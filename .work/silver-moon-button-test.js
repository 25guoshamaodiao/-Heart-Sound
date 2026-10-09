/* 银月 · 注入重试按钮 自检台（v1.4 / v1.4.1）
 *
 * 目标：把「失败才出按钮 / 点一下重试 / 成功就消失 / 清理不残留」变成可断言的事实。
 * 环境：jsdom + .work/ref/st-mirror.js（ST 1.14.0 逐字搬来的迷你 ST）+ 一组
 *       **照酒馆助手 4.11.3 真实实现写**的按钮桩：只桩真实存在的四个全局
 *         getScriptButtons()      —— 返回 klona 克隆（src/function/script.ts:64）
 *         replaceScriptButtons()  —— 未就绪时**静默丢弃**（src/function/script.ts:76-78）
 *         getButtonEvent(name)    —— 返回 `${script_id}_${encodeURIComponent(name)}`
 *         eventOn(id, fn)         —— 返回 { stop() }
 *       刻意**不桩** registerScriptButton / listenEvent —— 这两个在 4.11.3 里根本不存在，
 *       v1.4 的「按钮在、点了没反应」就是信了它们。桩里再放，就是继续测一个不存在的世界。
 * 跑法：node .work/silver-moon-button-test.js   （报告写到 .work/button-report.txt）
 */
const fs = require('fs');
const path = require('path');
const { loadJsdom } = require('./jsdom-loader');
const { JSDOM, VirtualConsole } = loadJsdom(path.join(__dirname, '..'));

const ROOT = process.cwd();
const TARGET = path.join(ROOT, '思维链', '银月', 'silver-moon.js');
const MIRROR = path.join(ROOT, '.work', 'ref', 'st-mirror.js');
const OUT = path.join(ROOT, '.work', 'button-report.txt');

const BUTTON_NAME = '银月·注入';
// 源码里的 VERSION 直接读出来用：断言别写死版本号，免得每次升版都要改一堆测试。
const SRC_VERSION = (fs.readFileSync(TARGET, 'utf8').match(/const VERSION = "([^"]+)"/) || [])[1];

const results = [];
const lines = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined && extra !== '' ? '  <' + extra + '>' : ''));
  return ok;
}
function section(title) {
  lines.push('');
  lines.push('===== ' + title + ' =====');
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 6; i += 1) await tick();
}

// ---- 酒馆助手 4.11.3 真实按钮 API 的桩（当源码字符串内联，保证在 silver-moon 之前执行）----
// 只桩真实存在的四个全局：getScriptButtons / replaceScriptButtons / getButtonEvent / eventOn。
// 特别地：**不桩 registerScriptButton 和 listenEvent** —— 它们在 4.11.3 根本不存在，
// v1.4 之所以「按钮在、点了没反应」就是因为信了这两个名字（小 cot 的 listenEvent 是
// 它自己的局部函数）。桩里再放它们，就等于继续测一个不存在的世界。
const STUB_SRC = `
window.__buttonCalls = { get: 0, replace: 0, getEvent: [], eventOn: [], replaced: [] };
window.__buttonState = {
  buttons: [],      // 本脚本自己的按钮列表（酒馆助手 store 里那份）
  events: {},       // name -> button_id
  handlers: {},     // event_id -> [handler]
  toasts: [],
  storeReady: true, // false = 还在 app_ready 之前，replace 会被静默丢掉
  discarded: 0,     // 被丢掉几次写
};
window.getScriptButtons = function () {
  window.__buttonCalls.get += 1;
  // 真实实现返回 klona 克隆（src/function/script.ts:64）：改返回值不影响 store。
  return (window.__buttonState.buttons || []).map(function (b) { return Object.assign({}, b); });
};
window.replaceScriptButtons = function (list) {
  window.__buttonCalls.replace += 1;
  window.__buttonCalls.replaced.push(JSON.stringify(list || []));
  if (!window.__buttonState.storeReady) { window.__buttonState.discarded += 1; return; }
  window.__buttonState.buttons = (list || []).map(function (b) { return Object.assign({}, b); });
};
window.getButtonEvent = function (name) {
  window.__buttonCalls.getEvent.push(name);
  var hit = (window.__buttonState.buttons || []).filter(function (b) { return b && b.name === name; })[0];
  if (!hit) return null;
  if (!window.__buttonState.events[name]) {
    // 真实 button_id 形状：\`\${script_id}_\${encodeURIComponent(name)}\`
    window.__buttonState.events[name] = 'sm-test_' + encodeURIComponent(name);
  }
  return window.__buttonState.events[name];
};
window.eventOn = function (event_id, handler) {
  window.__buttonCalls.eventOn.push(event_id);
  if (!window.__buttonState.handlers[event_id]) window.__buttonState.handlers[event_id] = [];
  window.__buttonState.handlers[event_id].push(handler);
  return { stop: function () { window.__buttonState.handlers[event_id] = []; } };
};
// 模拟「用户手动在脚本库里建了一个同名按钮」——button.buttons 一开始就非空
window.__seedButton = function (name) {
  window.__buttonState.buttons.push({ name: name, visible: true });
  return window.__buttonState.events[name] = 'sm-test_' + encodeURIComponent(name);
};
window.toastr = {
  success: function (m) { window.__buttonState.toasts.push(['success', String(m)]); },
  warning: function (m) { window.__buttonState.toasts.push(['warning', String(m)]); },
  error: function (m) { window.__buttonState.toasts.push(['error', String(m)]); },
  info: function (m) { window.__buttonState.toasts.push(['info', String(m)]); },
};
`;

async function makeEnv(options) {
  const opts = options || {};
  const withApi = opts.withButtonApi !== false;
  const src = {
    mirror: fs.readFileSync(MIRROR, 'utf8'),
    script: fs.readFileSync(TARGET, 'utf8'),
  };
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => logs.push('[jsdomError] ' + (e && e.stack ? e.stack : e)));
  vc.on('warn', (...a) => logs.push('[warn] ' + a.join(' ')));
  vc.on('error', (...a) => logs.push('[error] ' + a.join(' ')));
  vc.on('log', (...a) => logs.push('[log] ' + a.join(' ')));
  // 预先在 ST 顶层 window 上登记一个「别的实例」的归属，用来测让位 / 接管
  // （真实场景：脚本库里一份 + 某预设的启动器 import 的 CDN 一份）。
  const preSrc = opts.preOwner
    ? 'window.top.__silverMoonOwner = ' +
      JSON.stringify(Object.assign({ id: 'other-instance', ts: 1 }, opts.preOwner)) +
      ';\n'
    : '';
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="chat"></div>' +
    '<script>' + src.mirror + '</script>' +
    '<script>' + preSrc + STUB_SRC + '</script>' +
    '<script>' + src.script + '</script>' +
    '</body></html>';
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'http://127.0.0.1/',
  });
  const win = dom.window;
  if (!withApi) {
    // 真的没有按钮 API 的酒馆助手：四个全局全部不存在
    delete win.getScriptButtons;
    delete win.replaceScriptButtons;
    delete win.getButtonEvent;
    delete win.eventOn;
  } else if (opts.noEventOn) {
    delete win.eventOn;
  }
  if (opts.storeReady === false) win.__buttonState.storeReady = false;
  await settle();
  return { dom, win, logs };
}

