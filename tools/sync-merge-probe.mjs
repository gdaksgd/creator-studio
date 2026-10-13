// 首次登录「本机匿名数据会不会被云端整表覆盖」的端到端验证（前端审阅者 HIGH ③）。
//
// 剧本：全新档案（空 IndexedDB）→ 打开站点，前端自动播种演示数据（本机匿名创作）
//      → 用 API 注册一个新账号并把一条「只有云端有」的选题上传上去
//      → 把 token 写进 localStorage、确保没有 lastSyncAt，然后整页刷新
//        （这条路径就是「首次登录进已有云端内容的账号」）
//      → 断言本机匿名数据仍在（按 id 合并，而不是清空 6 张表后回填）
//      → 断言合并后本机独有的记录被推到了账号云端。
//
// 用法：node _sync-merge-probe.mjs [baseUrl]
// 跑完请清理云端测试账号：
//   cd D:\自媒体之路\server; npx.cmd tsx scripts/cloud-admin.ts prune-prefix "mrg"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const PORT = 9371;
const NONCE = Date.now().toString(36);
const USER = `mrg${NONCE}`.slice(0, 24); // USERNAME_PATTERN 上限 24 字符
const PASSWORD = 'ProbePass123!';
const CLOUD_TOPIC_ID = `cloud-only-${NONCE}`;

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

const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!edge) throw new Error('找不到 Edge');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-merge-'));
const child = spawn(edge, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-features=Translate',
  base,
], { stdio: 'ignore' });

let ws = null;
let msgId = 0;
const pending = new Map();
let loadFired = 0;

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

async function reloadAndWait() {
  const before = loadFired;
  await send('Page.reload', {});
  for (let i = 0; i < 100 && loadFired === before; i += 1) await sleep(200);
  if (loadFired === before) throw new Error('整页刷新没有等到 load 事件');
}

async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch { /* 页面可能正在换文档 */ }
    await sleep(400);
  }
  throw new Error(`等不到：${label}`);
}

const PROBE_ALL = `
window.__probeAll = (store) => new Promise((resolve) => {
  const req = indexedDB.open('CreatorStudio');
  req.onerror = () => resolve([]);
  req.onsuccess = () => {
    const dbi = req.result;
    if (!dbi.objectStoreNames.contains(store)) { dbi.close(); resolve([]); return; }
    const tx = dbi.transaction(store, 'readonly');
    const all = tx.objectStore(store).getAll();
    all.onsuccess = () => { const rows = all.result || []; dbi.close(); resolve(rows.map((r) => ({ id: String(r.id || ''), demo: String(r.id || '').startsWith('demo-') }))); };
    all.onerror = () => { dbi.close(); resolve([]); };
  };
});
// 直接往 IndexedDB 写一条「使用者自己的匿名创作」（不是演示数据，演示数据会被上传层按设计过滤掉）
window.__probePut = (store, row) => new Promise((resolve) => {
  const req = indexedDB.open('CreatorStudio');
  req.onerror = () => resolve(false);
  req.onsuccess = () => {
    const dbi = req.result;
    const tx = dbi.transaction(store, 'readwrite');
    tx.objectStore(store).put(row);
    tx.oncomplete = () => { dbi.close(); resolve(true); };
    tx.onerror = () => { dbi.close(); resolve(false); };
  };
});
true;`;

