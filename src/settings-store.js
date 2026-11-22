'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MODES, MIN_INTERVAL_SEC, MAX_INTERVAL_SEC } = require('./validation');

const MAX_PROFILES = 20;
const MAX_HISTORY = 100;
const HISTORY_TYPES = new Set(['started', 'action', 'stopped']);

class SettingsStore {
  constructor(filePath) {
    this._filePath = filePath;
    this._settings = this._read();
  }

  _read() {
    let raw;
    try {
      raw = fs.readFileSync(this._filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { autoUpdateCheck: true, notifications: true, profiles: [], history: [] };
      }
      throw error;
    }

    let saved;
    try {
      saved = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Файл настроек повреждён: ${error.message}`);
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new Error('Файл настроек имеет неверный формат');
    }

    return {
      autoUpdateCheck: saved.autoUpdateCheck !== false,
      notifications: saved.notifications !== false,
      profiles: Array.isArray(saved.profiles)
        ? saved.profiles.map((profile) => this._validateStoredProfile(profile)).filter(Boolean).slice(0, MAX_PROFILES)
        : [],
      history: Array.isArray(saved.history)
        ? saved.history.map((entry) => this._validateStoredHistory(entry)).filter(Boolean).slice(0, MAX_HISTORY)
        : [],
    };
  }

  _validateStoredProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    if (typeof profile.id !== 'string' || typeof profile.name !== 'string' || !MODES.includes(profile.mode)) return null;
    if (!Number.isInteger(profile.intervalSec) || profile.intervalSec < MIN_INTERVAL_SEC || profile.intervalSec > MAX_INTERVAL_SEC) return null;
    return {
      id: profile.id.slice(0, 64),
      name: profile.name.trim().slice(0, 32),
      mode: profile.mode,
      intervalSec: profile.intervalSec,
    };
  }

  _validateStoredHistory(entry) {
    if (!entry || typeof entry !== 'object' || !HISTORY_TYPES.has(entry.type)) return null;
    if (!Number.isFinite(entry.at) || typeof entry.title !== 'string') return null;
    return {
      id: typeof entry.id === 'string' ? entry.id.slice(0, 64) : crypto.randomUUID(),
      type: entry.type,
      at: entry.at,
      title: entry.title.slice(0, 80),
      detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 160) : '',
      ok: entry.ok !== false,
    };
  }

  _persist() {
    fs.mkdirSync(path.dirname(this._filePath), { recursive: true });
    fs.writeFileSync(this._filePath, JSON.stringify(this._settings, null, 2), 'utf8');
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this._settings));
  }

  setAutoUpdateCheck(value) {
    if (typeof value !== 'boolean') throw new TypeError('Ожидается true/false');
    this._settings.autoUpdateCheck = value;
    this._persist();
    return this.snapshot();
  }

  setNotifications(value) {
    if (typeof value !== 'boolean') throw new TypeError('Ожидается true/false');
    this._settings.notifications = value;
    this._persist();
    return this.snapshot();
  }

  saveProfile(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Некорректный профиль');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 32) throw new RangeError('Название профиля должно содержать от 1 до 32 символов');
    if (!MODES.includes(input.mode)) throw new RangeError('Неизвестный режим активности');
    if (!Number.isInteger(input.intervalSec) || input.intervalSec < MIN_INTERVAL_SEC || input.intervalSec > MAX_INTERVAL_SEC) {
      throw new RangeError(`Интервал должен быть целым числом от ${MIN_INTERVAL_SEC} до ${MAX_INTERVAL_SEC} секунд`);
    }

    const existingIndex = input.id === undefined
      ? -1
      : this._settings.profiles.findIndex((profile) => profile.id === input.id);
    if (input.id !== undefined && existingIndex === -1) throw new Error('Профиль не найден');
    if (existingIndex === -1 && this._settings.profiles.length >= MAX_PROFILES) {
      throw new RangeError(`Можно сохранить не более ${MAX_PROFILES} профилей`);
    }
    if (this._settings.profiles.some((profile, index) => index !== existingIndex && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('Профиль с таким названием уже существует');
    }

    const profile = {
      id: existingIndex === -1 ? crypto.randomUUID() : this._settings.profiles[existingIndex].id,
      name,
      mode: input.mode,
      intervalSec: input.intervalSec,
    };
    if (existingIndex === -1) this._settings.profiles.unshift(profile);
    else this._settings.profiles[existingIndex] = profile;
    this._persist();
    return { ...profile };
  }

  deleteProfile(id) {
    if (typeof id !== 'string' || !id) throw new TypeError('Некорректный идентификатор профиля');
    const index = this._settings.profiles.findIndex((profile) => profile.id === id);
    if (index === -1) throw new Error('Профиль не найден');
    this._settings.profiles.splice(index, 1);
    this._persist();
    return this.snapshot();
  }

  recordHistory(entry) {
    const record = this._validateStoredHistory({
      id: crypto.randomUUID(),
      at: Date.now(),
      ...entry,
    });
    if (!record) throw new TypeError('Некорректная запись истории');
    this._settings.history.unshift(record);
    this._settings.history.length = Math.min(this._settings.history.length, MAX_HISTORY);
    this._persist();
    return { ...record };
  }

  clearHistory() {
    this._settings.history = [];
    this._persist();
    return [];
  }
}

module.exports = { SettingsStore, MAX_PROFILES, MAX_HISTORY };
