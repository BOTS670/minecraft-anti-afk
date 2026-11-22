'use strict';

const MAX_CONSECUTIVE_FAILURES = 3;

class Session {
  /**
   * @param {object} deps
   * @param {(pid:number, mode:string)=>Promise<void>} deps.sendAction
   * @param {(pid:number)=>boolean} deps.isAlive
   * @param {object} deps.scheduler  экземпляр Scheduler
   */
  constructor({ sendAction, isAlive, scheduler, watchMs = 1000, setInterval: si = setInterval, clearInterval: ci = clearInterval, onChange = () => {} }) {
    this._send = sendAction;
    this._isAlive = isAlive;
    this._scheduler = scheduler;
    this._watchMs = watchMs;
    this._setInterval = si;
    this._clearInterval = ci;
    this._onChange = onChange;
    this._watch = null;
    this._failures = 0;
    this._state = {
      status: 'idle',
      client: null,
      mode: null,
      intervalSec: null,
      nextActionAt: null,
      lastResult: null,
      stopReason: null,
      startedAt: null,
      actionCount: 0,
    };
  }

  snapshot() {
    return { ...this._state, client: this._state.client ? { ...this._state.client } : null };
  }

  _emit() {
    this._onChange(this.snapshot());
  }

  start({ client, mode, intervalSec }) {
    if (this._state.status === 'running') throw new Error('Уже запущено');
    if (!this._isAlive(client.pid)) throw new Error('Выбранный процесс Minecraft не найден');
    this._failures = 0;
    this._state = {
      status: 'running',
      client,
      mode,
      intervalSec,
      nextActionAt: null,
      lastResult: null,
      stopReason: null,
      startedAt: Date.now(),
      actionCount: 0,
    };
    this._scheduler.start(
      intervalSec * 1000,
      () => this._act(),
      (at) => {
        this._state.nextActionAt = at;
        this._emit();
      },
    );
    this._watch = this._setInterval(() => {
      if (this._state.status === 'running' && !this._isAlive(this._state.client.pid)) {
        this.stop('Процесс Minecraft закрыт');
      }
    }, this._watchMs);
  }

  async _act() {
    const { client, mode } = this._state;
    if (this._state.status !== 'running') return;
    if (!this._isAlive(client.pid)) {
      this.stop('Процесс Minecraft закрыт');
      return;
    }
    try {
      await this._send(client.pid, mode);
      this._failures = 0;
      if (this._state.status === 'running') {
        this._state.actionCount += 1;
        this._state.lastResult = { ok: true, at: Date.now() };
      }
    } catch (err) {
      this._failures += 1;
      if (this._state.status !== 'running') return;
      this._state.actionCount += 1;
      this._state.lastResult = { ok: false, at: Date.now(), error: String((err && err.message) || err).slice(0, 300) };
      if (!this._isAlive(client.pid)) this.stop('Процесс Minecraft закрыт');
      else if (this._failures >= MAX_CONSECUTIVE_FAILURES) this.stop(`Остановлено после ${MAX_CONSECUTIVE_FAILURES} неудач подряд`);
    }
    if (this._state.status === 'running') this._emit();
  }

  stop(reason = 'Остановлено пользователем') {
    if (this._state.status !== 'running') return;
    this._scheduler.stop();
    if (this._watch !== null) this._clearInterval(this._watch);
    this._watch = null;
    this._state.status = 'stopped';
    this._state.nextActionAt = null;
    this._state.stopReason = reason;
    this._emit();
  }
}

module.exports = { Session, MAX_CONSECUTIVE_FAILURES };
