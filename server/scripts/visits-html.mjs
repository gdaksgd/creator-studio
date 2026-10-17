// ============================================================
//  生成 HTML 访问报表
//
//  用法：
//    node server/scripts/visits-html.mjs --days 7 --out <file>
//    node server/scripts/visits-html.mjs --days 7 > report.html   （不带 --out 时输出到 stdout）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { renderReportHtml } from './lib/visits-html.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const days = Math.max(1, Number(arg('days', '7')));
const out = arg('out', '');

const html = renderReportHtml({ days });

if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`saved: ${out} (${(html.length / 1024).toFixed(1)} KB)`);
} else {
  process.stdout.write(html);
}
