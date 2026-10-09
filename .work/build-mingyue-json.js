// 把 silver-moon.js 重新装进 思维链/银月/酒馆助手脚本-明月.json（保留原结构）
//   用法：node .work/build-mingyue-json.js [--verify]
// 保留的字段：type/name/enabled/id/button/export_with（逐字沿用 json 里原来的值）；
// 只换 content（= silver-moon.js 去掉 BOM 之后的全文）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const J = path.join(ROOT, '思维链', '银月', '酒馆助手脚本-明月.json');
const S = path.join(ROOT, '思维链', '银月', 'silver-moon.js');
const VERIFY = process.argv.indexOf('--verify') !== -1;

const raw = fs.readFileSync(J, 'utf8');
const obj = JSON.parse(raw);
const src = fs.readFileSync(S, 'utf8').replace(/^\uFEFF/, '');
const beforeLen = obj.content.length;
obj.content = src;
const out = JSON.stringify(obj, null, 2) + '\n';

const check = (label, ok, extra) => console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra === undefined ? '' : '  <' + extra + '>'));
check('content 与 silver-moon.js 逐字一致', obj.content === src, src.length + ' chars');
check('BOM 去掉了', out.charCodeAt(0) !== 0xfeff);
check('JSON 能来回解析', JSON.parse(out).content === src);
check('button 通道仍开着（enabled=true）', obj.button && obj.button.enabled === true, JSON.stringify(obj.button));
check('button.buttons 仍然为空（按钮由脚本运行时自己写）', Array.isArray(obj.button.buttons) && obj.button.buttons.length === 0);
check('export_with 保持原样', obj.export_with && obj.export_with.button === true && obj.export_with.data === false, JSON.stringify(obj.export_with));
check('name / id / enabled 没被动过', obj.name === '明月' && obj.id === 'be1b4c0b-6dbf-4576-aa9e-71e5c7659173' && obj.enabled === false);
check('VERSION 跟着源码走', (src.match(/const VERSION = "([^"]+)"/) || [])[1] !== '1.3',
  (src.match(/const VERSION = "([^"]+)"/) || [])[1]);
console.log('content: ' + beforeLen + ' → ' + out.length);

if (VERIFY) {
  console.log('（--verify：不写文件）');
} else {
  const outPath = process.argv[2] && process.argv[2] !== '--verify' ? path.resolve(process.argv[2]) : J;
  fs.writeFileSync(outPath, out, 'utf8');
  console.log('已写入 ' + path.relative(ROOT, outPath));
}
