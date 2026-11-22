'use strict';

const MODES = {
  look: { label: 'Камера', short: 'КАМЕРА' },
  step: { label: 'Шаг', short: 'ШАГ' },
  jump: { label: 'Прыжок', short: 'ПРЫЖОК' },
};
const VIEW_TITLES = { overview: 'Обзор', profiles: 'Профили', history: 'История', settings: 'Настройки' };
const $ = (id) => document.getElementById(id);
const el = {
  views: document.querySelectorAll('.view'),
  nav: document.querySelectorAll('[data-view]'),
  title: $('page-title'),
  timer: $('timer'),
  timerProgress: $('timer-progress'),
  status: $('status'),
  liveDot: $('live-dot'),
  hero: document.querySelector('.hero-card'),
  heroMode: $('hero-mode'),
  heroClient: $('hero-client'),
  heroInterval: $('hero-interval'),
  clients: $('clients'),
  clientHint: $('clients-hint'),
  clientCount: $('client-count'),
  refresh: $('refresh'),
  interval: $('interval'),
  intervalOutput: $('interval-output'),
  intervalRow: document.querySelector('.interval-row'),
  start: $('start'),
  stop: $('stop'),
  message: $('message'),
  profiles: $('profiles-list'),
  overviewProfiles: $('overview-profiles'),
  profileCount: $('profile-count'),
  profileTotal: $('profiles-total'),
  profileEmpty: $('profiles-empty'),
  profileName: $('profile-name'),
  saveProfile: $('save-profile'),
  history: $('history-list'),
  historyEmpty: $('history-empty'),
  historyTotal: $('history-total'),
  clearHistory: $('clear-history'),
  todayActions: $('today-actions'),
  sessionDuration: $('session-duration'),
  sideStatus: $('side-status'),
  sideStatusCard: document.querySelector('.sidebar-status'),
  topStatus: $('top-status'),
  updateText: $('u-text'),
  updateCheck: $('u-check'),
  updateAuto: $('u-auto'),
  updateInstall: $('u-install'),
  updateCancel: $('u-cancel'),
  updateOpen: $('u-open'),
  notifications: $('notifications-toggle'),
};

let state = { status: 'idle', actionCount: 0 };
let settings = { profiles: [], history: [], notifications: true, autoUpdateCheck: true };
let updateState = null;
let dismissedVersion = null;
let timerHandle = null;

function showMessage(text, isError = false) {
  el.message.textContent = text || '';
  el.message.classList.toggle('error', isError);
}

function formatInterval(seconds) {
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} мин ${rest} сек` : `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} ч ${remainingMinutes} мин` : `${hours} ч`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}ч ${String(minutes).padStart(2, '0')}м`;
  if (minutes) return `${minutes}м ${String(seconds).padStart(2, '0')}с`;
  return `${seconds}с`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function setView(name) {
  if (!VIEW_TITLES[name]) return;
  el.views.forEach((view) => {
    const active = view.id === `view-${name}`;
    view.classList.toggle('active', active);
    view.hidden = !active;
  });
  el.nav.forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  el.title.textContent = VIEW_TITLES[name];
}

function selectedMode() {
  const choice = document.querySelector('input[name=mode]:checked');
  return choice ? choice.value : 'look';
}

function renderInterval() {
  el.intervalOutput.value = formatInterval(Number(el.interval.value));
  document.querySelectorAll('.preset-button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.interval) === Number(el.interval.value));
  });
}

function applyProfile(profile) {
  const mode = document.querySelector(`input[name=mode][value="${profile.mode}"]`);
  if (mode) {
    mode.checked = true;
    document.querySelectorAll('.mode-card').forEach((card) => card.classList.toggle('selected', card.contains(mode)));
  }
  el.interval.value = String(profile.intervalSec);
  renderInterval();
  showMessage(`Профиль «${profile.name}» применён`);
  setView('overview');
}

function applySession(nextState) {
  state = nextState;
  renderSession();
  if (nextState.status === 'stopped' && nextState.stopReason) showMessage(nextState.stopReason);
}

