// R5 配音与字幕验收：真实 Edge TTS worker → 字幕 → 复核 → v2 媒体包。
// 依赖本地 logs/tts-venv 与 tools/tts-worker/worker.py；worker 未运行时会自动启动。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const EDGE = path.join('C:', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const WORKER_PY = path.join(ROOT, 'logs', 'tts-venv', 'Scripts', 'python.exe');
const WORKER_SCRIPT = path.join(ROOT, 'tools', 'tts-worker', 'worker.py');
const WORKER_URL = 'http://127.0.0.1:3101';
const PORT = 10400 + Math.floor(Math.random() * 200);
const APP = 'http://127.0.0.1:5173';
const DOWNLOAD_DIR = path.join(ROOT, 'logs', 'r5-e2e-downloads');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
for (const file of fs.readdirSync(DOWNLOAD_DIR)) {
  if (/\.zip$/i.test(file)) fs.rmSync(path.join(DOWNLOAD_DIR, file), { force: true });
}

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

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-r5-e2e-'));
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
async function waitForNewZip(before, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter((file) => file.endsWith('.zip'));
    const fresh = files.find((file) => !before.has(file));
    if (fresh) return path.join(DOWNLOAD_DIR, fresh);
    await sleep(300);
  }
  return '';
}

try {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
    eventsEnabled: true,
  });
  await client.send('Page.navigate', { url: `${APP}/runs` });
  await sleep(5000);

  const prep = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const { db } = await import('/src/db/index.ts');
    const runs = await service.listRuns();
    const demo = runs.find((item) => item.id.startsWith('demo-run-'));
    const script = await db.scripts.get(demo.scriptId);
    const topic = await db.topics.get(demo.topicId);
    let run = await service.createRun(script, topic, 'R5 E2E');
    for (const slot of run.assetSlots) {
      run = await service.updateAssetSlot(run.id, slot.id, { status: 'not_needed' }, 'R5 E2E');
    }
    run = await service.setRightsConfirmed(run.id, true, 'R5 E2E');
    run = await service.refreshRun(run.id, 'R5 E2E');
    return {
      id: run.id,
      pipelineVersion: run.pipelineVersion,
      status: run.status,
      stages: service.getRunStages(run).map((stage) => ({ key: stage.key, status: stage.status })),
      voiceMissing: run.checks.some((check) => check.id === 'voice-missing' && check.level === 'block'),
      demoId: demo.id,
    };
  })()`);
  check(
    'v2 任务创建后有 7 阶段且配音阻塞',
    prep.pipelineVersion === '2' && prep.stages.length === 7 && prep.status === 'blocked' && prep.voiceMissing,
    JSON.stringify(prep),
  );

  await client.send('Page.navigate', { url: `${APP}/runs/${prep.id}` });
  await sleep(3000);
  await waitFor(`!!document.querySelector('[data-testid="voice-card"]')`, 15000, '配音卡');
  const voiceCardText = await evalJs(`document.querySelector('[data-testid="voice-card"]')?.innerText || ''`);
  check('配音卡显示 Worker 已连接', voiceCardText.includes('Worker 已连接'), voiceCardText.slice(0, 120));

  await waitFor(`(() => {
    const button = [...document.querySelectorAll('[data-testid="voice-card"] button')].find((item) => item.textContent.includes('生成配音与字幕'));
    return !!button && !button.disabled;
  })()`, 15000, '配音按钮可用');
  await evalJs(`[...document.querySelectorAll('[data-testid="voice-card"] button')].find((item) => item.textContent.includes('生成配音与字幕'))?.click()`);
  await waitFor(
    `!!document.querySelector('[data-testid="voice-audio"]') && !!document.querySelector('[data-testid="subtitle-panel"]')`,
    90000,
    '配音与字幕生成',
  );

  const generated = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const media = await import('/src/services/runMedia.ts');
    const run = await service.getRun(${JSON.stringify(prep.id)});
    const mediaRecord = await media.getRunVoiceMedia(run.id);
    const audio = document.querySelector('[data-testid="voice-audio"]');
    return {
      voiceStatus: run.voiceover?.status,
      durationSec: run.voiceover?.durationSec,
      boundaries: run.voiceover?.boundaries?.length ?? 0,
      subtitles: {
        status: run.subtitles?.status,
        cueCount: run.subtitles?.cueCount,
        timingSource: run.subtitles?.timingSource,
        maxLineChars: run.subtitles?.maxLineChars,
        maxCharsPerSecond: run.subtitles?.maxCharsPerSecond,
        contentLength: run.subtitles?.content?.length ?? 0,
      },
      mediaSize: mediaRecord?.blob.size ?? 0,
      audioSrc: audio?.currentSrc || audio?.getAttribute('src') || '',
      status: run.status,
      stageKeys: service.getRunStages(run).map((stage) => stage.key),
      checks: run.checks.map((check) => ({ id: check.id, level: check.level })),
    };
  })()`);
  check(
    '真实音频与字幕已生成',
    generated.voiceStatus === 'ready' && generated.mediaSize > 1000 &&
      generated.subtitles.status === 'ready' && generated.subtitles.cueCount > 0 &&
      generated.subtitles.contentLength > 50,
    JSON.stringify(generated),
  );
  check('音频播放器指向本机 Blob', String(generated.audioSrc).startsWith('blob:'), generated.audioSrc);
  check(
    '生成后进入待复核且阶段完整',
    generated.status === 'review' && generated.stageKeys.includes('voice') && generated.stageKeys.includes('subtitles'),
    `status=${generated.status} stages=${generated.stageKeys.join(',')}`,
  );
  check(
    '配音/字幕检查通过',
    generated.checks.some((item) => item.id === 'voice-ready' && item.level === 'pass') &&
      generated.checks.some((item) => item.id === 'subtitle-ready' && item.level === 'pass') &&
      !generated.checks.some((item) => item.id === 'voice-missing'),
    JSON.stringify(generated.checks.filter((item) => item.id.startsWith('voice') || item.id.startsWith('subtitle'))),
  );

  const reviewed = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const run = await service.saveReview(${JSON.stringify(prep.id)}, {
      approved: true,
      reviewer: 'R5 E2E',
      note: '配音与字幕已生成；字幕时间戳来自 TTS，人工抽检通过。',
    }, 'R5 E2E');
    return { status: run.status, packStale: run.pack?.stale ?? false };
  })()`);
  check('复核通过后可导出', reviewed.status === 'ready', JSON.stringify(reviewed));

  await client.send('Page.navigate', { url: `${APP}/runs/${prep.id}` });
  await sleep(3000);
  await waitFor(`[...document.querySelectorAll('button')].some((button) => button.textContent.includes('导出发布包') && !button.disabled)`, 15000, '发布包按钮');
  const beforeZip = new Set(fs.readdirSync(DOWNLOAD_DIR).filter((file) => file.endsWith('.zip')));
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('导出发布包') && !button.disabled)?.click()`);
  const zipPath = await waitForNewZip(beforeZip);
  check('v2 发布包已下载', !!zipPath, zipPath || '没有新 zip');

  if (zipPath) {
    const fflate = await import(pathToFileURL(path.join(ROOT, 'creator-app', 'node_modules', 'fflate', 'esm', 'index.mjs')).href);
    const unzipped = fflate.unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
    const names = Object.keys(unzipped);
    const manifest = names.includes('manifest.json')
      ? JSON.parse(fflate.strFromU8(unzipped['manifest.json']))
      : null;
    const srt = names.includes('subtitles.srt') ? fflate.strFromU8(unzipped['subtitles.srt']) : '';
    const mp3Size = names.includes('voiceover.mp3') ? unzipped['voiceover.mp3'].length : 0;
    check(
      'v2 包含音频/字幕/JSON 与 manifest v2',
      ['voiceover.mp3', 'subtitles.srt', 'voice.json', 'subtitle.json'].every((name) => names.includes(name)) &&
        mp3Size > 1000 && srt.includes('-->') &&
        manifest?.formatVersion === '2' && manifest?.media?.voiceover === 'voiceover.mp3',
      JSON.stringify({ names, mp3Size, formatVersion: manifest?.formatVersion }),
    );
    check('v2 manifest 记录实际时长与字幕条数', (manifest?.media?.durationSec ?? 0) > 0 && (manifest?.media?.cueCount ?? 0) > 0, JSON.stringify(manifest?.media));
    fs.rmSync(zipPath, { force: true });
  }

  // v1 演示任务不应出现配音卡
  await client.send('Page.navigate', { url: `${APP}/runs/${prep.demoId}` });
  await sleep(3000);
  const v1HasVoiceCard = await evalJs(`!!document.querySelector('[data-testid="voice-card"]')`);
  check('v1 演示任务不要求配音/字幕', !v1HasVoiceCard);

  // Worker 不可用：阶段阻塞、生成按钮禁用、不产生假音频
  const unavailableRun = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const { db } = await import('/src/db/index.ts');
    const runs = await service.listRuns();
    const demo = runs.find((item) => item.id.startsWith('demo-run-'));
    const script = await db.scripts.get(demo.scriptId);
    const topic = await db.topics.get(demo.topicId);
    let run = await service.createRun(script, topic, 'R5 E2E');
    for (const slot of run.assetSlots) {
      run = await service.updateAssetSlot(run.id, slot.id, { status: 'not_needed' }, 'R5 E2E');
    }
    run = await service.setRightsConfirmed(run.id, true, 'R5 E2E');
    run = await service.refreshRun(run.id, 'R5 E2E');
    return { id: run.id };
  })()`);
  await evalJs(`localStorage.setItem('creator-studio-tts-worker', 'http://127.0.0.1:3999')`);
  await client.send('Page.navigate', { url: `${APP}/runs/${unavailableRun.id}` });
  await sleep(3000);
  await waitFor(`document.body.innerText.includes('Worker 未运行')`, 15000, 'Worker 未运行提示');
  const unavailable = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const run = await service.getRun(${JSON.stringify(unavailableRun.id)});
    const button = [...document.querySelectorAll('[data-testid="voice-card"] button')].find((item) => item.textContent.includes('生成配音与字幕'));
    return {
      status: run.status,
      voiceMissing: run.checks.some((check) => check.id === 'voice-missing' && check.level === 'block'),
      voiceover: run.voiceover ?? null,
      buttonDisabled: button?.disabled ?? null,
      hint: document.body.innerText.includes('没有 worker 时不会生成假音频'),
    };
  })()`);
  check(
    'Worker 不可用时配音阶段阻塞且按钮禁用',
    unavailable.status === 'blocked' && unavailable.voiceMissing && !unavailable.voiceover && unavailable.buttonDisabled === true && unavailable.hint,
    JSON.stringify(unavailable),
  );
  await evalJs(`localStorage.removeItem('creator-studio-tts-worker')`);
  await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    await service.deleteRun(${JSON.stringify(unavailableRun.id)});
  })()`);

  const realErrors = client.errors.filter((error) => !error.includes('Failed to load resource') && !error.includes('502'));
  check('无页面脚本报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || 'none');
} finally {
  if (client.errors.length) console.log('PAGE ERRORS:', client.errors.slice(0, 5).join(' | '));
  edge.kill();
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
  if (workerProcess) {
    workerProcess.kill();
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exitCode = 1;
