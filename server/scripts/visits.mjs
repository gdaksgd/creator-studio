// ============================================================
//  访问报表（北京时间）
//
//  用法：
//    node server/scripts/visits.mjs                  # 最近 7 天 + 最近 50 条明细
//    node server/scripts/visits.mjs --days 30        # 最近 30 天
//    node server/scripts/visits.mjs --limit 200      # 明细行数
//    node server/scripts/visits.mjs --ip 1.2.3.4     # 只看某个 IP
//
//  数据来源：data/access/YYYY-MM.jsonl（由服务端 accessLog 中间件写入，
//  地区来自 Cloudflare 注入的 CF-IPCountry / CF-Region / CF-IPCity 头）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const accessDir = path.join(here, '..', 'data', 'access');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const days = Math.max(1, Number(arg('days', '7')));
const limit = Math.max(1, Number(arg('limit', '50')));
const onlyIp = arg('ip', null);

const COUNTRY = {
  CN: '中国', HK: '中国香港', TW: '中国台湾', MO: '中国澳门',
  US: '美国', SG: '新加坡', JP: '日本', KR: '韩国', GB: '英国',
  DE: '德国', FR: '法国', CA: '加拿大', AU: '澳大利亚', NL: '荷兰',
  RU: '俄罗斯', IN: '印度', MY: '马来西亚', TH: '泰国', VN: '越南',
};
const countryName = (code) => (code ? COUNTRY[code] || code : '-');
const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  } catch {
    return iso;
  }
};
const geo = (v) => {
  const parts = [countryName(v.country)];
  if (v.region) parts.push(v.region);
  if (v.city) parts.push(v.city);
  return parts.join(' · ');
};

const cutoff = Date.now() - days * 24 * 3600 * 1000;
const files = fs.existsSync(accessDir)
  ? fs.readdirSync(accessDir).filter((f) => f.endsWith('.jsonl')).sort().slice(-2)
  : [];

const visits = [];
for (const file of files) {
  for (const line of fs.readFileSync(path.join(accessDir, file), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v.ts && Date.parse(v.ts) >= cutoff) visits.push(v);
    } catch {
      /* 跳过坏行 */
    }
  }
}

if (visits.length === 0) {
  console.log(`最近 ${days} 天没有访问记录（${accessDir}）`);
  process.exit(0);
}

visits.sort((a, b) => (a.ts < b.ts ? 1 : -1));
const filtered = onlyIp ? visits.filter((v) => v.ip === onlyIp) : visits;

// 汇总
const ipSet = new Set(visits.map((v) => v.ip).filter(Boolean));
const geoSet = new Set(visits.map((v) => geo(v)).filter((g) => g !== '-'));
console.log('');
console.log(`=== 访问汇总（最近 ${days} 天，北京时间）===`);
console.log(`页面访问 ${filtered.length} 次 · 独立访客 ${ipSet.size} 个 · 地区 ${geoSet.size} 个`);

const byGeo = new Map();
for (const v of filtered) {
  const key = geo(v);
  const entry = byGeo.get(key) ?? { views: 0, ips: new Set() };
  entry.views += 1;
  if (v.ip) entry.ips.add(v.ip);
  byGeo.set(key, entry);
}
console.log('\n--- 按地区 ---');
for (const [key, entry] of [...byGeo.entries()].sort((a, b) => b[1].views - a[1].views)) {
  console.log(`${key.padEnd(24)} ${String(entry.views).padStart(4)} 次 / ${entry.ips.size} 个 IP`);
}

const byDay = new Map();
for (const v of filtered) {
  const day = new Date(v.ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const entry = byDay.get(day) ?? { views: 0, ips: new Set() };
  entry.views += 1;
  if (v.ip) entry.ips.add(v.ip);
  byDay.set(day, entry);
}
console.log('\n--- 按天 ---');
for (const [day, entry] of [...byDay.entries()].sort().reverse()) {
  console.log(`${day}  ${String(entry.views).padStart(4)} 次 / ${entry.ips.size} 个 IP`);
}

// 访客明细（按 IP 聚合；IPv6 较长，按最长的 IP 动态对齐）
const byIp = new Map();
for (const v of filtered) {
  const key = v.ip || '(unknown)';
  const entry = byIp.get(key) ?? { count: 0, last: v.ts, first: v.ts, geo: geo(v) };
  entry.count += 1;
  if (v.ts > entry.last) entry.last = v.ts;
  if (v.ts < entry.first) entry.first = v.ts;
  if (entry.geo === '-' && geo(v) !== '-') entry.geo = geo(v);
  byIp.set(key, entry);
}
const ipWidth = Math.min(42, Math.max(18, ...[...byIp.keys()].map((ip) => ip.length + 2)));
console.log('\n--- 访客明细（按最近访问排序）---');
console.log(`${'IP'.padEnd(ipWidth)}地区                     次数  最近访问`);
for (const [ip, entry] of [...byIp.entries()].sort((a, b) => (a[1].last < b[1].last ? 1 : -1)).slice(0, 30)) {
  console.log(`${ip.padEnd(ipWidth)}${entry.geo.padEnd(24)} ${String(entry.count).padStart(4)}  ${fmtTime(entry.last)}`);
}

// 最近访问明细
const detailIpWidth = Math.min(42, Math.max(18, ...filtered.slice(0, limit).map((v) => (v.ip || '-').length + 2)));
console.log(`\n--- 最近访问（最多 ${limit} 条）---`);
console.log(`时间                  状态  路径                        ${'IP'.padEnd(detailIpWidth)}地区`);
for (const v of filtered.slice(0, limit)) {
  const time = fmtTime(v.ts).padEnd(19);
  const status = String(v.status ?? '-').padEnd(4);
  const p = (v.path || '/').slice(0, 26).padEnd(26);
  const ip = (v.ip || '-').padEnd(detailIpWidth);
  console.log(`${time}  ${status}  ${p}  ${ip}${geo(v)}`);
}
console.log('');
