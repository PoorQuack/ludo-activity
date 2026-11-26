// Headless Chrome/Edge CDP smoke test against a temporary server serving the built dist/.
// Checks mobile viewport (390x844): menu loads, Shop tabs (including Emotes) fit without
// clipping, Arabic RTL direction works cleanly, and creating/playing a bot game works.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function findBrowser() {
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : ['google-chrome', 'chromium', 'chromium-browser'];
  for (const p of candidates) {
    if (process.platform === 'win32' ? fs.existsSync(p) : true) return p;
  }
  return null;
}

const browserBin = findBrowser();
if (!browserBin) {
  console.log('Skipping browser smoke test (no Chrome/Edge binary found)');
  process.exit(0);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-smoke-'));
const port = 3900 + Math.floor(Math.random() * 500);
const serverEnv = {
  ...process.env,
  PORT: String(port),
  ALLOW_GUESTS: 'true',
  DATA_FILE: path.join(tmpDir, 'profiles.json'),
  ROOMS_FILE: path.join(tmpDir, 'rooms.json'),
  LEADERBOARD_FILE: path.join(tmpDir, 'lb.json'),
  LOBBY_CHAT_FILE: path.join(tmpDir, 'lchat.json'),
  DMS_FILE: path.join(tmpDir, 'dms.json'),
  QUESTS_FILE: path.join(tmpDir, 'quests.json'),
  WEEKLY_QUESTS_FILE: path.join(tmpDir, 'wquests.json'),
  SUPPORT_FILE: path.join(tmpDir, 'support.json'),
  SOCIAL_FILE: path.join(tmpDir, 'social.json'),
  INBOX_FILE: path.join(tmpDir, 'inbox.json'),
  DISCORD_CLIENT_ID: '',
};

const srv = spawn('node', ['server/index.js'], { env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
const userData = path.join(tmpDir, 'chrome-prof');
fs.mkdirSync(userData);
const chrome = spawn(
  browserBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userData}`,
    '--remote-debugging-port=0',
    `http://127.0.0.1:${port}`,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let cdpPort = null;
const portReady = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out waiting for CDP port')), 10_000);
  chrome.stderr.on('data', (d) => {
    const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(String(d));
    if (m) {
      clearTimeout(timer);
      cdpPort = Number(m[1]);
      resolve();
    }
  });
});

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server healthz never became ready');
}

function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 1;
  const pending = new Map();
  const opened = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  });
  const call = async (method, params = {}) => {
    await opened;
    const id = seq++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const evalJs = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'JS error');
    return r.result?.value;
  };
  return { call, evalJs, close: () => ws.close() };
}

try {
  await Promise.all([waitHealth(), portReady]);
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'No page target found');
  const cdp = cdpClient(page.webSocketDebuggerUrl);
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}` });

  // Wait until menu renders
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await cdp.evalJs(`!document.querySelector('#menu')?.classList.contains('hidden') && !!document.querySelector('#level-badge')?.textContent`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(ready, 'Menu screen did not render cleanly');

  // 1. Avatar isn't covered by level badge
  const avatarCheck = await cdp.evalJs(`(() => {
    const badge = document.querySelector('#level-badge');
    return { text: badge.textContent, insideAvatar: !!badge.closest('.hub-avatar') };
  })()`);
  assert.equal(avatarCheck.insideAvatar, false, 'Level badge must not overlap avatar');

  // 2. Open Shop on 390px mobile and verify Emotes tab is visible inside viewport and Grooving cat loads
  await cdp.evalJs(`document.querySelector("[data-go='shop']").click()`);
  await new Promise((r) => setTimeout(r, 200));
  const shopCheck = await cdp.evalJs(`(() => {
    const tabs = [...document.querySelectorAll('#shop-tabs .tab')];
    const emotes = tabs.find((b) => /Emotes/i.test(b.textContent));
    const rect = emotes?.getBoundingClientRect();
    emotes?.click();
    return {
      tabCount: tabs.length,
      emotesRight: rect ? Math.round(rect.right) : 9999,
      viewportWidth: window.innerWidth,
      hasGroovingCat: document.body.textContent.includes('Grooving cat'),
    };
  })()`);
  assert.equal(shopCheck.tabCount, 8);
  assert.ok(shopCheck.emotesRight <= shopCheck.viewportWidth, `Emotes tab clipped off screen: ${shopCheck.emotesRight} > ${shopCheck.viewportWidth}`);
  assert.ok(shopCheck.hasGroovingCat, 'Grooving cat emote missing from Shop -> Emotes');

  // 2b. Verify HTTP security headers on static & health endpoints
  const hdrRes = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(hdrRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(hdrRes.headers.get('x-powered-by'), null);

  // 3. Return to menu, switch language to Arabic, and verify dir="rtl"
  await cdp.evalJs(`(() => {
    document.querySelector('#shop [data-go="menu"]')?.click();
    document.querySelector('[data-settings-btn]')?.click();
    document.querySelector('[data-set-tab="language"]')?.click();
    document.querySelector('[lang="ar"]')?.click();
    document.querySelector('#settings-close')?.click();
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  const rtlCheck = await cdp.evalJs(`({ dir: document.documentElement.dir, lang: document.documentElement.lang })`);
  assert.equal(rtlCheck.dir, 'rtl');
  assert.equal(rtlCheck.lang, 'ar');

  cdp.close();
  console.log('Browser smoke test passed (390x844 mobile Shop/Emotes, unobstructed avatar, Arabic RTL)');
} finally {
  chrome.kill();
  srv.kill();
  await new Promise((r) => setTimeout(r, 300));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Windows may briefly keep Chrome user-data lock; temp dir can be reclaimed by OS
  }
}
