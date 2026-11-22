'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStart } = require('../src/validation');
const { parseClients, isProcessAlive } = require('../src/clients');

test('validateStart принимает корректные параметры', () => {
  assert.deepEqual(validateStart({ pid: 123, mode: 'jump', intervalSec: 30, extra: 1 }), { pid: 123, mode: 'jump', intervalSec: 30 });
});

test('validateStart отклоняет некорректные данные', () => {
  for (const bad of [null, [], 'x', {}, { pid: '1', mode: 'jump', intervalSec: 30 }, { pid: 0, mode: 'jump', intervalSec: 30 },
    { pid: 1, mode: 'rm -rf', intervalSec: 30 }, { pid: 1, mode: 'jump', intervalSec: 4 }, { pid: 1, mode: 'jump', intervalSec: 3601 },
    { pid: 1, mode: 'jump', intervalSec: 10.5 }, { pid: 1.5, mode: 'jump', intervalSec: 10 }]) {
    assert.throws(() => validateStart(bad), undefined, JSON.stringify(bad));
  }
});

test('parseClients: пусто, один объект, массив, мусор', () => {
  assert.deepEqual(parseClients(''), []);
  assert.deepEqual(parseClients('[]'), []);
  assert.equal(parseClients('{"pid":5,"name":"javaw","title":"Minecraft 1.20"}')[0].pid, 5);
  assert.equal(parseClients('[{"pid":1},{"pid":"x"},null,{"pid":-3}]').length, 1);
  assert.throws(() => parseClients('not json'));
});

test('isProcessAlive: живой, отсутствующий, нет прав', () => {
  assert.equal(isProcessAlive(1, () => true), true);
  assert.equal(isProcessAlive(1, () => { throw Object.assign(new Error(), { code: 'ESRCH' }); }), false);
  assert.equal(isProcessAlive(1, () => { throw Object.assign(new Error(), { code: 'EPERM' }); }), true);
  assert.equal(isProcessAlive(process.pid), true);
});
