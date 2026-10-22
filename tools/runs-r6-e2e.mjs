// R6 验收：批量任务/重试、成本账本、供应商注册表、备份 v4。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const EDGE = path.join('C:', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const WORKER_PY = path.join(ROOT, 'logs', 'tts-venv', 'Scripts', 'python.exe');
const WORKER_SCRIPT = path.join(ROOT, 'tools', 'tts-worker', 'worker.py');
const WORKER_URL = 'http://127.0.0.1:3101';
const PORT = 10800 + Math.floor(Math.random() * 200);
const APP = 'http://127.0.0.1:5173';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function workerHealthy() {
  try {
    const response = await fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(2500) });
    const data = await response.json();
    return response.ok && data.ok === true;
  } catch {
    return false;
  }
}

let workerProcess = null;
if (!(await workerHealthy())) {
  if (!fs.existsSync(WORKER_PY)) {
    console.error('缺少 logs/tts-venv；先运行 tools/tts-worker/start-tts-worker.ps1');
    process.exit(1);
  }
  workerProcess = spawn(WORKER_PY, [WORKER_SCRIPT, '--host', '127.0.0.1', '--port', '3101'], { stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await workerHealthy()) { ready = true; break; }
    await sleep(500);
  }
  if (!ready) throw new Error('TTS worker 启动失败');
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-r6-e2e-'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, 'about:blank',
], { stdio: 'ignore' });

class Client {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.waiters = new Map();
    this.errors = [];
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.id && this.waiters.has(msg.id)) {
        const { resolve, reject } = this.waiters.get(msg.id);
        this.waiters.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'exception');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(msg.params.args.map((arg) => arg.value || arg.description || '').join(' '));
      }
    });
  }
  send(method, params = {}, timeoutMs = 60000) {
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

async function connect() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', reject, { once: true });
        });
        return new Client(ws);
      }
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const client = await connect();
const evalJs = async (expression) => {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function waitFor(expression, timeoutMs = 30000, label = expression) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await evalJs(expression);
    if (last) return last;
    await sleep(400);
  }
  throw new Error('等待超时：' + label + ' last=' + JSON.stringify(last));
}

