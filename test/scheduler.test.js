'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler } = require('../src/scheduler');
const { fakeClock } = require('./helpers');

function make() {
  const clock = fakeClock();
  const scheduler = new Scheduler(clock);
  return { clock, scheduler };
}

test('задача срабатывает строго по интервалу', async () => {
  const { clock, scheduler } = make();
  const calls = [];
  scheduler.start(10_000, async () => { calls.push(clock.now()); });
  await clock.advance(9_999);
  assert.equal(calls.length, 0);
  await clock.advance(1);
  assert.equal(calls.length, 1);
  await clock.advance(30_000);
  assert.equal(calls.length, 4);
});

test('msUntilNext убывает и сбрасывается после срабатывания', async () => {
  const { clock, scheduler } = make();
  scheduler.start(10_000, async () => {});
  assert.equal(scheduler.msUntilNext(), 10_000);
  await clock.advance(4_000);
  assert.equal(scheduler.msUntilNext(), 6_000);
  await clock.advance(6_000);
  assert.equal(scheduler.msUntilNext(), 10_000);
});

test('медленная задача не накапливает дрейф', async () => {
  const { clock, scheduler } = make();
  const starts = [];
  const t0 = clock.now();
  scheduler.start(10_000, () => { starts.push(clock.now() - t0); return new Promise((r) => clock.setTimeout(r, 3_000)); });
  await clock.advance(35_000);
  assert.deepEqual(starts, [10_000, 20_000, 30_000]);
});

test('onSchedule получает время следующего запуска', async () => {
  const { clock, scheduler } = make();
  const seen = [];
  const t0 = clock.now();
  scheduler.start(5_000, async () => {}, (at) => seen.push(at - t0));
  await clock.advance(10_000);
  assert.deepEqual(seen, [5_000, 10_000, 15_000]);
});

test('stop отменяет таймер и сбрасывает состояние', async () => {
  const { clock, scheduler } = make();
  let n = 0;
  scheduler.start(5_000, async () => { n++; });
  scheduler.stop();
  await clock.advance(60_000);
  assert.equal(n, 0);
  assert.equal(scheduler.msUntilNext(), null);
  assert.equal(clock.timerCount, 0);
});

test('stop во время выполнения задачи не планирует следующий запуск', async () => {
  const { clock, scheduler } = make();
  let n = 0;
  scheduler.start(5_000, async () => { n++; scheduler.stop(); });
  await clock.advance(60_000);
  assert.equal(n, 1);
  assert.equal(clock.timerCount, 0);
});

test('некорректный интервал отклоняется', () => {
  const { scheduler } = make();
  assert.throws(() => scheduler.start(0, async () => {}));
  assert.throws(() => scheduler.start(NaN, async () => {}));
});
