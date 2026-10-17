// ============================================================
//  HTML 报表渲染（visits-html.mjs 与 daily-report.mjs 共用）
//  单文件、内联样式、无外部依赖，可直接用浏览器打开或通过私密链接查看。
// ============================================================
import { loadVisits, summarize, geoLabel, fmtBeijing, beijingDay } from './visits.mjs';

const esc = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const cell = (text, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${esc(text)}</td>`;

export function renderReportHtml({ days = 7 } = {}) {
  const visits = loadVisits(days);
  const summary = summarize(visits);
  const { total, ips, geoCount, byGeo, byDay, byIp } = summary;

  const geoRows = [...byGeo.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .map(([key, e]) => `<tr>${cell(key)}${cell(e.views, 'num')}${cell(e.ips.size, 'num')}</tr>`)
    .join('');

  const dayRows = [...byDay.entries()]
    .sort()
    .reverse()
    .map(([day, e]) => `<tr>${cell(day)}${cell(e.views, 'num')}${cell(e.ips.size, 'num')}</tr>`)
    .join('');

  const ipRows = [...byIp.entries()]
    .sort((a, b) => (a[1].last < b[1].last ? 1 : -1))
    .slice(0, 60)
    .map(([ip, e]) => `<tr>${cell(ip, 'mono')}${cell(e.geo)}${cell(e.count, 'num')}${cell(fmtBeijing(e.last))}</tr>`)
    .join('');

  const detailRows = visits
    .slice(0, 300)
    .map((v) => `<tr>${cell(fmtBeijing(v.ts))}${cell(v.status ?? '-', 'num')}${cell(v.path || '/', 'mono')}${cell(v.ip || '-', 'mono')}${cell(geoLabel(v))}</tr>`)
    .join('');

  const today = beijingDay(new Date().toISOString());

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>访问报表 · creator.creator-app.xyz · ${esc(today)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f7f9; color: #101828; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 56px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
  h2 { margin: 28px 0 10px; font-size: 15px; letter-spacing: -.01em; }
  .sub { margin-top: 6px; color: #667085; font-size: 12px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 20px; }
  .card { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; padding: 16px 18px; }
  .card .k { color: #667085; font-size: 12px; }
  .card .v { margin-top: 4px; font-size: 26px; font-weight: 650; letter-spacing: -.02em; }
  .panel { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 9px 14px; text-align: left; border-bottom: 1px solid #eef1f5; font-size: 13px; }
  th { background: #f9fafb; color: #475467; font-weight: 600; font-size: 12px; }
  tr:last-child td { border-bottom: 0; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
  th.num { text-align: right; }
  .foot { margin-top: 26px; color: #98a2b3; font-size: 12px; }
  @media (max-width: 640px) {
    .cards { grid-template-columns: 1fr; }
    .wrap { padding: 20px 12px 40px; }
    th, td { padding: 8px 10px; }
    .hide-sm { display: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>访问报表</h1>
  <div class="sub">creator.creator-app.xyz · 最近 ${days} 天 · 北京时间 · 生成于 ${esc(fmtBeijing(new Date().toISOString()))}</div>

  <div class="cards">
    <div class="card"><div class="k">页面访问</div><div class="v">${total}<span style="font-size:13px;font-weight:500;color:#667085"> 次</span></div></div>
    <div class="card"><div class="k">独立访客</div><div class="v">${ips}<span style="font-size:13px;font-weight:500;color:#667085"> 个 IP</span></div></div>
    <div class="card"><div class="k">覆盖地区</div><div class="v">${geoCount}<span style="font-size:13px;font-weight:500;color:#667085"> 个</span></div></div>
  </div>

  <h2>按地区</h2>
  <div class="panel"><table>
    <thead><tr><th>地区</th><th class="num">访问</th><th class="num">IP</th></tr></thead>
    <tbody>${geoRows || '<tr><td colspan="3">暂无数据</td></tr>'}</tbody>
  </table></div>

  <h2>按天</h2>
  <div class="panel"><table>
    <thead><tr><th>日期</th><th class="num">访问</th><th class="num">IP</th></tr></thead>
    <tbody>${dayRows || '<tr><td colspan="3">暂无数据</td></tr>'}</tbody>
  </table></div>

  <h2>访客明细</h2>
  <div class="panel"><table>
    <thead><tr><th>IP</th><th>地区</th><th class="num">次数</th><th>最近访问</th></tr></thead>
    <tbody>${ipRows || '<tr><td colspan="4">暂无数据</td></tr>'}</tbody>
  </table></div>

  <h2>最近访问（最多 300 条）</h2>
  <div class="panel"><table>
    <thead><tr><th>时间</th><th class="num">状态</th><th>页面</th><th>IP</th><th class="hide-sm">地区</th></tr></thead>
    <tbody>${detailRows || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody>
  </table></div>

  <div class="foot">数据来源：服务端页面访问日志（Cloudflare 透传真实 IP 与地区头）。仅记录页面访问，不含 API 与静态资源。</div>
</div>
</body>
</html>`;
}
