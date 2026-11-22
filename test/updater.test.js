'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseRepo, compareVersions, checkForUpdate, downloadUpdate, UpdateService, SIX_HOURS_MS } = require('../src/updater');
const { fakeClock } = require('./helpers');

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const REPO = 'me/anti-afk';
const UPDATE_BYTES = Buffer.from('verified portable update');

function release(tag = 'v1.2.0', bytes = UPDATE_BYTES) {
  const version = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    assets: [{
      name: `Minecraft-Anti-AFK-${version}-portable.exe`,
      size: bytes.length,
      digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
    }],
  };
}

test('parseRepo принимает owner/repo и отклоняет заглушку и мусор', () => {
  assert.equal(parseRepo('me/anti-afk'), 'me/anti-afk');
  for (const bad of ['OWNER/REPO', 'owner/repo', '', 'a', 'a/b/c', 'a b/c', '../x', 'a/b?x=1', null, 5]) assert.equal(parseRepo(bad), null, String(bad));
});

test('compareVersions', () => {
  assert.ok(compareVersions('1.2.0', '1.1.9') > 0);
  assert.ok(compareVersions('v2.0.0', '1.99.99') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.throws(() => compareVersions('1.0.0-rc1', '1.0.0'));
});

test('checkForUpdate: доступна новая версия, ссылка строится локально', async () => {
  const r = await checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: reply(200, release('v1.1.0')) });
  assert.deepEqual(r, {
    kind: 'available',
    version: '1.1.0',
    url: 'https://github.com/me/anti-afk/releases/tag/v1.1.0',
    asset: {
      url: 'https://github.com/me/anti-afk/releases/download/v1.1.0/Minecraft-Anti-AFK-1.1.0-portable.exe',
      name: 'Minecraft-Anti-AFK-1.1.0-portable.exe',
      size: UPDATE_BYTES.length,
      sha256: crypto.createHash('sha256').update(UPDATE_BYTES).digest('hex'),
    },
  });
});

test('checkForUpdate: актуальная версия, 404, ошибки', async () => {
  assert.equal((await checkForUpdate({ repo: REPO, currentVersion: '1.1.0', fetchFn: reply(200, { tag_name: 'v1.1.0' }) })).kind, 'up-to-date');
  assert.equal((await checkForUpdate({ repo: REPO, currentVersion: '9.0.0', fetchFn: reply(200, { tag_name: 'v1.1.0' }) })).kind, 'up-to-date');
  assert.equal((await checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: reply(404, {}) })).kind, 'no-releases');
  await assert.rejects(checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: reply(403, {}) }), /лимит/);
  await assert.rejects(checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: reply(500, {}) }), /500/);
  await assert.rejects(checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: reply(200, 'не json') }), /Некорректный ответ/);
  await assert.rejects(checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: reply(200, { tag_name: 'nightly' }) }), /тег/);
  await assert.rejects(checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: async () => { throw new Error('offline'); } }), /offline/);
});

test('checkForUpdate: таймаут', async () => {
  const hang = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  await assert.rejects(checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: hang, timeoutMs: 20 }), /время ожидания/);
});

test('checkForUpdate refuses installation when release asset has no SHA-256 digest', async () => {
  const noDigest = release();
  delete noDigest.assets[0].digest;
  const result = await checkForUpdate({ repo: REPO, currentVersion: '1.0.0', fetchFn: reply(200, noDigest) });
  assert.equal(result.kind, 'available');
  assert.equal(result.asset, null);
  assert.match(result.assetError, /SHA-256/);
});

test('downloadUpdate verifies size and SHA-256 before returning the executable', async () => {
  const asset = {
    url: 'https://github.com/me/anti-afk/releases/download/v1.2.0/update.exe',
    size: UPDATE_BYTES.length,
    sha256: crypto.createHash('sha256').update(UPDATE_BYTES).digest('hex'),
  };
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    url: 'https://release-assets.githubusercontent.com/update.exe',
    headers: { get: () => String(UPDATE_BYTES.length) },
    arrayBuffer: async () => UPDATE_BYTES,
  });
  assert.deepEqual(await downloadUpdate({ asset, fetchFn }), UPDATE_BYTES);
  await assert.rejects(downloadUpdate({
    asset: { ...asset, sha256: '0'.repeat(64) },
    fetchFn,
  }), /SHA-256/);
});

