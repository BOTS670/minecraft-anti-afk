'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SettingsStore, MAX_HISTORY, MAX_PROFILES } = require('../src/settings-store');

function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new SettingsStore(path.join(directory, 'settings.json'));
}

test('settings store persists profiles and notification preferences', (t) => {
  const store = temporaryStore(t);
  const profile = store.saveProfile({ name: 'Mining', mode: 'step', intervalSec: 90 });
  store.setNotifications(false);
  store.setAutoUpdateCheck(false);

  assert.equal(store.snapshot().profiles[0].id, profile.id);
  assert.equal(store.snapshot().notifications, false);
  assert.equal(store.snapshot().autoUpdateCheck, false);
});

test('profiles can be updated and deleted; duplicate names are rejected', (t) => {
  const store = temporaryStore(t);
  const profile = store.saveProfile({ name: 'Base', mode: 'jump', intervalSec: 60 });
  store.saveProfile({ id: profile.id, name: 'Base', mode: 'look', intervalSec: 120 });
  assert.equal(store.snapshot().profiles.length, 1);
  assert.equal(store.snapshot().profiles[0].mode, 'look');
  store.saveProfile({ name: 'Second', mode: 'step', intervalSec: 60 });
  assert.throws(() => store.saveProfile({ name: 'base', mode: 'jump', intervalSec: 60 }), /уже существует/);
  store.deleteProfile(profile.id);
  assert.equal(store.snapshot().profiles.length, 1);
});

test('profile validation and limits are enforced', (t) => {
  const store = temporaryStore(t);
  assert.throws(() => store.saveProfile({ name: '', mode: 'jump', intervalSec: 60 }), /Название/);
  assert.throws(() => store.saveProfile({ name: 'Bad', mode: 'unknown', intervalSec: 60 }), /режим/);
  for (let index = 0; index < MAX_PROFILES; index++) {
    store.saveProfile({ name: `Profile ${index}`, mode: 'jump', intervalSec: 60 });
  }
  assert.throws(() => store.saveProfile({ name: 'Too many', mode: 'jump', intervalSec: 60 }), /не более/);
});

test('history is newest-first, bounded, and clearable', (t) => {
  const store = temporaryStore(t);
  for (let index = 0; index < MAX_HISTORY + 2; index++) {
    store.recordHistory({ type: 'action', title: `Action ${index}`, detail: '', ok: true });
  }
  const history = store.snapshot().history;
  assert.equal(history.length, MAX_HISTORY);
  assert.equal(history[0].title, `Action ${MAX_HISTORY + 1}`);
  assert.deepEqual(store.clearHistory(), []);
});