let token = '';
try {
  await connect();
  await send('Page.enable', {});
  await send('Runtime.enable', {});

  // 1) 等到前端把匿名演示数据播种进 IndexedDB
  await waitFor(`(async () => { ${PROBE_ALL} return (await window.__probeAll('topics')).length > 0; })()`, 30000, '匿名演示数据进 IndexedDB');
  const localBefore = await evaluate(`(async () => { ${PROBE_ALL} return window.__probeAll('topics'); })()`);
  check('全新档案打开后本机有匿名数据（演示数据已播种）', localBefore.length > 0, `topics=${localBefore.length}`);
  const demoCount = localBefore.filter((row) => row.demo).length;
  check('这些本机数据是匿名创作（demo- 前缀）', demoCount > 0, `demo=${demoCount}/${localBefore.length}`);

  // 1b) 再放一条「使用者自己的」匿名创作（非 demo-：上传层会按设计过滤掉 demo- 记录）
  const LOCAL_TOPIC_ID = `local-only-${NONCE}`;
  const putOk = await evaluate(`(async () => { ${PROBE_ALL} const now = Date.now(); return window.__probePut('topics', { id: ${JSON.stringify(LOCAL_TOPIC_ID)}, title: '只存在于本机的匿名选题', category: 'game', status: 'idea', source: 'manual', createdAt: now, updatedAt: now }); })()`);
  check('本机写入一条自己的匿名选题（非演示数据）', putOk === true, `id=${LOCAL_TOPIC_ID}`);

  // 2) 注册账号 + 往该账号云端传一条「只有云端有」的选题
  const setup = await evaluate(`(async () => {
    const reg = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASSWORD)} }) });
    const regBody = await reg.json().catch(() => ({}));
    if (!reg.ok) return { ok: false, status: reg.status, body: regBody };
    const tok = regBody.token;
    const now = Date.now();
    const topic = { id: ${JSON.stringify(CLOUD_TOPIC_ID)}, title: '只存在于云端的选题', category: 'game', status: 'idea', source: 'manual', createdAt: now, updatedAt: now };
    const up = await fetch('/api/sync/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ topics: [topic], scripts: [] }) });
    const upBody = await up.json().catch(() => ({}));
    return { ok: up.ok, status: up.status, uploadStatus: up.status, uploadBody: upBody, token: tok };
  })()`);
  check('注册测试账号成功', !!setup.ok, `status=${setup.status} body=${JSON.stringify(setup.body || setup.uploadBody)}`);
  token = setup.token || '';
  check('云端已写入一条账号独有选题', !!token, `uploadStatus=${setup.uploadStatus}`);

  // 3) 模拟「首次登录这个账号」：token 有了、lastSyncAt 不存在，然后刷新
  await evaluate(`localStorage.setItem('creator-studio-token', ${JSON.stringify(token)}); localStorage.removeItem('lastSyncAt'); true;`);
  await reloadAndWait();

  // 4) 等同步完成：云端独有那条出现在本机
  await waitFor(`(async () => { ${PROBE_ALL} const rows = await window.__probeAll('topics'); return rows.some((r) => r.id === ${JSON.stringify(CLOUD_TOPIC_ID)}); })()`, 40000, '云端选题被合并进本机');
  const localAfter = await evaluate(`(async () => { ${PROBE_ALL} return window.__probeAll('topics'); })()`);
  const ids = new Set(localAfter.map((row) => row.id));
  check('合并后本机拿到了云端那条选题', ids.has(CLOUD_TOPIC_ID), `topics=${localAfter.length}`);
  const demoAfter = localAfter.filter((row) => row.demo).length;
  check('合并没有清空本机匿名创作（HIGH ③ 的丢数据路径）', demoAfter > 0, `demo 保留 ${demoAfter}/${demoCount}`);
  check('本机数据总条数不少于合并前', localAfter.length >= localBefore.length, `${localBefore.length} → ${localAfter.length}`);
  const lastSync = await evaluate(`localStorage.getItem('lastSyncAt')`);
  check('合并后写入了 lastSyncAt', Number(lastSync) > 0, `lastSyncAt=${lastSync}`);

  // 5) 本机独有的记录应当已被补传进这个账号的云端
  //    上传走的是防抖队列（scheduleSyncUpload），所以要轮询等它真正发出去。
  let cloud = { ok: false, status: 0, ids: [], empty: null, uploadedAt: 0 };
  const cloudDeadline = Date.now() + 30000;
  while (Date.now() < cloudDeadline) {
    cloud = await evaluate(`(async () => {
      const res = await fetch('/api/sync/download', { headers: { Authorization: 'Bearer ' + ${JSON.stringify(token)} } });
      const body = await res.json();
      return { ok: res.ok, status: res.status, ids: (body.topics || []).map((t) => String(t.id)), empty: body.empty, uploadedAt: body.uploadedAt };
    })()`);
    if (cloud.ids.includes(LOCAL_TOPIC_ID)) break;
    await sleep(1000);
  }
  check('云端下载成功（确认回传结果）', cloud.ok, `status=${cloud.status} empty=${cloud.empty} uploadedAt=${cloud.uploadedAt}`);
  check('本机自己的匿名选题已被补传到账号云端（不再只存在于本机）', cloud.ids.includes(LOCAL_TOPIC_ID), `云端 ${cloud.ids.length} 条：${cloud.ids.join(', ').slice(0, 200)}`);
  check('云端仍保留原本那条账号独有选题', cloud.ids.includes(CLOUD_TOPIC_ID));
  check('演示数据仍按设计留在本机、不进云端（README 承诺）', cloud.ids.every((id) => !id.startsWith('demo-')), `云端 ${cloud.ids.filter((id) => id.startsWith('demo-')).length} 条 demo`);
} catch (error) {
  check('探针执行未抛异常', false, String(error && error.message ? error.message : error));
} finally {
  console.log(results.join('\n'));
  console.log(`\n${passed}/${passed + failed} 断言通过${failed ? `，${failed} 项失败` : ''}`);
  console.log(`测试账号: ${USER}（清理：cd D:\\自媒体之路\\server; npx.cmd tsx scripts/cloud-admin.ts prune-prefix "${USER}"）`);
  try { child.kill(); } catch { /* ignore */ }
  await sleep(300);
  process.exit(failed ? 1 : 0);
}
