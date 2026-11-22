'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 5000;
const MAX_UPDATE_BYTES = 250 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120000;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** 'owner/repo' -> 'owner/repo' или null (в том числе для заглушки OWNER/REPO). */
function parseRepo(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!REPO_RE.test(v) || v.toUpperCase() === 'OWNER/REPO') return null;
  if (v.split('/').some((part) => /^\.+$/.test(part))) return null; // '.' и '..' не допускаются
  return v;
}

/** 'v1.2.3' | '1.2.3' -> [1,2,3]; всё остальное (в т.ч. 1.2.3-rc1) -> null. */
function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** >0 если a новее b, <0 если старее, 0 если равны. Бросает ошибку на нестрогой версии. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Некорректная версия: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * Один запрос к GitHub Releases API. Ничего, кроме GET, не отправляется.
 * @returns {{kind:'no-releases'}|{kind:'up-to-date'|'available', version:string, url:string}}
 */
async function checkForUpdate({ repo, currentVersion, fetchFn, installKind = 'portable', timeoutMs = 10000 }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'minecraft-anti-afk-update-check', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: ac.signal,
    });
    if (res.status === 404) return { kind: 'no-releases' };
    if (res.status === 403 || res.status === 429) throw new Error('Превышен лимит запросов GitHub, попробуйте позже');
    if (!res.ok) throw new Error(`GitHub вернул статус ${res.status}`);
    const text = await res.text();
    if (text.length > 1_000_000) throw new Error('Слишком большой ответ GitHub');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Некорректный ответ GitHub'); }
    const tag = data && typeof data.tag_name === 'string' ? data.tag_name.trim() : '';
    if (!parseVersion(tag)) throw new Error(`Неподдерживаемый тег релиза: ${tag.slice(0, 40) || 'пусто'}`);
    const version = tag.replace(/^v/, '');
    // Ссылка строится из проверенных частей, а не берётся из ответа сервера.
    const url = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
    const kind = compareVersions(version, currentVersion) > 0 ? 'available' : 'up-to-date';
    if (kind !== 'available') return { kind, version, url, asset: null };

    if (!['portable', 'installer'].includes(installKind)) {
      return { kind, version, url, asset: null, assetError: 'Неизвестный тип установки' };
    }

    const assetName = `Minecraft-Anti-AFK-${version}-${installKind === 'portable' ? 'portable' : 'setup'}.exe`;
    const releaseAsset = Array.isArray(data.assets)
      ? data.assets.find((asset) => asset && asset.name === assetName)
      : null;
    if (!releaseAsset) {
      return {
        kind,
        version,
        url,
        asset: null,
        assetError: `В релизе нет файла для ${installKind === 'portable' ? 'portable' : 'установленной'} версии`,
      };
    }

    const digest = /^sha256:([a-f0-9]{64})$/i.exec(String(releaseAsset.digest || ''));
    if (!digest || !Number.isSafeInteger(releaseAsset.size) || releaseAsset.size <= 0 || releaseAsset.size > MAX_UPDATE_BYTES) {
      return { kind, version, url, asset: null, assetError: 'У файла релиза нет корректной SHA-256 контрольной суммы' };
    }

    return {
      kind,
      version,
      url,
      asset: {
        url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${assetName}`,
        name: assetName,
        size: releaseAsset.size,
        sha256: digest[1].toLowerCase(),
      },
    };
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('Превышено время ожидания ответа GitHub');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadUpdate({ asset, fetchFn, timeoutMs = DOWNLOAD_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(asset.url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'minecraft-anti-afk-updater' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`Не удалось скачать обновление (HTTP ${response.status})`);

    if (response.url) {
      const host = new URL(response.url).hostname;
      if (!['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(host)) {
        throw new Error('Ссылка скачивания перенаправила на неизвестный сервер');
      }
    }

    const headerSize = Number(response.headers && response.headers.get('content-length'));
    if (Number.isFinite(headerSize) && headerSize > 0 && headerSize !== asset.size) {
      throw new Error('Размер файла обновления не совпадает с релизом');
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== asset.size || bytes.length > MAX_UPDATE_BYTES) {
      throw new Error('Размер скачанного файла не совпадает с релизом');
    }
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== asset.sha256) throw new Error('SHA-256 обновления не совпадает; установка отменена');
    return bytes;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('Превышено время ожидания скачивания обновления');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

class UpdateService {
  constructor({ repo, currentVersion, fetchFn, autoCheck = true, intervalMs = SIX_HOURS_MS, firstDelayMs = FIRST_CHECK_DELAY_MS,
    setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout, setInterval: si = setInterval, clearInterval: ci = clearInterval,
    now = Date.now, onChange = () => {}, portablePath = process.env.PORTABLE_EXECUTABLE_FILE,
    installKind = portablePath ? 'portable' : null, executablePath = process.execPath,
    installScriptPath = path.join(__dirname, '..', 'scripts', 'install-update.ps1'), processId = process.pid,
    tempDir = os.tmpdir(), spawnFn = spawn }) {
    this._repo = parseRepo(repo);
    this._fetch = fetchFn;
    this._autoCheck = !!autoCheck;
    this._intervalMs = intervalMs;
    this._firstDelayMs = firstDelayMs;
    this._st = st; this._ct = ct; this._si = si; this._ci = ci;
    this._now = now;
    this._onChange = onChange;
    this._portablePath = portablePath;
    this._installKind = installKind;
    this._targetPath = installKind === 'portable' ? portablePath : installKind === 'installer' ? executablePath : null;
    this._installScriptPath = installScriptPath;
    this._processId = processId;
    this._tempDir = tempDir;
    this._spawn = spawnFn;
    this._first = null;
    this._every = null;
    this._url = null;
    this._asset = null;
    this._busy = false;
    this._state = {
      status: this._repo ? 'idle' : 'disabled',
      autoCheck: this._autoCheck,
      currentVersion,
      latestVersion: null,
      checkedAt: null,
      error: null,
      installAvailable: false,
    };
  }

  snapshot() { return { ...this._state }; }
  openTarget() { return this._state.status === 'available' ? this._url : null; }
  _set(patch) { this._state = { ...this._state, ...patch }; this._onChange(this.snapshot()); }

  start() { this._schedule(); }
  stop() { this._unschedule(); }

  _schedule() {
    this._unschedule();
    if (!this._repo || !this._autoCheck) return;
    this._first = this._st(() => { this._first = null; this.check(); }, this._firstDelayMs);
    this._every = this._si(() => this.check(), this._intervalMs);
  }

  _unschedule() {
    if (this._first !== null) this._ct(this._first);
    if (this._every !== null) this._ci(this._every);
    this._first = this._every = null;
  }

  setAutoCheck(value) {
    this._autoCheck = !!value;
    this._schedule();
    this._set({ autoCheck: this._autoCheck });
  }

  async check() {
    if (!this._repo || this._busy) return this.snapshot();
    this._busy = true;
    this._set({ status: 'checking', error: null });
    try {
      const r = await checkForUpdate({
        repo: this._repo,
        currentVersion: this._state.currentVersion,
        fetchFn: this._fetch,
        installKind: this._installKind || 'portable',
      });
      this._url = r.kind === 'available' ? r.url : null;
      this._asset = r.kind === 'available' ? r.asset : null;
      this._set({
        status: r.kind,
        latestVersion: r.version || null,
        checkedAt: this._now(),
        installAvailable: Boolean(this._asset && this._targetPath && this._installKind),
        error: r.assetError || (this._asset && !this._installKind ? 'Автоустановка доступна только в собранной версии' : null),
      });
    } catch (err) {
      this._set({ status: 'error', error: String((err && err.message) || err).slice(0, 200), checkedAt: this._now() });
    } finally {
      this._busy = false;
    }
    return this.snapshot();
  }

  async install() {
    if (this._state.status !== 'available') throw new Error('Нет доступного обновления');
    if (!this._asset) throw new Error(this._state.error || 'В релизе нет проверенного файла для установки');
    if (!['portable', 'installer'].includes(this._installKind) || !this._targetPath || !path.isAbsolute(this._targetPath)) {
      throw new Error('Автоустановка доступна только в собранной версии');
    }
    if (path.extname(this._targetPath).toLowerCase() !== '.exe') {
      throw new Error('Путь приложения не прошёл проверку');
    }

    this._set({ status: 'downloading', error: null });
    let downloadPath = null;
    try {
      const bytes = await downloadUpdate({ asset: this._asset, fetchFn: this._fetch });
      downloadPath = path.join(this._tempDir, `minecraft-anti-afk-${crypto.randomUUID()}.exe`);
      await fs.writeFile(downloadPath, bytes, { flag: 'wx' });
      this._set({ status: 'installing' });

      const child = this._spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this._installScriptPath,
        '-UpdateType',
        this._installKind,
        '-NewExecutablePath',
        downloadPath,
        '-TargetExecutablePath',
        this._targetPath,
        '-ProcessId',
        String(this._processId),
      ], { detached: true, windowsHide: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      return { ...this.snapshot(), restart: true };
    } catch (error) {
      if (downloadPath) await fs.rm(downloadPath, { force: true }).catch(() => {});
      const message = String((error && error.message) || error).slice(0, 200);
      this._set({ status: 'available', error: message });
      return this.snapshot();
    }
  }
}

module.exports = {
  parseRepo,
  parseVersion,
  compareVersions,
  checkForUpdate,
  downloadUpdate,
  UpdateService,
  SIX_HOURS_MS,
  MAX_UPDATE_BYTES,
};
