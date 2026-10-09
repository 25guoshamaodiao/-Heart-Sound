// 把用户酒馆里那份「明月」脚本就地换成仓库当前源码（v1.4.3）。
//   用法： node .work/patch-live-mingyue.js --check   # 只看，不写
//          node .work/patch-live-mingyue.js           # 备份 + 写 + 回读校验
//
// 只改 extension_settings.tavern_helper.script.scripts 里那一条的 content。
// 目标优先按「名字 = 明月 且内容里有银月痕迹」找（重新导入会换 id），找不到才退回旧 id。
// 其它脚本、extension_settings 的其它字段、power_user 等一律不动（写完逐项校验）。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = 'E:/sillydata/default-user/settings.json';
const TARGET_ID = '8c42b176-ce66-46ce-81f9-6b40ea58056f'; // 旧 id，仅作兜底
const TARGET_NAME = '明月';
const SRC = path.join(ROOT, '思维链', '银月', 'silver-moon.js');
const CHECK = process.argv.indexOf('--check') !== -1;

const check = (label, ok, extra) =>
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra === undefined ? '' : '  <' + extra + '>'));

const src = fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '');
const raw = fs.readFileSync(LIVE, 'utf8');
const indent4 = /\n {4}"/.test(raw);
const ver = (t) => (t.match(/const VERSION = "([^"]+)"/) || [])[1] || null;

const obj = JSON.parse(raw);
const list = obj.extension_settings.tavern_helper.script.scripts;

// 目标：名字是「明月」、内容里确实是银月（老版没有 injectButtonName，所以用更宽的 银月 字样）
const named = list.filter((s) => s && s.name === TARGET_NAME && /银月/.test(String(s.content || '')));
let entry = null;
if (named.length === 1) {
  entry = named[0];
} else if (named.length > 1) {
  console.log('同名候选 ' + named.length + ' 条：' + JSON.stringify(named.map((s) => ({ id: s.id, v: ver(String(s.content || '')) }))));
  entry = named.filter((s) => /injectButtonName/.test(String(s.content))).slice(-1)[0] || named.slice(-1)[0];
}
if (!entry) entry = list.find((s) => s && s.id === TARGET_ID) || null;
if (!entry) {
  console.error('FAIL 没找到目标「明月」脚本（按名字也没找到、按旧 id ' + TARGET_ID + ' 也没找到）');
  process.exit(1);
}
const TARGET = entry.id;


const before = String(entry.content || '');
const othersBefore = list.filter((s) => s && s.id !== TARGET).map((s) => s.id + ':' + String(s.content || ''));

console.log('文件      : ' + LIVE + '  (' + Buffer.byteLength(raw, 'utf8') + ' bytes, 缩进=' + (indent4 ? 4 : 2) + ')');
console.log('目标脚本  : ' + entry.name + '  id=' + entry.id + '  enabled=' + entry.enabled);
console.log('现在      : VERSION=' + ver(before) + '  content=' + before.length + ' 字');
console.log('换成      : VERSION=' + ver(src) + '  content=' + src.length + ' 字');
console.log('脚本总数  : ' + list.length);

if (CHECK) {
  console.log('（--check：不写文件）');
  process.exit(0);
}

// 1) 先备份
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(ROOT, '.work', 'settings-backup-' + stamp + '.json');
fs.copyFileSync(LIVE, backup);
console.log('已备份    : ' + path.relative(ROOT, backup) + '  (' + fs.statSync(backup).size + ' bytes)');

// 2) 只换 content，写回
entry.content = src;
const out = JSON.stringify(obj, null, indent4 ? 4 : 2) + '\n';
fs.writeFileSync(LIVE, out, 'utf8');

// 3) 回读校验：目标换成新源码，其它一切逐项没动
const back = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
const list2 = back.extension_settings.tavern_helper.script.scripts;
const now = list2.find((s) => s && s.id === TARGET);
const othersAfter = list2.filter((s) => s && s.id !== TARGET).map((s) => s.id + ':' + String(s.content || ''));

check('回读：明月 content 与 silver-moon.js 逐字一致',
  !!now && now.content === src, now ? 'VERSION=' + ver(now.content) + ' len=' + now.content.length : 'missing');
check('脚本总数没变', list2.length === list.length, String(list2.length));
check('其它 13 个脚本的 content 一字未动',
  othersAfter.length === othersBefore.length && othersAfter.every((v, i) => v === othersBefore[i]),
  othersAfter.length + ' 条');
check('extension_settings.regex 没被动过',
  JSON.stringify(back.extension_settings.regex) === JSON.stringify(obj.extension_settings.regex),
  String((back.extension_settings.regex || []).length) + ' 条');
check('power_user 的键数没变',
  Object.keys(back.power_user || {}).length === Object.keys(obj.power_user || {}).length,
  String(Object.keys(back.power_user || {}).length));
check('明月的其它字段（id/name/enabled/button）没动',
  now && now.id === entry.id && now.name === entry.name && now.enabled === entry.enabled &&
  JSON.stringify(now.button) === JSON.stringify(entry.button),
  JSON.stringify({ id: now && now.id, name: now && now.name, enabled: now && now.enabled, button: now && now.button }));
check('文件仍是合法 JSON 且以换行结尾', JSON.parse(fs.readFileSync(LIVE, 'utf8')) && fs.readFileSync(LIVE, 'utf8').endsWith('\n'));
console.log('写入后    : ' + fs.statSync(LIVE).size + ' bytes');
console.log('想还原    : copy "' + backup + '" 回 ' + LIVE + '（酒馆关着的时候做）');
