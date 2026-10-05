/* 拿你机器上真实生效的正则列表，检查银月开 adoptLeadingThink 后会不会误判冲突而让位。
 * 只读 E:\sillydata\default-user\settings.json（不回写任何东西）。
 */
const fs = require('fs');

const SETTINGS = 'E:\\sillydata\\default-user\\settings.json';
const j = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
const list = j.extension_settings.regex || [];

// —— 这一段和 silver-moon.js 里的 collectForeignRegexes / wrapperCores / regexHitsWrapper 等价 ——
const WRAPPERS = [
  ['<think>', '</think>'],
  ['<thinking>', '</thinking>'],
  ['<thought>', '</thought>'],
  ['<reasoning>', '</reasoning>'],
  ['<analysis>', '</analysis>'],
  ['[metacognition]', '</thinking>'],
  ['[metacognition]', '[/metacognition]'],
  ['<基础确认>', '</基础确认>'],
  ['<思考>', '</思考>'],
  ['[思考]', '[/思考]'],
  ['<思维链>', '</思维链>'],
];
function wrapperCores() {
  const cores = [];
  const push = (core, style) => {
    if (core && !cores.some((c) => c.core === core && c.style === style)) cores.push({ core, style });
  };
  for (const pair of WRAPPERS) {
    for (const literal of pair) {
      const text = String(literal).trim();
      let m = text.match(/^<\/?([^<>\/\s]+)>$/);
      if (m) { push(m[1], 'xml'); continue; }
      m = text.match(/^\[\/?([^\[\]\/\s]+)\]$/);
      if (m) push(m[1], 'bracket');
    }
  }
  return cores;
}
function regexHitsWrapper(find, core, style) {
  const text = String(find || '');
  const forms = style === 'bracket'
    ? ['[' + core + ']', '[/' + core + ']', '[\\/' + core + ']', '[\\s*' + core + '\\s*]']
    : ['<' + core + '>', '</' + core + '>', '<' + core + '\\s', '<\\/' + core + '>', '<\\/' + core + '\\s', '<\\s*' + core + '\\s*>'];
  return forms.some((f) => text.indexOf(f) !== -1);
}
function touchesDisplay(s) {
  const md = !!s.markdownOnly;
  const pr = !!s.promptOnly;
  return md || !pr;
}

const cores = wrapperCores();
const OWN = ['银月 · 思维链归一（勿删）', '银月 · 思维链归一·流式（勿删）'];
console.log('检查的正则条数 =', list.length);
console.log('wrapper 标签 =', cores.map((c) => (c.style === 'bracket' ? '[' + c.core + ']' : '<' + c.core + '>')).join(' '));
console.log('');
let conflicts = 0;
for (const s of list) {
  if (s.disabled) continue;
  if (OWN.includes(s.scriptName)) continue; // 自己那两条不算冲突
  const display = touchesDisplay(s);
  for (const c of cores) {
    if (!regexHitsWrapper(s.findRegex, c.core, c.style)) continue;
    const label = c.style === 'bracket' ? '[' + c.core + ']' : '<' + c.core + '>';
    // 纯提示词侧且不改显示 → 银月不把它算冲突（和脚本里的判定一致）
    const counted = display;
    console.log((counted ? '冲突  ' : '忽略  ') + label + '  ←  ' + s.scriptName +
      '  [md=' + !!s.markdownOnly + ' pr=' + !!s.promptOnly + ' pl=' + JSON.stringify(s.placement) + ' disabled=' + !!s.disabled + ']');
    if (counted) conflicts += 1;
  }
}
console.log('');
console.log(conflicts ? '→ 会让位，冲突数 = ' + conflicts : '→ 不会让位（没有别的正则在管这批标签），开 adoptLeadingThink 会直接接管');
console.log('');
console.log('顺带列一遍现在装着的正则：');
list.forEach((s) => console.log('  [' + (s.disabled ? 'x' : 'o') + '] md=' + (s.markdownOnly ? 1 : 0) + ' pr=' + (s.promptOnly ? 1 : 0) + ' ' + s.scriptName));
