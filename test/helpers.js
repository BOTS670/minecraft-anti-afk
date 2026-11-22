'use strict';

/** Управляемые часы и таймеры для детерминированных тестов. */
function fakeClock() {
  let t = 1_000_000;
  let id = 0;
  const timers = new Map();
  const api = {
    now: () => t,
    setTimeout: (fn, ms) => { const k = ++id; timers.set(k, { at: t + ms, fn, every: null }); return k; },
    clearTimeout: (k) => timers.delete(k),
    setInterval: (fn, ms) => { const k = ++id; timers.set(k, { at: t + ms, fn, every: ms }); return k; },
    clearInterval: (k) => timers.delete(k),
    get timerCount() { return timers.size; },
    /** Двигает время вперёд, запуская таймеры по порядку и дожидаясь асинхронных задач. */
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [k, v] of timers) if (v.at <= end && (!next || v.at < next.v.at)) next = { k, v };
        if (!next) break;
        t = Math.max(t, next.v.at);
        if (next.v.every) next.v.at += next.v.every; else timers.delete(next.k);
        next.v.fn();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      t = end;
    },
  };
  return api;
}

module.exports = { fakeClock };
