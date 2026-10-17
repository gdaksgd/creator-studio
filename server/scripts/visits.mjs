// ============================================================
//  访问报表（北京时间，控制台输出）
//
//  用法：
//    node server/scripts/visits.mjs                  # 最近 7 天 + 最近 50 条明细
//    node server/scripts/visits.mjs --days 30        # 最近 30 天
//    node server/scripts/visits.mjs --limit 200      # 明细行数
//    node server/scripts/visits.mjs --ip 1.2.3.4     # 只看某个 IP
// ============================================================
import { loadVisits, summarize, geoLabel, fmtBeijing } from './lib/visits.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const days = Math.max(1, Number(arg('days', '7')));
const limit = Math.max(1, Number(arg('limit', '50')));
const onlyIp = arg('ip', null);

let visits = loadVisits(days);
if (onlyIp) visits = visits.filter((v) => v.ip === onlyIp);

if (visits.length === 0) {
  console.log(`最近 ${days} 天没有访问记录`);
  process.exit(0);
}

const { total, ips, geoCount, byGeo, byDay, byIp } = summarize(visits);

console.log('');
console.log(`=== 访问汇总（最近 ${days} 天，北京时间）===`);
console.log(`页面访问 ${total} 次 · 独立访客 ${ips} 个 · 地区 ${geoCount} 个`);

console.log('\n--- 按地区 ---');
for (const [key, entry] of [...byGeo.entries()].sort((a, b) => b[1].views - a[1].views)) {
  console.log(`${key.padEnd(24)} ${String(entry.views).padStart(4)} 次 / ${entry.ips.size} 个 IP`);
}

console.log('\n--- 按天 ---');
for (const [day, entry] of [...byDay.entries()].sort().reverse()) {
  console.log(`${day}  ${String(entry.views).padStart(4)} 次 / ${entry.ips.size} 个 IP`);
}

const ipWidth = Math.min(42, Math.max(18, ...[...byIp.keys()].map((ip) => ip.length + 2)));
console.log('\n--- 访客明细（按最近访问排序）---');
console.log(`${'IP'.padEnd(ipWidth)}地区                     次数  最近访问`);
for (const [ip, entry] of [...byIp.entries()].sort((a, b) => (a[1].last < b[1].last ? 1 : -1)).slice(0, 30)) {
  console.log(`${ip.padEnd(ipWidth)}${entry.geo.padEnd(24)} ${String(entry.count).padStart(4)}  ${fmtBeijing(entry.last)}`);
}

const detailIpWidth = Math.min(42, Math.max(18, ...visits.slice(0, limit).map((v) => (v.ip || '-').length + 2)));
console.log(`\n--- 最近访问（最多 ${limit} 条）---`);
console.log(`时间                  状态  路径                        ${'IP'.padEnd(detailIpWidth)}地区`);
for (const v of visits.slice(0, limit)) {
  console.log(
    `${fmtBeijing(v.ts).padEnd(19)}  ${String(v.status ?? '-').padEnd(4)}  ${(v.path || '/').slice(0, 26).padEnd(26)}  ${(v.ip || '-').padEnd(detailIpWidth)}${geoLabel(v)}`,
  );
}
console.log('');