const ownButton = (win) => (win.__buttonState.buttons || []).filter((b) => b && b.name === BUTTON_NAME)[0] || null;
// ST 全局正则列表里有没有我们那两条（按名字认）
const hasOursRegex = (win) => win.__mirror.getGlobalRegexes()
  .some((r) => String((r && r.scriptName) || '').indexOf('银月 · 思维链归一') === 0);
const ourRegexCount = (win) => win.__mirror.getGlobalRegexes()
  .filter((r) => String((r && r.scriptName) || '').indexOf('银月 · 思维链归一') === 0).length;
// 框架/酒馆助手宿主自己也会 eventOn（app_ready、chat_id_changed…），所以只数绑到
// 「我们按钮的 event id」上的那几次，否则断言会把宿主的绑定算进来。
const ourEventOn = (win) => {
  const id = win.__buttonState.events[BUTTON_NAME];
  return (win.__buttonCalls.eventOn || []).filter((e) => e === id);
};
const shown = (win) => {
  const b = ownButton(win);
  return !!b && b.visible !== false;
};
const clickButton = async (win) => {
  // 真实事件名是 getButtonEvent 给的 button_id，不是按钮名字
  const id = win.__buttonState.events[BUTTON_NAME];
  const list = (id && win.__buttonState.handlers[id]) || [];
  for (const h of list.slice()) await h();
  await settle();
  return list.length;
};
const info = (win) => win.__silverMoon.injectButton();
const toasts = (win) => win.__buttonState.toasts || [];
const toastCount = (win) => toasts(win).length;
const hasToast = (win, type, needle) =>
  toasts(win).some((t) => t[0] === type && t[1].indexOf(needle) !== -1);

// 数一条消息上有几个思维块、块里是什么（和 st-reasoning-test.js 同款）
const blockInfo = (win, idx) => {
  const el = win.document.querySelector('#chat .mes[mesid="' + idx + '"] .mes_reasoning_details');
  if (!el) return { count: 0, state: null, reasoning: '' };
  const body = el.querySelector('.mes_reasoning');
  return {
    count: win.document.querySelectorAll('#chat .mes[mesid="' + idx + '"] .mes_reasoning_details').length,
    state: el.getAttribute('data-state'),
    reasoning: body ? String(body.textContent || '') : '',
  };
};
// 正文里残留了几处 canonical wrapper（要 0）
function leakCount(win, prefix, suffix) {
  const p = String(prefix || '').trim();
  const s = String(suffix || '').trim();
  let n = 0;
  win.document.querySelectorAll('#chat .mes_text').forEach((el) => {
    const t = String(el.textContent || '');
    if ((p && t.indexOf(p) !== -1) || (s && t.indexOf(s) !== -1)) n += 1;
  });
  return n;
}

// 怎么稳定地把探针打挂：探针串是 canonicalPrefix + marker + canonicalSuffix，而
// applyCanonicalConfig() 会把 CONFIG 里这一对字面量写进 power_user.reasoning —— 所以
// 「改 CONFIG」是打不挂探针的（探针读的就是它）。
// 真正能让探针挂掉的是「配置没铺上」：CANONICAL_PREFIX 守着 ST 里那份陈旧配置，
// 测试脚本在启动前把它设成探针串，然后关掉 manageReasoningConfig，
// applyCanonicalConfig() 就永远不会覆盖它 → 探针必挂，而且 buildNormalizeRules() 仍能出规则。
const CANONICAL_PREFIX = '[metacognition]';
async function broke(api) {
  api.config.manageReasoningConfig = false;
  api.config.canonicalPrefix = 'QQ银月探针ZZ';
  await api.refresh();
  await settle();
  return api.status().normalize.state;
}
async function fixed(api) {
  api.config.manageReasoningConfig = true;
  api.config.canonicalPrefix = CANONICAL_PREFIX;
  await api.refresh();
  await settle();
  return api.status().normalize.state;
}

