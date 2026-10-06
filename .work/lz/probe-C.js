/* 微探针：ST 管线对「裸 HTML」和「代码围栏里的 HTML」分别做什么 */
'use strict';
const P = require('./pipeline');
const { win } = P;

function facts(html) {
  const box = win.document.createElement('div');
  box.innerHTML = html;
  const d = box.querySelector('div[data-lz-content]');
  return {
    els: box.querySelectorAll('*').length,
    pre: box.querySelectorAll('pre').length,
    code: box.querySelectorAll('code').length,
    shell: box.querySelectorAll('[data-lz-content]').length,
    style: box.querySelectorAll('style').length,
    text: (box.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
    htmlHead: html.replace(/\s+/g, ' ').slice(0, 130),
    contentText: d ? (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
  };
}

function boot(label, replaceString) {
  const script = {
    id: 't', scriptName: label, disabled: false,
    findRegex: '/<content>([\\s\\S]*?)<\\/content>/is',
    replaceString,
    trimStrings: [], placement: [2], markdownOnly: true, promptOnly: false,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
  };
  const mes = '<content>\n路明非把书推回架子。\n“你又在躲。”诺诺说。\n</content>';
  const cleaned = P.cleanUpMessage(mes, { scripts: [script] });
  const html = P.messageFormatting(cleaned, { scripts: [script] });
  const f = facts(html);
  console.log('=== ' + label + ' ===');
  console.log('  <div>值: ' + JSON.stringify(f));
  console.log('');
  return html;
}

// 1) 现在这样：整份 HTML 文档塞进 ```html 围栏
const fenced = boot('现在：```html 围栏 + doctype + html/head/body + script', '```html\n<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>t</title><style>:root{--x:#fff}</style></head><body><div data-lz-content>X</div><textarea data-lz-source="content">$1</textarea><script>console.log(1)<\/script></body></html>\n```');

// 2) 去掉围栏：裸 HTML 片段
const raw = boot('去掉围栏：裸 HTML 片段（div/details/section/textarea）',
  '<div data-lz-content><section><h1>标题</h1><p>正文占位</p></section></div>\n' +
  '<textarea data-lz-source="content" hidden>$1</textarea>\n' +
  '<style>[data-lz-content]{color:#123}</style>');

// 3) 裸 HTML + script：script 能不能活
boot('裸 HTML + <script>（测 script 是否被消掉）',
  '<div data-lz-content><p>hi</p></div><script>globalThis.__ran=1<\/script>');

// 4) 裸 HTML + iframe
boot('裸 HTML + <iframe>（第三方渲染器的做法）',
  '<div data-lz-content><iframe srcdoc="&lt;p&gt;hi&lt;/p&gt;"></iframe></div>');

// 5) 只用白名单元素，且不用 doctype/html/head/body
const shell = boot('方案：只发一个薄壳（div + pre 装原文 + style）',
  '<div data-lz-content><pre data-lz-pending>■ 正文生成中…</pre></div>' +
  '<textarea data-lz-source="content" hidden>$1</textarea>' +
  '<style>[data-lz-content]{border:1px solid #ccc}</style>');

const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(__dirname, 'out-variants.txt'),
  ['--- fenced ---', fenced, '', '--- raw ---', raw, '', '--- shell ---', shell].join('\n'), 'utf8');
console.log('写出 .work/lz/out-variants.txt');
