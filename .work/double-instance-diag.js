/* 复现「仓库里那份明月 v1.4.3」和「CDN 启动器 import 进来的 v1.2.0」同时跑会怎样。
 * 酒馆里脚本 iframe 和启动器 iframe 是两个 window，但**共享同一份 ST 设置**
 * （power_user.reasoning / extension_settings.regex），所以设置级的互相踩踏
 * 用一个 window 里的两个 IIFE 就能忠实复现。
 */
const fs = require('fs');
const path = require('path');
const { loadJsdom } = require('./jsdom-loader');
const { JSDOM, VirtualConsole } = loadJsdom(path.join(__dirname, '..'));

const ROOT = process.cwd();
const MIRROR = path.join(ROOT, '.work', 'ref', 'st-mirror.js');
const NEW = fs.readFileSync(path.join(ROOT, '思维链', '银月', 'silver-moon.js'), 'utf8').replace(/^\uFEFF/, '');
const OLD = fs.readFileSync(path.join(ROOT, '.work', 'ref', 'silver-moon-v1.2.0.js'), 'utf8').replace(/^\uFEFF/, '');

const STUB_SRC = `
window.__buttonCalls = { get: 0, replace: 0, getEvent: [], eventOn: [] };
window.__buttonState = { buttons: [], events: {}, handlers: {}, toasts: [], storeReady: true, discarded: 0 };
window.getScriptButtons = function () { window.__buttonCalls.get += 1; return (window.__buttonState.buttons || []).map(function (b) { return Object.assign({}, b); }); };
window.replaceScriptButtons = function (list) { window.__buttonCalls.replace += 1; if (!window.__buttonState.storeReady) { window.__buttonState.discarded += 1; return; } window.__buttonState.buttons = (list || []).map(function (b) { return Object.assign({}, b); }); };
window.getButtonEvent = function (name) { window.__buttonCalls.getEvent.push(name); if (!window.__buttonState.events[name]) window.__buttonState.events[name] = 'sm_' + encodeURIComponent(name); return window.__buttonState.events[name]; };
window.eventOn = function (id, fn) { window.__buttonCalls.eventOn.push(id); (window.__buttonState.handlers[id] = window.__buttonState.handlers[id] || []).push(fn); return { stop: function () { window.__buttonState.handlers[id] = []; } }; };
window.toastr = { success: function (m) { window.__buttonState.toasts.push(['success', String(m)]); }, warning: function (m) { window.__buttonState.toasts.push(['warning', String(m)]); }, error: function (m) { window.__buttonState.toasts.push(['error', String(m)]); }, info: function (m) { window.__buttonState.toasts.push(['info', String(m)]); } };
`;

const logs = [];
const vc = new VirtualConsole();
for (const ev of ['jsdomError', 'warn', 'error', 'log', 'info']) vc.on(ev, (...a) => logs.push('[' + ev + '] ' + a.join(' ')));

const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="chat"></div>' +
  '<script>' + fs.readFileSync(MIRROR, 'utf8') + '</script>' +
  '<script>' + STUB_SRC + '</script>' +
  '</body></html>';

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://127.0.0.1/' });
const win = dom.window;
const wait = async (n = 20) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 5)); };

function snapshot(win, tag) {
  const re = win.__mirror.getGlobalRegexes ? win.__mirror.getGlobalRegexes() : [];
  const ours = re.filter((r) => /银月/.test(String(r.scriptName || '')));
  const pw = win.__mirror.power_user.reasoning;
  const styles = Array.from(win.document.querySelectorAll('style')).filter((s) => /mes_reasoning_details/.test(s.textContent || ''));
  console.log('\n===== ' + tag + ' =====');
  console.log('  银月自己的正则 : ' + ours.length + ' 条  ' +
    JSON.stringify(ours.map((r) => ({ n: r.scriptName, to: r.replaceString, on: !r.disabled }))));
  console.log('  reasoning 配置 : ' + JSON.stringify({ prefix: pw && pw.prefix, suffix: pw && pw.suffix, auto_parse: pw && pw.auto_parse }));
  console.log('  美化用的 <style>: ' + styles.length + ' 个（含 mes_reasoning_details 规则）');
  console.log('  按钮列表       : ' + JSON.stringify(win.__buttonState.buttons));
  return ours;
}

// 探针：现在的 reasoning 配置能不能把 [metacognition]…</thinking> 切出来
function probeParse(win, text) {
  const r = win.__mirror.parseReasoningFromString
    ? win.__mirror.parseReasoningFromString(text)
    : null;
  return r;
}

const run = async () => {
  // ---- 实例 A：仓库里的 v1.4.3（= 酒馆脚本库里的「明月」）----
  const aScript = win.document.createElement('script');
  aScript.textContent = NEW;
  win.document.body.appendChild(aScript);
  await wait();
  const apiA = win.__silverMoon;
  console.log('\nA 起来了吗: ' + (apiA ? apiA.version : '(没有)'));
  snapshot(win, 'A 单独跑完（当前版本）');
  console.log('  探针           : ' + JSON.stringify(probeParse(win, '[metacognition]在想什么</thinking>正文')));

  // ---- 实例 B：CDN 启动器 import 的 v1.2.0（老版，没有归属权概念）----
  const bScript = win.document.createElement('script');
  bScript.textContent = OLD;
  win.document.body.appendChild(bScript);
  await wait();
  snapshot(win, 'B 也起来之后（CDN 老版后到）');
  console.log('  探针           : ' + JSON.stringify(probeParse(win, '[metacognition]在想什么</thinking>正文')));
  console.log('  __silverMoon 被谁占 : ' + (win.__silverMoon && win.__silverMoon.version));

  // ---- A 再自检/刷新一次（相当于切聊天、点按钮、app_ready）----
  if (apiA && typeof apiA.refresh === 'function') {
    await apiA.refresh();
    await wait();
    snapshot(win, 'A.refresh() 之后');
    console.log('  探针           : ' + JSON.stringify(probeParse(win, '[metacognition]在想什么</thinking>正文')));
  }

  // ---- B 的 pagehide（脚本 iframe 销毁/重载）----
  win.dispatchEvent(new win.Event('pagehide'));
  await wait();
  snapshot(win, 'pagehide（任一个实例被销毁）之后');
  console.log('  探针           : ' + JSON.stringify(probeParse(win, '[metacognition]在想什么</thinking>正文')));

  // ---- 再补一个被动事件（app_ready / 切聊天）：自愈该把被摘掉的正则和样式补回来 ----
  const appReady = win.__buttonState.handlers['app_ready'] || [];
  for (const fn of appReady) { try { fn(); } catch (_) { /* noop */ } }
  await wait();
  snapshot(win, '再补一个 app_ready（自愈）之后');
  console.log('  探针           : ' + JSON.stringify(probeParse(win, '[metacognition]在想什么</thinking>正文')));

  console.log('\n--- 警告/错误日志 ---');
  console.log(logs.filter((l) => /\[(warn|error|jsdomError)\]/.test(l)).slice(0, 25).join('\n'));
};

run();
