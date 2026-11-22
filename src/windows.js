'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const { parseClients } = require('./clients');

const SCRIPT_ERRORS = {
  ERR_NO_PROCESS: 'Процесс не найден',
  ERR_NOT_JAVA: 'Это не Java-процесс',
  ERR_NO_WINDOW: 'У процесса нет окна',
  ERR_NO_FOCUS: 'Не удалось активировать окно Minecraft; ввод не отправлен',
};

function describeScriptError(stderr, fallback = 'Ошибка PowerShell') {
  const text = String(stderr || '');
  const code = /ERR_[A-Z_]+/.exec(text);
  if (code && SCRIPT_ERRORS[code[0]]) return SCRIPT_ERRORS[code[0]];
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return (firstLine || fallback).slice(0, 300);
}

function resolveScriptsDir(isPackaged, resourcesPath) {
  return isPackaged
    ? path.join(resourcesPath, 'scripts')
    : path.join(__dirname, '..', 'scripts');
}

const SCRIPTS_DIR = resolveScriptsDir(
  Boolean(process.versions.electron && !process.defaultApp),
  process.resourcesPath,
);

function runPowerShell(scriptName, args = [], timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS_DIR, scriptName), ...args],
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(describeScriptError(stderr, err.message)));
        resolve(stdout);
      },
    );
  });
}

async function listClients() {
  return parseClients(await runPowerShell('list-clients.ps1'));
}

// Аргументы уже провалидированы (целое pid и режим из белого списка) и передаются массивом, не строкой команды.
function sendAction(pid, mode) {
  return runPowerShell('send-input.ps1', ['-ProcessId', String(pid), '-Action', mode], 15000);
}

module.exports = { listClients, sendAction, resolveScriptsDir, describeScriptError };
