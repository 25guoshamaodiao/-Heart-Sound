/* 用真实消息（<dream_plot> 那条）验银月的归一化到底会不会出事。
 * 场景：canonical 带换行（现在 v1.2 的值） / 不带换行；整条收到 / 流式逐块。
 * 跑法：node .work/dream-check.js
 */
const fs = require('fs');
const path = require('path');
const { loadJsdom } = require('./jsdom-loader');
const { JSDOM, VirtualConsole } = loadJsdom(path.join(__dirname, '..'));

const ROOT = process.cwd();
const SCRIPT_SRC = fs.readFileSync(path.join(ROOT, '思维链', '银月', 'silver-moon.js'), 'utf8');
const MIRROR_SRC = fs.readFileSync(path.join(ROOT, '.work', 'ref', 'st-mirror.js'), 'utf8');
const SAMPLE_RAW = fs.readFileSync(path.join(ROOT, '.work', 'dream-sample.txt'), 'utf8');

function makeEnv() {
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('warn', (...a) => logs.push('[warn] ' + a.join(' ')));
  vc.on('error', (...a) => logs.push('[error] ' + a.join(' ')));
  vc.on('log', (...a) => logs.push('[log] ' + a.join(' ')));
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

function show(title, win, M, st) {
  const body = (M.chat[0] && M.chat[0].mes) || '';
  const extra = (M.chat[0] && M.chat[0].extra) || {};
  const el = win.document.querySelector('#chat .mes[mesid="0"] .mes_reasoning_details');
  const blocks = win.document.querySelectorAll('#chat .mes[mesid="0"] .mes_reasoning_details').length;
  console.log('── ' + title);
  console.log('   规则产出（正则之后）: ' + head(st.regexed, 90));
  console.log('   ST reasoning（长度 ' + String(extra.reasoning || '').length + '）: ' + head(extra.reasoning, 70));
  console.log('   正文 mes（长度 ' + body.length + '）: ' + head(body, 90));
  console.log('   思维块: ' + blocks + ' 个，state=' + (el ? el.getAttribute('data-state') : '无'));
  console.log('   正文里还有 <dream_plot> 吗: ' + (body.indexOf('<dream_plot>') !== -1));
  console.log('   reasoning 里吞进了 <dream_plot> 吗: ' + (String(extra.reasoning || '').indexOf('<dream_plot>') !== -1));
  console.log('');
}

async function run(label, { newlineBeforeClose, adopt, streaming }) {
  const raw = SAMPLE_RAW.replace('@@NL@@', newlineBeforeClose ? '\n' : '');
  const { win, logs } = makeEnv();
  await new Promise((r) => setTimeout(r, 0));
  const api = win.__silverMoon;
  const M = win.__mirror;
  api.config.adoptLeadingThink = adopt;
  if (!newlineBeforeClose) {
    api.config.canonicalPrefix = '[metacognition]';
    api.config.canonicalSuffix = '</thinking>';
  }
  await api.refresh();
  const st = api.status();
  // 只看「我的正则把消息变成了什么」
  const regexed = M.getRegexedString(raw, 2, {});
  const out = { regexed, st };
  if (streaming) {
    const s = M.beginStream(0);
    const size = 60;
    for (let i = 0; i < raw.length; i += size) {
      s.apply(raw.slice(0, i + size), i + size >= raw.length);
    }
    s.finish();
  } else {
    M.receive(0, raw);
  }
  console.log('════ ' + label);
  console.log('   canonical = ' + JSON.stringify(api.config.canonicalPrefix) + ' 后缀 ' + JSON.stringify(api.config.canonicalSuffix));
  console.log('   归一化规则状态 = ' + st.normalize.state + '，探针 = ' + (st.normalize.probe && st.normalize.probe.ok));
  show('结果', win, M, out);
  const bad = logs.filter((l) => l.indexOf('[error]') === 0);
  if (bad.length) console.log('   控制台 error: ' + bad.join(' | '));
}

(async function main() {
  const cases = [
    ['① 接管关着（你现在的旧行为）+ 整条收到', { newlineBeforeClose: true, adopt: false, streaming: false }],
    ['② v1.2 现状：canonical 带换行 + 整条收到', { newlineBeforeClose: true, adopt: true, streaming: false }],
    ['③ v1.2 现状：canonical 带换行 + 流式', { newlineBeforeClose: true, adopt: true, streaming: true }],
    ['④ 真实收尾（</thinking> 紧贴、无换行）+ 整条收到', { newlineBeforeClose: false, adopt: true, streaming: false }],
    ['⑤ 真实收尾（无换行）+ 流式', { newlineBeforeClose: false, adopt: true, streaming: true }],
    ['⑥ 无换行的 canonical + 真实收尾 + 流式', { newlineBeforeClose: false, adopt: true, streaming: true, noNlCanonical: true }],
  ];
  // ⑥ 需要把 canonical 也改成不带换行 —— 已经由 newlineBeforeClose=false 分支处理
  for (const [label, opts] of cases) {
    // eslint-disable-next-line no-await-in-loop
    await run(label, opts);
  }
})().catch((e) => {
  console.error('崩了：', e);
  process.exit(1);
});