(async function main() {
  lines.push('target = ' + path.relative(ROOT, TARGET));
  check('源码里没有 </script>（能安全内联）',
    fs.readFileSync(TARGET, 'utf8').indexOf('</script>') === -1);

  /* ---------------- A. 常驻按钮：成功时也在，点了就再同步一次 ---------------- */
  section('A. 注入成功（installed）：按钮常驻、可点（点了再同步一次）');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    check('A1 暴露了 __silverMoon', !!api);
    check('A2 归一化真的接管了（installed/present）',
      api.status().normalize.state === 'installed' || api.status().normalize.state === 'present',
      api.status().normalize.state);
    check('A3 按钮常驻（v1.4.2 起成功时也留着）',
      !!ownButton(win) && ownButton(win).visible === true, JSON.stringify(win.__buttonState.buttons));
    check('A4 injectButton().mode === "ok"、want === false',
      info(win).mode === 'ok' && info(win).want === false, JSON.stringify(info(win)));
    check('A5 成功态也绑了点击（v1.4.4 修：以前只在失败态绑，「一开页面就成功」的用户点了毫无反应）',
      ourEventOn(win).length === 1 && info(win).bound === true,
      JSON.stringify({ eventOn: win.__buttonCalls.eventOn, bound: info(win).bound }));
    const rendersBefore = win.__mirror.stats().renderTriggerCount;
    const before = toastCount(win);
    await clickButton(win);
    check('A6 成功态点击真的会再同步一次（success 播报、没有 warning）',
      hasToast(win, 'success', '已就位') &&
      !toasts(win).slice(before).some((t) => t[0] === 'warning') &&
      info(win).retryCount === 1,
      JSON.stringify(toasts(win).slice(before)));
    check('A7 规则没变化时点它不会重排聊天（renderTriggerCount 不涨）',
      win.__mirror.stats().renderTriggerCount === rendersBefore,
      JSON.stringify({ before: rendersBefore, after: win.__mirror.stats().renderTriggerCount }));
    check('A8 点完状态仍是 installed/present、按钮仍可见',
      (api.status().normalize.state === 'installed' || api.status().normalize.state === 'present') &&
      info(win).visible === true,
      JSON.stringify(info(win)));
  }

  /* ---------------- B. 探针没过：出按钮 ---------------- */
  section('B. 探针没过（probe-failed）：按钮出现且可见');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    const st0 = await broke(api);
    const st = api.status();
    check('B1 状态 = probe-failed', st.normalize.state === 'probe-failed', st0);
    check('B2 按钮被写进列表、名字对且 visible',
      !!ownButton(win) && ownButton(win).visible === true, JSON.stringify(win.__buttonState.buttons));
    check('B3 写进去的条目只有 name + visible（ScriptButton schema 只有这两个键）',
      !!ownButton(win) && Object.keys(ownButton(win)).sort().join(',') === 'name,visible',
      JSON.stringify(Object.keys(ownButton(win) || {})));
    check('B4 injectButton().want === true', info(win).want === true);
    check('B5 injectButton().visible === true 且 storeReady === true',
      info(win).visible === true && info(win).storeReady === true, JSON.stringify(info(win)));
    check('B6 eventOn 绑的是 getButtonEvent 给的 button_id（只一次）',
      ourEventOn(win).length === 1 &&
      ourEventOn(win)[0] === win.__buttonState.events[BUTTON_NAME],
      JSON.stringify(win.__buttonCalls.eventOn));
    check('B7 event 字段是真的 button_id 形状（含按钮名的 encodeURIComponent）',
      String(info(win).event).indexOf(encodeURIComponent(BUTTON_NAME)) !== -1, String(info(win).event));
    lines.push('  探针原因 = ' + st.normalize.note);
  }

  /* ---------------- B2. store 还没就绪：回读校验 + 重试补写 ---------------- */
  section('B2. app_ready 之前写入被吞 → 回读校验发现 → 重试补上');
  {
    const env = await makeEnv({ storeReady: false });
    const win = env.win;
    const api = win.__silverMoon;
    await broke(api); // 这次写会被 store 丢掉
    check('B2-1 写被丢掉（桩记录 discarded）', win.__buttonState.discarded >= 1, String(win.__buttonState.discarded));
    check('B2-2 回读不一致 → storeReady === false', info(win).storeReady === false, JSON.stringify(info(win).storeReady));
    check('B2-3 按钮此刻还没进列表', !ownButton(win), JSON.stringify(win.__buttonState.buttons));

    // 页面切回前台 + store 就绪 → 重试循环（或 visibilitychange）应该把它补上
    win.__buttonState.storeReady = true;
    win.document.dispatchEvent(new win.Event('visibilitychange'));
    await settle();
    check('B2-4 补写成功：按钮进列表且可见', !!ownButton(win) && ownButton(win).visible === true,
      JSON.stringify(win.__buttonState.buttons));
    check('B2-5 补写后 storeReady === true', info(win).storeReady === true, JSON.stringify(info(win)));
    check('B2-6 replace 被调了不止一次（说明真的在重试，不是碰巧）',
      win.__buttonCalls.replace >= 3, String(win.__buttonCalls.replace));
  }

  /* ---------------- B3. 重试耗尽：留痕、不抛错、脚本还活着 ---------------- */
  section('B3. store 一直不就绪：后台不空转、可见后重试耗尽只留痕');
  {
    const env = await makeEnv({ storeReady: false });
    const win = env.win;
    const api = win.__silverMoon;
    api.config.injectStoreRetryDelayMs = 1;
    // 上限放大：后台阶段要能区分「1ms 的 setTimeout 循环」（50ms 能涨几十次）
    // 和「被几个真实事件顺手推了一两次」。上限 3 的话两者都到不了就分不清了。
    api.config.injectStoreRetryMax = 8;
    // jsdom（pretendToBeVisual）的 document.hidden 默认不是 true，这里显式钉住「页面在后台」，
    // 否则测的就不是「后台不空转」这条分支。
    Object.defineProperty(win.document, 'hidden', { value: true, configurable: true });
    // 进后台之前 init 阶段已经扣过的那一次（那时还不是后台，扣得对）。之后一次都不许再扣。
    const atHiddenStart = info(win).storeRetryCount;
    await broke(api);
    await settle();
    await new Promise((r) => setTimeout(r, 40));
    await settle();
    const hiddenCount = info(win).storeRetryCount;
    check('B3-0 进后台之后一次预算都不再扣（v1.4.4 修：以前先扣再判 hidden，挂着后台会把预算耗光）',
      info(win).storeGaveUp === false && hiddenCount === atHiddenStart && atHiddenStart <= 1,
      JSON.stringify({ atHiddenStart, count: hiddenCount, gaveUp: info(win).storeGaveUp }));
    await new Promise((r) => setTimeout(r, 50));
    await settle();
    check('B3-0b 后台这 50ms 里预算一点都不动 —— 真的没有 setTimeout 空转，也没白扣',
      info(win).storeRetryCount - hiddenCount === 0,
      JSON.stringify({ was: hiddenCount, now: info(win).storeRetryCount }));

    // 回到前台：把因后台而暂停的重试续上，一路到顶
    Object.defineProperty(win.document, 'hidden', { value: false, configurable: true });
    win.document.dispatchEvent(new win.Event('visibilitychange'));
    await settle();
    await new Promise((r) => setTimeout(r, 80));
    await settle();
    check('B3-1 storeGaveUp === true（重试耗尽后如实留痕，不无限空转）',
      info(win).storeGaveUp === true, JSON.stringify(info(win)));
    check('B3-2 重试次数到顶就停（storeRetryCount === 上限 8）',
      info(win).storeRetryCount === 8, String(info(win).storeRetryCount));
    await new Promise((r) => setTimeout(r, 50));
    await settle();
    check('B3-2b 到顶之后再等也不涨（真的停了）',
      info(win).storeRetryCount === 8, String(info(win).storeRetryCount));
    check('B3-3 脚本还活着（status() 仍可调用）', typeof api.status === 'function' && !!api.status().normalize);
    check('B3-4 按钮仍然拿不到（如实报告）', info(win).visible === false, JSON.stringify(info(win).visible));
    check('B3-5 常驻按钮在「写不进去」时仍然把意图报出来（want/registered 是真话）',
      info(win).want === true && info(win).storeReady === false,
      JSON.stringify({ want: info(win).want, registered: info(win).registered, storeReady: info(win).storeReady }));
  }

  /* ---------------- B4. 没有 eventOn 的老酒馆助手：降级但不崩 ---------------- */
  section('B4. 没有 eventOn：只 warn 不抛错');
  {
    const env = await makeEnv({ noEventOn: true });
    const win = env.win;
    const api = win.__silverMoon;
    await broke(api);
    check('B4-1 按钮照样写进列表', !!ownButton(win), JSON.stringify(win.__buttonState.buttons));
    check('B4-2 bound === false（点不了，如实报告）', info(win).bound === false, JSON.stringify(info(win).bound));
    check('B4-3 有 warn 提示 eventOn 不可用',
      env.logs.some((l) => l.indexOf('eventOn') !== -1), JSON.stringify(env.logs.filter((l) => l.indexOf('eventOn') !== -1)));
    check('B4-4 retryInject() 仍可用', typeof api.retryInject === 'function');
  }

  /* ---------------- B5. 旧式假 API：不再被信任 ---------------- */
  section('B5. 只给旧式假 API（registerScriptButton + listenEvent）时不该有任何动作');
  {
    const env = await makeEnv({ withButtonApi: false });
    const win = env.win;
    const api = win.__silverMoon;
    // 把 v1.4 信过的那两个假全局塞回去 —— 修好之后脚本不该再看它们
    win.registerScriptButton = function () { throw new Error('不该被调用：registerScriptButton'); };
    win.listenEvent = function () { throw new Error('不该被调用：listenEvent'); };
    await broke(api);
    check('B5-1 不抛错（两个假全局一次都没被调用）', true);
    check('B5-2 按钮 API 缺失 → registered === false', info(win).registered === false, JSON.stringify(info(win)));
    check('B5-3 仍然如实给出 want === true', info(win).want === true);
  }

  /* ---------------- C. 点一下重试，成功即消失 ---------------- */
  section('C. 点按钮重试：修好后成功 → 按钮消失');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await broke(api);
    check('C1 前置：按钮已可见', info(win).visible === true && !!ownButton(win));

    const before = win.__buttonState.toasts.length;
    const handlers = await clickButton(win);
    check('C2 点的时候确实没有修好 → 保留按钮 + warning 弹窗',
      info(win).visible === true && hasToast(win, 'warning', '还是没注入上'),
      JSON.stringify(toasts(win).slice(before)));
    check('C3 retryCount 累加', info(win).retryCount === 1, String(info(win).retryCount));
    check('C4 点了之后也没重复绑事件',
      ourEventOn(win).length === 1 && handlers === 1,
      JSON.stringify({ eventOn: ourEventOn(win).length, handlers }));

    // 玩家在脚本库里把「注入按钮」修好（等价于重新加载脚本 → 探针这次能过）
    await fixed(api);
    const st = api.status();
    check('C5 前置修好后状态回到 installed/present',
      st.normalize.state === 'installed' || st.normalize.state === 'present', st.normalize.state);
    check('C6 成功了 → 按钮仍然常驻可见（v1.4.2 常驻按钮）', info(win).visible === true && !!ownButton(win));
    check('C8 成功后条目不重复（去重逻辑生效）',
      win.__buttonState.buttons.filter((b) => b && b.name === BUTTON_NAME).length === 1,
      JSON.stringify(win.__buttonState.buttons));

    // 已就位时再点（v1.4.4）：真的再同步一次 → 播报 success；
    // 因为规则没变化，不许再触发酒馆助手那次整段聊天重排。
    const beforeOk = toastCount(win);
    const rendersBeforeOk = win.__mirror.stats().renderTriggerCount;
    await clickButton(win);
    check('C7 已就位时点击会再同步一次：给 success、没有 warning，且不重排聊天',
      hasToast(win, 'success', '已就位') && info(win).retryCount === 2 &&
      win.__mirror.stats().renderTriggerCount === rendersBeforeOk &&
      !toasts(win).slice(beforeOk).some((t) => t[0] === 'warning'),
      JSON.stringify({ toasts: toasts(win).slice(beforeOk), renders: [rendersBeforeOk, win.__mirror.stats().renderTriggerCount] }));
    check('C9 点完状态仍是 installed/present，按钮仍可见',
      (api.status().normalize.state === 'installed' || api.status().normalize.state === 'present') &&
      info(win).visible === true,
      JSON.stringify(info(win)));
  }

  /* ---------------- D. 没有按钮 API：只降级，不炸 ---------------- */
  section('D. 没有酒馆助手按钮 API：脚本照常跑，只降级');
  {
    const env = await makeEnv({ withButtonApi: false });
    const win = env.win;
    const api = win.__silverMoon;
    await broke(api);
    check('D1 状态仍是 probe-failed', api.status().normalize.state === 'probe-failed');
    check('D2 没有按钮 API 也不抛错，脚本还活着', !!api && typeof api.retryInject === 'function');
    check('D3 injectButton().registered === false', info(win).registered === false);
    check('D4 有明确的 warn 说明按钮不可用、并给出替代入口',
      env.logs.some((l) => l.indexOf('注入按钮不可用') !== -1) &&
      env.logs.some((l) => l.indexOf('retryInject') !== -1),
      JSON.stringify(env.logs.filter((l) => l.indexOf('注入按钮') !== -1).slice(0, 2)));
    // 替代入口仍然可用
    await fixed(api);
    await api.retryInject();
    await settle();
    check('D5 用 __silverMoon.retryInject() 也能救回来',
      api.status().normalize.state === 'installed' || api.status().normalize.state === 'present',
      api.status().normalize.state);
  }

  /* ---------------- E. 玩家自己已经建过同名按钮 ---------------- */
  section('E. 已经存在同名按钮：复用条目，不重复、不弄丢');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    const seededId = win.__seedButton(BUTTON_NAME); // 模拟脚本库里手动建过一个同名按钮
    await broke(api);
    check('E1 列表里仍然只有一条同名按钮（就地复用，没重复加）',
      win.__buttonState.buttons.filter((b) => b && b.name === BUTTON_NAME).length === 1,
      JSON.stringify(win.__buttonState.buttons));
    check('E2 复用了玩家那条的事件 id', win.__buttonState.events[BUTTON_NAME] === seededId);
    check('E3 复用后仍是可见的', !!ownButton(win) && ownButton(win).visible === true);
    check('E4 点它照样能重试（事件绑在复用的事件 id 上）',
      (win.__buttonState.handlers[seededId] || []).length === 1,
      String((win.__buttonState.handlers[seededId] || []).length));
    await fixed(api);
    await clickButton(win);
    check('E5 修好后按钮仍在、点击通道保持（不会重复堆条目）',
      info(win).visible === true && !!ownButton(win) && info(win).bound === true &&
      win.__buttonState.buttons.filter((b) => b && b.name === BUTTON_NAME).length === 1,
      JSON.stringify(info(win)));
  }

  /* ---------------- F. yielded：常驻按钮仍在，点了也只是重查一遍 ---------------- */
  section('F. yielded（主动让位）：按钮常驻、可点（点了重查一遍冲突）');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    win.__mirror.setGlobalRegexes([
      win.__mirror.nativeRegex('00-别人家的思维链', '/<think>([\\s\\S]*?)<\\/think>/g', { markdownOnly: true }),
    ]);
    await api.refresh();
    await settle();
    check('F1 状态 = yielded', api.status().normalize.state === 'yielded', api.status().normalize.state);
    check('F2 常驻按钮仍在（让位也要看得见状态）',
      !!ownButton(win) && ownButton(win).visible === true, JSON.stringify(win.__buttonState.buttons));
    check('F3 让位态同样绑了点击（v1.4.4：点了是「重查一遍冲突」，不是「重试注入」）',
      ourEventOn(win).length === 1 && info(win).bound === true, JSON.stringify(win.__buttonCalls.eventOn));
    check('F4 mode === "ok"、want === false', info(win).mode === 'ok' && info(win).want === false, JSON.stringify(info(win)));
    // 点一下：仍然让位（冲突还在），但如实告知「让位了」，不是静默也不是报错
    const before = toastCount(win);
    await clickButton(win);
    check('F5 让位态点一下：状态仍是 yielded，并如实播报「让位」（不静默、不 error）',
      api.status().normalize.state === 'yielded' &&
      toasts(win).slice(before).some((t) => t[0] === 'warning' && (t[1].indexOf('让位') !== -1 || t[1].indexOf('yielded') !== -1)) &&
      !toasts(win).slice(before).some((t) => t[0] === 'error'),
      JSON.stringify({ state: api.status().normalize.state, toasts: toasts(win).slice(before) }));
  }

  /* ---------------- G. uninstall()：完整拆卸、顺序正确 ---------------- */
  section('G. uninstall()：完整拆卸（正则/样式/按钮/reasoning），先摘正则再动别的');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    await settle();
    check('G1 前置：装好了、正则装着、按钮可见',
      (api.status().normalize.state === 'installed' || api.status().normalize.state === 'present') &&
      win.__mirror.getGlobalRegexes().some((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0) &&
      info(win).visible === true,
      JSON.stringify({ state: api.status().normalize.state, info: info(win) }));

    const order = [];
    const rawReplace = win.replaceScriptButtons;
    let namesAtButtonWrite = null;
    win.replaceScriptButtons = function (list) {
      order.push('replaceScriptButtons');
      namesAtButtonWrite = win.__mirror.getGlobalRegexes().map((r) => String(r.scriptName));
      return rawReplace(list);
    };

    const ret = api.uninstall();
    await settle();
    check('G2 按钮已不可见', info(win).visible === false, JSON.stringify(info(win)));
    check('G3 归一化正则被摘掉了',
      win.__mirror.getGlobalRegexes().every((r) => String(r.scriptName).indexOf('银月 · 思维链归一') !== 0),
      JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
    check('G4 顺序对：动按钮时正则已经不在了（先摘正则，避免正文留字面 wrapper）',
      !!namesAtButtonWrite && namesAtButtonWrite.every((n) => n.indexOf('银月 · 思维链归一') !== 0),
      JSON.stringify(namesAtButtonWrite));
    check('G5 样式也摘掉了（不留孤儿样式）',
      !win.document.getElementById('reasoning-style-sm-test'));
    check('G6 uninstall() 顺手放弃了归属（下一份实例不会误判「已有更新的在跑」而让位）',
      win.top.__silverMoonOwner === undefined, JSON.stringify(win.top.__silverMoonOwner));
    check('G7 uninstall() 返回 true（有明确回执，不是 undefined）', ret === true, String(ret));
    check('G8 拆卸时确实动过按钮列表（replaceScriptButtons 被调用）',
      order.indexOf('replaceScriptButtons') !== -1, JSON.stringify(order));

    // ---- v1.4.4：卸载必须是**粘性**的 ----
    const hasOurs = () => hasOursRegex(win);
    const passiveLeft = ['app_ready', 'chat_id_changed', 'settings_loaded']
      .map((n) => ((win.__buttonState.handlers[n] || []).length));
    check('G9 卸载时把被动监听全解绑了（eventOn 的句柄真的被 stop，不是丢掉句柄）',
      passiveLeft.every((n) => n === 0), JSON.stringify({ handlers: passiveLeft }));

    // 就算有谁漏网：把残留处理函数全调一遍、再走 visibilitychange 与 silver-moon:sync，
    // 也不许把按钮/正则装回来（uninstall 之后 app_ready 会把东西装回来是 v1.4.3 的真 bug）
    for (const n of ['app_ready', 'chat_id_changed', 'settings_loaded']) {
      for (const fn of (win.__buttonState.handlers[n] || []).slice()) { try { fn(); } catch (_) { /* noop */ } }
    }
    win.document.dispatchEvent(new win.Event('visibilitychange'));
    win.dispatchEvent(new win.Event('silver-moon:sync'));
    await settle();
    check('G10 卸载后再来被动事件，正则和按钮都不会被装回来',
      !hasOurs() && !shown(win) && info(win).mode === 'ok',
      JSON.stringify({ regexes: win.__mirror.getGlobalRegexes().map((r) => r.scriptName), buttons: win.__buttonState.buttons }));
    check('G11 卸载后状态如实变成 off（不再自称 installed/present）',
      api.status().normalize.state === 'off' && api.status().owner.mine === false,
      JSON.stringify({ state: api.status().normalize.state, owner: api.status().owner }));

    // install() 要能把「已卸载」状态重新武装起来
    await api.install();
    await settle();
    check('G12 install() 之后重新装上：正则回来、按钮回来、被动监听重新绑上',
      hasOurs() && shown(win) && api.status().normalize.state !== 'off' &&
      (win.__buttonState.handlers['app_ready'] || []).length >= 1,
      JSON.stringify({ state: api.status().normalize.state, handlers: (win.__buttonState.handlers['app_ready'] || []).length }));
  }

  /* ---------------- G2. 非归属实例 uninstall：摘自己的，不碰别人的 reasoning ---------------- */
  section('G2. 被接管的实例 uninstall：只摘自己的东西，别人的 reasoning 配置不许动');
  {
    // 造一个「别人的归属 + 别人铺的 reasoning 配置」的现场，然后让这一份 uninstall。
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    await settle();
    // 换成「另一个实例在管」：instance 不是我们的，版本相同
    win.top.__silverMoonOwner = { instance: 'other#9', id: 'other-instance', version: SRC_VERSION, ts: Date.now() };
    // 别人铺的 reasoning 配置
    win.__mirror.power_user.reasoning = { auto_parse: true, prefix: '[别家前缀]', suffix: '</别家后缀>' };
    const ret = api.uninstall();
    await settle();
    check('G2-1 仍然摘掉自己那份归一化正则（按名字认，不会伤到别人）', !hasOursRegex(win),
      JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
    check('G2-2 但绝不还原 reasoning 配置（那是别人铺的，还原就是拆别人的台）',
      win.__mirror.power_user.reasoning.prefix === '[别家前缀]' &&
      win.__mirror.power_user.reasoning.suffix === '</别家后缀>',
      JSON.stringify(win.__mirror.power_user.reasoning));
    check('G2-3 也不去删别人的归属登记',
      win.top.__silverMoonOwner && win.top.__silverMoonOwner.instance === 'other#9',
      JSON.stringify(win.top.__silverMoonOwner));
    check('G2-4 回执是真话：我确实摘了自己的东西 → true', ret === true, String(ret));
  }

  /* ---------------- J. 秋青那套形状：外层 <thinking> 套着 [metacognition] ---------------- */
  section('J. 秋青那套形状（<thinking> + [metacognition] + </thinking>）也要能缩进块里');
  {
    const env = await makeEnv({ withButtonApi: false });
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    check('J0 前提：归一化装好了', api.status().normalize.state === 'installed' || api.status().normalize.state === 'present',
      api.status().normalize.state);

    // 用户原话里那份形状，逐字搬过来：
    //   <thinking>
    //   [metacognition]
    //   [思维链内容，必须思考每一条不得跳过！]
    //   </thinking>{{getvar::timeline}}
    const RAW =
      '<thinking>\n[metacognition]\n[思维链内容，必须思考每一条不得跳过！]\n</thinking>{{getvar::timeline}}\n\n真正的正文。';
    const m = win.__mirror.receive(0, RAW);
    const reasoning = String(m.extra.reasoning || '');
    check('J1 整段被认出来（第 6 对 [metacognition]→</thinking> 吃下外层 <thinking>）',
      reasoning.indexOf('[思维链内容，必须思考每一条不得跳过！]') !== -1, JSON.stringify(reasoning));
    check('J2 里面那行 [metacognition] 原样留在思维链正文里',
      reasoning.indexOf('[metacognition]') === 0, JSON.stringify(reasoning.slice(0, 40)));
    check('J3 正文被摘出来，只剩正文 + 那个宏',
      m.mes.indexOf('真正的正文') !== -1 && m.mes.indexOf('<thinking>') === -1,
      JSON.stringify(m.mes));
    check('J4 恰好一个思维链块', blockInfo(win, 0).count === 1, JSON.stringify(blockInfo(win, 0)));
    check('J5 正文里 0 处残留 canonical wrapper',
      leakCount(win, api.config.canonicalPrefix, api.config.canonicalSuffix) === 0,
      'leak=' + leakCount(win, api.config.canonicalPrefix, api.config.canonicalSuffix));

    // {{getvar::timeline}} 是扩展宏，不是格式的一部分；本机没装那个扩展，
    // 所以它只会原样躺着 —— 这里明确钉一下「银月不会去动它」。
    check('J6 宏 {{getvar::timeline}} 原样留着，银月不去展开/吞掉它',
      m.mes.indexOf('{{getvar::timeline}}') !== -1, JSON.stringify(m.mes));

    // 另外两种常见变体，一起钉住（都走同一对 [metacognition] → </thinking>）
    const bare = win.__mirror.receive(1, '[metacognition]\n秋青式裸包裹\n</thinking>\n\n正文A');
    check('J7 裸 [metacognition]…</thinking> 一样能认',
      String(bare.extra.reasoning || '').indexOf('秋青式裸包裹') !== -1, JSON.stringify(bare.extra.reasoning));
    const plain = win.__mirror.receive(2, '<think>\n裸 think 包裹\n</think>\n\n正文B');
    check('J8 只写成 <think> 的预设也一样能认（第 1 对）',
      String(plain.extra.reasoning || '').indexOf('裸 think 包裹') !== -1, JSON.stringify(plain.extra.reasoning));
  }

  /* ---------------- H. 静态接线检查 ---------------- */
  section('H. 静态接线');
  {
    const src = fs.readFileSync(TARGET, 'utf8');
    check('H1 init 里 syncLeadingThink().then(syncInjectButton)',
      /syncLeadingThink\(\)\.then\(syncInjectButton\)/.test(src));
    check('H2 cleanup（完整拆卸）的顺序：先摘正则，再样式、按钮，最后（且只有归属者才）还原 reasoning',
      /removeNormalizeRegex\(\);\s*\n\s*removeStyle\(\);\s*\n\s*hideInjectButton\(\);[\s\S]{0,500}?restoreReasoningConfig\(\);/.test(src));
    check('H2a2 卸载会停掉被动监听（stopPassiveSyncTriggers）并把 disposed 置真',
      /function stopPassiveSyncTriggers\(\)/.test(src) && /disposed = true;/.test(src) &&
      /stopPassiveSyncTriggers\(\);/.test(src));
    check('H2a3 自愈与按钮同步都看 disposed / stillOwner（同版本双实例不再互相抢装）',
      /if \(disposed \|\| !ownsInstance \|\| !stillOwner\(\)\) return;/.test(src) &&
      /if \(disposed\) return;\s*\n\s*if \(injectRetrying\) return;/.test(src));
    check('H2a4 归属标记带 per-instance 身份（同版本也能判「还是不是我」）',
      /INSTANCE_ID/.test(src) && /function shouldYieldTo/.test(src) && /instance: INSTANCE_ID/.test(src));
    check('H2a5 闭合规则不再只看「开头是不是 canonical」（否则 [metacognition]…[/metacognition] 永远归一不了）',
      /guardClosed/.test(src) && /\(\?!\" \+ cp \+ \"\[\\\\s\\\\S\]\*\?\" \+ cs \+ \"\)/.test(src));
    check('H2b pagehide 绑的是 onPageHide（只放归属），不是 cleanup（会拆掉新实例的成果）',
      /addEventListener\("pagehide",\s*onPageHide\)/.test(src) &&
      !/addEventListener\("pagehide",\s*cleanup\)/.test(src));
    check('H2c init 开头不再调 cleanup()（那就是跨 iframe 互拆的源头）',
      !/function init\(\) \{\s*\n\s*cleanup\(\);/.test(src));
    check('H2d 归属权接线在：OWNER_KEY + 版本比较',
      /OWNER_KEY/.test(src) && /function versionRank/.test(src) && /writeOwner\(\)/.test(src));
    check('H2e 被动兜底里带自愈（resyncIfStripped）',
      /resyncIfStripped\(\)/.test(src) && /function resyncIfStripped/.test(src));
    check('H3 暴露了 retryInject', /retryInject:\s*onInjectButtonClick/.test(src));
    check('H4 没有引入定时器兜底（无 setInterval）', !/setInterval/.test(src));
    check('H5 VERSION 是 1.4 系列', /const VERSION = "1\.4(\.\d+)?"/.test(src), (src.match(/const VERSION = "([^"]+)"/) || [])[1]);    check('H6 绑事件用的是 eventOn（真名），不是 listenEvent',
      /bareGlobal\("eventOn"\)/.test(src) && !/bareGlobal\("listenEvent"\)/.test(src));
    check('H7 不调用 registerScriptButton（4.11.3 里没这个全局；注释里提它不算）',
      !/(bareGlobal|window|globalThis)\s*[\.\[(]?\s*["']?registerScriptButton/.test(src));
    check('H8 写按钮走 replaceScriptButtons + getScriptButtons 回读校验',
      /bareGlobal\("replaceScriptButtons"\)/.test(src) && /bareGlobal\("getScriptButtons"\)/.test(src));
    check('H9 回读校验后会把结果写进 injectButton().storeReady',
      /storeReady/.test(src));
    check('H10 storeReady 用到 visibilitychange 兜底', /visibilitychange/.test(src));
    check('H11 按钮配置里只有 name + visible（schema 里没有 description）',
      !/description:\s*CONFIG\.injectButtonDescription/.test(src.replace(/[\s\S]*?function registerInjectButton/, '')));
    check('H12 常驻开关真的接线了（injectButtonAlways 不只是暴露字段）',
      /if \(!mode && !CONFIG\.injectButtonAlways\)/.test(src));
  }

  /* ---------------- K. 导入用的 json：里面的 content 就是现在这份源码 ---------------- */
  section('K. 导入用 json（酒馆助手脚本-明月.json）');
  {
    const JSON_FILE = path.join(ROOT, '思维链', '银月', '酒馆助手脚本-明月.json');
    const src = fs.readFileSync(TARGET, 'utf8').replace(/^\uFEFF/, '');
    if (!fs.existsSync(JSON_FILE)) {
      check('K0 json 存在', false, JSON.stringify(JSON_FILE));
    } else {
      const raw = fs.readFileSync(JSON_FILE, 'utf8');
      let obj = null;
      let parseErr = null;
      try { obj = JSON.parse(raw); } catch (e) { parseErr = String(e.message); }
      check('K1 是合法 JSON', !!obj, parseErr === null ? 'ok' : parseErr);
      check('K2 没有 BOM', raw.charCodeAt(0) !== 0xfeff);
      if (obj) {
        check('K3 content 与 silver-moon.js 逐字一致（含换行）',
          obj.content === src,
          JSON.stringify({ jsonLen: obj.content.length, srcLen: src.length }));
        check('K4 content 不带 BOM', obj.content.charCodeAt(0) !== 0xfeff);
        check('K5 VERSION 与源码一致',
          (obj.content.match(/const VERSION = "([^"]+)"/) || [])[1] ===
          (src.match(/const VERSION = "([^"]+)"/) || [])[1],
          (obj.content.match(/const VERSION = "([^"]+)"/) || [])[1]);
        check('K6 按钮通道开着（button.enabled === true，否则脚本运行时写不进按钮）',
          !!(obj.button && obj.button.enabled === true), JSON.stringify(obj.button));
        check('K7 导出时带上按钮（export_with.button === true）',
          !!(obj.export_with && obj.export_with.button === true), JSON.stringify(obj.export_with));
        check('K8 是 script 类型、名字是明月',
          obj.type === 'script' && obj.name === '明月', obj.type + '/' + obj.name);
        check('K9 明确不含 registerScriptButton（别再把这名字带出去）',
          !/registerScriptButton/.test(obj.content));

        // 这份 json 的代码真的能被脚本引擎接受吗（不是只比字符串）
        let compiled = null;
        try { compiled = new Function(obj.content); } catch (e) { compiled = String(e.message); }
        check('K10 content 能被 JS 引擎编译通过', typeof compiled === 'function',
          typeof compiled === 'function' ? 'ok' : String(compiled));
      }
    }
  }

  /* ---------------- L. injectButtonAlways:false → 退回「只在没注入上时露面」 ---------------- */
  section('L. injectButtonAlways=false：退回 v1.4 的「失败才露面」');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;

    // 默认（常驻）：装好之后按钮也在 —— 先确认这条，作为对照
    check('L1 默认 injectButtonAlways === true，装好后按钮仍可见',
      info(win).always === true && info(win).visible === true, JSON.stringify(info(win)));

    // 关掉常驻 + 让注入失败 → 按钮应该出现（这是 v1.4 的老行为，不能一起关坏）
    api.config.injectButtonAlways = false;
    await broke(api);
    check('L2 关掉常驻后、注入失败时按钮照样出现（可重试）',
      info(win).always === false && info(win).mode === 'retry' && info(win).visible === true &&
      !!ownButton(win), JSON.stringify(info(win)));

    // 再修好 → 按钮应该被撤下（v1.4 语义：成功即消失）
    await fixed(api);
    check('L3 修好后按钮被撤下（visible === false，条目留着但不露面）',
      info(win).mode === 'ok' && info(win).visible === false,
      JSON.stringify({ info: info(win), buttons: win.__buttonState.buttons }));

    // 恢复默认，避免影响后面的断言（这个 env 之后不再用，但保持干净）
    api.config.injectButtonAlways = true;
    await api.refresh();
    await settle();
  }

  /* ---------------- M. 归属权：让位 / 接管 / 同窗口重复加载 ---------------- */
  section('M. 多实例归属权：更新的让老版本让位，老版本不许抢，同一窗口不许跑两遍');
  {
    // M1：已经有一份**更新**的在跑 → 这一份什么都不做
    const envOld = await makeEnv({ preOwner: { version: '9.9.9' } });
    const wOld = envOld.win;
    check('M1a 让位：没有暴露 __silverMoon（不接管）', !wOld.__silverMoon, String(!!wOld.__silverMoon));
    check('M1b 让位：没有往 ST 里写我们的归一化正则',
      wOld.__mirror.getGlobalRegexes().every((r) => String(r.scriptName).indexOf('银月 · 思维链归一') !== 0),
      JSON.stringify(wOld.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
    check('M1c 让位：没有注入样式', !wOld.document.getElementById('reasoning-style-sm-test'));
    check('M1d 让位：没有写按钮', !ownButton(wOld), JSON.stringify(wOld.__buttonState.buttons));
    check('M1e 让位：别人的归属标记原样留着（没被我们改掉）',
      wOld.top.__silverMoonOwner && wOld.top.__silverMoonOwner.version === '9.9.9',
      JSON.stringify(wOld.top.__silverMoonOwner));
    check('M1f 让位时有 warn 说明（不是静默消失）',
      envOld.logs.some((l) => l.indexOf('让位') !== -1), JSON.stringify(envOld.logs.filter((l) => l.indexOf('SilverMoon') !== -1)));

    // M2：老版本在跑 → 我们接管（版本号说话）
    const envNew = await makeEnv({ preOwner: { version: '1.0.0' } });
    const wNew = envNew.win;
    const apiNew = wNew.__silverMoon;
    check('M2a 接管：这一份装上了正则', !!apiNew &&
      wNew.__mirror.getGlobalRegexes().some((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0),
      JSON.stringify(wNew.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
    check('M2b 接管：归属标记换成我们的了（带 per-instance 身份）',
      wNew.top.__silverMoonOwner && wNew.top.__silverMoonOwner.id !== 'other-instance' &&
      wNew.top.__silverMoonOwner.instance && wNew.top.__silverMoonOwner.version === SRC_VERSION,
      JSON.stringify(wNew.top.__silverMoonOwner));
    check('M2c status().owner 说「我在管」', apiNew.status().owner.mine === true,
      JSON.stringify(apiNew.status().owner));

    // M3：同一个 window 里被跑第二遍（重复 import）→ 必须被挡掉，绝不能堆出重复正则
    const envDup = await makeEnv();
    const wDup = envDup.win;
    const before = wDup.__mirror.getGlobalRegexes().length;
    const oursBefore = wDup.__mirror.getGlobalRegexes()
      .filter((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0).length;
    try { wDup.eval(fs.readFileSync(TARGET, 'utf8')); } catch (e) { check('M3a 第二遍执行不该抛错', false, String(e && e.message)); }
    await settle();
    const oursAfter = wDup.__mirror.getGlobalRegexes()
      .filter((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0).length;
    check('M3a 第二遍执行没抛错', true);
    check('M3b 第二遍被挡掉：正则没有变成双份', oursAfter === oursBefore,
      JSON.stringify({ before, oursBefore, oursAfter, all: wDup.__mirror.getGlobalRegexes().map((r) => r.scriptName) }));
    check('M3c 第二遍被挡掉时有 warn 说明',
      envDup.logs.some((l) => l.indexOf('已经跑过一份') !== -1),
      JSON.stringify(envDup.logs.filter((l) => l.indexOf('SilverMoon') !== -1)));

    // M4：**同版本**的两份实例（脚本库那份 + CDN 那份，或 iframe 重建的瞬间）
    //     v1.4.4 起靠 per-instance 身份 + 启动时刻分高低；以前只比版本号 → 谁都不让位、互相抢。
    const envLater = await makeEnv({ preOwner: { instance: 'other#later', version: SRC_VERSION, ts: Date.now() + 60000 } });
    check('M4a 同版本、对方更晚启动 → 让位（不再两份一起抢共享设置）',
      !envLater.win.__silverMoon && !hasOursRegex(envLater.win),
      JSON.stringify({ owner: envLater.win.top.__silverMoonOwner }));

    const envOlder = await makeEnv({ preOwner: { instance: 'other#older', version: SRC_VERSION, ts: 1 } });
    const wOlder = envOlder.win;
    check('M4b 同版本、对方更早启动 → 接管，且归属记到我们名下',
      !!wOlder.__silverMoon && hasOursRegex(wOlder) &&
      wOlder.top.__silverMoonOwner.instance !== 'other#older' &&
      wOlder.top.__silverMoonOwner.version === SRC_VERSION,
      JSON.stringify(wOlder.top.__silverMoonOwner));

    // M5：被接管之后自愈不许再抢装（stillOwner() 是唯一判据）
    const envTaken = await makeEnv();
    const wTaken = envTaken.win;
    const apiTaken = wTaken.__silverMoon;
    await apiTaken.refresh();
    await settle();
    wTaken.top.__silverMoonOwner = { instance: 'other#9', id: 'other-instance', version: SRC_VERSION, ts: Date.now() };
    wTaken.__mirror.setGlobalRegexes(
      wTaken.__mirror.getGlobalRegexes().filter((r) => String(r.scriptName).indexOf('银月 · 思维链归一') !== 0));
    for (const fn of (wTaken.__buttonState.handlers['app_ready'] || []).slice()) { try { fn(); } catch (_) { /* noop */ } }
    await settle();
    check('M5 被接管后自愈不再抢装（stillOwner() 为假就不动手，v1.4.4 前会两边一起装）',
      !hasOursRegex(wTaken),
      JSON.stringify(wTaken.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
  }

  /* ---------------- N. pagehide 只放弃归属：绝不拆掉共享设置；被拆了能自愈 ---------------- */
  section('N. pagehide 非破坏性 + 自愈（这次「缩不进去 / 美化消失」的正主）');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    await settle();
    const stBefore = api.status();
    check('N1 前置：装好了、样式在、按钮在',
      (stBefore.normalize.state === 'installed' || stBefore.normalize.state === 'present') &&
      !!win.document.getElementById('reasoning-style-sm-test') &&
      info(win).visible === true,
      stBefore.normalize.state);

    // 模拟「酒馆助手重建脚本 iframe」：新实例已经 init 完，旧 iframe 的 pagehide 才到
    win.dispatchEvent(new win.Event('pagehide'));
    await settle();
    check('N2 pagehide 后归一化正则**还在**（旧实例不许拆新实例的成果）',
      win.__mirror.getGlobalRegexes().some((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0),
      JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
    check('N3 pagehide 后 reasoning 配置**还是**归一化那对（没被还原成 ST 默认）',
      !!win.__mirror.power_user.reasoning &&
      String(win.__mirror.power_user.reasoning.prefix) === '[metacognition]' &&
      String(win.__mirror.power_user.reasoning.suffix) === '</thinking>',
      JSON.stringify(win.__mirror.power_user.reasoning));
    check('N4 pagehide 后样式**还在**（美化不会时有时无）',
      !!win.document.getElementById('reasoning-style-sm-test'));
    check('N5 pagehide 只放弃归属', win.top.__silverMoonOwner === undefined,
      JSON.stringify(win.top.__silverMoonOwner));

    // 样式单独被外力摘掉（v1.2 那种老实例的 cleanup 会按同一个 STYLE_ID 删样式，
    // 用户看到的就是「明月本身也不美化了」）→ 被动事件要能只补样式，不重装正则。
    win.document.getElementById('reasoning-style-sm-test').remove();
    check('N5b 前置：样式被外力摘掉了，正则还在',
      !win.document.getElementById('reasoning-style-sm-test') &&
      win.__mirror.getGlobalRegexes().some((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0));
    for (const fn of (win.__buttonState.handlers['app_ready'] || [])) { try { fn(); } catch (_) { /* noop */ } }
    await settle();
    check('N5c 自愈：样式补回来了（「明月不美化」也会自己好）',
      !!win.document.getElementById('reasoning-style-sm-test'));
    check('N5d 补样式没顺手把正则重装一遍（还是 2 条，没堆重复）',
      win.__mirror.getGlobalRegexes().filter((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0).length === 2,
      JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));

    // 自愈：被别的实例/设置重载摘掉正则 → app_ready 这类被动事件会补装回来
    win.__mirror.setGlobalRegexes(
      win.__mirror.getGlobalRegexes().filter((r) => String(r.scriptName).indexOf('银月 · 思维链归一') !== 0));
    check('N6 前置：正则被外力摘光了',
      win.__mirror.getGlobalRegexes().every((r) => String(r.scriptName).indexOf('银月 · 思维链归一') !== 0),
      JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
    const appReady = win.__buttonState.handlers['app_ready'] || [];
    for (const fn of appReady) { try { fn(); } catch (_) { /* noop */ } }
    await settle();
    await settle();
    check('N7 自愈：被动事件后正则补回来了（不用再去脚本库开关一次脚本）',
      win.__mirror.getGlobalRegexes().some((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0),
      JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
    check('N8 自愈：装一条就够，没堆重复',
      win.__mirror.getGlobalRegexes().filter((r) => String(r.scriptName).indexOf('银月 · 思维链归一') === 0).length === 2,
      JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));

    // 自愈不该在「本该让位」的状态下瞎装：yielded 时外力摘掉就让它摘着
    await broke(api);
    win.__mirror.setGlobalRegexes(
      win.__mirror.getGlobalRegexes().filter((r) => String(r.scriptName).indexOf('银月 · 思维链归一') !== 0));
    for (const fn of (win.__buttonState.handlers['app_ready'] || [])) { try { fn(); } catch (_) { /* noop */ } }
    await settle();
    check('N9 探针没过（probe-failed）时外力摘掉就摘着，不自愈乱装',
      win.__mirror.getGlobalRegexes().every((r) => String(r.scriptName).indexOf('银月 · 思维链归一') !== 0),
      JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
  }

  /* ---------------- O. 无变化不写回：别动不动就重排整段聊天 ---------------- */
  section('O. 规则没变化时不写回（酒馆助手 updateTavernRegexesWith 落地 = saveSettings + 重排聊天）');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    await settle();
    check('O0 前提：两条正则都在位', ourRegexCount(win) === 2 && hasOursRegex(win), String(ourRegexCount(win)));

    const r0 = win.__mirror.stats().renderTriggerCount;
    const s0 = win.__mirror.stats().saveCount;
    await api.refresh();
    await api.refresh();
    await settle();
    check('O1 规则一致时 refresh 两次都不写回（renderTriggerCount / saveCount 都不涨）',
      win.__mirror.stats().renderTriggerCount === r0 && win.__mirror.stats().saveCount === s0,
      JSON.stringify({ renders: [r0, win.__mirror.stats().renderTriggerCount], saves: [s0, win.__mirror.stats().saveCount] }));
    check('O2 跳过的是「写入」，不是「安装」：正则仍在、状态仍是 present',
      ourRegexCount(win) === 2 && api.status().normalize.state !== 'off',
      JSON.stringify({ ours: ourRegexCount(win), state: api.status().normalize.state }));

    // 反过来：规则真的变了就必须写（别把「无变化不写回」做成「永不写回」）
    api.config.normalizeWhileStreaming = false;
    await api.refresh();
    await settle();
    check('O3 关掉流式那条（规则真的变了）→ 必须写回，且旧条目被摘掉（只剩 1 条）',
      win.__mirror.stats().renderTriggerCount > r0 && ourRegexCount(win) === 1,
      JSON.stringify({ renders: [r0, win.__mirror.stats().renderTriggerCount], ours: ourRegexCount(win) }));

    api.config.normalizeWhileStreaming = true;
    await api.refresh();
    await settle();
    check('O4 再打开流式 → 又写回一次，回到 2 条', ourRegexCount(win) === 2, String(ourRegexCount(win)));
  }

  lines.unshift('RESULT: ' + results.filter((r) => r.indexOf('PASS') === 0).length + '/' + results.length + ' PASS');
  const out = results.concat(lines).join('\n') + '\n';
  fs.writeFileSync(OUT, out, 'utf8');
  const failed = results.filter((r) => r.indexOf('FAIL') === 0);
  console.log(out);
  console.log('报告：' + path.relative(ROOT, OUT));
  if (failed.length) {
    console.log('FAILED ' + failed.length + ' 条');
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
