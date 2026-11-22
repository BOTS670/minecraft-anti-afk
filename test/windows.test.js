'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { resolveScriptsDir, describeScriptError } = require('../src/windows');

test('packaged app resolves PowerShell scripts from Electron resources', () => {
  assert.equal(
    resolveScriptsDir(true, 'C:\\Apps\\Minecraft Anti-AFK\\resources'),
    path.join('C:\\Apps\\Minecraft Anti-AFK\\resources', 'scripts'),
  );
});

test('development app resolves PowerShell scripts from the project folder', () => {
  assert.equal(
    resolveScriptsDir(false),
    path.join(__dirname, '..', 'scripts'),
  );
});

test('PowerShell error codes are translated into useful messages', () => {
  assert.match(describeScriptError('ERR_NO_FOCUS\r\n'), /активировать окно/);
  assert.equal(describeScriptError('ERR_NO_PROCESS'), 'Процесс не найден');
  assert.equal(describeScriptError('\n  Ошибка теста\nподробности'), 'Ошибка теста');
  assert.equal(describeScriptError('', 'резервное сообщение'), 'резервное сообщение');
  assert.equal(describeScriptError('x'.repeat(500)).length, 300);
});
