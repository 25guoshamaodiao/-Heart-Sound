/* 真实数据回归：用你机器上的预设（梦鲸思客V4-0902）+ 那条 <dream_plot> 真实消息，
 * 钉住「让位必须让干净」这件事。
 *
 * 背景：那个预设自己用 `<think>` 管思维链，有三条正则在动它：
 *   [🥷隐藏]思考正则格式化      md=0 pr=0  find: ^(?!<think>)([\s\S]*\S[\s\S]*)(?:</think>|(<dream_plot>)(?=\r?\n))
 *                                          replace: <think>\n$1\n</think>\n$2
 *   [🦋美化]思考正则隐藏 - 二选一 md=1 pr=0  find: /<think>([\s\S]*)<\/think>/i   replace: （空，显示时藏掉）
 *   [🥷隐藏]删除额外标签         md=1 pr=0
 * 所以银月必须**让位**；但如果让位时没把 ST 的 reasoning 配置还回去，
 * ST 就会自己去搬 `[metacognition]…</thinking>`，把正文和聊天记录改坏。
 *
 * 跑法：node .work/dream-check2.js
 */
const fs = require('fs');
const path = require('path');
const { loadJsdom } = require('./jsdom-loader');
const { JSDOM, VirtualConsole } = loadJsdom(path.join(__dirname, '..'));

const ROOT = path.join(__dirname, '..');
const SCRIPT_SRC = fs.readFileSync(path.join(ROOT, '思维链', '银月', 'silver-moon.js'), 'utf8');
const MIRROR_SRC = fs.readFileSync(path.join(ROOT, '.work', 'ref', 'st-mirror.js'), 'utf8');
const SAMPLE = path.join(ROOT, '.work', 'dream-sample.txt');
const PRESETS = [
  'E:/sillydata/default-user/OpenAI Settings/梦鲸思客V4-0902.json',
  path.join(ROOT, '.work', 'ref', 'preset-dream.json'),
];

const results = [];
const lines = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined && extra !== '' ? '  <' + extra + '>' : ''));
  return ok;
}

function findPreset() {
  for (const p of PRESETS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) { /* noop */ }
  }
  return null;
}

function makeEnv() {
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('warn', (...a) => logs.push('[warn] ' + a.join(' ')));
  vc.on('error', (...a) => logs.push('[error] ' + a.join(' ')));
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="chat"></div>' +
    '<script>' + MIRROR_SRC + '</script><script>' + SCRIPT_SRC + '</script></body></html>';
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://127.0.0.1/' });
  return { win: dom.window, logs };
}
const head = (s, n) => {
  const t = String(s || '').replace(/\n/g, '⏎');
  return t.length > n ? t.slice(0, n) + '…' : t;
};

function streamThrough(win, raw) {
  const M = win.__mirror;
  const s = M.beginStream(0);
  const size = 80;
  const marks = [];
  for (let i = 0; i < raw.length; i += size) {
    s.apply(raw.slice(0, i + size), i + size >= raw.length);
    const el = win.document.querySelector('#chat .mes[mesid="0"] .mes_reasoning_details');
    marks.push(el ? el.getAttribute('data-state') : '-');
  }
  s.finish();
  return marks;
}
async function envWith(presetRegexes, { adopt, takeOver }) {
  const { win } = makeEnv();
  await new Promise((r) => setTimeout(r, 0));
  win.__mirror.setPresetRegexes(presetRegexes);
  const api = win.__silverMoon;
  api.config.adoptLeadingThink = adopt;
  const p = api.refresh();
  if (takeOver) await p.then(() => api.takeOver());
  else await p;
  return { win, api };
}

