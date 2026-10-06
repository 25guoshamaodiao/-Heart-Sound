/* 只装「龙族正文美化｜正式版·全历史」一条，看 <content> 到底渲染成什么 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./pipeline');

const DIR = path.resolve(__dirname, '..', '..', '思维链', '银月');
const CONTENT = JSON.parse(fs.readFileSync(path.join(DIR, 'regex-龙族正文美化｜正式版·全历史.json'), 'utf8'));
const SCRIPTS = [CONTENT];

const BODY = [
  '<scene location="卡塞尔学院·图书馆二层" time="傍晚" mood="试探" />',
  '<yanling user="诺诺" name="言灵·君焰" desc="试探性的热浪" />',
  '路明非把书推回架子，指尖还留着纸页的凉。',
  '“你又在躲。”诺诺说。',
].join('\n');
const SAMPLE = '<content>\n' + BODY + '\n</content>\n尾巴正文。';

const out = [];
const log = (s) => { out.push(s); console.log(s); };

function facts(html) {
  const box = P.win.document.createElement('div');
  box.innerHTML = html;
  return {
    box,
    lzContent: box.querySelectorAll('[data-lz-content]').length,
    lzSource: box.querySelectorAll('[data-lz-source]').length,
    pre: box.querySelectorAll('pre').length,
    code: box.querySelectorAll('code').length,
    els: box.querySelectorAll('*').length,
    txt: (box.textContent || '').replace(/\s+/g, ' ').trim(),
    raw: html,
  };
}

log('输入样本长度 = ' + SAMPLE.length + '，</content> 结束于 ' + (SAMPLE.indexOf('</content>') + 10));
log('findRegex = ' + CONTENT.findRegex);
log('replaceString 长度 = ' + CONTENT.replaceString.length);
log('');

// A. 完整
const cA = P.cleanUpMessage(SAMPLE, { scripts: SCRIPTS });
const hA = P.messageFormatting(cA, { scripts: SCRIPTS });
const fA = facts(hA);
fs.writeFileSync(path.join(__dirname, 'out-content-full.html'), hA, 'utf8');
log('=== A. 完整消息 ===');
log('cleanUpMessage 后（前 120）: ' + cA.replace(/\s+/g, ' ').slice(0, 120));
log('messageFormatting 产物长度 = ' + hA.length);
log('  [data-lz-content]=' + fA.lzContent + '  [data-lz-source]=' + fA.lzSource +
    '  <pre>=' + fA.pre + '  <code>=' + fA.code + '  元素总数=' + fA.els);
log('  可见文字（前 200）: ' + fA.txt.slice(0, 200));
log('  产物开头 160 字: ' + hA.replace(/\s+/g, ' ').slice(0, 160));
log('');

// B. 流式
log('=== B. 流式逐 token ===');
const step = 10;
let firstCode = null, firstShell = null, firstBody = null;
for (let n = step; n <= SAMPLE.length + step; n += step) {
  const partial = SAMPLE.slice(0, Math.min(n, SAMPLE.length));
  const c = P.cleanUpMessage(partial, { scripts: SCRIPTS });
  const h = P.messageFormatting(c, { scripts: SCRIPTS });
  const f = facts(h);
  if (f.code > 0 && firstCode === null) firstCode = partial.length;
  if (f.lzContent > 0 && firstShell === null) firstShell = partial.length;
  if (/路明非/.test(f.txt) && firstBody === null) firstBody = partial.length;
  if (partial.length <= 90 || partial.length >= SAMPLE.length - 10) {
    log(`  raw=${String(partial.length).padStart(4)} lz-content=${f.lzContent} pre=${f.pre} code=${f.code} 元素=${String(f.els).padStart(4)} 文字="${f.txt.slice(0, 60)}"`);
  }
}
log('');
log('>>> 第一次出现 <code>（说明模板被当成代码块）: ' + (firstCode === null ? '无' : 'raw=' + firstCode));
log('>>> 第一次出现 [data-lz-content] 壳: ' + (firstShell === null ? '从未出现（流式期间完全没有渲染）' : 'raw=' + firstShell));
log('>>> 第一次在可见文字里看到正文: ' + (firstBody === null ? '从未出现' : 'raw=' + firstBody));

fs.writeFileSync(path.join(__dirname, 'report-B.txt'), out.join('\n'), 'utf8');
console.log('\n报告写入 .work/lz/report-B.txt');
