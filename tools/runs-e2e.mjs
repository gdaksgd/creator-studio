// 成片任务 v1 浏览器验收：创建/阻断/素材/复核/导出 ZIP。
// 本地 Edge headless + CDP；不依赖 Playwright。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = path.join('C:', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const PORT = 9375 + Math.floor(Math.random() * 200);
const APP = 'http://127.0.0.1:5173';
const DOWNLOAD_DIR = path.join(process.cwd(), 'logs', 'runs-e2e-downloads');
const KEEP_SAMPLE = process.env.KEEP_SAMPLE === '1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
// 下载目录是测试专用：清掉上一次留下的工件/ZIP，避免同名文件被覆盖后漏检。
for (const file of fs.readdirSync(DOWNLOAD_DIR)) {
  if (/\.(zip|md|csv|json)$/i.test(file)) fs.rmSync(path.join(DOWNLOAD_DIR, file), { force: true });
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-runs-e2e-'));
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
    this.requests = [];
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.id && this.waiters.has(msg.id)) {
        const { resolve, reject } = this.waiters.get(msg.id);
        this.waiters.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        return;
      }
      if (msg.method === 'Network.requestWillBeSent') {
        this.requests.push(msg.params.request.url);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'exception');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(msg.params.args.map((arg) => arg.value || arg.description || '').join(' '));
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

async function waitFor(expression, timeoutMs = 15000, label = expression) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await evalJs(expression);
    if (last) return last;
    await sleep(300);
  }
  throw new Error('等待超时：' + label);
}

async function waitForNewZip(before, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter((file) => file.endsWith('.zip'));
    const fresh = files.find((file) => !before.has(file));
    if (fresh) return path.join(DOWNLOAD_DIR, fresh);
    await sleep(300);
  }
  return '';
}

async function waitForNewFile(before, fileName, timeoutMs = 12000) {
  const start = Date.now();
  const suffixed = `${fileName.slice(0, fileName.lastIndexOf('.'))} (`;
  while (Date.now() - start < timeoutMs) {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter(
      (file) => !before.has(file) && (file === fileName || file.includes(suffixed)),
    );
    if (files.length) return path.join(DOWNLOAD_DIR, files[0]);
    await sleep(300);
  }
  return '';
}

