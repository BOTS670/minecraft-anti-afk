'use strict';

const MODES = Object.freeze(['look', 'step', 'jump']);
const MIN_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 3600;

function validateStart(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Некорректные параметры запуска');
  }
  const { pid, mode, intervalSec } = payload;
  if (!Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) {
    throw new RangeError('Некорректный PID');
  }
  if (typeof mode !== 'string' || !MODES.includes(mode)) {
    throw new RangeError('Неизвестный режим активности');
  }
  if (!Number.isInteger(intervalSec) || intervalSec < MIN_INTERVAL_SEC || intervalSec > MAX_INTERVAL_SEC) {
    throw new RangeError(`Интервал должен быть целым числом от ${MIN_INTERVAL_SEC} до ${MAX_INTERVAL_SEC} секунд`);
  }
  return { pid, mode, intervalSec };
}

module.exports = { MODES, MIN_INTERVAL_SEC, MAX_INTERVAL_SEC, validateStart };
