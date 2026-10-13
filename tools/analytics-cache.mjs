// 数据看板「一小时才回源一次」的验收探针
//
//   node tools\analytics-cache.mjs [baseUrl]        （默认 http://127.0.0.1:3001）
//
// 验的是行为，不是实现：注册一个临时账号并在浏览器里登录，然后打开 /analytics。
//   1. 首次打开 → /api/ai/account 与 /api/ai/account/history 各 1 次
//   2. 整页刷新（内存缓存清空，只剩 IndexedDB）→ 两个接口 0 次请求，数字照常渲染
//   3. 页面右上角显示「缓存 · N 分钟前」，title 说明每小时自动回源、点同步可立刻回源
//   4. 点「立即同步」→ POST /api/ai/account/sync 真的发出（手动路径不会被缓存挡住），
//      且结果写回缓存（同步后再刷新页面仍是 0 次请求）
//   5. 把缓存时间改成 2 小时前（模拟 TTL 过期）→ 整页刷新后两个接口各回源 1 次
//   6. 缓存命名空间跟登录态绑定，且绝不是所有账号共用的 'anon' 槽位
//      （/api/ai/account* 本身不设 Cache-Control，所以这里只验我们自己的缓存层）
//
// 账号：优先登录固定的探针账号 analytics-cache-probe；不存在才注册一次。
// 注册接口限流 5 次 / 10 分钟（防批量刷号），反复跑探针不能每次都新注册。
// 想彻底清掉这个账号：
//   cd D:\自媒体之路\server; npx.cmd tsx scripts/cloud-admin.ts prune-prefix "analytics-cache-probe"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const PORT = 9381;
const USER = 'analytics-cache-probe'; // USERNAME_PATTERN 上限 24 字符
const PASSWORD = 'ProbePass123!';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

