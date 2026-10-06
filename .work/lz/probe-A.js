/* 体检：把三条真实正则喂进复刻好的 ST 管线，看
 *   A) 完整消息（生成结束）到底渲染成了什么
 *   B) 流式逐 token 时，什么时候才出现东西
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./pipeline');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, '思维链', '银月');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

const SCRIPTS = [
  load('regex-[美化]龙族变量更新中.json'),
  load('regex-[美化]龙族完整变量更新.json'),
  load('regex-龙族正文美化｜正式版·全历史.json'),
];

const SAMPLE = [
  '<UpdateVariable>',
  '<Analysis>',
  '本轮：路明非在图书馆遇到诺诺，情绪从躲闪转为承认。好感度 +1，诺诺警觉度 +1。',
  '</Analysis>',
  '<JSONPatch>',
  '[{"op":"replace","path":"/角色/路明非/好感度","value":2}]',
  '</JSONPatch>',
  '</UpdateVariable>',
  '<content>',
  '<scene location="卡塞尔学院·图书馆二层" time="傍晚" mood="试探" />',
  '<yanling user="诺诺" name="言灵·君焰" desc="试探性的热浪" />',
  '路明非把书推回架子，指尖还留着纸页的凉。',
  '“你又在躲。”诺诺说。',
  '</content>',
].join('\n');

function domFacts(html) {
  const { win } = P;
  const box = win.document.createElement('div');
  box.innerHTML = html;
  const text = box.textContent || '';
  return {
    len: html.length,
    nodeCount: box.querySelectorAll('*').length,
    preCount: box.querySelectorAll('pre').length,
    codeCount: box.querySelectorAll('code').length,
    iframeCount: box.querySelectorAll('iframe').length,
    lzRoot: box.querySelectorAll('[data-lz-content],[data-lzvr-root],[data-lz-source]').length,
    textHead: text.replace(/\s+/g, ' ').slice(0, 260),
    htmlHead: html.replace(/\s+/g, ' ').slice(0, 200),
  };
}

const out = [];
const log = (s) => { out.push(s); console.log(s); };

log('==============================================================');
log('A. 生成结束：整条消息走完 cleanUpMessage + messageFormatting');
log('==============================================================');
const cleaned = P.cleanUpMessage(SAMPLE, { scripts: SCRIPTS });
log(`cleanUpMessage 后长度: ${cleaned.length}（原 ${SAMPLE.length}）`);
log('--- cleanUpMessage 产物前 200 字 ---');
log(cleaned.replace(/\s+/g, ' ').slice(0, 200));
log('');

const formatted = P.messageFormatting(cleaned, { scripts: SCRIPTS });
fs.writeFileSync(path.join(__dirname, 'out-formatted.html'), formatted, 'utf8');
const f = domFacts(formatted);
log(`messageFormatting 产物长度: ${f.len}`);
log(`  DOM: 元素 ${f.nodeCount} 个 / <pre> ${f.preCount} / <code> ${f.codeCount} / <iframe> ${f.iframeCount}`);
log(`  龙族模板根节点命中数 (data-lz-content|data-lzvr-root|data-lz-source): ${f.lzRoot}`);
log(`  产物开头: ${f.htmlHead}`);
log(`  可见文字开头: ${f.textHead}`);
log('');

log('==============================================================');
log('B. 流式：每个 token 重跑一遍（ST 就是这么干的）');
log('==============================================================');
// 按 8 个字符切 token，模拟流式累积
const step = 8;
let firstVisible = null;
let firstLzRoot = null;
const rows = [];
for (let n = step; n <= SAMPLE.length + step; n += step) {
  const partial = SAMPLE.slice(0, Math.min(n, SAMPLE.length));
  const c = P.cleanUpMessage(partial, { scripts: SCRIPTS });
  const h = P.messageFormatting(c, { scripts: SCRIPTS });
  const box = P.win.document.createElement('div');
  box.innerHTML = h;
  const lz = box.querySelectorAll('[data-lz-content],[data-lzvr-root],[data-lz-source]').length;
  const txt = (box.textContent || '').replace(/\s+/g, ' ').trim();
  const hasShell = lz > 0;
  if (hasShell && firstLzRoot === null) firstLzRoot = partial.length;
  if (/路明非/.test(txt) && firstVisible === null) firstVisible = partial.length;
  if (rows.length < 6 || n > SAMPLE.length - step * 3 || (hasShell && rows.length < 14)) {
    rows.push(`  raw=${String(partial.length).padStart(4)}  lz壳=${lz}  pre=${box.querySelectorAll('pre').length}  文字="${txt.slice(0, 46)}"`);
  }
}
rows.forEach(log);
log('');
log(`>>> 第一次出现"龙族模板壳"的位置: ${firstLzRoot === null ? '从未出现' : 'raw 长度 ' + firstLzRoot + ' / ' + SAMPLE.length}`);
log(`>>> 第一次在正文里看到 <content> 内文的位置: ${firstVisible === null ? '从未出现' : 'raw 长度 ' + firstVisible}`);
log(`>>> <content> 闭合标签出现在 raw 长度: ${SAMPLE.indexOf('</content>') + '</content>'.length}`);
log('');

fs.writeFileSync(path.join(__dirname, 'report-A.txt'), out.join('\n'), 'utf8');
console.log('\n报告已写入 .work/lz/report-A.txt');
