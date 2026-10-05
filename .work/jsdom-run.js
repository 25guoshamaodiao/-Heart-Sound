/* 在 jsdom 里跑 harness.html：把外链脚本内联进去，然后读报告 + 自动断言 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(process.env.TEMP, 'sm-harness', 'node_modules', 'jsdom'));

const ROOT = process.cwd();
const HARNESS = path.join(ROOT, '.work', 'harness', 'harness.html');
const TARGET = process.argv[2] || path.join(ROOT, '思维链', '银月', 'silver-moon-blocks-inline.js');
const OUT = process.argv[3] || path.join(ROOT, '.work', 'jsdom-report.txt');

let html = fs.readFileSync(HARNESS, 'utf8');
const read = (p) => fs.readFileSync(p, 'utf8');

// 额外样本（真实消息）从文件读进来，避免在 HTML 里转义
const sampleFile = path.join(ROOT, '.work', 'harness', 'sample-shot.txt');
const extra = fs.existsSync(sampleFile) ? read(sampleFile) : null;
if (extra) {
  html = html.replace('<script src="vendor/showdown.min.js"></script>', '<script>window.__SAMPLE_EXTRA = ' + JSON.stringify(extra) + ';</script>\n<script src="vendor/showdown.min.js"></script>');
}

// 外链 → 内联
html = html.replace('<script src="vendor/showdown.min.js"></script>', '<script>' + read(path.join(ROOT, '.work', 'harness', 'vendor', 'showdown.min.js')) + '</script>');
html = html.replace('<script src="vendor/purify.min.js"></script>', '<script>' + read(path.join(ROOT, '.work', 'harness', 'vendor', 'purify.min.js')) + '</script>');
html = html.replace(/<script>\s*\/\* 变体切换[\s\S]*?<\/script>/, '<script>' + read(TARGET) + '</script>');

const logs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => logs.push('[jsdomError] ' + (e && e.stack ? e.stack : e)));
vc.on('error', (...a) => logs.push('[error] ' + a.join(' ')));
vc.on('warn', (...a) => logs.push('[warn] ' + a.join(' ')));
vc.on('log', (...a) => logs.push('[log] ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://127.0.0.1:8791/.work/harness/harness.html',
});

const win = dom.window;

// 对照台的性能/流式/「不闪」测试是异步的：等它们全部跑完再断言，免得抢跑
async function waitForHarness(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (win.__perf && win.__syncTest) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

setTimeout(async () => {
  const harnessReady = await waitForHarness(15000);
  const out = [];
  out.push('target = ' + path.relative(ROOT, TARGET));
  out.push('harnessDone = ' + win.__harnessDone + ' / 异步测试跑完 = ' + harnessReady);
  out.push('');
  const report = win.document.getElementById('report');
  out.push(report ? report.textContent : '(没有 #report)');
  out.push('');
  out.push('===== 控制台 =====');
  out.push(logs.join('\n'));

  // ---- 额外断言（jsdom 没有排版，所以只看结构与文字） ----
  const chatA = win.document.getElementById('chat-a');
  const chatB = win.document.getElementById('chat');
  const aTexts = Array.from(chatA.querySelectorAll('.mes_text'));
  const bTexts = Array.from(chatB.querySelectorAll('.mes_text'));
  out.push('');
  out.push('===== 断言 =====');
  const results = [];
  const check = (name, ok, extra) => {
    results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  <' + extra + '>' : ''));
  };
  // 现状那套正则遇到「块内容是 markdown 列表」时，第一项会退化成字面文字 “1. ”；
  // 新方案把它还原成真正的列表（编号由浏览器画），所以比对时把空白与字面编号都抹掉。
  // 流式样本里新方案会多出「正在写的那一块」的折叠头文案，也一并抹掉。
  const LABELS_RE = /小左 · 记忆与逻辑|小右 · 情感与关系|小爱 · 欲望与身体|前额叶 · 合议与大纲|她的心里话（点击展开）|变量更新/g;
  const flat = (s) => String(s).replace(LABELS_RE, '').replace(/\s+/g, '').replace(/\d+\./g, '');
  const streamIdxForSkip = win.__STREAM_INDEX;
  // 性能测试会往 #chat 里再加 80 层，所以统一以 A 栏（只有样本）的条数来对齐
  const sampleCount = aTexts.length;
  for (let i = 0; i < sampleCount; i++) {
    const b = bTexts[i];
    const a = aTexts[i];
    // 流式样本（切了一半）本来就和现状不是一回事：现状只有 1 个块，新方案多一个「正在写」的块。
    // 它的专用断言在下面单独写。
    if (i === streamIdxForSkip) continue;
    check('消息' + i + ' 没有残留标记', b.querySelectorAll('span[data-sm]').length === 0, 'leftover=' + b.querySelectorAll('span[data-sm]').length);
    check('消息' + i + ' 没有裸露的自定义标签文本', !/<\/?(thinking_left|thinking_right|thinking_love|thinking_director|inner|time|elapsed|content|UpdateVariable)>/.test(b.textContent), '');
    check('消息' + i + ' 文字无增无减（抹掉空白与字面编号后一致）', a && flat(a.textContent) === flat(b.textContent), '');
    if (a && flat(a.textContent) !== flat(b.textContent)) {
      const ta = flat(a.textContent);
      const tb = flat(b.textContent);
      let k = 0;
      while (k < ta.length && k < tb.length && ta[k] === tb[k]) k++;
      out.push('   消息' + i + ' 首处不同 @' + k + '  A=' + JSON.stringify(ta.slice(Math.max(0, k - 20), k + 30)) + '  B=' + JSON.stringify(tb.slice(Math.max(0, k - 20), k + 30)));
    }
    check('消息' + i + ' 块外壳数量一致', a && a.querySelectorAll('details').length === b.querySelectorAll('details').length, 'A=' + (a ? a.querySelectorAll('details').length : -1) + ' B=' + b.querySelectorAll('details').length);
    check('消息' + i + ' 没有空列表外壳（会画出多余编号）', Array.from(b.querySelectorAll('ol, ul')).every((el) => String(el.textContent || '').trim() !== ''), Array.from(b.querySelectorAll('ol, ul')).filter((el) => String(el.textContent || '').trim() === '').length + ' 个');
    const trapped = Array.from(b.querySelectorAll('details, .sm-footer, .sm-pill-wrap, .sm-inner-wrap')).filter((el) => el.closest('li'));
    check('消息' + i + ' 块没被卷进列表项里', trapped.length === 0, trapped.length + ' 个');
  }

  // ---- 高楼层性能（80 层 + 5 条样本）----
  if (win.__perf) {
    const p = win.__perf;
    out.push('');
    out.push('===== 性能（jsdom，比真浏览器慢）=====');
    out.push(JSON.stringify(p));
    // jsdom 的微测量噪声很大，这些阈值只当冒烟检查（真浏览器里通常小一个量级）
    check('性能：85 层第二次全扫应当很快（签名快路命中）', p.warmScanMs < 60, 'warm=' + p.warmScanMs + 'ms');
    check('性能：普通楼层（内容没变）单层开销小', p.onePlainFloorMs < 25, 'onePlain=' + p.onePlainFloorMs + 'ms');
    check('性能：带块楼层（内容没变）单层开销小', p.oneBlockFloorMs < 25, 'oneBlock=' + p.oneBlockFloorMs + 'ms');
    check('性能：单趟流式装配足够便宜（要按帧跟）', p.streamPassMs < 60, 'streamPass=' + p.streamPassMs + 'ms');
  }

  // ---- 「不闪」的机制验证：重排后只跑微任务，块就该已经装好 ----
  out.push('');
  out.push('===== 诊断 =====');
  {
    const sIdx = win.__STREAM_INDEX;
    const sc = win.document.querySelector('#chat .mes[mesid="' + sIdx + '"] .mes_text');
    const apiRef = win.__silverMoonBlocksInline || win.__silverMoonBlocksClass;
    out.push(
      'generating=' +
        (apiRef && apiRef.state && apiRef.state.generating) +
        ' streamSyncOk(see log) streamAttr=' +
        (sc ? sc.hasAttribute('data-sm-streaming') : 'n/a') +
        ' details=' +
        (sc ? sc.querySelectorAll('details').length : 'n/a') +
        ' open=' +
        (sc ? sc.querySelectorAll('details[open]').length : 'n/a') +
        ' syncTest=' +
        JSON.stringify(win.__syncTest) +
        ' perf=' +
        JSON.stringify(win.__perf),
    );
  }
  if (win.__syncTest) {
    const s = win.__syncTest;
    out.push('');
    out.push('===== 重排后是否在同一帧内装好（不闪的关键）=====');
    out.push(JSON.stringify(s));
    check('不闪：酒馆重排后、下一个宏任务之前就已经装好', s.assembledBeforeTimer === true, JSON.stringify(s));
    check('不闪：同一时刻没有残留标记', s.leftoverMarkers === 0, 'leftover=' + s.leftoverMarkers);
  }
  // ---- 流式装配（生成中途那一趟）：必须赶在 api.scan() 之前看，收尾那一趟会把它收起来 ----
  const streamIdx = win.__STREAM_INDEX;
  if (typeof streamIdx === 'number') {
    const sb = win.document.querySelector('#chat .mes[mesid="' + streamIdx + '"] .mes_text');
    const opened = sb ? Array.from(sb.querySelectorAll('details[open]')) : [];
    const label = (d) => {
      const s = d.querySelector('summary');
      return s ? String(s.textContent || '').trim() : '';
    };
    check('流式：关掉了残留标记', sb && sb.querySelectorAll('span[data-sm]').length === 0, 'leftover=' + (sb ? sb.querySelectorAll('span[data-sm]').length : 'no-panel'));
    check('流式：正在写的那块是展开的', opened.some((d) => /小右/.test(label(d))), 'open=' + opened.length + ' labels=' + opened.map(label).join('/'));
    check('流式：已写完的块是收起的', sb && Array.from(sb.querySelectorAll('details')).some((d) => !d.open && /小左/.test(label(d))), '');
    check('流式：内容已经进了块里（没丢字）', sb && /一、她是谁/.test(sb.textContent) && /二、她怎么读他/.test(sb.textContent), '');
    check('流式：块没被卷进列表项里', sb && Array.from(sb.querySelectorAll('details')).every((d) => !d.closest('li')), '');
    out.push('流式样本 mesid=' + streamIdx + '，装配块数=' + win.__streamCount + '，展开中=' + opened.length + '，展开的是=' + opened.map(label).join('/'));
  }

  // 幂等：再扫一次不应有任何变化（只比样本那几条；流式那条的展开态本来就会被收尾那一趟收起来）
  const sampleHtml = (b, i) => (i === streamIdxForSkip ? '' : b.innerHTML);
  const before = bTexts.slice(0, sampleCount).map(sampleHtml);
  const api = win.__silverMoonBlocksInline || win.__silverMoonBlocksClass;
  api.scan();
  const after = bTexts.slice(0, sampleCount).map(sampleHtml);
  check('重复 scan 幂等', before.join('|') === after.join('|'), before.map((v, i) => (v === after[i] ? '' : '#' + i)).filter(Boolean).join(','));

  // ---- 变体 B（类名版）：CSS 声明必须与原内联样式一一对应 ----
  if (api && api.css) {
    const norm = (s) =>
      String(s)
        .replace(/\s+/g, ' ')
        .replace(/\s*([:,;])\s*/g, '$1')
        .replace(/(^|[^\d.])0\.(\d)/g, '$1.$2')
        .trim()
        .toLowerCase();
    const decls = (text) =>
      String(text)
        .split(';')
        .map((d) => norm(d))
        .filter((d) => d && d.includes(':'));
    // A 栏：现状 DOM 里所有内联声明
    const aDecls = new Set();
    aTexts.forEach((a) => {
      a.querySelectorAll('[style]').forEach((el) => {
        decls(el.getAttribute('style') || '').forEach((d) => aDecls.add(d));
      });
    });
    // B 栏：CSS 文本里的所有声明（去掉选择器部分）
    const css = String(api.css);
    const bDecls = new Set();
    (css.match(/\{[^}]*\}/g) || []).forEach((block) => {
      decls(block.slice(1, -1)).forEach((d) => bDecls.add(d));
    });
    const missing = [...aDecls].filter((d) => !bDecls.has(d));
    const extra = [...bDecls].filter((d) => !aDecls.has(d));
    check('类名版 CSS 覆盖了全部原内联声明', missing.length === 0, 'missing=' + JSON.stringify(missing));
    check('类名版 CSS 没有多出声明', extra.length === 0, 'extra=' + JSON.stringify(extra));
    out.push('A 内联声明数 = ' + aDecls.size + ' / B CSS 声明数 = ' + bDecls.size);

    // 逐个标签的配色对得上吗（防串色 / 防选择器写错）
    const BLOCKS = api.blocks || [];
    const ncss = norm(css);
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleHas = (selector, decl) => new RegExp(esc(norm(selector)) + '\\s*\\{[^}]*' + esc(norm(decl))).test(ncss);
    BLOCKS.forEach((b) => {
      const sel = b.kind === 'variable' ? '.sm-var' : '[data-sm-tag="' + b.tag + '"]';
      if (b.color && b.kind === 'details') {
        check('标签 ' + b.tag + ' 的边框色', ruleHas(sel, 'border-left:3px solid ' + b.color), sel);
      }
      if (b.color && b.kind === 'inner') {
        check('标签 ' + b.tag + ' 的边框色', ruleHas(sel, 'border-left:2px solid ' + b.color), sel);
      }
      if (b.color && b.kind === 'variable') {
        check('标签 ' + b.tag + ' 的边框色', ruleHas('.sm-var', 'border-left:3px solid ' + b.color), '.sm-var');
      }
      if (b.bg) {
        check('标签 ' + b.tag + ' 的背景色', ruleHas(sel, 'background:' + b.bg), 'expected bg=' + b.bg);
      }
      if (b.kind === 'details' || b.kind === 'inner') {
        check('标签 ' + b.tag + ' 的标题色', ruleHas(sel + ' > .sm-summary', 'color:' + b.color), '');
      }
      if (b.kind === 'pill') {
        check('标签 ' + b.tag + ' 的描边色', ruleHas(sel, 'border:0.5px solid ' + b.color + '59'), '');
        check('标签 ' + b.tag + ' 的文字色', ruleHas(sel, 'color:' + b.color), '');
      }
    });
    // 07-时间结算的固定色
    check('时间结算的固定色', ruleHas('.sm-footer', 'color:#9a8f6a'), '');
    // 12-变量更新的标题色
    check('变量更新的标题色', ruleHas('.sm-var > .sm-summary', 'color:#9aa3ad'), '');
  }
  out.push(results.join('\n'));

  fs.writeFileSync(OUT, out.join('\n'), 'utf8');
  console.log('written ' + path.relative(ROOT, OUT));
  console.log(results.filter((r) => r.startsWith('FAIL')).join('\n') || 'all assertions passed');
}, 900);
