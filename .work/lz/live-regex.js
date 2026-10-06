'use strict';
const fs = require('fs');
const path = require('path');

const SETTINGS = 'E:\\sillydata\\default-user\\settings.json';
const j = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));

console.log('=== settings.json 顶层键 ===');
console.log(Object.keys(j).join(', '));

function listRegex(label, arr) {
  if (!Array.isArray(arr)) { console.log(`\n[${label}] 不是数组 / 不存在`); return; }
  console.log(`\n=== ${label}（${arr.length} 条）===`);
  arr.forEach((r, i) => {
    const name = r.scriptName || r.script_name || '(无名)';
    const dis = r.disabled ?? (r.enabled === false);
    const find = String(r.findRegex || r.find_regex || '');
    const place = (r.placement || []).join('/');
    console.log(
      `${String(i).padStart(3)} ${dis ? '✗停用' : '✓启用'} p=[${place}] md=${r.markdownOnly} pr=${r.promptOnly} ` +
      `| ${name} | ${find.length > 90 ? find.slice(0, 90) + '…' : find}`,
    );
  });
}

listRegex('全局 extension_settings.regex', j.extension_settings && j.extension_settings.regex);
if (j.extension_settings) {
  console.log('\n=== 其它 regex 相关 ===');
  console.log('preset_allowed_regex:', JSON.stringify(j.extension_settings.preset_allowed_regex || null));
  console.log('character_allowed_regex:', JSON.stringify(j.extension_settings.character_allowed_regex || null));
  console.log('disabledExtensions:', JSON.stringify(j.extension_settings.disabledExtensions || null));
}

console.log('\n=== power_user.reasoning ===');
console.log(JSON.stringify((j.power_user || {}).reasoning ?? null));

// 预设层
const PPDIR = 'E:\\sillydata\\default-user\\OpenAI Settings';
if (fs.existsSync(PPDIR)) {
  console.log('\n=== OpenAI Settings 目录 ===');
  for (const f of fs.readdirSync(PPDIR)) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(PPDIR, f), 'utf8'));
      const rs = p.extensions && p.extensions.regex_scripts;
      if (Array.isArray(rs) && rs.length) {
        console.log(`\n--- 预设 ${f} 带 ${rs.length} 条正则 ---`);
        rs.forEach((r, i) => console.log(`   ${i} ${r.disabled ? '✗' : '✓'} ${r.scriptName} | ${String(r.findRegex).slice(0, 80)}`));
      }
    } catch (e) { /* 非 JSON 预设 */ }
  }
}
