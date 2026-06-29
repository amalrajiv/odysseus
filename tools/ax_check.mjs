#!/usr/bin/env node
/* ax-* adoption test harness (no browser required).
 *   1. Collects every .ax-* class DEFINED in static/css/components.css
 *   2. Collects every ax-* token USED in static html/js files
 *   3. Flags used-but-undefined ax-* classes (typo guard)
 *   4. Brace-balance sanity check on the CSS files
 *   5. Reports counts for any legacy classes passed as argv (orphan guard)
 * Usage: node tools/ax_check.mjs [legacyClass1 legacyClass2 ...]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = join(ROOT, 'static');
const COMPONENTS = join(STATIC, 'css', 'components.css');
const STYLE = join(STATIC, 'style.css');

function walk(dir, exts, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, acc);
    else if (exts.includes(extname(p))) acc.push(p);
  }
  return acc;
}

// 1. Defined ax-* selectors (class `.ax-…` OR id `#ax-…`) in components.css.
//    Ids count too: some ax-* namespaced singletons (e.g. #ax-window-switcher)
//    are referenced by id in JS, so the typo guard must know they're defined.
const componentsCss = readFileSync(COMPONENTS, 'utf8');
const defined = new Set();
for (const m of componentsCss.matchAll(/[.#](ax-[a-z0-9-]+)/g)) defined.add(m[1]);

// 2. Used ax-* tokens across html/js
const files = walk(STATIC, ['.html', '.js']);
const used = new Map(); // token -> Set(files)
for (const f of files) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/\bax-[a-z0-9-]+/g)) {
    if (!used.has(m[0])) used.set(m[0], new Set());
    used.get(m[0]).add(f.replace(ROOT, ''));
  }
}

// 3. Undefined-but-used
const undefinedUsed = [];
for (const [tok, where] of used) {
  if (!defined.has(tok)) undefinedUsed.push([tok, [...where]]);
}

// 4. Brace balance
function braceBalance(file) {
  const txt = readFileSync(file, 'utf8');
  let depth = 0;
  for (const ch of txt) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

// 5. Legacy orphan counts
const legacy = process.argv.slice(2);
const legacyCounts = {};
for (const cls of legacy) {
  let n = 0;
  for (const f of files) {
    const txt = readFileSync(f, 'utf8');
    const re = new RegExp('\\b' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    n += (txt.match(re) || []).length;
  }
  legacyCounts[cls] = n;
}

console.log('=== ax-* class resolution ===');
console.log(`defined ax-* classes: ${defined.size}`);
console.log(`used ax-* tokens:     ${used.size}`);
if (undefinedUsed.length) {
  console.log('UNDEFINED ax-* used (FAIL):');
  for (const [tok, where] of undefinedUsed) console.log(`  ${tok}  <- ${where.join(', ')}`);
} else {
  console.log('all used ax-* tokens are defined: OK');
}

console.log('\n=== CSS brace balance ===');
console.log(`components.css: ${braceBalance(COMPONENTS) === 0 ? 'balanced OK' : 'UNBALANCED ' + braceBalance(COMPONENTS)}`);
console.log(`style.css:      ${braceBalance(STYLE) === 0 ? 'balanced OK' : 'UNBALANCED ' + braceBalance(STYLE)}`);

if (legacy.length) {
  console.log('\n=== legacy orphan counts (markup/js) ===');
  for (const [cls, n] of Object.entries(legacyCounts)) console.log(`  ${cls}: ${n}`);
}

const fail = undefinedUsed.length > 0 || braceBalance(COMPONENTS) !== 0 || braceBalance(STYLE) !== 0;
process.exit(fail ? 1 : 0);
