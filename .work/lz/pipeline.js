/* 龙族美化正则 · 真实 ST 渲染管线复刻
 * 每个函数都从本机 ST（E:\share\SillyTavern，1.14.0）源码搬来，出处标在函数头。
 * 目的：不是"照着自己的实现再实现一遍"，而是把 ST 的 mes_text 真实产物造出来。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { JSDOM } = require(process.env.LZ_JSDOM || path.join(__dirname, '..', 'node-test', 'node_modules', 'jsdom'));

const ST = 'E:\\share\\SillyTavern';
const ST_NM = path.join(ST, 'node_modules');

const showdown = require(path.join(ST_NM, 'showdown'));
const createDOMPurify = require(path.join(ST_NM, 'dompurify'));

// ---------------------------------------------------------------- jsdom 环境
const dom = new JSDOM('<!doctype html><html><body><div id="chat"></div></body></html>', {
  url: 'http://127.0.0.1:8791/',
  pretendToBeVisual: true,
});
const win = dom.window;
const DOMPurify = createDOMPurify(win);

// ---------------------------------------------------------------- showdown 扩展
// script.js:481-499 —— ST 的转换器配置
const converter = new showdown.Converter({
  emoji: true,
  literalMidWordUnderscores: true,
  parseImgDimensions: true,
  tables: true,
  underline: true,
  simpleLineBreaks: true,
  strikethrough: true,
  disableForced4SpacesIndentedSublists: true,
  // ST 另外挂了 markdownUnderscoreExt / markdownExclusionExt 两个扩展，
  // 它们只影响下划线与 dinkus 的边角，对 <content> 的"代码块会不会被渲染"这件事没有影响。
});

// ---------------------------------------------------------------- ST helpers
// utils.js:1269
function escapeRegex(string) {
  return String(string).replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

// script.js 里 escapeHtml 从 utils 导入（utils.js）
function escapeHtml(string) {
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// chats.js:538-543
function encodeStyleTags(text) {
  const styleRegex = /<style>(.+?)<\/style>/gims;
  return text.replaceAll(styleRegex, (_, match) => {
    return `<custom-style>${encodeURIComponent(match)}</custom-style>`;
  });
}

// chats.js:553+ —— 这里只需要「能跑」：把 custom-style 还原成 <style>。
// 真实 ST 会顺带做 css 解析 + 选择器加 .mes_text 前缀；那步只影响样式生效范围，
// 不改变"模板有没有被渲染出来"这个判定，所以这里退化成直通，并在报告里标注。
function decodeStyleTags(text, { prefix } = { prefix: '.mes_text ' }) {
  return text
    .replace(/<custom-style>([\s\S]*?)<\/custom-style>/g, (_, enc) => {
      try {
        return `<style>${decodeURIComponent(enc)}</style>`;
      } catch (e) {
        return `<style>${enc}</style>`;
      }
    });
}

// utils.js:1279-1294
function regexFromString(input) {
  try {
    const m = String(input).match(/(\/?)(.+)\1([a-z]*)/i);
    if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) return new RegExp(input);
    return new RegExp(m[2], m[3]);
  } catch (e) {
    return;
  }
}

// ---------------------------------------------------------------- 正则扩展引擎
// extensions/regex/engine.js:226-237
const regex_placement = { MD_DISPLAY: 0, USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 5, REASONING: 6 };

// engine.js:279-326 + 336-393
function getRegexedString(rawString, placement, { isMarkdown, isPrompt, isEdit, depth } = {}, scripts) {
  if (typeof rawString !== 'string') return '';
  let finalString = rawString;
  if (!rawString || placement === undefined) return finalString;
  (scripts || []).forEach((script) => {
    const markdownOnly = !!script.markdownOnly;
    const promptOnly = !!script.promptOnly;
    if (
      (markdownOnly && isMarkdown) ||
      (promptOnly && isPrompt) ||
      (!markdownOnly && !promptOnly && !isMarkdown && !isPrompt)
    ) {
      if (isEdit && !script.runOnEdit) return;
      if ((script.placement || []).indexOf(placement) !== -1) {
        finalString = runRegexScript(script, finalString);
      }
    }
  });
  return finalString;
}

// engine.js:336-393 —— 逐字复刻（含 $1..$n、$<name>、{{match}}、trimStrings、末尾 substituteParams）
function runRegexScript(regexScript, rawString, { substitute } = {}) {
  let newString = rawString;
  if (!regexScript || regexScript.disabled || !regexScript.findRegex || !rawString) return newString;
  const findRegex = regexFromString(regexScript.findRegex);
  if (!findRegex) return newString;
  newString = rawString.replace(findRegex, function (match) {
    const args = [...arguments];
    const replaceString = String(regexScript.replaceString).replace(/{{match}}/gi, '$0');
    const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
      if (num) match = args[Number(num)];
      else if (groupName) {
        const groups = args[args.length - 1];
        match = groups && typeof groups === 'object' && groups[groupName];
      }
      if (!match) return '';
      const filteredMatch = filterString(match, regexScript.trimStrings || []);
      return filteredMatch;
    });
    return substitute ? substitute(replaceWithGroups) : replaceWithGroups;
  });
  return newString;
}

function filterString(rawString, trimStrings) {
  let finalString = rawString;
  (trimStrings || []).forEach((trimString) => {
    finalString = finalString.replaceAll(trimString, '');
  });
  return finalString;
}

// ---------------------------------------------------------------- messageFormatting
// script.js:1618-1777 的忠实复刻（只保留与本任务相关的分支）
// 注意：这里的 power_user 取值来自你机器上的 settings.json：
//   encode_tags=false, auto_fix_generated_markdown=false, collapse_newlines=false
const power_user = { encode_tags: false, auto_fix_generated_markdown: false, collapse_newlines: false, show_user_prompt_bias: false, user_prompt_bias: '' };

function messageFormatting(mes, { scripts = [], substitute, isSystem = false, isUser = false, ch_name = 'Char', isReasoning = false } = {}) {
  if (!mes) return '';

  // script.js:1668-1678
  const regexPlacement = isReasoning
    ? regex_placement.REASONING
    : isUser
      ? regex_placement.USER_INPUT
      : regex_placement.AI_OUTPUT;
  if (!isSystem) {
    mes = getRegexedString(mes, regexPlacement, { characterOverride: ch_name, isMarkdown: true, depth: 0 }, scripts);
  }

  // script.js:1681
  if (power_user.auto_fix_generated_markdown) { /* ST 的 fixMarkdown，本机为 false，跳过 */ }

  // script.js:1692-1700 —— 思维链包裹字面量转义（本机 reasoning 默认 <think>\n / \n</think>）
  const REASONING_PREFIX = '<think>\n';
  const REASONING_SUFFIX = '\n</think>';
  [REASONING_PREFIX, REASONING_SUFFIX].forEach((reasoningString) => {
    if (!reasoningString || !reasoningString.trim().length) return;
    if (mes.includes(reasoningString)) mes = mes.replace(reasoningString, escapeHtml(reasoningString));
  });

  if (!isSystem) {
    // script.js:1704-1708
    if (!power_user.encode_tags) {
      mes = mes.replace(/<([^>]+)>/g, function (_, contents) {
        return '<' + contents.replace(/"/g, '\ufffe') + '>';
      });
    }
    // script.js:1710-1736 —— 中文引号 → <q>
    mes = mes.replace(
      /<style>[\s\S]*?<\/style>|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[\s\S]*?`|(".*?")|(\u201C.*?\u201D)|(\u00AB.*?\u00BB)|(\u300C.*?\u300D)|(\u300E.*?\u300F)|(\uFF02.*?\uFF02)/gim,
      function (match, p1, p2, p3, p4, p5, p6) {
        if (p1) return `<q>"${p1.slice(1, -1)}"</q>`;
        else if (p2) return `<q>\u201C${p2.slice(1, -1)}\u201D</q>`;
        else if (p3) return `<q>\u00AB${p3.slice(1, -1)}\u00BB</q>`;
        else if (p4) return `<q>\u300C${p4.slice(1, -1)}\u300D</q>`;
        else if (p5) return `<q>\u300E${p5.slice(1, -1)}\u300F</q>`;
        else if (p6) return `<q>\uFF02${p6.slice(1, -1)}\uFF02</q>`;
        else return match;
      },
    );
    // script.js:1738-1741
    if (!power_user.encode_tags) mes = mes.replace(/\ufffe/g, '"');

    // script.js:1743-1745
    mes = mes.replaceAll('\\begin{align*}', '$$');
    mes = mes.replaceAll('\\end{align*}', '$$');
    if (substitute) mes = substitute(mes);
    mes = converter.makeHtml(mes);

    // script.js:1747-1756
    mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, (match) => match.replace(/\n/gm, '\u0000'));
    mes = mes.replace(/\u0000/g, '\n');
    mes = mes.trim();
    mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, (match) => match.replace(/&amp;/g, '&'));
  }

  // script.js:1759-1761
  if (ch_name && !isUser && !isSystem) {
    mes = mes.replace(new RegExp(`(^|\\n)${escapeRegex(ch_name)}:`, 'g'), '$1');
  }

  // script.js:1763-1774
  const config = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false,
    MESSAGE_SANITIZE: true,
    ADD_TAGS: ['custom-style'],
  };
  mes = encodeStyleTags(mes);
  mes = DOMPurify.sanitize(mes, config);
  mes = decodeStyleTags(mes, { prefix: '.mes_text ' });

  return mes;
}

// script.js:5981-6020（只保留与正则相关的分支）
function cleanUpMessage(getMessage, { scripts = [], isImpersonate = false } = {}) {
  if (!getMessage) return '';
  return getRegexedString(getMessage, isImpersonate ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT, {}, scripts);
}

/** 把 messageFormatting 的产物真正塞进 DOM，返回 .mes_text 元素 */
function mount(html, id) {
  const chat = win.document.getElementById('chat');
  const mes = win.document.createElement('div');
  mes.className = 'mes';
  mes.setAttribute('mesid', String(id));
  const text = win.document.createElement('div');
  text.className = 'mes_text';
  text.innerHTML = html;
  mes.appendChild(text);
  chat.appendChild(mes);
  return text;
}

module.exports = {
  win, DOMPurify, converter,
  getRegexedString, runRegexScript, messageFormatting, cleanUpMessage, mount,
  regexFromString, regex_placement, escapeHtml, encodeStyleTags, decodeStyleTags, escapeRegex,
};
