'use strict';

/**
 * Периодический таймер без накопления дрейфа.
 * Время следующего запуска считается от плановой отметки, а не от конца задачи.
 * Часы и таймеры внедряются, поэтому класс тестируется без реального ожидания.
 */
class Scheduler {
  constructor({ now = Date.now, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout } = {}) {
    this._now = now;
    this._set = st;
    this._clear = ct;
    this._timer = null;
    this._gen = 0;
    this.running = false;
    this.nextAt = null;
    this.intervalMs = 0;
  }

  start(intervalMs, task, onSchedule = () => {}) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('Некорректный интервал');
    this.stop();
    this.running = true;
    this.intervalMs = intervalMs;
    this._task = task;
    this._onSchedule = onSchedule;
    this.nextAt = this._now() + intervalMs;
    this._arm();
  }

  _arm() {
    this._onSchedule(this.nextAt);
    const delay = Math.max(0, this.nextAt - this._now());
    this._timer = this._set(() => this._fire(), delay);
  }

  async _fire() {
    const gen = this._gen;
    this._timer = null;
    try {
      await this._task();
    } catch {
      /* ошибки задачи обрабатывает вызывающий код */
    }
    if (!this.running || gen !== this._gen) return;
    this.nextAt += this.intervalMs;
    const now = this._now();
    if (this.nextAt <= now) this.nextAt = now + this.intervalMs; // пропущенные тики не догоняем
    this._arm();
  }

  stop() {
    this.running = false;
    this._gen += 1;
    if (this._timer !== null) this._clear(this._timer);
    this._timer = null;
    this.nextAt = null;
  }

  msUntilNext() {
    return this.nextAt === null ? null : Math.max(0, this.nextAt - this._now());
  }
}

module.exports = { Scheduler };