try {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
    eventsEnabled: true,
  });

  await client.send('Page.navigate', { url: `${APP}/runs` });
  await sleep(5000);

  const href = await evalJs(`document.querySelector('a[href^="/runs/"]')?.getAttribute('href')`);
  check('演示任务出现在列表', !!href, href || '');
  if (!href) throw new Error('没有演示任务，无法继续');
  await client.send('Page.navigate', { url: APP + href });
  await sleep(3500);

  const title = await waitFor(`document.querySelector('h1')?.textContent`, 10000, '任务标题');
  check('任务详情可打开', !!title, String(title));
  const blockedText = await evalJs(`document.body.innerText.includes('有阻塞，发布包不可导出')`);
  check('演示任务初始为阻塞', blockedText);

  const timelineText = () => evalJs(`document.querySelector('[data-testid="run-timeline"]')?.innerText || ''`);
  const publishText = () => evalJs(`document.querySelector('[data-testid="publish-calibration"]')?.innerText || ''`);
  check('创建后有创建事件', String(await timelineText()).includes('创建任务并锁定脚本快照'), String(await timelineText()).slice(0, 80));

  // R1：五个阶段工件可单独下载（阻塞状态也可以）
  const artifactRows = await evalJs(`document.querySelectorAll('[data-testid="stage-artifacts"] button[aria-label^="下载 "]').length`);
  check('阶段工件卡有 5 个下载入口', artifactRows === 5, `buttons=${artifactRows}`);
  client.requests.length = 0;
  const artifactDefs = [
    { name: 'script.md', marker: '首发 6 小时' },
    { name: 'shotlist.csv', marker: '镜号' },
    { name: 'assets.csv', marker: '素材类型' },
    { name: 'checks.json', marker: '[' },
    { name: 'publish.md', marker: '# 发布交接' },
  ];
  const artifactPaths = new Map();
  for (const artifact of artifactDefs) {
    const beforeFiles = new Set(fs.readdirSync(DOWNLOAD_DIR));
    await evalJs(`document.querySelector('button[aria-label="下载 ${artifact.name}"]')?.click()`);
    const filePath = await waitForNewFile(beforeFiles, artifact.name);
    const size = filePath ? fs.statSync(filePath).size : 0;
    artifactPaths.set(artifact.name, filePath);
    check(`阶段工件 ${artifact.name} 可下载且非空`, !!filePath && size > 0, filePath ? `${size} bytes` : '没有新文件');
  }
  const artifactText = (name) => {
    const filePath = artifactPaths.get(name);
    return filePath ? fs.readFileSync(filePath, 'utf8') : '';
  };
  let checksJson = null;
  try { checksJson = JSON.parse(artifactText('checks.json')); } catch { /* checked below */ }
  const scriptText = artifactText('script.md');
  const shotlistText = artifactText('shotlist.csv');
  const assetsText = artifactText('assets.csv');
  const publishMd = artifactText('publish.md');
  check(
    '阶段工件内容与 run 快照一致',
    scriptText.includes('首发 6 小时') && shotlistText.includes('镜号') && assetsText.includes('素材类型') &&
      Array.isArray(checksJson) && publishMd.includes('# 发布交接'),
    `script=${scriptText.length} shotlist=${shotlistText.length} checks=${Array.isArray(checksJson) ? checksJson.length : 'invalid'}`,
  );
  check(
    'CSV 保留 UTF-8 BOM',
    shotlistText.charCodeAt(0) === 0xfeff && assetsText.charCodeAt(0) === 0xfeff,
    `${shotlistText.charCodeAt(0)} / ${assetsText.charCodeAt(0)}`,
  );
  const artifactRequests = client.requests.filter((url) => /^https?:/i.test(url));
  check('下载阶段工件不发网络请求', artifactRequests.length === 0, artifactRequests.slice(0, 3).join(' | ') || 'none');
  for (const artifact of artifactPaths.values()) {
    if (artifact) fs.rmSync(artifact, { force: true });
  }

  // R4：素材库授权 fixtures
  const seededAssets = await evalJs(`(async () => {
    const { db } = await import('/src/db/index.ts');
    const now = Date.now();
    const rows = [
      {
        id: 'e2e-asset-own', title: 'E2E 自有版权素材', type: 'image',
        url: 'https://example.com/e2e-own.png', category: 'indie', tags: ['开场', '实机'],
        note: 'E2E 自有版权素材', folder: 'E2E',
        sourceType: 'original', license: 'own', allowedPlatforms: ['bilibili', 'douyin'],
        createdAt: now, updatedAt: now,
      },
      {
        id: 'e2e-asset-expired', title: 'E2E 过期授权素材', type: 'image',
        url: 'https://example.com/e2e-expired.png', category: 'indie', tags: ['开场'],
        note: 'E2E 过期授权素材', folder: 'E2E',
        sourceType: 'stock', license: 'licensed', expiresAt: now - 86400000,
        allowedPlatforms: ['bilibili'], createdAt: now, updatedAt: now,
      },
      {
        id: 'e2e-asset-blocked', title: 'E2E 仅抖音素材', type: 'image',
        url: 'https://example.com/e2e-blocked.png', category: 'indie', tags: ['开场'],
        note: 'E2E 仅抖音授权素材', folder: 'E2E',
        sourceType: 'stock', license: 'licensed', allowedPlatforms: ['douyin'],
        createdAt: now, updatedAt: now,
      },
      {
        id: 'e2e-asset-legacy', title: 'E2E 旧素材记录', type: 'image',
        url: 'https://example.com/e2e-legacy.png', category: 'indie', tags: ['旧记录'],
        note: 'E2E 没有来源和授权字段的旧记录', folder: 'E2E',
        createdAt: now, updatedAt: now,
      },
    ];
    await db.assets.bulkPut(rows);
    const store = await import('/src/store/assetStore.ts');
    await store.useAssetStore.getState().loadAssets();
    return { count: rows.length };
  })()`);
  check('素材库 R4 fixtures 已写入', seededAssets.count === 4, JSON.stringify(seededAssets));

  await evalJs(`document.querySelector('button[aria-label="镜 1 选择素材库素材"]')?.click()`);
  await waitFor(`document.body.innerText.includes('为镜 1 选择素材')`, 10000, '素材选择弹窗');
  const pickerHasAsset = await evalJs(`!!document.querySelector('button[aria-label="选择素材 E2E 自有版权素材"]')`);
  check('素材选择弹窗列出可用素材', pickerHasAsset);
  await evalJs(`document.querySelector('button[aria-label="选择素材 E2E 自有版权素材"]')?.click()`);
  await waitFor(`document.querySelector('[data-testid="asset-slot-1"]')?.innerText.includes('E2E 自有版权素材')`, 10000, '素材关联');
  await waitFor(`!document.body.innerText.includes('为镜 1 选择素材')`, 10000, '素材关联完成');
  const slotOneText = await evalJs(`document.querySelector('[data-testid="asset-slot-1"]')?.innerText || ''`);
  check(
    '槽位显示来源/授权/平台',
    slotOneText.includes('授权可核验') && slotOneText.includes('原创') &&
      slotOneText.includes('自有版权') && slotOneText.includes('B站 / 抖音'),
    slotOneText.replace(/\s+/g, ' ').slice(0, 180),
  );
  const assetUsage = await evalJs(`(async () => {
    const { db } = await import('/src/db/index.ts');
    const asset = await db.assets.get('e2e-asset-own');
    return { usageCount: asset?.usageCount ?? 0, lastUsedAt: asset?.lastUsedAt ?? 0 };
  })()`);
  check('关联素材会记录使用次数', assetUsage.usageCount === 1 && assetUsage.lastUsedAt > 0, JSON.stringify(assetUsage));

  // 草稿包：阻塞状态下也应可导出，README 标记 DRAFT
  const beforeDraft = new Set(fs.readdirSync(DOWNLOAD_DIR).filter((file) => file.endsWith('.zip')));
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('导出草稿包'))?.click()`);
  const draftZip = await waitForNewZip(beforeDraft);
  check('草稿包 ZIP 已下载', !!draftZip, draftZip || '没有新 zip');
  if (draftZip) {
    const fflate = await import(pathToFileURL(path.join(process.cwd(), 'creator-app', 'node_modules', 'fflate', 'esm', 'index.mjs')).href);
    const unzippedDraft = fflate.unzipSync(new Uint8Array(fs.readFileSync(draftZip)));
    const draftReadme = fflate.strFromU8(unzippedDraft['README.md']);
    check('草稿包标记 DRAFT', draftReadme.includes('DRAFT'), draftReadme.slice(0, 40));
    fs.rmSync(draftZip, { force: true });
  }

  // 逐个把素材状态改为 ready；每次重新查询，避免 React 重渲染后的旧节点。
  for (let scene = 1; scene <= 5; scene += 1) {
    const changed = await evalJs(`(() => {
      const select = document.querySelector('select[aria-label="镜 ${scene} 素材状态"]');
      if (!select) return false;
      select.value = 'ready';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!changed) {
      check(`素材 ${scene} 状态可修改`, false, '找不到状态选择器');
      break;
    }
    await sleep(450);
  }
  const readyCount = await evalJs(`document.querySelectorAll('select[aria-label$="素材状态"]').length`);
  const allReady = await evalJs(`[...document.querySelectorAll('select[aria-label$="素材状态"]')].every((select) => select.value === 'ready')`);
  check('五个素材都标记为已准备', readyCount === 5 && allReady, `selects=${readyCount} allReady=${allReady}`);
  const assetTimeline = String(await timelineText());
  check('修改素材后新增素材事件', assetTimeline.includes('素材状态改为已准备'), assetTimeline.slice(0, 100));

  // 确认版权
  await evalJs(`(() => {
    const checkbox = document.querySelector('input[type="checkbox"]');
    if (checkbox && !checkbox.checked) checkbox.click();
    return checkbox?.checked;
  })()`);
  await sleep(600);
  const rightsChecked = await evalJs(`document.querySelector('input[type="checkbox"]')?.checked`);
  check('版权确认已勾选', !!rightsChecked);
  const rightsTimeline = String(await timelineText());
  check('确认版权后新增版权事件', rightsTimeline.includes('已确认素材版权/授权'), rightsTimeline.slice(0, 100));

  // 重新检查平台规则
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('重新检查'))?.click()`);
  await sleep(3000);
  const statusAfterCheck = await evalJs(`document.body.innerText.includes('待复核')`);
  check('重新检查后进入待复核', statusAfterCheck, await evalJs(`document.body.innerText.match(/待复核|可导出|阻塞/)?.[0] || ''`));
  const checkedTimeline = String(await timelineText());
  check('重新检查后新增检查事件', /发布前检查：\d+ 阻塞 \/ \d+ 提醒 \/ \d+ 通过/.test(checkedTimeline), checkedTimeline.slice(0, 120));

  // 复核备注必填（有提醒项）
  await evalJs(`(() => {
    const input = document.querySelector('input[placeholder="输入复核人"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'E2E 复核');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const textarea = document.querySelector('textarea[placeholder^="例如：素材已确认"]');
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, '素材齐备、版权确认；发布后回填播放数据。');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return !!textarea;
  })()`);
  await sleep(400);
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('标记复核通过'))?.click()`);
  await sleep(1200);
  const ready = await evalJs(`document.body.innerText.includes('复核已通过') || document.body.innerText.includes('可导出')`);
  check('复核通过后进入可导出', ready);
  const reviewTimeline = String(await timelineText());
  check('复核通过后新增复核事件', reviewTimeline.includes('复核通过'), reviewTimeline.slice(0, 100));

  // 导出发布包
  const before = new Set(fs.readdirSync(DOWNLOAD_DIR).filter((file) => file.endsWith('.zip')));
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('导出发布包') && !button.disabled)?.click()`);
  const zipPath = await waitForNewZip(before);
  check('发布包 ZIP 已下载', !!zipPath, zipPath || '没有新 zip');

  if (zipPath) {
    const fflate = await import(pathToFileURL(path.join(process.cwd(), 'creator-app', 'node_modules', 'fflate', 'esm', 'index.mjs')).href);
    const bytes = new Uint8Array(fs.readFileSync(zipPath));
    const unzipped = fflate.unzipSync(bytes);
    const names = Object.keys(unzipped);
    const required = ['README.md', 'manifest.json', 'script.md', 'shotlist.csv', 'assets.csv', 'publish.md', 'checks.json', 'source-topic.json'];
    const missing = required.filter((file) => !names.includes(file));
    check('ZIP 文件齐全', missing.length === 0, missing.join(', ') || names.join(', '));
    const readme = names.includes('README.md') ? fflate.strFromU8(unzipped['README.md']) : '';
    check('发布包标记 READY', readme.includes('READY'), readme.slice(0, 40));
    const manifest = names.includes('manifest.json') ? JSON.parse(fflate.strFromU8(unzipped['manifest.json'])) : null;
    check('manifest 可解析且有 pipeline', manifest?.format === 'creator-studio-run-pack' && !!manifest?.pipeline?.id);
    const assetsCsv = names.includes('assets.csv') ? fflate.strFromU8(unzipped['assets.csv']) : '';
    check(
      'assets.csv 带授权与素材库来源',
      assetsCsv.includes('来源,授权,到期,允许平台,素材ID,素材名称') &&
        assetsCsv.includes('自有版权') && assetsCsv.includes('e2e-asset-own'),
      assetsCsv.split('\r\n').slice(0, 2).join(' | ').slice(0, 220),
    );
    check('发布包标注演示性质', readme.includes('演示任务'), readme.slice(0, 80));
    if (KEEP_SAMPLE) {
      const sampleDir = path.join(process.cwd(), 'docs', 'examples');
      fs.mkdirSync(sampleDir, { recursive: true });
      const samplePath = path.join(sampleDir, 'creator-studio-sample-publish.zip');
      fs.copyFileSync(zipPath, samplePath);
      console.log('sample pack saved:', samplePath);
    }
    fs.rmSync(zipPath, { force: true });
  }

  const exportTimeline = String(await timelineText());
  check('导出发布包后新增导出事件', exportTimeline.includes('导出发布包'), exportTimeline.slice(0, 100));

  // R2：发布回填与校准
  const publishCard = String(await publishText());
  check(
    '发布校准显示真实数据与偏差',
    publishCard.includes('18.6万') && publishCard.includes('12.0万') &&
      publishCard.includes('+55.0%') && publishCard.includes('BV1demo0001') && publishCard.includes('B站接口'),
    publishCard.replace(/\s+/g, ' ').slice(0, 180),
  );
  check(
    '预测来源与口径可见',
    publishCard.includes('历史目标') && publishCard.includes('不是承诺'),
    publishCard.replace(/\s+/g, ' ').slice(0, 180),
  );

  await evalJs(`[...document.querySelectorAll('[data-testid="publish-calibration"] button')].find((button) => button.textContent.includes('绑定本次发布'))?.click()`);
  await waitFor(`document.querySelector('[data-testid="publish-calibration"]')?.innerText.includes('已绑定本次任务')`, 12000, '发布绑定');
  const boundText = String(await publishText());
  check(
    '绑定本次发布后显示已绑定',
    boundText.includes('已绑定本次任务') && boundText.includes('BV1demo0001'),
    boundText.replace(/\s+/g, ' ').slice(0, 140),
  );
  const bindTimeline = String(await timelineText());
  check('绑定发布后新增发布事件', bindTimeline.includes('绑定发布记录'), bindTimeline.slice(0, 100));

  const runUrl = await evalJs('location.href');
  await client.send('Page.navigate', { url: runUrl });
  await sleep(3000);
  await waitFor(`document.querySelector('[data-testid="publish-calibration"]')?.innerText.includes('已绑定本次任务')`, 10000, '刷新后的发布绑定');
  const boundAfterReload = String(await publishText());
  check(
    '刷新后发布绑定仍在',
    boundAfterReload.includes('已绑定本次任务') && boundAfterReload.includes('BV1demo0001'),
    boundAfterReload.replace(/\s+/g, ' ').slice(0, 140),
  );

  const beforeRepack = new Set(fs.readdirSync(DOWNLOAD_DIR).filter((file) => file.endsWith('.zip')));
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('重新导出发布包'))?.click()`);
  const repackPath = await waitForNewZip(beforeRepack, 15000);
  check('绑定后可重新导出发布包', !!repackPath, repackPath || '没有新 zip');
  if (repackPath) {
    const fflate = await import(pathToFileURL(path.join(process.cwd(), 'creator-app', 'node_modules', 'fflate', 'esm', 'index.mjs')).href);
    const unzipped = fflate.unzipSync(new Uint8Array(fs.readFileSync(repackPath)));
    const manifest = unzipped['manifest.json'] ? JSON.parse(fflate.strFromU8(unzipped['manifest.json'])) : null;
    const readme = unzipped['README.md'] ? fflate.strFromU8(unzipped['README.md']) : '';
    check(
      'manifest 含 publishRef 且 README 标注发布绑定',
      manifest?.run?.publishRef?.bvid === 'BV1demo0001' && readme.includes('发布绑定') && readme.includes('BV1demo0001'),
      `bvid=${manifest?.run?.publishRef?.bvid || 'none'} readme=${readme.includes('发布绑定')}`,
    );
    fs.rmSync(repackPath, { force: true });
  }

  const backupInfo = await evalJs(`(async () => {
    const module = await import('/src/services/localBackup.ts');
    const backup = await module.createLocalBackup();
    return { version: backup.version, runs: backup.runs.length };
  })()`);
  check('本地备份 v4 包含成片任务', backupInfo.version === 4 && backupInfo.runs > 0, JSON.stringify(backupInfo));

  const backupRoundTrip = await evalJs(`(async () => {
    const module = await import('/src/services/localBackup.ts');
    const backup = await module.createLocalBackup();
    const file = new File([JSON.stringify(backup)], 'creator-studio-backup-e2e.json', { type: 'application/json' });
    const preview = await module.inspectLocalBackup(file);
    const run = preview.backup.runs.find((item) => item.id.startsWith('demo-run-'));
    return {
      runCount: preview.runCount,
      version: preview.backup.version,
      warnings: preview.warnings.length,
      eventCount: run?.events?.length ?? 0,
      bvid: run?.publishRef?.bvid ?? '',
    };
  })()`);
  check('备份可回读且包含成片任务', backupRoundTrip.runCount > 0 && backupRoundTrip.version === 4, JSON.stringify(backupRoundTrip));
  check(
    '备份保留事件与发布绑定',
    backupRoundTrip.eventCount > 0 && backupRoundTrip.bvid === 'BV1demo0001',
    JSON.stringify(backupRoundTrip),
  );

  const backupGuards = await evalJs(`(async () => {
    const module = await import('/src/services/localBackup.ts');
    const backup = await module.createLocalBackup();
    const makeFile = (mutate) => {
      const copy = JSON.parse(JSON.stringify(backup));
      mutate(copy.runs[0]);
      return new File([JSON.stringify(copy)], 'backup-invalid.json', { type: 'application/json' });
    };
    let eventError = '';
    let publishError = '';
    try {
      await module.inspectLocalBackup(makeFile((run) => {
        run.events = [{ id: 'bad', type: 'not-a-type', at: 1, actor: 'E2E', summary: 'bad' }];
      }));
    } catch (error) { eventError = error.message; }
    try {
      await module.inspectLocalBackup(makeFile((run) => {
        run.publishRef = { topicId: 'topic', platform: 'youtube', publishedAt: 1, boundAt: 1 };
      }));
    } catch (error) { publishError = error.message; }
    return { eventError, publishError };
  })()`);
  check('备份拒绝非法事件', String(backupGuards.eventError).includes('不受支持'), backupGuards.eventError || 'no error');
  check('备份拒绝非法 publishRef', String(backupGuards.publishError).includes('不受支持'), backupGuards.publishError || 'no error');

  const restored = await evalJs(`(async () => {
    const module = await import('/src/services/localBackup.ts');
    const service = await import('/src/services/runService.ts');
    const backup = await module.createLocalBackup();
    const result = await module.restoreLocalBackup(backup, 'replace');
    const runs = await service.listRuns();
    const run = runs.find((item) => item.id.startsWith('demo-run-'));
    return { ...result, eventCount: run?.events?.length ?? 0, bvid: run?.publishRef?.bvid ?? '' };
  })()`);
  check('备份恢复包含成片任务', restored.runCount > 0 && restored.topicCount > 0, JSON.stringify(restored));
  check(
    '恢复后事件与发布绑定仍在',
    restored.eventCount > 0 && restored.bvid === 'BV1demo0001',
    JSON.stringify(restored),
  );

  // 从 runs 页创建任务（脚本页「开始成片」走的是同一个 query 入口）
  await client.send('Page.navigate', { url: APP + '/runs?create=1' });
  await sleep(3500);
  const modalOpen = await evalJs(`document.body.innerText.includes('创建成片任务')`);
  check('创建任务弹窗可打开', modalOpen);
  const pipelineOptions = await evalJs(`document.querySelectorAll('select[aria-label="选择流水线"] option').length`);
  check('创建弹窗提供 3 条流水线', pipelineOptions === 3, `options=${pipelineOptions}`);
  const pipelineSelected = await evalJs(`(() => {
    const select = document.querySelector('select[aria-label="选择流水线"]');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'version-marketing-pack');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);
  await sleep(500);
  const marketingHint = await evalJs(`document.body.innerText.includes('营销包不跑平台规则')`);
  check(
    '可选择版本营销素材包',
    pipelineSelected === 'version-marketing-pack' && marketingHint,
    `selected=${pipelineSelected} hint=${marketingHint}`,
  );
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('创建并检查'))?.click()`);
  await sleep(4500);
  const createdUrl = await evalJs('location.pathname');
  const createdRunId = String(createdUrl).split('/').pop();
  const createdDetail = await evalJs(`document.body.innerText.includes('素材与发布检查') && document.body.innerText.includes('素材清单')`);
  check('创建后进入任务详情', createdUrl.startsWith('/runs/') && createdDetail, createdUrl);

  const marketingDetail = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const run = await service.getRun(${JSON.stringify(createdRunId)});
    return {
      pipelineId: run?.pipelineId,
      stageKeys: run ? service.getRunStages(run).map((stage) => stage.key) : [],
      hasReviewCard: [...document.querySelectorAll('h2')].some((heading) => heading.textContent.trim() === '人工复核'),
      packList: document.querySelector('[data-testid="pack-file-list"]')?.innerText || '',
      artifactButtons: document.querySelectorAll('[data-testid="stage-artifacts"] button[aria-label^="下载 "]').length,
    };
  })()`);
  check(
    '营销任务使用 3 阶段流水线',
    marketingDetail.pipelineId === 'version-marketing-pack' &&
      marketingDetail.stageKeys.join(',') === 'lock,assets,pack' &&
      !marketingDetail.hasReviewCard,
    JSON.stringify(marketingDetail),
  );
  check(
    '营销导出清单不含完整分镜',
    marketingDetail.packList.includes('assets.csv') &&
      !marketingDetail.packList.includes('script.md') &&
      !marketingDetail.packList.includes('shotlist.csv'),
    marketingDetail.packList.replace(/\s+/g, ' ').slice(0, 160),
  );
  check('营销阶段工件只列相关文件', marketingDetail.artifactButtons === 3, `buttons=${marketingDetail.artifactButtons}`);

  const beforeMarketingZip = new Set(fs.readdirSync(DOWNLOAD_DIR).filter((file) => file.endsWith('.zip')));
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('导出草稿包'))?.click()`);
  const marketingZip = await waitForNewZip(beforeMarketingZip, 15000);
  check('营销草稿包 ZIP 已下载', !!marketingZip, marketingZip || '没有新 zip');
  if (marketingZip) {
    const fflate = await import(pathToFileURL(path.join(process.cwd(), 'creator-app', 'node_modules', 'fflate', 'esm', 'index.mjs')).href);
    const unzipped = fflate.unzipSync(new Uint8Array(fs.readFileSync(marketingZip)));
    const names = Object.keys(unzipped);
    const manifest = names.includes('manifest.json')
      ? JSON.parse(fflate.strFromU8(unzipped['manifest.json']))
      : null;
    const readme = names.includes('README.md') ? fflate.strFromU8(unzipped['README.md']) : '';
    check(
      '营销包不含分镜文件且 manifest 标记省略',
      !names.includes('script.md') &&
        !names.includes('shotlist.csv') &&
        manifest?.pipeline?.id === 'version-marketing-pack' &&
        manifest?.storyboardsOmitted === true &&
        manifest?.run?.snapshot?.script?.storyboards?.length === 0,
      JSON.stringify({ names, pipeline: manifest?.pipeline?.id, omitted: manifest?.storyboardsOmitted }),
    );
    check(
      '营销包 README 标明流水线与不含分镜',
      readme.includes('版本营销素材包') && readme.includes('不包含完整分镜'),
      readme.slice(0, 120),
    );
    fs.rmSync(marketingZip, { force: true });
  }

  const legacyPack = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const pack = await import('/src/services/runPack.ts');
    const runs = await service.listRuns();
    const demoRun = runs.find((item) => item.id.startsWith('demo-run-'));
    const legacy = { ...demoRun, pipelineId: undefined, pipelineVersion: undefined };
    const result = pack.buildRunPack(legacy, 'draft');
    const manifest = JSON.parse(result.files.find((file) => file.name === 'manifest.json').content);
    return {
      id: manifest.pipeline.id,
      version: manifest.pipeline.version,
      files: result.files.map((file) => file.name),
    };
  })()`);
  check(
    '旧 run 默认 game-longform 并写入 manifest',
    legacyPack.id === 'game-longform' && legacyPack.version === '1' && legacyPack.files.length === 8,
    JSON.stringify({ id: legacyPack.id, version: legacyPack.version, files: legacyPack.files.length }),
  );

  const createdPublish = String(await evalJs(`document.querySelector('[data-testid="publish-calibration"]')?.innerText || ''`));
  check(
    '无发布记录时显示空状态而非假数字',
    createdPublish.includes('这个选题还没有发布记录。') &&
      !createdPublish.includes('点赞') && !createdPublish.includes('BVID'),
    createdPublish.replace(/\s+/g, ' ').slice(0, 160),
  );

  const serviceGuards = await evalJs(`(async () => {
    const runService = await import('/src/services/runService.ts');
    const { db } = await import('/src/db/index.ts');
    const runs = await runService.listRuns();
    const demoRun = runs.find((run) => run.id.startsWith('demo-run-'));
    if (!demoRun || !demoRun.publishRef) return { error: 'missing demo run publishRef' };
    const ref = demoRun.publishRef;
    const input = { topicId: ref.topicId, platform: ref.platform, bvid: ref.bvid, url: ref.url, title: ref.title, publishedAt: ref.publishedAt };
    let platformError = '';
    try {
      await runService.bindRunPublish(demoRun.id, { ...input, platform: demoRun.platform === 'bilibili' ? 'douyin' : 'bilibili' });
    } catch (error) { platformError = error.message; }
    const capped = runService.appendRunEvents(
      { ...demoRun, events: Array.from({ length: 200 }, (_, index) => ({ id: 'e' + index, type: 'note_updated', at: index, actor: 'E2E', summary: 'x' })) },
      [{ type: 'checked', summary: '新事件' }],
      'E2E',
    );
    const script = await db.scripts.get(demoRun.scriptId);
    const second = script ? await runService.createRun(script, undefined, 'E2E') : null;
    let conflictMessage = '';
    let conflictTitle = '';
    if (second) {
      try { await runService.bindRunPublish(second.id, input); } catch (error) { conflictMessage = error.message; }
      const conflict = await runService.findRunPublishConflict(second.id, input);
      conflictTitle = conflict?.title || '';
      await runService.deleteRun(second.id);
    }
    return {
      platformError,
      cappedCount: capped.length,
      cappedDroppedOldest: capped[0]?.id !== 'e0',
      conflictMessage,
      conflictTitle,
      scriptFound: !!script,
    };
  })()`);
  check('平台不一致禁止绑定', String(serviceGuards.platformError).includes('不能绑定'), serviceGuards.platformError || JSON.stringify(serviceGuards));
  check('事件最多保留 200 条', serviceGuards.cappedCount === 200 && serviceGuards.cappedDroppedOldest, JSON.stringify(serviceGuards));
  check(
    '重复绑定给出冲突提示',
    String(serviceGuards.conflictMessage).includes('已绑定到另一条任务') && !!serviceGuards.conflictTitle,
    JSON.stringify(serviceGuards),
  );

  // ── R4：授权阻塞与未匹配豁免 ──
  const rightsGuard = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const pack = await import('/src/services/runPack.ts');
    const { db } = await import('/src/db/index.ts');
    const runs = await service.listRuns();
    const demo = runs.find((item) => item.id.startsWith('demo-run-'));
    const script = await db.scripts.get(demo.scriptId);
    const topic = await db.topics.get(demo.topicId);
    const temp = await service.createRun(script, topic, 'E2E');
    const expiredRun = await service.assignSlotAsset(temp.id, temp.assetSlots[0].id, 'e2e-asset-expired', 'E2E');
    let exportError = '';
    try { pack.buildRunPack(expiredRun, 'publish'); } catch (error) { exportError = error.message; }
    const expiredBlock = expiredRun.checks.some((check) => check.id === 'asset-rights-expired' && check.level === 'block');
    const blockedRun = await service.assignSlotAsset(temp.id, temp.assetSlots[0].id, 'e2e-asset-blocked', 'E2E');
    const blockedBlock = blockedRun.checks.some((check) => check.id === 'asset-platform-blocked' && check.level === 'block');
    await service.assignSlotAsset(temp.id, temp.assetSlots[0].id, null, 'E2E');
    for (const slot of blockedRun.assetSlots) {
      await service.updateAssetSlot(temp.id, slot.id, { status: 'not_needed' }, 'E2E');
    }
    const notNeeded = await service.getRun(temp.id);
    const unmatchedWhenSkipped = notNeeded.checks.some((check) => check.id === 'asset-unmatched');
    await service.deleteRun(temp.id);
    return {
      expiredBlock,
      expiredStatus: expiredRun.status,
      exportError,
      blockedBlock,
      blockedStatus: blockedRun.status,
      unmatchedWhenSkipped,
    };
  })()`);
  check(
    '过期素材阻塞发布包',
    rightsGuard.expiredBlock && rightsGuard.expiredStatus === 'blocked' && String(rightsGuard.exportError).includes('不能导出'),
    JSON.stringify(rightsGuard),
  );
  check(
    '平台不允许阻塞发布包',
    rightsGuard.blockedBlock && rightsGuard.blockedStatus === 'blocked',
    JSON.stringify(rightsGuard),
  );
  check('未匹配素材标记不需要不提醒', rightsGuard.unmatchedWhenSkipped === false, JSON.stringify(rightsGuard));

  // ── R3：同组任务与组合包 ──
  await client.send('Page.navigate', { url: APP + href });
  await sleep(3000);
  await waitFor(`!!document.querySelector('[data-testid="campaign-card"]')`, 10000, '同组任务卡');
  const campaignInitial = await evalJs(`document.body.innerText.includes('还没有同组任务。')`);
  check('同组任务卡初始为空', campaignInitial);

  await evalJs(`[...document.querySelectorAll('[data-testid="campaign-card"] button')].find((button) => button.textContent.includes('创建另一平台任务'))?.click()`);
  await waitFor(`document.body.innerText.includes('选择同一选题下另一平台的脚本版本')`, 10000, '创建同组任务弹窗');
  const variantInfo = await evalJs(`(() => {
    const select = document.querySelector('select[aria-label="选择另一平台脚本"]');
    return {
      options: select?.options.length ?? 0,
      text: select?.selectedOptions?.[0]?.textContent || '',
    };
  })()`);
  check(
    '同组弹窗列出另一平台脚本',
    variantInfo.options === 1 && variantInfo.text.includes('抖音'),
    JSON.stringify(variantInfo),
  );
  await evalJs(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('创建同组任务'))?.click()`);
  await waitFor(
    `(() => { const card = document.querySelector('[data-testid="campaign-card"]'); return !!card && card.innerText.includes('抖音 · 短版') && card.innerText.includes('当前任务'); })()`,
    15000,
    '同组任务创建',
  );

  const campaignState = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const runs = await service.listRuns();
    const demo = runs.find((item) => item.id.startsWith('demo-run-'));
    const rows = demo?.campaignId ? await service.listCampaignRuns(demo.campaignId) : [];
    return {
      campaignId: demo?.campaignId ?? '',
      count: rows.length,
      siblings: rows.map((item) => ({ id: item.id, platform: item.platform, pipelineId: item.pipelineId })),
      card: document.querySelector('[data-testid="campaign-card"]')?.innerText || '',
    };
  })()`);
  check(
    '创建同组任务并关联 campaign',
    !!campaignState.campaignId && campaignState.count === 2 &&
      campaignState.siblings.some((item) => item.pipelineId === 'game-shortform'),
    JSON.stringify(campaignState.siblings),
  );
  check(
    '同组卡片显示两条任务',
    campaignState.card.includes('B站 · 长版') &&
      campaignState.card.includes('抖音 · 短版') &&
      campaignState.card.includes('当前任务'),
    campaignState.card.replace(/\s+/g, ' ').slice(0, 140),
  );

  const beforeCampaignZip = new Set(fs.readdirSync(DOWNLOAD_DIR).filter((file) => file.endsWith('.zip')));
  await evalJs(`[...document.querySelectorAll('[data-testid="campaign-card"] button')].find((button) => button.textContent.includes('导出组合包'))?.click()`);
  const campaignZip = await waitForNewZip(beforeCampaignZip, 15000);
  check('组合包 ZIP 已下载', !!campaignZip, campaignZip || '没有新 zip');
  if (campaignZip) {
    const fflate = await import(pathToFileURL(path.join(process.cwd(), 'creator-app', 'node_modules', 'fflate', 'esm', 'index.mjs')).href);
    const unzipped = fflate.unzipSync(new Uint8Array(fs.readFileSync(campaignZip)));
    const names = Object.keys(unzipped);
    const campaign = names.includes('campaign.json')
      ? JSON.parse(fflate.strFromU8(unzipped['campaign.json']))
      : null;
    check(
      '组合包包含两条任务与 campaign.json',
      names.includes('campaign.json') &&
        names.includes('runs/bilibili-long/README.md') &&
        names.includes('runs/douyin-short/README.md') &&
        campaign?.runs?.length === 2,
      names.join(', '),
    );
    const pipelineIds = campaign?.runs?.map((item) => item.pipeline.id) ?? [];
    check(
      '组合包保留各自流水线',
      pipelineIds.includes('game-longform') && pipelineIds.includes('game-shortform'),
      JSON.stringify(pipelineIds),
    );
    check(
      '未就绪同组任务以 DRAFT 进入组合包',
      campaign?.runs?.find((item) => item.platform === 'douyin')?.packMode === 'draft',
      JSON.stringify(campaign?.runs?.map((item) => ({ platform: item.platform, mode: item.packMode }))),
    );
    fs.rmSync(campaignZip, { force: true });
  }

  await waitFor(`document.querySelector('[data-testid="run-timeline"]')?.innerText.includes('导出组合包')`, 10000, '组合包运行记录');
  check('组合包导出写入运行记录', true);

  const independence = await evalJs(`(async () => {
    const service = await import('/src/services/runService.ts');
    const runs = await service.listRuns();
    const demo = runs.find((item) => item.id.startsWith('demo-run-'));
    const rows = demo?.campaignId ? await service.listCampaignRuns(demo.campaignId) : [];
    const sibling = rows.find((item) => item.id !== demo?.id);
    if (!sibling) return { error: 'no sibling' };
    await service.archiveRun(sibling.id, 'E2E');
    const original = await service.getRun(demo.id);
    const siblingAfter = await service.getRun(sibling.id);
    return {
      originalStatus: original?.status,
      originalBound: !!original?.publishRef,
      siblingStatus: siblingAfter?.status,
      count: rows.length,
    };
  })()`);
  check(
    '归档同组任务不影响原任务',
    independence.originalStatus === 'exported' &&
      independence.originalBound &&
      independence.siblingStatus === 'archived' &&
      independence.count === 2,
    JSON.stringify(independence),
  );

  // 新 profile 首次访问 / 会被门户引导到 /welcome；标记已进站后再验证深链。
  await evalJs(`localStorage.setItem('creator-studio-visited', '1')`);
  await client.send('Page.navigate', { url: `${APP}/?publish=demo-topic-1` });
  await sleep(2500);
  await waitFor(`document.body.innerText.includes('记录发布结果')`, 12000, '发布深链弹窗');
  const deepLinkState = await evalJs(`({
    search: location.search,
    value: document.querySelector('input[placeholder^="https://www.bilibili.com/video/BV"]')?.value || '',
  })`);
  check(
    '?publish= 深链打开对应发布弹窗',
    String(deepLinkState.value).includes('BV1demo0001') && deepLinkState.search === '',
    JSON.stringify(deepLinkState),
  );

  await client.send('Page.navigate', { url: `${APP}/library` });
  await sleep(2500);
  const libraryText = String(await evalJs('document.body.innerText'));
  check(
    '旧素材显示未记录来源与授权',
    libraryText.includes('E2E 旧素材记录') &&
      libraryText.includes('未记录来源') &&
      libraryText.includes('未记录授权'),
    libraryText.slice(0, 160),
  );

  const realErrors = client.errors.filter((error) => !error.includes('Failed to load resource') && !error.includes('502'));
  check('无页面脚本报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || 'none');
} finally {
  if (client.errors.length) console.log('PAGE ERRORS:', client.errors.slice(0, 5).join(' | '));
  edge.kill();
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exitCode = 1;
