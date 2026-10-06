'use strict';
const fs = require('fs');
const path = require('path');

const EXT = 'E:\\sillydata\\default-user\\extensions';
const files = [];
(function walk(d, depth) {
  if (depth > 3) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, depth + 1); }
    else files.push(p);
  }
})(EXT, 0);

function scan(re, label) {
  const hits = [];
  for (const f of files) {
    if (!/\.(json|txt|yaml|yml)$/i.test(f)) continue;
    let c;
    try { c = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (re.test(c)) hits.push(path.relative(EXT, f) + '  [' + c.length + 'B]');
    re.lastIndex = 0;
  }
  console.log(`\n=== ${label} ===`);
  console.log(hits.length ? hits.join('\n') : '(无)');
}

scan(/allow_streaming/, 'allow_streaming');
scan(/render_enabled/, 'render_enabled');
scan(/TH-render/, 'TH-render');
scan(/render_blob_url|render_depth/, '其它 render_*');

console.log('\n=== JS-Slash-Runner 配置文件候选 ===');
for (const f of files) {
  if (/JS-Slash-Runner/.test(f) && /\.json$/i.test(f)) console.log('  ' + path.relative(EXT, f));
}
