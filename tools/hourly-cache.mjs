// 资讯中心 / 分析报告的「一小时才回源一次」验收探针
//
//   node tools\hourly-cache.mjs [baseUrl]        （默认 http://127.0.0.1:3001）
//
// 验的是行为，不是实现：
//   1. 首次打开 → 各发 1 次 /api/report|/api/news
//   2. 立刻刷新页面（整页 reload，内存缓存清空，只剩 IndexedDB）→ 0 次请求，内容照常渲染
//   3. 点页面上的「刷新」→ 强制回源 1 次
//   4. 把缓存写成 2 小时前（模拟 TTL 过期）→ 自动回源 1 次
//   5. 资讯切品类 → 该品类首次要请求，切回「全部」→ 命中缓存 0 次请求
//   6. 两个接口都带 Cache-Control: no-store（避免浏览器 HTTP 缓存和本地缓存打架）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:3001';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9361;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-hourly-'));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('Edge CDP 没起来');
}

const counts = { news: 0, report: 0 };
let loadEvents = 0;
let tgt;
try {
  tgt = await target();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params?.request?.url || '';
    if (!url.startsWith(BASE)) return;
    if (url.includes('/api/news/collect')) return;
    if (url.includes('/api/news?') || url.endsWith('/api/news')) counts.news++;
    else if (url.includes('/api/report/game-industry') && !url.includes('.md')) counts.report++;
  }
  if (msg.method === 'Page.loadEventFired') loadEvents++;
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const send = (method, params = {}) => {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const evaluate = async (expression, awaitPromise = false) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'evaluate failed');
  return res.result?.value;
};
const waitFor = async (expression, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await sleep(150);
  }
  return false;
};
const text = () => evaluate('document.body.innerText');
const goto = async (route) => {
  await send('Page.navigate', { url: `${BASE}${route}` });
  await sleep(1200);
};
/**
 * 整页刷新，并确保等到的是**新文档**。
 * Page.reload 是立即返回的，若只等页面文案，会在旧文档上就判定通过
 * （第一版探针就栽在这里：TTL 过期的断言读到的是刷新前的旧页面）。
 */
