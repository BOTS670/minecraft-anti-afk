'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeScriptError } = require('../src/windows');

test('.ps1 скрипты содержат только ASCII (иначе PowerShell 5.1 ломает разбор файла без BOM)', () => {
  const dir = path.join(__dirname, '..', 'scripts');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ps1'));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const bad = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').findIndex((l) => /[^\x00-\x7F]/.test(l));
    assert.equal(bad, -1, `${f}: не-ASCII символ в строке ${bad + 1}`);
  }
});

test('describeScriptError переводит коды и обрезает прочий вывод', () => {
  assert.match(describeScriptError('ERR_NO_FOCUS\r\n'), /активировать окно/);
  assert.equal(describeScriptError('ERR_NO_PROCESS'), 'Процесс не найден');
  assert.equal(describeScriptError('\n  Какая-то ошибка\nвторая строка'), 'Какая-то ошибка');
  assert.equal(describeScriptError('', 'запасной'), 'запасной');
  assert.equal(describeScriptError('x'.repeat(500)).length, 300);
});
