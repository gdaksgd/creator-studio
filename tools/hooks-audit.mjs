// ============================================================
//  React hooks-order guard
//
//  Detects a hook call placed AFTER an early return in the same
//  component. That pattern throws at runtime:
//      "Rendered more hooks than during the previous render."
//  which crashes the whole page (white screen), but `tsc` reports
//  nothing and there is no ESLint in this project.
//
//  Real incident (2026-10-05): Analytics.tsx had
//      if (!account) return <Loading/>;
//      ...
//      const calibration = useMemo(...)   <-- added after the return
//  and the Analytics page went blank as soon as account data arrived.
//
//  Usage:  node tools/hooks-audit.mjs
//  Exit :  0 = clean, 1 = violations found
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'creator-app', 'src');

// a hook call at component top level (2-space indent)
const HOOK = /^\s{2,4}(?:const|let|var)?\s*.*?\b(use[A-Z]\w*)\s*\(/;
// a 2-space `if (` — candidate for an early return
const EARLY_IF = /^\s{2}if\s*\(/;
// a fresh top-level function/component declaration resets the scope
const NEW_SCOPE_FN = /^(export\s+)?(default\s+)?(async\s+)?function\s+\w+/;
const NEW_SCOPE_ARROW = /^const\s+[A-Z]\w*\s*(:[^=]+)?=\s*(\(|React\.memo|memo\b)/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(ROOT)) {
  console.error(`[ERROR] source directory not found: ${ROOT}`);
  process.exit(1);
}

const findings = [];

for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let earlyReturnLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*import\b/.test(line)) continue;

    if (NEW_SCOPE_FN.test(line) || NEW_SCOPE_ARROW.test(line)) {
      earlyReturnLine = 0;
      continue;
    }

    if (!earlyReturnLine && EARLY_IF.test(line)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        if (/^\s{4}return\b/.test(lines[j])) { earlyReturnLine = i + 1; break; }
        if (/^\s{2}\}/.test(lines[j])) break;
      }
      continue;
    }

    if (earlyReturnLine) {
      const m = line.match(HOOK);
      if (m && !/\/\//.test(line.split(m[1])[0])) {
        findings.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          earlyReturn: earlyReturnLine,
          hook: i + 1,
          hookName: m[1],
          text: line.trim().slice(0, 80),
        });
      }
    }
  }
}

if (findings.length === 0) {
  console.log('OK: no React hook is called after an early return.');
  process.exit(0);
}

console.error(`[ERROR] ${findings.length} hook call(s) placed after an early return.`);
console.error('        React will throw "Rendered more hooks than during the previous render."\n');
for (const f of findings) {
  console.error(`  ${f.file}:${f.hook}  <-- ${f.hookName}()  (early return at :${f.earlyReturn})`);
  console.error(`        ${f.text}`);
}
process.exit(1);
