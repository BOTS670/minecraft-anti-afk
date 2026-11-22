'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler } = require('../src/scheduler');
const { Session, MAX_CONSECUTIVE_FAILURES } = require('../src/session');
const { fakeClock } = require('./helpers');

const CLIENT = { pid: 4242, name: 'javaw', title: 'Minecraft 1.20.1', startedAt: null };

function make({ alive = new Set([4242]), send } = {}) {
  const clock = fakeClock();
  const sent = [];
  const states = [];
  const session = new Session({
    sendAction: send || (async (pid, mode) => { sent.push([pid, mode]); }),
    isAlive: (pid) => alive.has(pid),
    scheduler: new Scheduler(clock),
    watchMs: 1000,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    onChange: (s) => states.push(s),
  });
  return { clock, session, sent, alive, states };
}

test('запуск выставляет состояние и время следующего действия', () => {
  const { clock, session } = make();
  session.start({ client: CLIENT, mode: 'jump', intervalSec: 20 });
  const s = session.snapshot();
  assert.equal(s.status, 'running');
  assert.equal(s.client.pid, 4242);
  assert.equal(s.mode, 'jump');
  assert.equal(s.nextActionAt, clock.now() + 20_000);
});

test('действие выполняется по таймеру для выбранного PID и режима', async () => {
  const { clock, session, sent } = make();
  session.start({ client: CLIENT, mode: 'look', intervalSec: 10 });
  await clock.advance(25_000);
  assert.deepEqual(sent, [[4242, 'look'], [4242, 'look']]);
  assert.equal(session.snapshot().lastResult.ok, true);
});

test('закрытие процесса между действиями останавливает сессию (слежение)', async () => {
  const { clock, session, sent, alive } = make();
  session.start({ client: CLIENT, mode: 'jump', intervalSec: 60 });
  await clock.advance(5_000);
  alive.delete(4242);
  await clock.advance(1_000);
  const s = session.snapshot();
  assert.equal(s.status, 'stopped');
  assert.equal(s.stopReason, 'Процесс Minecraft закрыт');
  assert.equal(s.nextActionAt, null);
  await clock.advance(300_000);
  assert.equal(sent.length, 0);
  assert.equal(clock.timerCount, 0);
});

test('процесс закрыт прямо перед действием — ввод не отправляется', async () => {
  const { clock, session, sent, alive } = make();
  session.start({ client: CLIENT, mode: 'jump', intervalSec: 10 });
  alive.delete(4242);
  await clock.advance(10_000);
  assert.equal(sent.length, 0);
  assert.equal(session.snapshot().status, 'stopped');
});

test('запуск для отсутствующего процесса отклоняется', () => {
  const { session } = make({ alive: new Set() });
  assert.throws(() => session.start({ client: CLIENT, mode: 'jump', intervalSec: 10 }), /не найден/);
  assert.equal(session.snapshot().status, 'idle');
});

test('повторный запуск во время работы отклоняется', () => {
  const { session } = make();
  session.start({ client: CLIENT, mode: 'jump', intervalSec: 10 });
  assert.throws(() => session.start({ client: CLIENT, mode: 'jump', intervalSec: 10 }), /Уже запущено/);
});

test('ручная остановка снимает все таймеры и идемпотентна', async () => {
  const { clock, session, sent, states } = make();
  session.start({ client: CLIENT, mode: 'jump', intervalSec: 10 });
  session.stop();
  const count = states.length;
  session.stop();
  assert.equal(states.length, count);
  await clock.advance(60_000);
  assert.equal(sent.length, 0);
  assert.equal(clock.timerCount, 0);
  assert.equal(session.snapshot().stopReason, 'Остановлено пользователем');
});

test(`после ${MAX_CONSECUTIVE_FAILURES} неудач подряд сессия останавливается`, async () => {
  const { clock, session } = make({ send: async () => { throw new Error('окно не активно'); } });
  session.start({ client: CLIENT, mode: 'jump', intervalSec: 10 });
  await clock.advance(10_000);
  assert.equal(session.snapshot().status, 'running');
  assert.equal(session.snapshot().lastResult.ok, false);
  await clock.advance(20_000);
  assert.equal(session.snapshot().status, 'stopped');
  assert.match(session.snapshot().stopReason, /неудач/);
});

test('можно запустить заново после остановки', async () => {
  const { clock, session, sent, alive } = make();
  session.start({ client: CLIENT, mode: 'jump', intervalSec: 10 });
  alive.delete(4242);
  await clock.advance(1_000);
  alive.add(4242);
  session.start({ client: CLIENT, mode: 'step', intervalSec: 10 });
  await clock.advance(10_000);
  assert.deepEqual(sent, [[4242, 'step']]);
});
