// ============================================================
//  访问数据读取（visits.mjs / visits-html.mjs / daily-report.mjs 共用）
//  数据：data/access/YYYY-MM.jsonl（服务端 accessLog 中间件写入）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const accessDir = path.join(here, '..', '..', 'data', 'access');

export const COUNTRY = {
  CN: '中国', HK: '中国香港', TW: '中国台湾', MO: '中国澳门',
  US: '美国', SG: '新加坡', JP: '日本', KR: '韩国', GB: '英国',
  DE: '德国', FR: '法国', CA: '加拿大', AU: '澳大利亚', NL: '荷兰',
  RU: '俄罗斯', IN: '印度', MY: '马来西亚', TH: '泰国', VN: '越南',
};

export const countryName = (code) => (code ? COUNTRY[code] || code : '-');

/** 「中国 · 上海 · 上海」/「中国香港 · Hong Kong」/「-」 */
export function geoLabel(v) {
  const parts = [countryName(v.country)];
  if (v.region) parts.push(v.region);
  if (v.city) parts.push(v.city);
  return parts.join(' · ');
}

/** 北京时间格式化 */
export function fmtBeijing(iso, options = { hour12: false }) {
  try {
    return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', ...options });
  } catch {
    return iso;
  }
}

/** 北京时间的日期（YYYY-MM-DD） */
export function beijingDay(iso) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

/**
 * 读取最近 days 天（按北京时间筛选）的访问，按时间倒序返回。
 * 最多回看 3 个月度文件，足够覆盖 90 天。
 */
export function loadVisits(days = 7) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const files = fs.existsSync(accessDir)
    ? fs.readdirSync(accessDir).filter((f) => f.endsWith('.jsonl')).sort().slice(-3)
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
  visits.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return visits;
}

/** 汇总：地区 / 按天 / 按 IP */
export function summarize(visits) {
  const ipSet = new Set(visits.map((v) => v.ip).filter(Boolean));
  const geoSet = new Set(visits.map(geoLabel).filter((g) => g !== '-'));

  const byGeo = new Map();
  for (const v of visits) {
    const key = geoLabel(v);
    const entry = byGeo.get(key) ?? { views: 0, ips: new Set() };
    entry.views += 1;
    if (v.ip) entry.ips.add(v.ip);
    byGeo.set(key, entry);
  }

  const byDay = new Map();
  for (const v of visits) {
    const day = beijingDay(v.ts);
    const entry = byDay.get(day) ?? { views: 0, ips: new Set() };
    entry.views += 1;
    if (v.ip) entry.ips.add(v.ip);
    byDay.set(day, entry);
  }

  const byIp = new Map();
  for (const v of visits) {
    const key = v.ip || '(unknown)';
    const entry = byIp.get(key) ?? { count: 0, first: v.ts, last: v.ts, geo: geoLabel(v) };
    entry.count += 1;
    if (v.ts > entry.last) entry.last = v.ts;
    if (v.ts < entry.first) entry.first = v.ts;
    if (entry.geo === '-' && geoLabel(v) !== '-') entry.geo = geoLabel(v);
    byIp.set(key, entry);
  }

  return { total: visits.length, ips: ipSet.size, geoCount: geoSet.size, byGeo, byDay, byIp };
}