function renderSession() {
  const running = state.status === 'running';
  el.hero.classList.toggle('running', running);
  el.intervalRow.classList.toggle('running', running);
  el.start.disabled = running;
  el.stop.disabled = !running;
  el.refresh.disabled = running;
  el.clients.disabled = running;
  el.interval.disabled = running;
  document.querySelectorAll('input[name=mode]').forEach((radio) => { radio.disabled = running; });

  const statusText = running ? 'Работает' : state.status === 'stopped' ? (state.stopReason || 'Остановлено') : 'Не запущено';
  el.status.textContent = running ? 'Сессия активна' : statusText;
  el.sideStatus.textContent = running ? 'Активная сессия' : state.status === 'stopped' ? 'Сессия завершена' : 'Готов к работе';
  el.sideStatusCard.classList.toggle('running', running);
  el.sideStatusCard.classList.toggle('stopped', !running);
  el.topStatus.classList.toggle('running', running);
  el.topStatus.classList.toggle('stopped', !running);
  el.topStatus.lastElementChild.textContent = running ? 'Активна' : 'Остановлена';
  el.liveDot.classList.toggle('running', running);

  const mode = MODES[state.mode] || null;
  el.heroMode.textContent = mode ? mode.short : 'РЕЖИМ НЕ ВЫБРАН';
  el.heroClient.textContent = state.client
    ? `${state.client.title || state.client.name} · PID ${state.client.pid}`
    : 'Выберите запущенный клиент Minecraft';
  el.heroInterval.textContent = state.intervalSec ? `ИНТЕРВАЛ ${formatInterval(state.intervalSec).toUpperCase()}` : 'ИНТЕРВАЛ —';
  el.todayActions.textContent = String(todayActionCount());

  if (running && state.startedAt) {
    el.sessionDuration.textContent = formatDuration(Date.now() - state.startedAt);
    el.timer.textContent = state.nextActionAt ? formatDuration(Math.max(0, state.nextActionAt - Date.now())) : '—';
    const remaining = state.nextActionAt ? Math.max(0, state.nextActionAt - Date.now()) : state.intervalSec * 1000;
    const progress = state.intervalSec ? 1 - remaining / (state.intervalSec * 1000) : 0;
    el.timerProgress.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  } else {
    el.sessionDuration.textContent = '—';
    el.timer.textContent = '--:--';
    el.timerProgress.style.width = '0%';
  }

  if (running && timerHandle === null) timerHandle = setInterval(renderSession, 1000);
  if (!running && timerHandle !== null) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

function todayActionCount() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return settings.history.filter((entry) => entry.type === 'action' && entry.ok && entry.at >= startOfDay.getTime()).length;
}

function makeProfileTile(profile, compact = false) {
  const button = document.createElement(compact ? 'button' : 'article');
  if (compact) button.type = 'button';
  button.className = compact ? 'profile-tile' : 'profile-card';
  const title = document.createElement('strong');
  title.textContent = profile.name;
  const meta = document.createElement('span');
  meta.textContent = `${MODES[profile.mode]?.label || profile.mode} · ${formatInterval(profile.intervalSec)}`;
  button.append(title, meta);

  if (compact) {
    const arrow = document.createElement('span');
    arrow.className = 'profile-arrow';
    arrow.textContent = '↗';
    button.append(arrow);
    button.addEventListener('click', () => applyProfile(profile));
    return button;
  }

  const actions = document.createElement('div');
  actions.className = 'profile-actions';
  const useButton = document.createElement('button');
  useButton.type = 'button';
  useButton.textContent = 'Применить';
  useButton.addEventListener('click', () => applyProfile(profile));
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-profile';
  deleteButton.textContent = 'Удалить';
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm(`Удалить профиль «${profile.name}»?`)) return;
    const result = await window.antiAfk.deleteProfile(profile.id);
    if (!result.ok) { showMessage(result.error, true); return; }
    settings.profiles = result.data.profiles;
    renderProfiles();
    showMessage('Профиль удалён');
  });
  actions.append(useButton, deleteButton);
  button.append(actions);
  return button;
}

function renderProfiles() {
  el.profiles.replaceChildren();
  el.overviewProfiles.replaceChildren();
  el.profileCount.textContent = String(settings.profiles.length);
  el.profileTotal.textContent = `${settings.profiles.length} из 20`;
  el.profileEmpty.hidden = settings.profiles.length > 0;

  settings.profiles.forEach((profile) => {
    el.profiles.append(makeProfileTile(profile));
  });
  settings.profiles.slice(0, 3).forEach((profile) => {
    el.overviewProfiles.append(makeProfileTile(profile, true));
  });
  if (!settings.profiles.length) {
    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'profile-tile empty';
    empty.textContent = '＋  Сохранить первый профиль';
    empty.addEventListener('click', () => setView('profiles'));
    el.overviewProfiles.append(empty);
  }
}