const reload = async () => {
  const before = loadEvents;
  await send('Page.reload');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (loadEvents > before) return true;
    await sleep(100);
  }
  return false;
};
const mark = () => ({ ...counts });

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // ── 分析报告 ───────────────────────────────────────────────
  let m = mark();
  await goto('/report');
  const reportRendered = await waitFor(`document.body.innerText.includes('原始样本池')`, 25000);
  check('报告首次打开能渲染出内容', reportRendered);
  check('报告首次打开回源 1 次', counts.report - m.report === 1, `实际 ${counts.report - m.report}`);

  m = mark();
  await reload();
  const reportCached = await waitFor(`document.body.innerText.includes('原始样本池')`, 25000);
  await sleep(800); // 给「万一还要回源」的请求留出发出时间，避免把 0 次读早了
  const reportBody = await text();
  check('报告整页刷新后仍渲染（内存缓存已清空，读 IndexedDB）', reportCached);
  check(
    '报告整页刷新 0 次网络请求（一小时缓存生效）',
    counts.report - m.report === 0,
    `实际 ${counts.report - m.report}`,
  );
  check('报告页显示「本机缓存于 …」提示', reportBody.includes('本机缓存于'));

  m = mark();
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '刷新'); if (b) { b.click(); return true; } return false; })()`,
  );
  await waitFor(`document.body.innerText.includes('原始样本池')`, 25000);
  // 关键：点刷新是 fire-and-forget，writeCache 的 IndexedDB 事务还没提交。
  // 这时马上改旧会被随后提交的新写入覆盖 → 缓存仍然是「新鲜」的，
  // 于是「TTL 过期要回源」这条断言会假失败（第一版就栽在这里）。
  await sleep(1500);
  check('点「刷新」强制回源 1 次', counts.report - m.report === 1, `实际 ${counts.report - m.report}`);

  // 模拟 TTL 过期：把缓存表里的 fetchedAt 改成 2 小时前，并回读确认真的改掉了
  const aged = await evaluate(
    `(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('CreatorStudioCache'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const tx = db.transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      const keys = await new Promise((res) => { const r = store.getAllKeys(); r.onsuccess = () => res(r.result); });
      let touched = 0;
      for (const k of keys) {
        const row = await new Promise((res) => { const r = store.get(k); r.onsuccess = () => res(r.result); });
        if (row) { row.fetchedAt = Date.now() - 2 * 60 * 60 * 1000; store.put(row); touched++; }
      }
      await new Promise((res) => { tx.oncomplete = res; });
      const tx2 = db.transaction('entries', 'readonly');
      const rows = await new Promise((res) => { const r = tx2.objectStore('entries').getAll(); r.onsuccess = () => res(r.result); });
      return { keys: keys.length, touched, minAge: rows.length ? Math.round(Math.min(...rows.map((x) => Date.now() - x.fetchedAt)) / 60000) : -1 };
    })()`,
    true,
  );
  check(
    '缓存表已改成 2 小时前（改旧这一步本身生效）',
    aged && aged.touched >= 1 && aged.minAge >= 60,
    JSON.stringify(aged),
  );
  m = mark();
  await reload();
  await waitFor(`document.body.innerText.includes('原始样本池')`, 25000);
  await sleep(800);
  check(
    `缓存过期后自动回源 1 次（缓存表 ${aged && aged.touched} 条已改旧）`,
    counts.report - m.report === 1,
    `实际 ${counts.report - m.report}`,
  );

  // ── 资讯中心 ───────────────────────────────────────────────
  m = mark();
  await goto('/info');
  const newsRendered = await waitFor(`document.body.innerText.includes('收录资讯')`, 25000);
  check('资讯首次打开能渲染出内容', newsRendered);
  check('资讯首次打开回源 1 次', counts.news - m.news === 1, `实际 ${counts.news - m.news}`);

  m = mark();
  await reload();
  const newsCached = await waitFor(`document.body.innerText.includes('收录资讯')`, 25000);
  await sleep(800);
  const newsBody = await text();
  check('资讯整页刷新后仍渲染', newsCached);
  check(
    '资讯整页刷新 0 次网络请求（一小时缓存生效）',
    counts.news - m.news === 0,
    `实际 ${counts.news - m.news}`,
  );
  check('资讯页显示「缓存 · …」提示', /缓存 · /.test(newsBody));

  // 切品类：新 key 要回源；切回「全部」：命中缓存
  m = mark();
  await evaluate(
    `(() => { const g = document.querySelector('[aria-label="按品类筛选"]'); const b = g && g.querySelectorAll('button')[1]; if (b) { b.click(); return b.innerText; } return null; })()`,
  );
  await waitFor(`document.body.innerText.includes('收录资讯')`, 25000);
  await sleep(800);
  const switched = counts.news - m.news;
  check('切到某个品类会为该筛选回源 1 次', switched === 1, `实际 ${switched}`);

  m = mark();
  await evaluate(
    `(() => { const g = document.querySelector('[aria-label="按品类筛选"]'); const b = g && g.querySelectorAll('button')[0]; if (b) { b.click(); return b.innerText; } return null; })()`,
  );
  await sleep(1500);
  const switchedBack = counts.news - m.news;
  check('切回「全部」命中缓存 0 次请求', switchedBack === 0, `实际 ${switchedBack}`);

  m = mark();
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '刷新'); if (b) { b.click(); return true; } return false; })()`,
  );
  await sleep(1500);
  check('资讯点「刷新」强制回源 1 次', counts.news - m.news === 1, `实际 ${counts.news - m.news}`);

  // ── HTTP 缓存头 ────────────────────────────────────────────
  const headers = await evaluate(
    `(async () => {
      const out = {};
      for (const url of ['/api/news?limit=5', '/api/report/game-industry']) {
        const r = await fetch(url);
        out[url] = { cc: r.headers.get('cache-control'), enc: r.headers.get('content-encoding') };
      }
      return out;
    })()`,
    true,
  );
  check(
    '两个接口都回 Cache-Control: no-store',
    Object.values(headers).every((h) => h && String(h.cc).includes('no-store')),
    JSON.stringify(headers),
  );

  const errors = await evaluate(`window.__probeErrors ? window.__probeErrors.length : 0`);
  check('页面无未捕获异常计数（尽力而为）', !errors || errors === 0, `errors=${errors}`);
} catch (err) {
  check('探针执行未抛异常', false, err instanceof Error ? err.message : String(err));
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('失败：' + failed.map((f) => f.name).join(' / '));
  try {
    ws.close();
  } catch {
    /* ignore */
  }
  edge.kill();
  process.exit(failed.length ? 1 : 0);
}
