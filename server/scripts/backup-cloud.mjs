// ============================================================
//  云端保活 + 每日备份（Linux 版，等价于本机 tools/keepalive.ps1 + backup.ps1）
//
//  Supabase 免费版 7 天无活动会暂停，所以每天发一次轻量查询保活；
//  同一份响应体直接写成 backups/app_sync-YYYY-MM-DD.json（保留 30 天）。
//  任何异常都不覆盖已有备份。
//
//  依赖：Node 22（自带 fetch）+ server/node_modules 里的 dotenv
//  定时：cron "5 9 * * * /usr/bin/node /opt/creator-studio/server/scripts/backup-cloud.mjs"
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');
const rootDir = path.join(serverDir, '..');
const backupsDir = path.join(rootDir, 'backups');
const logFile = path.join(rootDir, 'logs', 'keepalive.log');
const selectCols = 'data,uploaded_at';
const keepDays = 30;

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

const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_ANON_KEY || '';
if (!base || !key) {
  log('SKIP  SUPABASE_URL / SUPABASE_ANON_KEY not configured');
  process.exit(0);
}

// 1) 保活查询（HTTP 200 即代表数据库有响应）
let res;
try {
  res = await fetch(`${base}/rest/v1/app_sync?select=${selectCols}&id=eq.1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
} catch (err) {
  log(`FAIL  keep-alive request failed: ${err?.message ?? err}`);
  process.exit(1);
}

if (res.status !== 200) {
  log(`FAIL  keep-alive query returned HTTP ${res.status}`);
  process.exit(1);
}
log('OK    keep-alive query succeeded');

// 2) 同一份响应写备份（解析失败不落盘，避免用坏响应覆盖好备份）
let payload;
try {
  payload = await res.json();
} catch (err) {
  log(`FAIL  response is not JSON: ${err?.message ?? err}`);
  process.exit(1);
}
const row = Array.isArray(payload) ? payload[0] : null;
if (!row || row.data == null || !('uploaded_at' in row)) {
  log('FAIL  unexpected response shape, backup skipped');
  process.exit(1);
}

const stamp = new Date().toLocaleDateString('sv-SE'); // 本地日期 YYYY-MM-DD
const record = {
  backedUpAt: new Date().toISOString(),
  select: selectCols,
  httpStatus: 200,
  uploaded_at: row.uploaded_at,
  data: row.data,
};
fs.mkdirSync(backupsDir, { recursive: true });
const dest = path.join(backupsDir, `app_sync-${stamp}.json`);
const tmp = `${dest}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
fs.renameSync(tmp, dest);
log(`OK    app_sync-${stamp}.json (uploaded_at=${row.uploaded_at}) ${fs.statSync(dest).size} B`);

// 3) 清理超过 30 天的备份（按文件名日期）
const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
for (const name of fs.readdirSync(backupsDir)) {
  const match = /^app_sync-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
  if (!match) continue;
  const day = Date.parse(`${match[1]}T00:00:00`);
  if (Number.isFinite(day) && day < cutoff) {
    fs.rmSync(path.join(backupsDir, name), { force: true });
    log(`OK    pruned expired backup: ${name}`);
  }
}
process.exit(0);
