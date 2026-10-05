// 无头浏览器验收：平台适配检查面板的「自动保存 + 输入即复查 + 填写完毕」
// 用 Edge headless + CDP 驱动真实页面，直接读 IndexedDB 校验落库与回显。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const APP = 'http://127.0.0.1:3001';
const SCRIPT_ID = 'e2e-panel-script';
const TOPIC_ID = 'e2e-panel-topic';
const SEED_COVER = '原有封面文案';
const TYPED_COVER = '新封面文案（实测）';
const COVER_INPUT = 'input[placeholder="不填就不会给封面相关的结论"]';

const results = [];
const log = (...a) => console.log(...a);
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-e2e-'));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

class Client {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.waiters = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.waiters.has(msg.id)) {
        const { resolve, reject } = this.waiters.get(msg.id);
        this.waiters.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.waiters.has(id)) {
          this.waiters.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, timeoutMs);
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
        return new Client(ws);
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

async function evaluate(client, expression) {
  const r = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error('页面内异常: ' + d);
  }
  return r.result ? r.result.value : undefined;
}

async function waitFor(client, expression, timeoutMs = 15000, label = expression) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await evaluate(client, expression);
      if (last) return last;
    } catch (e) {
      last = 'err: ' + e.message;
    }
    await sleep(150);
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}；最后一次结果=${JSON.stringify(last)}`);
}

const seedExpr = `new Promise((resolve, reject) => {
  const req = indexedDB.open('CreatorStudio');
  req.onerror = () => reject(String(req.error));
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('scripts') || !db.objectStoreNames.contains('topics')) {
      reject('store missing: ' + Array.from(db.objectStoreNames).join(','));
      return;
    }
    const tx = db.transaction(['topics', 'scripts'], 'readwrite');
    const now = Date.now();
    tx.objectStore('topics').put({
      id: '${TOPIC_ID}', title: 'E2E 验收选题', category: 'horror', platform: 'bilibili',
      source: 'manual', status: 'idea', score: 80, tags: [], summary: '验收用', createdAt: now, updatedAt: now
    });
    tx.objectStore('scripts').put({
      id: '${SCRIPT_ID}', topicId: '${TOPIC_ID}', platform: 'bilibili', version: 'long',
      title: 'E2E 标题', hook: 'E2E 钩子', storyboards: [], notes: '',
      createdAt: now, updatedAt: now,
      platformCheck: { coverText: '${SEED_COVER}', ctr: 4.5, updatedAt: now }
    });
    tx.oncomplete = () => { db.close(); resolve('seeded'); };
    tx.onerror = () => reject(String(tx.error));
  };
})`;

const readRecordExpr = `new Promise((resolve, reject) => {
  const req = indexedDB.open('CreatorStudio');
  req.onerror = () => reject(String(req.error));
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(['scripts'], 'readonly');
    const g = tx.objectStore('scripts').get('${SCRIPT_ID}');
    g.onsuccess = () => { const v = g.result; db.close(); resolve(v ? JSON.stringify(v.platformCheck || null) : 'MISSING'); };
    g.onerror = () => reject(String(g.error));
  };
})`;

const inputValueExpr = `(() => {
  const el = document.querySelector(${JSON.stringify(COVER_INPUT)});
  return el ? el.value : null;
})()`;

const bodyTextExpr = `document.body ? document.body.innerText : ''`;

let client;
try {
  client = await connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  // 挡住云同步：既不让云端数据把本地种子冲掉，也不把验收假数据传上云
  await client.send('Network.setBlockedURLs', { urls: ['*://*/api/sync*', '*/api/sync*'] });

  // 1) 先加载应用，让 Dexie 建好库
  await client.send('Page.navigate', { url: APP + '/' });
  await waitFor(
    client,
    `indexedDB.databases().then(dbs => dbs.some(d => d.name === 'CreatorStudio') ? 'ready' : '')`,
    20000,
    'Dexie 建库完成'
  );

  // 2) 种一条主题 + 一条带旧 platformCheck 的脚本
  const seeded = await evaluate(client, seedExpr);
  check('种入带旧封面文案的脚本', seeded === 'seeded', String(seeded));

  // 3) 直接打开这条脚本的编辑页：面板应从脚本记录里回显旧内容
  await client.send('Page.navigate', { url: `${APP}/scripts/${SCRIPT_ID}` });
  const restored = await waitFor(
    client,
    `(() => { const el = document.querySelector(${JSON.stringify(COVER_INPUT)}); return el && el.value ? el.value : ''; })()`,
    20000,
    '面板渲染出封面文案输入框'
  );
  check('重开脚本后封面上次填的内容还在', restored === SEED_COVER, `输入框回显=${JSON.stringify(restored)}`);
  const panelText0 = await evaluate(client, bodyTextExpr);
  check('面板出现在脚本编辑页', panelText0.includes('平台适配检查'), panelText0.includes('平台适配检查') ? '' : '未见面板标题');

  // 4) 结果要能渲染出来（旧代码在这里会被 429 打住、一直停在「正在检查…」）
  const firstResults = await waitFor(
    client,
    `document.body.innerText.includes('全部带出处') ? document.body.innerText.match(/规则：\\d+ 条[^\\n]*/)[0] : ''`,
    20000,
    '首轮规则结论渲染'
  );
  check('面板首轮就给出规则结论（没有被限流拦住）', !!firstResults, firstResults);
  check('精简后只剩 4 条能真判断的规则', firstResults.includes('规则：4 条'), firstResults);

  // v1.5.2：只给「参考」、没有分析的规则行与对应输入整体删除，不留死 UI
  const panelTextNoRows = await evaluate(client, bodyTextExpr);
  for (const gone of ['填更多', '封面图像', '封面点击率', 'CTR', '更新节奏', '计划更新', '不填就不会给结论']) {
    check(`面板里已没有「${gone}」`, !panelTextNoRows.includes(gone), panelTextNoRows.includes(gone) ? '仍然出现' : '已移除');
  }

  // 5) 模拟键入：只改输入框，不点任何按钮
  const before = client.events.length;
  const typed = await evaluate(
    client,
    `(() => {
      const el = document.querySelector(${JSON.stringify(COVER_INPUT)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(TYPED_COVER)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`
  );
  check('键入生效（React 收到 input 事件）', typed === TYPED_COVER, `输入框=${JSON.stringify(typed)}`);

  // 6) 自动保存：不点按钮，等 1.2s 直接查 IndexedDB
  await sleep(1200);
  const rec1 = await evaluate(client, readRecordExpr);
  let parsed1 = null;
  try {
    parsed1 = JSON.parse(rec1);
  } catch {
    /* ignore */
  }
  check(
    '自动保存：没点按钮也已写进脚本记录',
    parsed1 && parsed1.coverText === TYPED_COVER,
    `platformCheck=${rec1}`
  );
  check(
    'CTR 等旧值仍在记录里没有被覆盖丢失',
    parsed1 && parsed1.ctr === 4.5,
    `ctr=${parsed1 ? JSON.stringify(parsed1.ctr) : 'n/a'}`
  );

  // 7) 实时复查：看这一轮真的发出了检查请求且全部 200
  await sleep(1800);
  const coverReqs = client.events
    .slice(before)
    .filter((e) => e.method === 'Network.requestWillBeSent' && String(e.params.request.url).includes('/api/ai/evaluate-cover'));
  const coverResps = client.events
    .slice(before)
    .filter((e) => e.method === 'Network.responseReceived' && String(e.params.response.url).includes('/api/ai/evaluate-cover'));
  const statuses = coverResps.map((e) => e.params.response.status);
  check('输入后自动发出了平台检查请求', coverReqs.length >= 2, `requests=${coverReqs.length}`);
  check(
    '复查请求全部成功（无 429）',
    coverResps.length >= 2 && statuses.every((s) => s === 200),
    `status=${JSON.stringify(statuses)}`
  );
  const panelText1 = await evaluate(client, bodyTextExpr);
  check('结论仍在页面上（没有停在「正在检查…」）', panelText1.includes('全部带出处'), '');
  check('没有出现限流提示', !panelText1.includes('检查太频繁'), '');
  check('状态行显示已自动保存', /上次填写/.test(panelText1), '');

  // 8) 「填写完毕」按钮
  const clicked = await evaluate(
    client,
    `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '填写完毕');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()`
  );
  check('页面上有「填写完毕」按钮且可点击', clicked === 'clicked', clicked);
  await sleep(1500);
  const panelText2 = await evaluate(client, bodyTextExpr);
  check('点「填写完毕」后给出复查反馈', panelText2.includes('已保存并复查') || panelText2.includes('已保存，正在复查'), '');

  // 9) 重新加载页面：内容必须还在（用户报的就是这一条）
  await client.send('Page.reload', { ignoreCache: true });
  const afterReload = await waitFor(
    client,
    `(() => { const el = document.querySelector(${JSON.stringify(COVER_INPUT)}); return el && el.value ? el.value : ''; })()`,
    20000,
    '刷新后面板重新渲染'
  );
  check('刷新页面后填好的封面文案依然在', afterReload === TYPED_COVER, `输入框=${JSON.stringify(afterReload)}`);
  const rec2 = await evaluate(client, readRecordExpr);
  check('刷新后脚本记录里的封面文案没变', rec2.includes(TYPED_COVER), `platformCheck=${rec2}`);

  const pageErrors = client.events.filter((e) => e.method === 'Runtime.exceptionThrown');
  check('页面没有 JS 异常', pageErrors.length === 0, pageErrors.length ? JSON.stringify(pageErrors[0].params) : '');
} catch (e) {
  check('验收脚本执行完成', false, e.message);
  if (client) {
    try {
      await client.send('Log.enable');
      const dump = await evaluate(
        client,
        `JSON.stringify({
           href: location.href,
           title: document.title,
           text: (document.body ? document.body.innerText : '(no body)').slice(0, 700),
           inputs: Array.from(document.querySelectorAll('input')).map(i => i.placeholder || i.type).slice(0, 20),
           buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).slice(0, 25)
         })`
      );
      log('--- 失败现场 ---');
      log(dump);
      const interesting = client.events.filter(
        (ev) =>
          ev.method === 'Runtime.exceptionThrown' ||
          ev.method === 'Log.entryAdded' ||
          ev.method === 'Runtime.consoleAPICalled' ||
          (ev.method === 'Network.responseReceived' && /\/scripts\/|evaluate-cover|\/api\/sync/.test(String(ev.params.response.url)))
      );
      for (const ev of interesting.slice(-25)) {
        if (ev.method === 'Network.responseReceived') log(`[net] ${ev.params.response.status} ${ev.params.response.url}`);
        else if (ev.method === 'Log.entryAdded') log(`[log] ${ev.params.entry.level}: ${ev.params.entry.text}`);
        else if (ev.method === 'Runtime.exceptionThrown') log(`[exc] ${ev.params.exceptionDetails.exception?.description || ev.params.exceptionDetails.text}`);
        else log(`[console] ${ev.params.type}: ${(ev.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
      }
    } catch (dbgErr) {
      log('（现场信息也取不到：' + dbgErr.message + '）');
    }
  }
} finally {
  try {
    edge.kill();
  } catch {
    /* ignore */
  }
  await sleep(500);
  try {
    fs.rmSync(userDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const failed = results.filter((r) => !r.ok);
log('');
log(`合计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
if (failed.length) log('失败项：' + failed.map((f) => f.name).join(' | '));
process.exit(failed.length ? 1 : 0);