function service(over = {}) {
  const clock = fakeClock();
  const states = [];
  let calls = 0;
  const svc = new UpdateService({
    repo: REPO, currentVersion: '1.0.0', ...clock, onChange: (s) => states.push(s),
    fetchFn: async (...a) => { calls++; return reply(200, { tag_name: 'v1.2.0' })(...a); }, ...over,
  });
  return { clock, svc, states, calls: () => calls };
}

test('UpdateService: автопроверка через 5 с после старта и затем каждые 6 часов', async () => {
  const { clock, svc, calls } = service();
  svc.start();
  await clock.advance(4_999);
  assert.equal(calls(), 0);
  await clock.advance(1);
  assert.equal(calls(), 1);
  assert.equal(svc.snapshot().status, 'available');
  assert.equal(svc.snapshot().latestVersion, '1.2.0');
  assert.equal(svc.openTarget(), 'https://github.com/me/anti-afk/releases/tag/v1.2.0');
  await clock.advance(SIX_HOURS_MS);
  assert.equal(calls(), 2);
});

test('UpdateService: отключение автопроверки снимает таймеры, ручная проверка работает', async () => {
  const { clock, svc, calls } = service();
  svc.start();
  svc.setAutoCheck(false);
  assert.equal(clock.timerCount, 0);
  await clock.advance(SIX_HOURS_MS * 2);
  assert.equal(calls(), 0);
  await svc.check();
  assert.equal(calls(), 1);
  svc.setAutoCheck(true);
  assert.equal(clock.timerCount, 2);
});

test('UpdateService: репозиторий не настроен — проверка выключена и сеть не используется', async () => {
  const { clock, svc, calls } = service({ repo: 'OWNER/REPO' });
  svc.start();
  assert.equal(svc.snapshot().status, 'disabled');
  assert.equal(clock.timerCount, 0);
  await svc.check();
  assert.equal(calls(), 0);
});

test('UpdateService: ошибка сети не роняет сервис, параллельные проверки не дублируются', async () => {
  let n = 0;
  const { svc } = service({ fetchFn: async () => { n++; await new Promise((r) => setImmediate(r)); throw new Error('offline'); } });
  await Promise.all([svc.check(), svc.check()]);
  assert.equal(n, 1);
  assert.equal(svc.snapshot().status, 'error');
  assert.equal(svc.openTarget(), null);
});

test('UpdateService installs only a verified asset after explicit invocation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-updater-test-'));
  let spawnArgs;
  try {
    const svc = new UpdateService({
      repo: REPO,
      currentVersion: '1.0.0',
      portablePath: 'C:\\Apps\\Minecraft-Anti-AFK-1.0.0-portable.exe',
      installScriptPath: 'C:\\Apps\\scripts\\install-update.ps1',
      processId: 1234,
      tempDir,
      fetchFn: async (url) => {
        if (url.includes('/releases/latest')) return reply(200, release())();
        return {
          ok: true,
          status: 200,
          url: 'https://release-assets.githubusercontent.com/update.exe',
          headers: { get: () => String(UPDATE_BYTES.length) },
          arrayBuffer: async () => UPDATE_BYTES,
        };
      },
      spawnFn: (_command, args) => {
        spawnArgs = args;
        return {
          once(event, callback) {
            if (event === 'spawn') queueMicrotask(callback);
            return this;
          },
          unref() {},
        };
      },
    });

    await svc.check();
    assert.equal(svc.snapshot().installAvailable, true);
    const result = await svc.install();
    assert.equal(result.restart, true);
    assert.equal(result.status, 'installing');
    assert.deepEqual(await fs.readFile(spawnArgs[7]), UPDATE_BYTES);
    assert.equal(spawnArgs[9], 'C:\\Apps\\Minecraft-Anti-AFK-1.0.0-portable.exe');
    assert.equal(spawnArgs[11], '1234');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