try {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: `${APP}/runs` });
  await sleep(5000);

  await waitFor(`[...document.querySelectorAll('button')].some((button) => button.textContent.includes('批量创建') && !button.disabled)`, 15000, '批量创建按钮');
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('批量创建'))?.click()`);
  await waitFor(`document.body.innerText.includes('批量创建成片任务')`, 10000, '批量创建弹窗');
  const selection = await evalJs(`(() => {
    const checks = [...document.querySelectorAll('input[type="checkbox"]')];
    return { total: checks.length, checked: checks.filter((item) => item.checked).length };
  })()`);
  check('批量弹窗默认选中 5 个脚本', selection.checked === 5 && selection.total >= 5, JSON.stringify(selection));

  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('创建并预检（5）'))?.click()`);
  await waitFor(`!!document.querySelector('[data-testid="batch-section"]')`, 20000, '批量任务卡');
  await waitFor(`document.querySelector('[data-testid="batch-section"]')?.innerText.includes('已完成')`, 120000, '批量完成');

  const batchState = await evalJs(`(async () => {
    const service = await import('/src/services/batchService.ts');
    const rows = await service.listRunBatches();
    const batch = rows[0];
    const progress = service.batchProgress(batch);
    return {
      id: batch.id,
      status: batch.status,
      items: batch.items.length,
      done: progress.done,
      failed: progress.failed,
      attempts: batch.items.reduce((sum, item) => sum + item.attempts, 0),
    };
  })()`);
  check(
    '5 条批量任务全部完成预检',
    batchState.items === 5 && batchState.done === 5 && batchState.failed === 0 && batchState.status === 'completed',
    JSON.stringify(batchState),
  );

  await evalJs(`[...document.querySelectorAll('[data-testid="batch-section"] button')].find((button) => button.textContent.includes('查看'))?.click()`);
  await waitFor(`!!document.querySelector('[data-testid="batch-detail"]')`, 10000, '批量详情');
  const batchDetail = await evalJs(`({
    links: document.querySelectorAll('[data-testid="batch-detail"] a[href^="/runs/"]').length,
    text: document.querySelector('[data-testid="batch-detail"]')?.innerText || '',
  })`);
  check(
    '批量详情列出 5 条任务且显示阻塞',
    batchDetail.links === 5 && batchDetail.text.includes('已预检') && batchDetail.text.includes('阻塞'),
    batchDetail.text.replace(/\s+/g, ' ').slice(0, 220),
  );

  await evalJs(`document.querySelector('[data-testid="batch-detail"] a[href^="/runs/"]')?.click()`);
  await sleep(3000);
  const runPath = await evalJs('location.pathname');
  const runId = String(runPath).split('/').pop();
  check('批量条目可跳转到任务详情', String(runPath).startsWith('/runs/'), String(runPath));
  await waitFor(`!!document.querySelector('[data-testid="voice-card"]')`, 15000, '配音卡');
  await waitFor(`(() => {
    const button = [...document.querySelectorAll('[data-testid="voice-card"] button')].find((item) => item.textContent.includes('生成配音与字幕'));
    return !!button && !button.disabled;
  })()`, 15000, '配音按钮');
  await evalJs(`[...document.querySelectorAll('[data-testid="voice-card"] button')].find((item) => item.textContent.includes('生成配音与字幕'))?.click()`);
  await waitFor(`!!document.querySelector('[data-testid="voice-audio"]')`, 90000, '配音生成');
  await waitFor(`document.querySelector('[data-testid="cost-card"]')?.innerText.includes('Edge TTS')`, 15000, '成本卡');
  const costState = await evalJs(`(async () => {
    const cost = await import('/src/services/costService.ts');
    const rows = await cost.listRunCosts(${JSON.stringify(runId)});
    const summary = cost.summarizeCosts(rows);
    return {
      count: rows.length,
      providerId: rows[0]?.providerId,
      capability: rows[0]?.capability,
      units: rows[0]?.units,
      actualCost: rows[0]?.actualCost,
      totalActual: summary.totalActual,
      card: document.querySelector('[data-testid="cost-card"]')?.innerText || '',
    };
  })()`);
  check(
    '生成配音后记录成本账本',
    costState.count >= 1 && costState.providerId === 'edge-tts' &&
      costState.capability === 'tts' && costState.units > 0 &&
      costState.actualCost === 0 && costState.totalActual === 0 &&
      costState.card.includes('¥0.00'),
    JSON.stringify(costState),
  );

  await evalJs(`[...document.querySelectorAll('[data-testid="cost-card"] button')].find((button) => button.textContent.includes('供应商'))?.click()`);
  await waitFor(`!!document.querySelector('[data-testid="provider-registry"]')`, 10000, '供应商注册表');
  const providerText = await evalJs(`document.querySelector('[data-testid="provider-registry"]')?.innerText || ''`);
  check(
    '供应商注册表含 Edge TTS/DeepSeek 与成本口径',
    providerText.includes('Edge TTS') && providerText.includes('DeepSeek') &&
      providerText.includes('付费') && providerText.includes('按供应商账单'),
    providerText.replace(/\s+/g, ' ').slice(0, 240),
  );
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '关闭')?.click()`);
  await sleep(400);

  // 失败重试：删掉一条 run 后再执行，预检失败会重试，重试后仍失败并可再次重试。
  const retryState = await evalJs(`(async () => {
    const batchService = await import('/src/services/batchService.ts');
    const runService = await import('/src/services/runService.ts');
    const { db } = await import('/src/db/index.ts');
    const scripts = (await db.scripts.toArray()).slice(0, 2);
    const batch = await batchService.createRunBatch({
      title: 'R6 失败重试 fixture',
      scriptIds: scripts.map((script) => script.id),
      concurrency: 2,
      actor: 'R6 E2E',
    });
    await runService.deleteRun(batch.items[0].runId);
    const first = await batchService.executeRunBatch(batch.id, { actor: 'R6 E2E' });
    const firstFailed = first.items.find((item) => item.status === 'failed');
    const retried = await batchService.executeRunBatch(batch.id, { retryFailedOnly: true, actor: 'R6 E2E' });
    const retriedFailed = retried.items.find((item) => item.status === 'failed');
    const result = {
      firstStatus: first.status,
      firstAttempts: firstFailed?.attempts ?? 0,
      firstError: firstFailed?.error ?? '',
      retryStatus: retried.status,
      retryAttempts: retriedFailed?.attempts ?? 0,
    };
    await batchService.deleteRunBatch(batch.id);
    for (const item of retried.items) {
      if (item.runId) await runService.deleteRun(item.runId);
    }
    return result;
  })()`);
  check(
    '批量失败项自动重试且可再次重试',
    retryState.firstAttempts >= 2 && retryState.retryAttempts > retryState.firstAttempts &&
      (retryState.firstStatus === 'partial' || retryState.firstStatus === 'failed') &&
      (retryState.retryStatus === 'partial' || retryState.retryStatus === 'failed'),
    JSON.stringify(retryState),
  );

  // 备份 v4：成本账本与批量任务随备份恢复
  const backupInfo = await evalJs(`(async () => {
    const backupModule = await import('/src/services/localBackup.ts');
    const backup = await backupModule.createLocalBackup();
    const file = new File([JSON.stringify(backup)], 'r6-backup.json', { type: 'application/json' });
    const preview = await backupModule.inspectLocalBackup(file);
    return {
      version: backup.version,
      costs: backup.runCosts.length,
      batches: backup.runBatches.length,
      previewCosts: preview.costCount,
      previewBatches: preview.batchCount,
      runCount: preview.runCount,
    };
  })()`);
  check(
    '备份 v4 包含成本与批量任务',
    backupInfo.version === 4 && backupInfo.costs >= 1 && backupInfo.batches >= 1 &&
      backupInfo.previewCosts === backupInfo.costs && backupInfo.previewBatches === backupInfo.batches,
    JSON.stringify(backupInfo),
  );

  const restored = await evalJs(`(async () => {
    const backupModule = await import('/src/services/localBackup.ts');
    const { db } = await import('/src/db/index.ts');
    const backup = await backupModule.createLocalBackup();
    const result = await backupModule.restoreLocalBackup(backup, 'replace');
    return {
      ...result,
      costsInDb: await db.runCosts.count(),
      batchesInDb: await db.runBatches.count(),
    };
  })()`);
  check(
    '备份 v4 恢复成本与批量任务',
    restored.costCount >= 1 && restored.batchCount >= 1 &&
      restored.costsInDb === restored.costCount && restored.batchesInDb === restored.batchCount,
    JSON.stringify(restored),
  );

  const realErrors = client.errors.filter((error) => !error.includes('Failed to load resource') && !error.includes('502'));
  check('无页面脚本报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || 'none');
} finally {
  if (client.errors.length) console.log('PAGE ERRORS:', client.errors.slice(0, 5).join(' | '));
  edge.kill();
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
  if (workerProcess) workerProcess.kill();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exitCode = 1;
