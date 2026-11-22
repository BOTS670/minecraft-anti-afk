'use strict';

const MODE_LABELS = { look: 'Поворот камеры', step: 'Шаг вперёд и назад', jump: 'Прыжок' };
const $ = (id) => document.getElementById(id);
const el = {
  countdown: document.querySelector('.countdown'), timer: $('timer'), status: $('status'),
  clients: $('clients'), hint: $('clients-hint'), refresh: $('refresh'),
  interval: $('interval'), start: $('start'), stop: $('stop'),
  sClient: $('s-client'), sMode: $('s-mode'), sLast: $('s-last'), message: $('message'),
};

let state = { status: 'idle' };
let tickHandle = null;

function say(text, isError = false) {
  el.message.textContent = text || '';
  el.message.classList.toggle('error', isError);
}

function fmt(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderTimer() {
  if (state.status === 'running' && state.nextActionAt) {
    el.timer.textContent = fmt(Math.max(0, state.nextActionAt - Date.now()));
  } else {
    el.timer.textContent = '—';
  }
}

function render() {
  const running = state.status === 'running';
  el.countdown.classList.toggle('running', running);
  el.start.disabled = running;
  el.stop.disabled = !running;
  el.refresh.disabled = running;
  el.clients.disabled = running;
  el.interval.disabled = running;
  document.querySelectorAll('input[name=mode]').forEach((r) => { r.disabled = running; });

  if (running) el.status.textContent = 'Работает. Следующее действие через:';
  else if (state.status === 'stopped') el.status.textContent = state.stopReason || 'Остановлено';
  else el.status.textContent = 'Не запущено';

  el.sClient.textContent = state.client ? `${state.client.title || state.client.name} (PID ${state.client.pid})` : '—';
  el.sMode.textContent = state.mode ? MODE_LABELS[state.mode] : '—';
  const last = state.lastResult;
  el.sLast.textContent = !last ? '—' : `${new Date(last.at).toLocaleTimeString('ru-RU')}: ${last.ok ? 'выполнено' : 'ошибка — ' + last.error}`;

  renderTimer();
  if (running && tickHandle === null) tickHandle = setInterval(renderTimer, 250);
  if (!running && tickHandle !== null) { clearInterval(tickHandle); tickHandle = null; }
}

function applyState(s) { state = s; render(); }

async function refreshClients() {
  el.refresh.disabled = true;
  el.hint.textContent = 'Поиск…';
  const res = await window.antiAfk.listClients();
  el.refresh.disabled = state.status === 'running';
  el.clients.replaceChildren();
  if (!res.ok) { el.hint.textContent = ''; say(res.error, true); return; }
  say('');
  for (const c of res.data) {
    const o = document.createElement('option');
    o.value = String(c.pid);
    o.textContent = `${c.title || c.name} — PID ${c.pid}`;
    el.clients.append(o);
  }
  if (res.data.length) el.clients.selectedIndex = 0;
  el.hint.textContent = res.data.length ? '' : 'Клиенты не найдены. Запустите Minecraft Java Edition (окно должно быть открыто) и обновите список.';
}

el.refresh.addEventListener('click', refreshClients);

el.start.addEventListener('click', async () => {
  const pid = Number(el.clients.value);
  if (!pid) { say('Выберите клиент Minecraft из списка', true); return; }
  const mode = document.querySelector('input[name=mode]:checked').value;
  const intervalSec = Number(el.interval.value);
  const res = await window.antiAfk.start({ pid, mode, intervalSec });
  if (!res.ok) { say(res.error, true); return; }
  say('');
  applyState(res.data);
});

el.stop.addEventListener('click', async () => {
  const res = await window.antiAfk.stop();
  if (res.ok) applyState(res.data);
});

const upd = {
  block: document.querySelector('.update'),
  text: $('u-text'),
  check: $('u-check'),
  auto: $('u-auto'),
  install: $('u-install'),
  cancel: $('u-cancel'),
  open: $('u-open'),
};
let updateState = null;
let dismissedVersion = null;

function renderUpdate(u) {
  updateState = u;
  const texts = {
    disabled: 'Проверка обновлений не настроена (package.json → antiAfk.updateRepo)',
    idle: `Версия ${u.currentVersion}`,
    checking: 'Проверка обновлений…',
    'up-to-date': `Установлена последняя версия (${u.currentVersion})`,
    'no-releases': `Версия ${u.currentVersion}. На GitHub пока нет релизов`,
    available: u.installAvailable
      ? `Доступна версия ${u.latestVersion} (у вас ${u.currentVersion}). ${u.error ? `Ошибка: ${u.error}` : 'Скачать и установить?'}`
      : `Доступна версия ${u.latestVersion}, но установить её отсюда нельзя${u.error ? `: ${u.error}` : ''}`,
    downloading: `Скачивание версии ${u.latestVersion}…`,
    installing: 'Обновление проверено. Приложение перезапустится после установки.',
    error: `Не удалось проверить обновления: ${u.error}`,
  };
  upd.text.textContent = texts[u.status] || '';
  upd.block.classList.toggle('available', u.status === 'available');
  const canPrompt = u.status === 'available' && u.installAvailable && dismissedVersion !== u.latestVersion;
  upd.install.hidden = !canPrompt;
  upd.cancel.hidden = !canPrompt;
  upd.install.disabled = u.status === 'downloading' || u.status === 'installing';
  upd.open.hidden = u.status !== 'available';
  upd.check.disabled = ['checking', 'downloading', 'installing', 'disabled'].includes(u.status);
  upd.auto.checked = !!u.autoCheck;
  upd.auto.disabled = ['disabled', 'downloading', 'installing'].includes(u.status);
}

upd.check.addEventListener('click', () => window.antiAfk.checkUpdates());
upd.install.addEventListener('click', async () => {
  upd.install.disabled = true;
  const res = await window.antiAfk.installUpdate();
  if (!res.ok) { say(res.error, true); return; }
  renderUpdate(res.data);
});
upd.cancel.addEventListener('click', () => {
  dismissedVersion = updateState && updateState.latestVersion;
  renderUpdate(updateState);
});
upd.auto.addEventListener('change', async () => {
  const res = await window.antiAfk.setAutoUpdate(upd.auto.checked);
  if (res.ok) renderUpdate(res.data); else say(res.error, true);
});
upd.open.addEventListener('click', async () => {
  const res = await window.antiAfk.openUpdatePage();
  if (!res.ok) say(res.error, true);
});
window.antiAfk.onUpdate(renderUpdate);
window.antiAfk.getUpdateState().then((res) => { if (res.ok) renderUpdate(res.data); });

window.antiAfk.onState(applyState);
window.antiAfk.getState().then((res) => { if (res.ok) applyState(res.data); });
refreshClients();