function renderHistory() {
  el.history.replaceChildren();
  el.historyTotal.textContent = `${settings.history.length} событий`;
  el.historyEmpty.hidden = settings.history.length > 0;
  settings.history.forEach((entry) => {
    const row = document.createElement('article');
    row.className = `history-row${entry.ok === false ? ' failed' : ''}${entry.type === 'stopped' ? ' stopped' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'history-icon';
    icon.textContent = entry.type === 'started' ? '▶' : entry.type === 'stopped' ? '■' : entry.ok === false ? '!' : '✓';
    const copy = document.createElement('div');
    copy.className = 'history-copy';
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const detail = document.createElement('small');
    detail.textContent = entry.detail || '—';
    copy.append(title, detail);
    const time = document.createElement('time');
    time.className = 'history-time';
    time.dateTime = new Date(entry.at).toISOString();
    time.textContent = formatTime(entry.at);
    row.append(icon, copy, time);
    el.history.append(row);
  });
  el.todayActions.textContent = String(todayActionCount());
}

async function loadClients() {
  const oldValue = el.clients.value;
  el.refresh.disabled = true;
  el.clientCount.textContent = 'ПОИСК…';
  el.clientHint.textContent = 'Ищем открытые окна Minecraft Java…';
  try {
    const result = await window.antiAfk.listClients();
    el.clients.replaceChildren();
    if (!result.ok) {
      el.clientHint.textContent = result.error;
      el.clientCount.textContent = 'ОШИБКА ПОИСКА';
      showMessage(result.error, true);
      return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = result.data.length ? 'Выбери игровой клиент' : 'Клиенты не найдены';
    el.clients.append(placeholder);
    result.data.forEach((client) => {
      const option = document.createElement('option');
      option.value = String(client.pid);
      option.textContent = `${client.title || client.name} · PID ${client.pid}`;
      el.clients.append(option);
    });
    el.clients.value = result.data.some((client) => String(client.pid) === oldValue) ? oldValue : '';
    el.clientCount.textContent = result.data.length ? `${result.data.length} НАЙДЕНО` : 'НЕТ ОКОН';
    el.clientHint.textContent = result.data.length
      ? 'Выбери окно, в котором открыт игровой мир.'
      : 'Запусти Minecraft Java Edition, затем обнови список.';
  } catch (error) {
    el.clientCount.textContent = 'ОШИБКА ПОИСКА';
    el.clientHint.textContent = error.message || 'Не удалось прочитать список окон';
    showMessage(el.clientHint.textContent, true);
  } finally {
    el.refresh.disabled = state.status === 'running';
  }
}

function renderUpdate(update) {
  updateState = update;
  const texts = {
    disabled: 'Проверка обновлений отключена.',
    idle: `Текущая версия ${update.currentVersion}`,
    checking: 'Проверяем GitHub Releases…',
    'up-to-date': `Установлена последняя версия ${update.currentVersion}.`,
    'no-releases': 'Для этого проекта пока нет опубликованных релизов.',
    available: update.installAvailable
      ? `Доступна версия ${update.latestVersion}. Установить сейчас?`
      : `Доступна версия ${update.latestVersion}${update.error ? ` · ${update.error}` : ''}`,
    downloading: `Проверяем и скачиваем версию ${update.latestVersion}…`,
    installing: 'Проверка завершена. Приложение перезапустится после установки.',
    error: `Не удалось проверить обновления: ${update.error}`,
  };
  el.updateText.textContent = texts[update.status] || '';
  const canInstall = update.status === 'available' && update.installAvailable && dismissedVersion !== update.latestVersion;
  el.updateInstall.hidden = !canInstall;
  el.updateCancel.hidden = !canInstall;
  el.updateInstall.disabled = ['downloading', 'installing'].includes(update.status);
  el.updateOpen.hidden = update.status !== 'available';
  el.updateCheck.disabled = ['checking', 'downloading', 'installing', 'disabled'].includes(update.status);
  el.updateAuto.checked = !!update.autoCheck;
  el.updateAuto.disabled = ['disabled', 'downloading', 'installing'].includes(update.status);
  $('version').textContent = `v${update.currentVersion}`;
  $('settings-version').textContent = `v${update.currentVersion}`;
}

async function initialize() {
  await Promise.all([
    loadClients(),
    window.antiAfk.getState().then((result) => { if (result.ok) applySession(result.data); }),
    window.antiAfk.getSettings().then((result) => {
      if (!result.ok) { showMessage(result.error, true); return; }
      settings = result.data;
      el.notifications.checked = settings.notifications;
      el.updateAuto.checked = settings.autoUpdateCheck;
      renderProfiles();
      renderHistory();
      renderSession();
    }),
    window.antiAfk.getUpdateState().then((result) => { if (result.ok) renderUpdate(result.data); }),
  ]);
}

el.nav.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));
el.refresh.addEventListener('click', loadClients);
el.interval.addEventListener('input', renderInterval);

document.querySelectorAll('input[name=mode]').forEach((radio) => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.mode-card').forEach((card) => {
      const cardRadio = card.querySelector('input[name=mode]');
      card.classList.toggle('selected', Boolean(cardRadio && cardRadio.checked));
    });
  });
});

document.querySelectorAll('.preset-button').forEach((button) => {
  button.addEventListener('click', () => {
    el.interval.value = button.dataset.interval;
    renderInterval();
  });
});

el.start.addEventListener('click', async () => {
  const pid = Number(el.clients.value);
  if (!pid) { showMessage('Сначала выбери окно Minecraft.', true); return; }
  el.start.disabled = true;
  const result = await window.antiAfk.start({
    pid,
    mode: selectedMode(),
    intervalSec: Number(el.interval.value),
  });
  if (!result.ok) { showMessage(result.error, true); el.start.disabled = false; return; }
  showMessage('');
  applySession(result.data);
});

el.stop.addEventListener('click', async () => {
  const result = await window.antiAfk.stop();
  if (result.ok) applySession(result.data);
  else showMessage(result.error, true);
});

el.saveProfile.addEventListener('click', async () => {
  const name = el.profileName.value.trim();
  if (!name) { showMessage('Введи название профиля.', true); setView('profiles'); el.profileName.focus(); return; }
  const result = await window.antiAfk.saveProfile({
    name,
    mode: selectedMode(),
    intervalSec: Number(el.interval.value),
  });
  if (!result.ok) { showMessage(result.error, true); return; }
  settings.profiles = result.data.profiles;
  el.profileName.value = '';
  renderProfiles();
  showMessage(`Профиль «${name}» сохранён`);
});

el.clearHistory.addEventListener('click', async () => {
  if (!settings.history.length || !window.confirm('Очистить всю историю активности?')) return;
  const result = await window.antiAfk.clearHistory();
  if (!result.ok) { showMessage(result.error, true); return; }
  settings.history = result.data;
  renderHistory();
});

el.notifications.addEventListener('change', async () => {
  const result = await window.antiAfk.setNotifications(el.notifications.checked);
  if (!result.ok) { showMessage(result.error, true); el.notifications.checked = settings.notifications; return; }
  settings.notifications = result.data.notifications;
});

el.updateCheck.addEventListener('click', () => window.antiAfk.checkUpdates());
el.updateInstall.addEventListener('click', async () => {
  el.updateInstall.disabled = true;
  const result = await window.antiAfk.installUpdate();
  if (!result.ok) { showMessage(result.error, true); return; }
  renderUpdate(result.data);
});
el.updateCancel.addEventListener('click', () => {
  dismissedVersion = updateState && updateState.latestVersion;
  renderUpdate(updateState);
});
el.updateAuto.addEventListener('change', async () => {
  const result = await window.antiAfk.setAutoUpdate(el.updateAuto.checked);
  if (!result.ok) { showMessage(result.error, true); return; }
  settings.autoUpdateCheck = result.data.autoCheck;
  renderUpdate(result.data);
});
el.updateOpen.addEventListener('click', async () => {
  const result = await window.antiAfk.openUpdatePage();
  if (!result.ok) showMessage(result.error, true);
});
$('repo-link').addEventListener('click', async (event) => {
  event.preventDefault();
  const result = await window.antiAfk.openRepository();
  if (!result.ok) showMessage(result.error, true);
});

window.antiAfk.onState(applySession);
window.antiAfk.onUpdate(renderUpdate);
window.antiAfk.onHistory((snapshot) => {
  settings.history = snapshot.history;
  renderHistory();
});
renderInterval();
initialize();