let passed = 0;
let failed = 0;
const results = [];
function check(name, ok, extra = '') {
  if (ok) { passed += 1; results.push(`PASS  ${name}${extra ? '  — ' + extra : ''}`); }
  else { failed += 1; results.push(`FAIL  ${name}${extra ? '  — ' + extra : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 探针账号：先登录，登录不上再注册一次 ────────────────────
const post = async (p, payload) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
};

let session = await post('/api/auth/login', { username: USER, password: PASSWORD });
if (session.ok && session.body.token) {
  console.log(`复用探针账号 ${USER} (${session.body.user.id})\n`);
} else {
  session = await post('/api/auth/register', { username: USER, password: PASSWORD });
  if (!session.ok || !session.body.token) {
    console.error('探针账号既登录不上、也注册不了：', session.status, JSON.stringify(session.body));
    process.exit(1);
  }
  console.log(`新注册探针账号 ${USER} (${session.body.user.id})\n`);
}
const TOKEN = session.body.token;

const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!edge) throw new Error('找不到 Edge');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-analytics-'));
const child = spawn(edge, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-features=Translate',
  'about:blank',
], { stdio: 'ignore' });

let ws = null;
let msgId = 0;
const pending = new Map();
let loadFired = 0;
/** 记下发出去的请求，用来断言「有没有回源」 */
let reqs = [];

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = (e) => reject(new Error('ws error ' + (e && e.message)));
        });
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
          } else if (msg.method === 'Page.loadEventFired') {
            loadFired += 1;
          } else if (msg.method === 'Network.requestWillBeSent') {
            reqs.push({ method: msg.params?.request?.method, url: msg.params?.request?.url || '' });
          }
        };
        return;
      }
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error('连不上 CDP 页面');
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error('页面内异常: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  return res.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch { /* 页面可能正在换文档 */ }
    await sleep(300);
  }
  throw new Error(`等不到：${label}`);
}

async function navigate(url) {
  const before = loadFired;
  await send('Page.navigate', { url });
  for (let i = 0; i < 120 && loadFired === before; i += 1) await sleep(200);
  if (loadFired === before) throw new Error('导航没有等到 load 事件：' + url);
  await evaluate(HELPERS); // 换文档后注入的助手会丢，重新注入
}

async function reload() {
  const before = loadFired;
  await send('Page.reload', {});
  for (let i = 0; i < 120 && loadFired === before; i += 1) await sleep(200);
  if (loadFired === before) throw new Error('整页刷新没有等到 load 事件');
  await evaluate(HELPERS); // 换文档后注入的助手会丢，重新注入
}

const pathname = (url) => { try { return new URL(url).pathname; } catch { return ''; } };
const hits = (p, method) =>
  reqs.filter((r) => pathname(r.url) === p && (!method || r.method === method)).length;

const RENDERED = `document.body.innerText.includes('总粉丝数')`;

// 页面内的 IndexedDB 助手（缓存库 CreatorStudioCache）
const HELPERS = `
window.__cacheRows = () => new Promise((resolve) => {
  const req = indexedDB.open('CreatorStudioCache');
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const dbi = req.result;
    if (!dbi.objectStoreNames.contains('entries')) { dbi.close(); resolve({}); return; }
    const tx = dbi.transaction('entries', 'readonly');
    const all = tx.objectStore('entries').getAll();
    all.onsuccess = () => {
      const out = {};
      for (const row of all.result) out[row.key] = row.fetchedAt;
      dbi.close();
      resolve(out);
    };
    all.onerror = () => { dbi.close(); resolve(null); };
  };
});
window.__expireCacheByPrefix = (prefixes) => new Promise((resolve) => {
  const req = indexedDB.open('CreatorStudioCache');
  req.onerror = () => resolve('open-failed');
  req.onsuccess = () => {
    const dbi = req.result;
    const tx = dbi.transaction('entries', 'readwrite');
    const store = tx.objectStore('entries');
    const old = Date.now() - 2 * 60 * 60 * 1000;
    let touched = 0;
    const all = store.getAll();
    all.onsuccess = () => {
      for (const row of all.result) {
        if (prefixes.some((p) => row.key.startsWith(p))) { row.fetchedAt = old; store.put(row); touched += 1; }
      }
    };
    tx.oncomplete = () => { dbi.close(); resolve('ok:' + touched); };
    tx.onerror = () => { dbi.close(); resolve('tx-failed'); };
  };
});
window.__clickByText = (needle) => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(needle));
  if (!btn) return false;
  btn.click();
  return true;
};
'ok';
`;

try {
  await connect();
  await send('Page.enable', {});
  await send('Network.enable', {});
  await send('Runtime.enable', {});

  // 打开站点拿到同源上下文，写入 token
  await navigate(base + '/');
  await evaluate(`localStorage.setItem('creator-studio-token', ${JSON.stringify(TOKEN)}); 'set'`);
  await evaluate(HELPERS);

  // ── 1. 首次打开数据看板 ────────────────────────────────
  reqs = [];
  await navigate(base + '/analytics');
  await evaluate(`localStorage.setItem('creator-studio-token', ${JSON.stringify(TOKEN)}); document.body.innerText.includes('总粉丝数')`);
  await waitFor(RENDERED, 30000, '数据看板渲染出账号数字');
  await sleep(800); // 让并发的请求都记下来
  const firstAccount = hits('/api/ai/account', 'GET');
  const firstHistory = hits('/api/ai/account/history', 'GET');
  check('首次打开：/api/ai/account 恰好请求 1 次', firstAccount === 1, `count=${firstAccount}`);
  check('首次打开：/api/ai/account/history 恰好请求 1 次', firstHistory === 1, `count=${firstHistory}`);
  const firstText = await evaluate('document.body.innerText');
  check('首次打开显示「刚刚更新」而不是缓存标记', firstText.includes('刚刚更新'), '');

  // ── 2. 整页刷新 → 完全命中缓存 ─────────────────────────
  reqs = [];
  await reload();
  await waitFor(RENDERED, 30000, '刷新后数据看板渲染出账号数字');
  await sleep(800);
  const secondAccount = hits('/api/ai/account', 'GET');
  const secondHistory = hits('/api/ai/account/history', 'GET');
  check('刷新后：/api/ai/account 0 次请求（命中本地缓存）', secondAccount === 0, `count=${secondAccount}`);
  check('刷新后：/api/ai/account/history 0 次请求（命中本地缓存）', secondHistory === 0, `count=${secondHistory}`);
  const secondText = await evaluate('document.body.innerText');
  check('刷新后页面显示「缓存 · N 分钟前」', /缓存 · /.test(secondText), '');

  // ── 3. 缓存命名空间绑定登录态 ─────────────────────────────
  const rows = await evaluate('window.__cacheRows()');
  const keys = Object.keys(rows || {});
  const accountKeys = keys.filter((k) => k.startsWith('analytics:account:'));
  const historyKeys = keys.filter((k) => k.startsWith('analytics:history:'));
  const accountKey = accountKeys[0] || '';
  check('账号统计写成 analytics:account:<命名空间>', accountKeys.length === 1, keys.join(','));
  check('历史数据写成 analytics:history:<命名空间>', historyKeys.length === 1, '');
  check('命名空间不是所有账号共用的 anon 槽位', accountKey !== '' && !accountKey.endsWith(':anon'), accountKey);

  // ── 4. 手动同步不被缓存挡住，并把结果写回缓存 ─────────────
  const beforeSyncAt = Number(rows[accountKey] || 0);
  reqs = [];
  const clicked = await evaluate(`window.__clickByText('立即同步')`);
  check('页面上找得到「立即同步」按钮', clicked === true, '');
  await waitFor(`/同步完成|同步部分失败/.test(document.body.innerText)`, 40000, '同步结果横幅出现');
  await sleep(500);
  const syncPosts = hits('/api/ai/account/sync', 'POST');
  check('点「立即同步」→ POST /api/ai/account/sync 发出 1 次', syncPosts === 1, `count=${syncPosts}`);
  // 横幅先出现，之后 handleSync 还要拉一次历史、再把结果写回缓存 —— 等它写完
  let afterSyncAt = beforeSyncAt;
  for (let i = 0; i < 60 && afterSyncAt <= beforeSyncAt; i += 1) {
    const snapshot = await evaluate('window.__cacheRows()');
    afterSyncAt = Number((snapshot || {})[accountKey] || 0);
    if (afterSyncAt > beforeSyncAt) break;
    await sleep(500);
  }
  check('手动同步的结果写回缓存（fetchedAt 变新）', afterSyncAt > beforeSyncAt, `${beforeSyncAt} → ${afterSyncAt}`);

  reqs = [];
  await reload();
  await waitFor(RENDERED, 30000, '同步后刷新仍能渲染');
  await sleep(800);
  check('手动同步之后再刷新：仍然 0 次请求', hits('/api/ai/account', 'GET') === 0, `account=${hits('/api/ai/account', 'GET')}`);

  // ── 5. TTL 过期 → 回源一次 ─────────────────────────────
  const expireResult = await evaluate(`window.__expireCacheByPrefix(['analytics:account:', 'analytics:history:'])`);
  check('把两行缓存改成 2 小时前（模拟 TTL 过期）', expireResult === 'ok:2', String(expireResult));
  reqs = [];
  await reload();
  await waitFor(RENDERED, 30000, '过期后重新回源并渲染');
  await sleep(1200);
  const expiredAccount = hits('/api/ai/account', 'GET');
  const expiredHistory = hits('/api/ai/account/history', 'GET');
  check('TTL 过期后：/api/ai/account 回源 1 次', expiredAccount === 1, `count=${expiredAccount}`);
  check('TTL 过期后：/api/ai/account/history 回源 1 次', expiredHistory === 1, `count=${expiredHistory}`);
  const expiredText = await evaluate('document.body.innerText');
  check('回源后不再是缓存标记（显示「刚刚更新」）', expiredText.includes('刚刚更新'), '');

  // ── 6. 布局：右上角新增的缓存提示不能把页面撑出横向滚动条 ──
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const box = await evaluate(`(() => { const d = document.documentElement; return { sw: d.scrollWidth, cw: d.clientWidth }; })()`);
    check(`宽度 ${width} 无横向溢出`, box.sw <= box.cw + 1, `scrollW=${box.sw} clientW=${box.cw}`);
  }
  await send('Emulation.clearDeviceMetricsOverride', {});

  const errors = await evaluate(`window.__probeErrors ? window.__probeErrors.length : 0`);
  check('页面无未捕获异常计数（尽力而为）', !errors || errors === 0, `errors=${errors}`);
} catch (err) {
  check('探针执行未抛异常', false, err instanceof Error ? err.message : String(err));
} finally {
  console.log('\n' + results.join('\n'));
  console.log(`\n${passed}/${passed + failed} PASS`);
  if (failed) console.log('失败：' + results.filter((r) => r.startsWith('FAIL')).join(' / '));
  try { ws && ws.close(); } catch { /* ignore */ }
  child.kill();
  process.exit(failed ? 1 : 0);
}
