// ============================================================
//  每日访问日报（北京时间 09:10 由 cron 触发）
//
//  1) 生成最近 7 天的 HTML 报表 → server/data/reports/visits-YYYY-MM-DD.html
//  2) 把昨日摘要推送到微信：
//     - Server酱³（https://sct.ftqq.com）：.env 配 WECHAT_PUSH_KEY
//     - PushPlus（https://www.pushplus.plus）：.env 配 PUSHPLUS_TOKEN
//     （两个都配就都发；都没配就只生成报表并记录 SKIP）
//  3) 清理 90 天前的报表文件
//
//  日志：logs/daily-report.log
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadVisits, summarize, beijingDay } from './lib/visits.mjs';
import { renderReportHtml } from './lib/visits-html.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');
const rootDir = path.join(serverDir, '..');
const reportsDir = path.join(serverDir, 'data', 'reports');
const logFile = path.join(rootDir, 'logs', 'daily-report.log');

dotenv.config({ path: path.join(serverDir, '.env') });

function log(message) {
  const line = `${new Date().toISOString()}  ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    /* 日志失败不影响主流程 */
  }
  process.stdout.write(line);
}

const today = beijingDay(new Date().toISOString());
const yesterday = beijingDay(new Date(Date.now() - 24 * 3600 * 1000).toISOString());

// ---------- 1. 生成 HTML 报表 ----------
let reportPath = null;
try {
  const html = renderReportHtml({ days: 7 });
  fs.mkdirSync(reportsDir, { recursive: true });
  reportPath = path.join(reportsDir, `visits-${today}.html`);
  fs.writeFileSync(reportPath, html);
  log(`OK    report saved: ${path.basename(reportPath)} (${(html.length / 1024).toFixed(1)} KB)`);
} catch (err) {
  log(`FAIL  render report: ${err?.message ?? err}`);
}

// ---------- 2. 昨日摘要 ----------
const visits = loadVisits(3);
const yesterdayVisits = visits.filter((v) => beijingDay(v.ts) === yesterday);
const stats = summarize(yesterdayVisits);
const topGeo =
  [...stats.byGeo.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 4)
    .map(([key, entry]) => `${key} ×${entry.views}`)
    .join('；') || '-';
const pageCount = new Map();
for (const v of yesterdayVisits) {
  const page = (v.path || '/').split('?')[0];
  pageCount.set(page, (pageCount.get(page) || 0) + 1);
}
const topPages =
  [...pageCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([page, count]) => `${page} ×${count}`)
    .join('；') || '-';

const token = (process.env.REPORT_TOKEN || '').trim();
const link = token ? `https://creator.creator-app.xyz/r/${token}/visits-${today}.html` : '';

const title = `访问日报 ${yesterday} · ${yesterdayVisits.length} 次 / ${stats.ips} 人`;
const body = [
  `**昨日（${yesterday}）**：页面访问 ${yesterdayVisits.length} 次 · 独立访客 ${stats.ips} 个`,
  '',
  `**地区**：${topGeo}`,
  `**页面**：${topPages}`,
  '',
  link ? `[查看完整 HTML 报表](${link})` : '',
].join('\n');

// ---------- 3. 推送 ----------
const pushKey = (process.env.WECHAT_PUSH_KEY || '').trim();
const pushPlus = (process.env.PUSHPLUS_TOKEN || '').trim();

if (!pushKey && !pushPlus) {
  log('SKIP  push not configured (WECHAT_PUSH_KEY / PUSHPLUS_TOKEN)');
} else {
  if (pushKey) {
    try {
      const res = await fetch(`https://sctapi.ftqq.com/${pushKey}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title, desp: body }),
        signal: AbortSignal.timeout(15000),
      });
      log(`PUSH  serverchan ${res.ok ? 'OK' : 'FAIL'} HTTP ${res.status}`);
    } catch (err) {
      log(`FAIL  serverchan push: ${err?.message ?? err}`);
    }
  }
  if (pushPlus) {
    try {
      const res = await fetch('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pushPlus, title, content: body, template: 'markdown' }),
        signal: AbortSignal.timeout(15000),
      });
      log(`PUSH  pushplus ${res.ok ? 'OK' : 'FAIL'} HTTP ${res.status}`);
    } catch (err) {
      log(`FAIL  pushplus push: ${err?.message ?? err}`);
    }
  }
}

// ---------- 4. 清理 90 天前的报表 ----------
try {
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  for (const name of fs.readdirSync(reportsDir)) {
    const m = /^visits-(\d{4})-(\d{2})-(\d{2})\.html$/.exec(name);
    if (!m) continue;
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`);
    if (Number.isFinite(t) && t < cutoff) {
      fs.rmSync(path.join(reportsDir, name), { force: true });
      log(`OK    pruned ${name}`);
    }
  }
} catch (err) {
  log(`WARN  prune failed: ${err?.message ?? err}`);
}