(async function main() {
  const presetPath = findPreset();
  if (!presetPath) {
    console.log('跳过：找不到预设文件（' + PRESETS[0] + '）');
    process.exit(0);
  }
  const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
  const presetRegexes = (preset.extensions && preset.extensions.regex_scripts) || [];
  const RAW = fs.readFileSync(SAMPLE, 'utf8').replace('@@NL@@', '\n');

  lines.push('preset = ' + presetPath);
  lines.push('preset regexes = ' + presetRegexes.length + ' 条');
  lines.push('message = ' + RAW.length + ' 字');
  lines.push('');

  /* ---- 参照组：接管关着，这就是「你原来的行为」 ---- */
  let baselineMes = '';
  {
    const { win, api } = await envWith(presetRegexes, { adopt: false });
    check('R0 关了接管时，银月自己不占 ST 的 reasoning 配置',
      api.status().normalize.configApplied === false && win.__mirror.power_user.reasoning.prefix === '<think>\n',
      JSON.stringify(api.status().reasoning));
    const marks = streamThrough(win, RAW);
    baselineMes = (win.__mirror.chat[0] && win.__mirror.chat[0].mes) || '';
    check('R0b 关了接管时流式不产生思维块', marks.every((m) => m === '-'), marks.join(''));
    lines.push('  参照：mes ' + baselineMes.length + ' 字，开头 ' + head(baselineMes, 50));
  }

  /* ---- 默认值（接管开着）→ 必须让位 + 让干净 ---- */
  {
    const { win, api } = await envWith(presetRegexes, { adopt: true });
    const st = api.status();
    lines.push('');
    lines.push('  默认（接管开着）：state=' + st.normalize.state + '  configApplied=' + st.normalize.configApplied);
    lines.push('  冲突：' + st.conflicts.map((c) => c.regex + '(' + c.tag + ')').join(' , '));
    check('R1 认得出预设那几条在管 <think>', st.conflicts.some((c) => c.regex.indexOf('思考正则格式化') !== -1), JSON.stringify(st.conflicts.slice(0, 3)));
    check('R2 状态 = yielded', st.normalize.state === 'yielded', st.normalize.state);
    check('R3 让位时两条正则都没装', !(win.__mirror.getGlobalRegexes() || []).some((r) => r.scriptName && r.scriptName.indexOf('银月 · 思维链归一') === 0),
      JSON.stringify((win.__mirror.getGlobalRegexes() || []).map((r) => r.scriptName)));
    check('R4 ★ 让位时把 ST 的 reasoning 配置原样还回去（v1.3 修的 bug）',
      win.__mirror.power_user.reasoning.prefix === '<think>\n' &&
        win.__mirror.power_user.reasoning.suffix === '\n</think>' &&
        win.__mirror.power_user.reasoning.auto_parse === false,
      JSON.stringify(st.reasoning));

    const marks = streamThrough(win, RAW);
    const mes = (win.__mirror.chat[0] && win.__mirror.chat[0].mes) || '';
    const extra = (win.__mirror.chat[0] && win.__mirror.chat[0].extra) || {};
    lines.push('  默认结果：流式块状态 ' + marks.join('') + '，mes ' + mes.length + ' 字，reasoning ' + String(extra.reasoning || '').length + ' 字');
    check('R5 让位时流式不产生思维块', marks.every((m) => m === '-'), marks.join(''));
    check('R6 让位时思维链没被从 mes 里搬走', String(extra.reasoning || '').length === 0, 'reasoning=' + String(extra.reasoning || '').length);
    check('R7 让位时 mes 与参照组一致（正文/记录都没被动）', mes === baselineMes, mes.length + ' vs ' + baselineMes.length);
    check('R8 mes 里仍然留着预设自己的 <think> 包装', mes.indexOf('<think>') !== -1);
  }

  /* ---- 强制接管：把代价明确打出来（这是你的选择，不是默认） ---- */
  {
    const { win, api } = await envWith(presetRegexes, { adopt: true, takeOver: true });
    const st = api.status();
    const marks = streamThrough(win, RAW);
    const mes = (win.__mirror.chat[0] && win.__mirror.chat[0].mes) || '';
    const extra = (win.__mirror.chat[0] && win.__mirror.chat[0].extra) || {};
    lines.push('');
    lines.push('  takeOver 之后：state=' + st.normalize.state + '  configApplied=' + st.normalize.configApplied);
    lines.push('    mes ' + mes.length + ' 字，开头 ' + head(mes, 60));
    lines.push('    搬进 reasoning 的思维链 ' + String(extra.reasoning || '').length + ' 字');
    lines.push('    流式块状态 ' + marks.join(''));
    check('R9 takeOver 后确实接管了（配置被占住 + 思维链被搬走）',
      st.normalize.configApplied === true && String(extra.reasoning || '').length > 0,
      'configApplied=' + st.normalize.configApplied + ' reasoning=' + String(extra.reasoning || '').length);
    check('R10 代价可见：mes 变短了（思维链不在正文里了）', mes.length < baselineMes.length, mes.length + ' < ' + baselineMes.length + ' ?');
  }

  const failed = results.filter((r) => r.startsWith('FAIL'));
  lines.push('', '===== 断言 =====', ...results);
  const report = lines.join('\n');
  fs.writeFileSync(path.join(ROOT, '.work', 'dream-report.txt'), report, 'utf8');
  console.log(report);
  console.log('');
  console.log(failed.length ? failed.join('\n') : '全部断言通过（' + results.length + ' 条）');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('崩了：', e);
  process.exit(2);
});
