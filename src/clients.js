'use strict';

/** Разбирает JSON из list-clients.ps1 и оставляет только корректные записи. */
function parseClients(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Не удалось разобрать список процессов');
  }
  if (!Array.isArray(data)) data = [data];
  return data
    .filter((c) => c && Number.isInteger(c.pid) && c.pid > 0)
    .map((c) => ({
      pid: c.pid,
      name: String(c.name || 'java').slice(0, 64),
      title: String(c.title || '').slice(0, 200),
      startedAt: typeof c.startedAt === 'string' ? c.startedAt : null,
    }));
}

/** Проверка существования процесса без запуска внешних команд. EPERM = процесс есть. */
function isProcessAlive(pid, kill = process.kill.bind(process)) {
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return !!err && err.code === 'EPERM';
  }
}

module.exports = { parseClients, isProcessAlive };
