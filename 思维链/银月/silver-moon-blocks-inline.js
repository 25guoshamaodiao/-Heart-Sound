/* eslint-disable no-var */
/**
 * 银月 · 美化块（变体 A：内联样式版）
 * ===============================================================
 * 把原来 9 条「酒馆正则」的美化逻辑，搬到银月这套「一个脚本 + 一段 CSS」
 * 的框架上：
 *
 *   01-小左        02-小右        03-小爱        04-前额叶
 *   05-内心活动    06-时空栏      07-时间结算    08-正文去壳
 *   12-隐藏变量更新
 *
 * 外观：与原正则**一致**——生成同一套 HTML 结构与内联样式。
 *   · 09-剧情选项 不动（它靠酒馆助手的「前端代码块 → iframe」渲染）
 *   · 10 / 10b / 11 不动（提示词侧的精简正则）
 *
 * 原理
 * ---------------------------------------------------------------
 * 自定义标签 `<thinking_left>` 会被酒馆的 DOMPurify 整段删掉（只留正文），
 * 于是「块与块的分界」在 DOM 里就丢了——这正是原来那条巨型否定预查正则
 * 存在的原因。本脚本改为：
 *
 *   1. 自动往「酒馆正则」里装一条极简**标记正则**（只有标签 → `<span
 *      data-sm="tag">` 的位置标记，不含任何样式、不含任何 HTML），
 *      它在酒馆的显示流程里跑，于是分界能穿过 DOMPurify 活到 DOM 里；
 *   2. 消息渲染完成后，本脚本按标记把每一块装配成原来的美化 HTML。
 *
 * 与 silver-moon.js 同一套框架：IIFE + CONFIG + 幂等 init + 干净卸载。
 */
(function () {
  'use strict';

  // ===================== 身份 =====================
  var VERSION = '1.3';
  var SCRIPT_ID = typeof getScriptId === 'function' ? getScriptId() : 'silver_moon_blocks_inline';
  var DONE_ATTR = 'data-sm-blocks';
  var STREAM_ATTR = 'data-sm-streaming';
  // 装配逻辑/标记正则的版本：变了就让所有消息重装一遍（写在 DONE_ATTR 里一起比对）
  var MARKER_SIG = 'sm2';
  var MARKER_ATTR = 'data-sm';
  var VARIANT = 'inline';
  var VARIANT_GLOBAL = '__silverMoonBlocksInline';
  var OTHER_GLOBAL = '__silverMoonBlocksClass';
  var DEBUG = false;

  // ===================== 可配置项 =====================
  var CONFIG = {
    // 是否由本脚本自动往「酒馆正则」里装那条标记正则（推荐开）
    manageMarkerRegex: true,
    // 标记正则放到哪一层：'global'（全局正则）/ 'preset'（预设正则）/ 'character'（角色卡正则）
    markerScope: 'global',
    // 标记正则的名字（在酒馆正则列表里看到的就是它）
    markerScriptName: '银月 · 美化标记（勿删）',
    // 标记正则的替换文本：$1 = "/" 或 ""，$2 = 标签名
    markerReplace: '<span ' + MARKER_ATTR + '="$1$2"></span>',

    // DOM 稳定后延迟多少毫秒再装配（生成结束后的正常节奏）
    debounceMs: 180,
    // 流式生成过程中也装配（块会跟着文字一起长出来）
    streamingRender: true,
    // 流式期间「最多延误多少毫秒」装配：只在同步路被判定为太贵时才用得上
    streamingThrottleMs: 0,
    // 单趟流式装配超过这个毫秒数，就认为跟不动了，本轮改用节流兜底（保护主线程）
    streamSlowMs: 12,
    // 全扫（整屏楼层）一次最多占主线程多少毫秒，剩下的分到下一帧继续
    scanBudgetMs: 8,
    // 流式期间块的展开状态：'partial' = 只把「还在写的那块」展开，写完的收起来；
    //                        'all'     = 全部展开；'none' = 全都不展开（只看折叠头）
    streamingOpen: 'partial',
    // 生成结束的兜底判定：这么久没有新动静就当生成结束
    idleFallbackMs: 12000,
    // 启动后的补渲染时刻（毫秒），用来兜住晚渲染的消息
    initDelays: [0, 300, 900, 1800, 3600, 7000, 12000],
    // 控制台多说一点
    verbose: false,
  };

  // ===================== 块表（唯一事实来源） =====================
  // color / bg 都取自原来正则里的内联样式，改这里就等于改全部。
  var BLOCKS = [
    { tag: 'thinking_left', kind: 'details', label: '小左 · 记忆与逻辑', color: '#5b9bd5', bg: '#5b9bd514', optionalOpen: true },
    { tag: 'thinking_right', kind: 'details', label: '小右 · 情感与关系', color: '#d977a8', bg: '#d977a814' },
    { tag: 'thinking_love', kind: 'details', label: '小爱 · 欲望与身体', color: '#9b7fd4', bg: '#9b7fd414' },
    { tag: 'thinking_director', kind: 'details', label: '前额叶 · 合议与大纲', color: '#c9a227', bg: '#c9a22714' },
    { tag: 'inner', kind: 'inner', label: '她的心里话（点击展开）', color: '#b08d57', bg: '#b08d5712' },
    { tag: 'time', kind: 'pill', color: '#5b9bd5', bg: '#5b9bd514', unwrapCode: true },
    { tag: 'elapsed', kind: 'footer' },
    { tag: 'content', kind: 'unwrap' },
    { tag: 'UpdateVariable', kind: 'variable', label: '变量更新', color: '#6b7280', bg: '#6b728012' },
  ];

  var BLOCK_BY_TAG = Object.create(null);
  BLOCKS.forEach(function (b) {
    BLOCK_BY_TAG[b.tag] = b;
  });

  // 标记正则：唯一作用是给标签打位置标记，不含任何样式与 HTML。
  // 注意：choice 不在里面——09-剧情选项那条正则要用原始 <choice> 标签。
  var MARKER_RE = /<(\/?)(thinking_left|thinking_right|thinking_love|thinking_director|inner|time|elapsed|content|UpdateVariable)>/g;
  var MARKER_FIND_STRING = MARKER_RE.toString();

  // ===================== 小工具 =====================
  function log() {
    if (!DEBUG && !CONFIG.verbose) return;
    try {
      console.log.apply(console, ['[银月·美化块]'].concat(Array.prototype.slice.call(arguments)));
    } catch (_) {
      /* noop */
    }
  }

  function warn(message, error) {
    try {
      console.warn('[银月·美化块] ' + message, error || '');
    } catch (_) {
      /* noop */
    }
  }

  function toast(message, type) {
    try {
      var fn = typeof toastr !== 'undefined' && toastr && toastr[type || 'success'];
      if (typeof fn === 'function') fn.call(toastr, message);
    } catch (_) {
      /* noop */
    }
  }

  function getAppWindow() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) return window.parent;
    } catch (_) {
      /* cross-origin */
    }
    return window;
  }

  function getAppDocument() {
    return getAppWindow().document || document;
  }

  function getST() {
    return typeof SillyTavern !== 'undefined' ? SillyTavern : null;
  }

  function hashText(text) {
    var hash = 2166136261;
    text = String(text || '');
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0) + ':' + text.length;
  }

  function isBlankText(node) {
    return node && node.nodeType === 3 && String(node.nodeValue || '').trim() === '';
  }

  function isBrNode(node) {
    return node && node.nodeType === 1 && String(node.localName || '').toLowerCase() === 'br';
  }

  // 判断一个元素是不是「什么都没有」——只有空白文本 / <br> / 空元素
  function isBlankNode(node) {
    if (!node) return true;
    if (node.nodeType === 3) return String(node.nodeValue || '').trim() === '';
    if (node.nodeType !== 1) return false;
    if (isBrNode(node)) return true;
    for (var i = 0; i < node.childNodes.length; i++) {
      if (!isBlankNode(node.childNodes[i])) return false;
    }
    return true;
  }

  // ===================== 标记正则的自动装卸 =====================
  // 通过酒馆助手（JS-Slash-Runner）的正则 API 管理，退回直接改 extension_settings。
  function getTavernHelper() {
    try {
      if (typeof window !== 'undefined' && window.TavernHelper) return window.TavernHelper;
    } catch (_) {
      /* noop */
    }
    return null;
  }

  function bareGlobal(name) {
    try {
      if (typeof window !== 'undefined' && typeof window[name] === 'function') return window[name];
    } catch (_) {
      /* noop */
    }
    try {
      if (typeof eval === 'function' && typeof eval(name) === 'function') return eval(name); // eslint-disable-line no-eval
    } catch (_) {
      /* noop */
    }
    return null;
  }

  function regexScopeOption() {
    var scope = String(CONFIG.markerScope || 'global');
    if (scope === 'preset') return { type: 'preset', name: 'in_use' };
    if (scope === 'character') return { type: 'character', name: 'current' };
    return { type: 'global' };
  }

  function makeTavernHelperRegex() {
    return {
      id: 'silver-moon-marker',
      script_name: CONFIG.markerScriptName,
      enabled: true,
      find_regex: MARKER_FIND_STRING,
      replace_string: CONFIG.markerReplace,
      trim_strings: [],
      source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
      destination: { display: true, prompt: false },
      run_on_edit: false,
      min_depth: null,
      max_depth: null,
    };
  }

  // 酒馆原生正则格式（直接写 extension_settings.regex 时用）
  function makeNativeRegex() {
    return {
      id: 'silver-moon-marker',
      scriptName: CONFIG.markerScriptName,
      findRegex: MARKER_FIND_STRING,
      replaceString: CONFIG.markerReplace,
      trimStrings: [],
      placement: [2], // 2 = AI 输出
      disabled: false,
      markdownOnly: true, // 只在显示时生效
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    };
  }

  var markerRegexState = 'unknown'; // installed | updated | present | failed | disabled

  function ensureMarkerRegex() {
    if (!CONFIG.manageMarkerRegex) {
      markerRegexState = 'disabled';
      return Promise.resolve(markerRegexState);
    }

    var TH = getTavernHelper();
    var getRegexes = (TH && TH.getTavernRegexes) || bareGlobal('getTavernRegexes');
    var updateRegexes = (TH && TH.updateTavernRegexesWith) || bareGlobal('updateTavernRegexesWith');
    var scope = regexScopeOption();

    if (typeof getRegexes === 'function' && typeof updateRegexes === 'function') {
      return Promise.resolve()
        .then(function () {
          var list = getRegexes(scope) || [];
          var mine = null;
          for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].script_name === CONFIG.markerScriptName) mine = list[i];
          }
          if (mine && mine.find_regex === MARKER_FIND_STRING && mine.replace_string === CONFIG.markerReplace && mine.enabled) {
            markerRegexState = 'present';
            return markerRegexState;
          }
          return Promise.resolve(
            updateRegexes(
              function (regexes) {
                var next = (regexes || []).slice();
                var hit = false;
                for (var i = 0; i < next.length; i++) {
                  if (next[i] && next[i].script_name === CONFIG.markerScriptName) {
                    next[i] = Object.assign({}, next[i], {
                      enabled: true,
                      find_regex: MARKER_FIND_STRING,
                      replace_string: CONFIG.markerReplace,
                      source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
                      destination: { display: true, prompt: false },
                    });
                    hit = true;
                  }
                }
                if (!hit) next.push(makeTavernHelperRegex());
                return next;
              },
              scope,
            ),
          ).then(function () {
            markerRegexState = 'installed';
            clearDoneMarks();
            log('标记正则已写入酒馆正则：' + CONFIG.markerScriptName);
            return markerRegexState;
          });
        })
        .catch(function (error) {
          warn('写标记正则失败，退回原生设置。', error);
          return ensureMarkerRegexNative();
        });
    }

    return Promise.resolve(ensureMarkerRegexNative());
  }

  // 没有酒馆助手的正则 API 时，直接改 extension_settings.regex（酒馆正则扩展读的就是它）
  function ensureMarkerRegexNative() {
    try {
      var context = getST() && getST().getContext ? getST().getContext() : null;
      var settings = context && context.extension_settings;
      if (!settings) {
        markerRegexState = 'failed';
        warnMarkerManual();
        return markerRegexState;
      }
      if (!Array.isArray(settings.regex)) settings.regex = [];
      var found = false;
      for (var i = 0; i < settings.regex.length; i++) {
        var item = settings.regex[i];
        if (item && item.scriptName === CONFIG.markerScriptName) {
          item.findRegex = MARKER_FIND_STRING;
          item.replaceString = CONFIG.markerReplace;
          item.disabled = false;
          item.markdownOnly = true;
          item.promptOnly = false;
          item.placement = [2];
          found = true;
        }
      }
      if (!found) settings.regex.push(makeNativeRegex());
      if (typeof context.saveSettingsDebounced === 'function') context.saveSettingsDebounced();
      markerRegexState = found ? 'present' : 'installed';
      log('标记正则已写入 extension_settings.regex');
      return markerRegexState;
    } catch (error) {
      markerRegexState = 'failed';
      warn('写标记正则失败。', error);
      warnMarkerManual();
      return markerRegexState;
    }
  }

  function warnMarkerManual() {
    warn(
      '没能自动装标记正则，请手动在「酒馆正则」里新建一条，然后**禁用/删除**原来 01~08、12 那几条：\n' +
        '  名字：' +
        CONFIG.markerScriptName +
        '\n  查找正则：' +
        MARKER_FIND_STRING +
        '\n  替换为：' +
        CONFIG.markerReplace +
        '\n  作用范围：AI 输出；勾选「仅格式显示」',
    );
  }

  function removeMarkerRegex() {
    var TH = getTavernHelper();
    var getRegexes = (TH && TH.getTavernRegexes) || bareGlobal('getTavernRegexes');
    var updateRegexes = (TH && TH.updateTavernRegexesWith) || bareGlobal('updateTavernRegexesWith');
    var scope = regexScopeOption();
    if (typeof getRegexes === 'function' && typeof updateRegexes === 'function') {
      return Promise.resolve(
        updateRegexes(function (regexes) {
          return (regexes || []).filter(function (r) {
            return !(r && r.script_name === CONFIG.markerScriptName);
          });
        }, scope),
      ).catch(function (error) {
        warn('卸载标记正则失败。', error);
      });
    }
    try {
      var context = getST() && getST().getContext ? getST().getContext() : null;
      var settings = context && context.extension_settings;
      if (settings && Array.isArray(settings.regex)) {
        settings.regex = settings.regex.filter(function (r) {
          return !(r && r.scriptName === CONFIG.markerScriptName);
        });
        if (typeof context.saveSettingsDebounced === 'function') context.saveSettingsDebounced();
      }
    } catch (error) {
      warn('卸载标记正则失败。', error);
    }
    return Promise.resolve();
  }

  // ===================== 原正则的一键让位 =====================
  // 把还在启用的 01~08 / 12 那几条旧正则停掉（只改 enabled/disabled，随时可还原）。
  var LEGACY_BACKUP_KEY = '__silvermoon_legacy_backup_' + SCRIPT_ID;

  function legacyRegexHit(script) {
    if (!script) return false;
    var name = script.script_name || script.scriptName || '';
    if (name === CONFIG.markerScriptName) return false;
    var find = String(script.find_regex || script.findRegex || '');
    if (!find) return false;
    // 提示词侧的正则（10 / 10b / 11）不动
    var isPromptOnly = false;
    if (script.destination) isPromptOnly = !!script.destination.prompt && !script.destination.display;
    else if (script.promptOnly) isPromptOnly = !!script.promptOnly && !script.markdownOnly;
    if (isPromptOnly) return false;
    // 命中我们管的标签才算
    for (var i = 0; i < BLOCKS.length; i++) {
      var tag = BLOCKS[i].tag;
      if (tag === 'content') continue;
      if (find.indexOf('<' + tag + '>') !== -1 || find.indexOf('</' + tag + '>') !== -1 || find.indexOf('<' + tag + '\\s') !== -1) return true;
    }
    if (find.indexOf('<content>') !== -1) return true;
    return false;
  }

  function migrateLegacy() {
    var TH = getTavernHelper();
    var getRegexes = (TH && TH.getTavernRegexes) || bareGlobal('getTavernRegexes');
    var updateRegexes = (TH && TH.updateTavernRegexesWith) || bareGlobal('updateTavernRegexesWith');
    var scope = regexScopeOption();
    if (typeof getRegexes !== 'function' || typeof updateRegexes !== 'function') {
      toast('没有找到酒馆助手的正则 API，请手动停用 01~08、12', 'warning');
      return Promise.resolve(false);
    }
    return Promise.resolve()
      .then(function () {
        var list = getRegexes(scope) || [];
        var backup = [];
        list.forEach(function (r) {
          if (r && legacyRegexHit(r) && r.enabled) backup.push({ id: r.id, script_name: r.script_name });
        });
        try {
          window[LEGACY_BACKUP_KEY] = backup;
        } catch (_) {
          /* noop */
        }
        if (!backup.length) {
          toast('没有需要让位的旧正则');
          return false;
        }
        return Promise.resolve(
          updateRegexes(function (regexes) {
            (regexes || []).forEach(function (r) {
              if (r && legacyRegexHit(r)) r.enabled = false;
            });
            return regexes;
          }, scope),
        ).then(function () {
          toast('已停用 ' + backup.length + ' 条旧美化正则（可用 migrate 还原）');
          return true;
        });
      })
      .catch(function (error) {
        warn('停用旧正则失败。', error);
        return false;
      });
  }

  function unmigrateLegacy() {
    var TH = getTavernHelper();
    var getRegexes = (TH && TH.getTavernRegexes) || bareGlobal('getTavernRegexes');
    var updateRegexes = (TH && TH.updateTavernRegexesWith) || bareGlobal('updateTavernRegexesWith');
    var scope = regexScopeOption();
    if (typeof getRegexes !== 'function' || typeof updateRegexes !== 'function') return Promise.resolve(false);
    var backup = [];
    try {
      backup = window[LEGACY_BACKUP_KEY] || [];
    } catch (_) {
      /* noop */
    }
    if (!backup.length) {
      toast('没有可还原的记录');
      return Promise.resolve(false);
    }
    return Promise.resolve(
      updateRegexes(function (regexes) {
        (regexes || []).forEach(function (r) {
          if (!r) return;
          var hit = backup.some(function (b) {
            return (b.id && r.id === b.id) || (!b.id && b.script_name === r.script_name);
          });
          if (hit) r.enabled = true;
        });
        return regexes;
      }, scope),
    )
      .then(function () {
        toast('已还原 ' + backup.length + ' 条旧美化正则');
        return true;
      })
      .catch(function (error) {
        warn('还原旧正则失败。', error);
        return false;
      });
  }

  // ===================== 美化块装配 =====================
  // ---- 外壳（与原来正则的 replaceString 逐字一致）----
  function detailsShell(spec) {
    return (
      '<details style="margin:6px 0;border-left:3px solid ' +
      spec.color +
      ';background:' +
      spec.bg +
      ';border-radius:0 8px 8px 0;">' +
      '<summary style="padding:7px 12px;cursor:pointer;color:' +
      spec.color +
      ';font-size:13px;font-weight:500;">' +
      spec.label +
      '</summary>' +
      '<div style="padding:2px 12px 10px;font-size:13px;line-height:1.75;white-space:pre-wrap;opacity:0.88;"></div>' +
      '</details>'
    );
  }

  function innerShell(spec) {
    return (
      '<div style="margin:6px 0;">' +
      '<details style="border-left:2px solid ' +
      spec.color +
      ';background:' +
      spec.bg +
      ';border-radius:0 6px 6px 0;padding:5px 12px;">' +
      '<summary style="cursor:pointer;color:' +
      spec.color +
      ';font-size:12px;list-style:none;">' +
      spec.label +
      '</summary>' +
      '<div style="margin-top:5px;font-size:13px;line-height:1.75;white-space:pre-wrap;opacity:0.88;"></div>' +
      '</details>' +
      '</div>'
    );
  }

  function pillShell(spec) {
    return (
      '<div style="margin:10px 0 16px;">' +
      '<span style="display:inline-block;padding:6px 14px;background:' +
      spec.bg +
      ';border:0.5px solid ' +
      spec.color +
      '59;border-radius:20px;font-size:12px;color:' +
      spec.color +
      ';letter-spacing:0.4px;"></span>' +
      '</div>'
    );
  }

  function variableShell() {
    return (
      '<details style="margin:6px 0;border-left:3px solid #6b7280;background:#6b728012;border-radius:0 8px 8px 0;">' +
      '<summary style="cursor:pointer;padding:6px 12px;font-size:12px;color:#9aa3ad;letter-spacing:0.5px;list-style:none;outline:none;">变量更新</summary>' +
      '<div style="padding:6px 12px 10px;font-size:12.5px;line-height:1.75;white-space:pre-wrap;opacity:.7;"></div>' +
      '</details>'
    );
  }

  // 内容容器：变体 A 不加 class，所以按结构找
  function findSlot(root, kind) {
    if (kind === 'inner') {
      var d = root.querySelector('details');
      return d ? d.lastElementChild : null;
    }
    if (kind === 'pill') return root.querySelector('span');
    return root.lastElementChild; // details / variable 的内容 div
  }

  function buildBlock(spec, frag) {
    if (spec.kind === 'unwrap') return null; // 08-正文去壳：只脱壳，不包壳

    if (spec.kind === 'footer') {
      // 07-时间结算：— $1 —
      var footer = document.createElement('div');
      footer.setAttribute('style', 'margin:12px 0 0;text-align:right;font-size:12px;color:#9a8f6a;letter-spacing:0.3px;');
      footer.appendChild(document.createTextNode('— '));
      footer.appendChild(frag);
      footer.appendChild(document.createTextNode(' —'));
      return footer;
    }

    var html = spec.kind === 'inner' ? innerShell(spec) : spec.kind === 'pill' ? pillShell(spec) : spec.kind === 'variable' ? variableShell() : detailsShell(spec);
    var holder = document.createElement('div');
    holder.innerHTML = html;
    var root = holder.firstElementChild;
    var slot = findSlot(root, spec.kind);
    if (!slot) return root;
    slot.appendChild(frag);
    return root;
  }

  // ---- 区域裁剪：等价于原正则里的 \s* ----
  function trimEdges(node, depth) {
    if (!node || (depth || 0) > 4) return;
    for (;;) {
      var first = node.firstChild;
      if (!first) return;
      if (isBlankText(first) || isBrNode(first)) {
        node.removeChild(first);
        continue;
      }
      if (first.nodeType === 3) {
        var trimmed = String(first.nodeValue || '').replace(/^[\s\u00A0]+/, '');
        if (trimmed !== first.nodeValue) first.nodeValue = trimmed;
        if (!trimmed) {
          node.removeChild(first);
          continue;
        }
        return;
      }
      if (first.nodeType === 1) trimEdges(first, (depth || 0) + 1);
      return;
    }
  }

  function trimEdgesEnd(node, depth) {
    if (!node || (depth || 0) > 4) return;
    for (;;) {
      var last = node.lastChild;
      if (!last) return;
      if (isBlankText(last) || isBrNode(last)) {
        node.removeChild(last);
        continue;
      }
      if (last.nodeType === 3) {
        var trimmed = String(last.nodeValue || '').replace(/[\s\u00A0]+$/, '');
        if (trimmed !== last.nodeValue) last.nodeValue = trimmed;
        if (!trimmed) {
          node.removeChild(last);
          continue;
        }
        return;
      }
      if (last.nodeType === 1) trimEdgesEnd(last, (depth || 0) + 1);
      return;
    }
  }

  // 06-时空栏：原来正则允许内容外面包 ` 或 ```，这里把包住的 code 元素剥掉
  function unwrapCodeWrap(frag) {
    var only = [];
    for (var i = 0; i < frag.childNodes.length; i++) {
      var n = frag.childNodes[i];
      if (isBlankText(n)) continue;
      only.push(n);
    }
    var target = null;
    if (only.length === 1 && only[0].nodeType === 1) {
      var el = only[0];
      var name = String(el.localName || '').toLowerCase();
      if (name === 'code') target = el;
      else if (name === 'p' || name === 'div') {
        var inner = [];
        for (var j = 0; j < el.childNodes.length; j++) {
          if (!isBlankText(el.childNodes[j])) inner.push(el.childNodes[j]);
        }
        if (inner.length === 1 && inner[0].nodeType === 1 && String(inner[0].localName || '').toLowerCase() === 'code') target = inner[0];
      }
    }
    if (!target) return;
    // ``` 包起来时是 <pre><code>…</code></pre>，` 包起来时是 <code>…</code>
    var victim = target;
    var parent = target.parentNode;
    if (parent && parent.nodeType === 1 && String(parent.localName || '').toLowerCase() === 'pre' && parent.parentNode) {
      victim = parent;
      parent = parent.parentNode;
    }
    if (!parent) return;
    parent.replaceChild(document.createTextNode(target.textContent || ''), victim);
  }

  // ---- 标记 → 配对 ----
  function collectMarkers(container) {
    var out = [];
    var nodes = container.querySelectorAll('span[' + MARKER_ATTR + ']');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var value = el.getAttribute(MARKER_ATTR) || '';
      if (!value) continue;
      var close = value.charAt(0) === '/';
      var tag = close ? value.slice(1) : value;
      if (!BLOCK_BY_TAG[tag]) continue;
      out.push({ el: el, tag: tag, close: close, index: i });
    }
    return out;
  }

  function pairMarkers(markers) {
    var openStacks = Object.create(null);
    var pairs = [];
    var orphanCloses = [];
    markers.forEach(function (m) {
      if (!m.close) {
        (openStacks[m.tag] || (openStacks[m.tag] = [])).push(m);
        return;
      }
      var stack = openStacks[m.tag];
      if (stack && stack.length) pairs.push({ tag: m.tag, open: stack.pop(), close: m });
      else orphanCloses.push(m);
    });
    var orphanOpens = [];
    Object.keys(openStacks).forEach(function (tag) {
      openStacks[tag].forEach(function (open) {
        orphanOpens.push(open);
      });
    });
    return { pairs: pairs, orphanCloses: orphanCloses, orphanOpens: orphanOpens };
  }

  function pointBefore(node) {
    return [node.parentNode, Array.prototype.indexOf.call(node.parentNode.childNodes, node)];
  }

  function pointAfter(node) {
    var parent = node.parentNode;
    return [parent, Array.prototype.indexOf.call(parent.childNodes, node) + 1];
  }

  function makeRange(startPoint, endPoint) {
    var range = document.createRange();
    range.setStart(startPoint[0], startPoint[1]);
    range.setEnd(endPoint[0], endPoint[1]);
    return range;
  }

  // 装配一个块，返回被插入的元素（或 null）
  function applyPair(container, spec, startPoint, endPoint) {
    var range = makeRange(startPoint, endPoint);
    var frag = range.extractContents();
    // 取走标记本身
    var inner = frag.querySelectorAll('span[' + MARKER_ATTR + ']');
    for (var i = 0; i < inner.length; i++) {
      if (inner[i].parentNode) inner[i].parentNode.removeChild(inner[i]);
    }
    trimEdges(frag, 0);
    trimEdgesEnd(frag, 0);
    if (spec.unwrapCode) unwrapCodeWrap(frag);

    if (spec.kind === 'unwrap') {
      // 08-正文去壳：把脱壳后的内容原样放回去
      range.insertNode(frag);
      return null;
    }
    var blockEl = buildBlock(spec, frag);
    if (!blockEl) return null;
    range.insertNode(blockEl);
    hoistOutOfParagraph(blockEl, container);
    hoistOutOfList(blockEl, container);
    pruneBlankAncestors(blockEl, container);
    return blockEl;
  }

  // 现状里这些块是「顶层兄弟」：正则产出的 <details> 会被浏览器解析器把所在的
  // <p> 顶开。DOM 里手动插入不会自动顶开，所以这里自己把段落切开——
  // 只处理直接挂在 .mes_text 下的段落，避免把嵌套块（外层的正文容器）拽出来。
  function hoistOutOfParagraph(blockEl, container) {
    var p = blockEl.parentElement;
    if (!p || p === container) return;
    if (String(p.tagName || '').toUpperCase() !== 'P') return;
    if (p.parentElement !== container) return;

    var before = p.cloneNode(false);
    var after = p.cloneNode(false);
    var node = p.firstChild;
    var passed = false;
    while (node) {
      var next = node.nextSibling;
      if (node === blockEl) passed = true;
      else (passed ? after : before).appendChild(node);
      node = next;
    }

    var parent = p.parentNode;
    if (!parent) return;
    // 两半都原样保留（哪怕只剩 <br> 或换行）——现状里这些换行/断行也是留着的，
    // 丢了它们块与块之间的行距会变。只剩断行的半边直接拆掉段落外壳，
    // 让裸的 <br>+换行留在顶层（现状就是这样），免得白多出一个段落的 10px 下边距。
    insertSide(parent, before, p);
    parent.insertBefore(blockEl, p);
    insertSide(parent, after, p);
    parent.removeChild(p);
  }

  function insertSide(parent, side, ref) {
    if (hasOnlyBreaks(side)) {
      while (side.firstChild) parent.insertBefore(side.firstChild, ref);
      return;
    }
    parent.insertBefore(side, ref);
  }

  // 只有 <br> 和空白（没有真正的文字、没有别的元素）
  function hasOnlyBreaks(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3) {
        if (String(node.nodeValue || '').trim() !== '') return false;
        continue;
      }
      if (node.nodeType === 1 && isBrNode(node)) continue;
      return false;
    }
    return true;
  }

  // 除了 exceptEl 这棵子树，node 里还有别的内容吗
  function hasContentBesides(node, exceptEl) {
    if (!node || node === exceptEl) return false;
    if (node.nodeType === 3) return String(node.nodeValue || '').trim() !== '';
    if (node.nodeType !== 1) return false;
    if (isBrNode(node)) return false;
    for (var i = 0; i < node.childNodes.length; i++) {
      if (hasContentBesides(node.childNodes[i], exceptEl)) return true;
    }
    return false;
  }

  // 浏览器解析器偶尔会把我们的块卷进列表项里（整条列表就剩它一个），
  // 那样会多画出一个孤零零的编号，所以把它提到列表外面。
  function hoistOutOfList(blockEl, container) {
    var li = blockEl.parentElement;
    while (li && li !== container && String(li.tagName || '').toUpperCase() !== 'LI') li = li.parentElement;
    if (!li || li === container) return;
    if (hasContentBesides(li, blockEl)) return; // 列表项里还有别的内容：别拆
    var list = li.parentElement;
    if (!list) return;
    var listName = String(list.tagName || '').toUpperCase();
    if (listName !== 'OL' && listName !== 'UL') return;
    if (!container.contains(list)) return;
    if (list.children.length > 1) return; // 列表里还有别的项：别动，免得编号错乱
    var parent = list.parentElement;
    if (!parent) return;
    parent.insertBefore(blockEl, list);
    parent.removeChild(list);
  }

  // 摘掉空的列表外壳（`<ol><li><p></p></li></ol>` 这种）——空列表项照样会画出编号，
  // 就是「块下面孤零零一个 1.」的来源。
  function pruneBlankListShells(root) {
    var lists = root.querySelectorAll('ol, ul');
    for (var i = lists.length - 1; i >= 0; i--) {
      var el = lists[i];
      if (!root.contains(el)) continue;
      if (isBlankNode(el) && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  var KEEP_TAGS = { DETAILS: 1, SUMMARY: 1, LI: 1, UL: 1, OL: 1, TABLE: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, BLOCKQUOTE: 1 };
  function pruneBlankAncestors(el, container) {
    var cur = el.parentElement;
    while (cur && cur !== container && container.contains(cur)) {
      var parent = cur.parentElement;
      var name = String(cur.tagName || '').toUpperCase();
      if (!KEEP_TAGS[name] && isBlankNode(cur)) {
        if (cur.parentNode) cur.parentNode.removeChild(cur);
      }
      cur = parent;
    }
  }

  // ---- 单条消息 ----
  function getRawMessageText(messageEl) {
    var id = Number(messageEl && messageEl.getAttribute('mesid'));
    if (!Number.isFinite(id)) return '';
    // 先走直读 window.chat（最便宜）：高楼层时每条消息都要算签名，别去碰酒馆助手的 API
    try {
      var app = getAppWindow();
      var chat = app.chat;
      if (Array.isArray(chat) && chat[id]) {
        var item = chat[id];
        if (typeof item.mes === 'string' && item.mes) return item.mes;
        var swipeId = Number.isFinite(item.swipe_id) ? item.swipe_id : 0;
        if (Array.isArray(item.swipes)) return String(item.swipes[swipeId] || item.swipes[0] || '');
      }
    } catch (_) {
      /* fallback */
    }
    try {
      if (typeof getChatMessages === 'function') {
        var list = getChatMessages(id, { role: 'assistant', hide_state: 'all', include_swipes: true });
        if (list && list[0]) {
          var msg = list[0];
          if (typeof msg.message === 'string' && msg.message) return msg.message;
          if (typeof msg.mes === 'string' && msg.mes) return msg.mes;
        }
      }
    } catch (_) {
      /* noop */
    }
    return '';
  }

  // streaming = true 表示这是「生成过程中」的那一趟：
  //   · 还没有闭合标签的最后一块，一路装到消息末尾（块跟着文字长出来）
  //   · 按 CONFIG.streamingOpen 决定要不要展开
  //   · 不写 DONE_ATTR（内容每时每刻都在变），只留 STREAM_ATTR 供收尾时判断
  function processContainer(container, streaming) {
    if (!container) return 0;
    var messageEl = container.closest ? container.closest('.mes') : null;

    // 最便宜的快路：文字没变就直接跳过——高楼层时这一条是性能的关键，
    // 它让「没在变的楼层」只花一次属性比较 + 一次文本哈希，不再扫 DOM。
    // （流式那趟不算签名：内容每时每刻都在变，算了也用不上，纯浪费。）
    var signature = '';
    if (!streaming) {
      var rawText = getRawMessageText(messageEl);
      signature = MARKER_SIG + ':' + hashText(rawText || container.textContent || '');
      if (container.getAttribute(DONE_ATTR) === signature) return 0;
    }

    var markers = collectMarkers(container);
    if (!markers.length) {
      if (streaming) {
        // 中途装过一次、这趟没东西可装：记着，等生成结束再收起来
        if (container.querySelector('details')) container.setAttribute(STREAM_ATTR, '1');
        return 0;
      }
      // 本来就没有块的消息也记上签名，下次直接跳过
      container.setAttribute(DONE_ATTR, signature);
      closeStreamedBlocks(container);
      return 0;
    }
    var grouped = pairMarkers(markers);
    // 内层先装配（后出现的 open 先处理），这样外层能把已装配好的块一起搬进去
    var ordered = grouped.pairs.slice().sort(function (a, b) {
      return b.open.index - a.open.index;
    });

    var count = 0;
    var built = [];
    ordered.forEach(function (pair) {
      var spec = BLOCK_BY_TAG[pair.tag];
      if (!spec) return;
      if (!pair.open.el.parentNode || !pair.close.el.parentNode) return;
      if (!container.contains(pair.open.el) || !container.contains(pair.close.el)) return;
      var startPoint = pointBefore(pair.open.el);
      var endPoint = pointAfter(pair.close.el);
      try {
        var made = applyPair(container, spec, startPoint, endPoint);
        if (made) built.push(made);
        count += 1;
      } catch (error) {
        warn('装配 ' + pair.tag + ' 失败，跳过该块。', error);
      }
    });

    // 流式：最后一个标记如果是「还没闭合的块」，就一路装到消息末尾，
    // 这样块会跟着流出来的文字一起长；等闭合标签到了，下一趟会重装成正常块。
    if (streaming && markers.length) {
      var tail = markers[markers.length - 1];
      var tailSpec = tail.close ? null : BLOCK_BY_TAG[tail.tag];
      if (tailSpec && tail.el.parentNode && container.contains(tail.el)) {
        try {
          var partial = applyPair(container, tailSpec, pointBefore(tail.el), [container, container.childNodes.length]);
          if (partial) {
            built.push(partial);
            if (CONFIG.streamingOpen === 'partial' || CONFIG.streamingOpen === 'all') setBlockOpen(partial, true);
          }
          count += 1;
        } catch (error) {
          warn('流式装配 ' + tail.tag + ' 失败。', error);
        }
      }
    }
    if (streaming && CONFIG.streamingOpen === 'all') {
      built.forEach(function (el) {
        setBlockOpen(el, true);
      });
    }

    // 只写了闭合标签（01-小左 的容错）：从上一个标记之后一直捡到闭合标签
    grouped.orphanCloses.forEach(function (closeMarker) {
      var spec = BLOCK_BY_TAG[closeMarker.tag];
      if (!spec || !spec.optionalOpen) return;
      if (!closeMarker.el.parentNode || !container.contains(closeMarker.el)) return;
      var prev = closeMarker.el.previousElementSibling;
      while (prev && !(prev.tagName === 'SPAN' && prev.hasAttribute && prev.hasAttribute(MARKER_ATTR))) prev = prev.previousElementSibling;
      var startPoint;
      if (prev && prev.parentNode) startPoint = pointAfter(prev);
      else startPoint = [container, 0];
      var endPoint = pointAfter(closeMarker.el);
      try {
        applyPair(container, spec, startPoint, endPoint);
        count += 1;
      } catch (error) {
        warn('容错装配 ' + closeMarker.tag + ' 失败。', error);
      }
    });

    // 剩下没人要的标记直接清掉（空 span 本来也不显示，但别留在 DOM 里）
    var leftovers = container.querySelectorAll('span[' + MARKER_ATTR + ']');
    for (var i = leftovers.length - 1; i >= 0; i--) {
      var el = leftovers[i];
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    // 空列表外壳也一并清掉（会画出多余的编号）
    // 收尾：先装的块可能把后装的块挤进列表项/段落里，所以所有块装完后统一再抬一次。
    for (var pass = 0; pass < 3; pass++) {
      built.forEach(function (el) {
        if (!container.contains(el)) return;
        hoistOutOfParagraph(el, container);
        hoistOutOfList(el, container);
        pruneBlankAncestors(el, container);
      });
    }
    pruneBlankListShells(container);

    if (streaming) container.setAttribute(STREAM_ATTR, '1');
    else container.setAttribute(DONE_ATTR, signature);
    return count;
  }

  // 展开/收起我们造的块（外壳可能是 div 包着 details，比如 05-内心活动）
  function setBlockOpen(el, open) {
    if (!el) return;
    if (String(el.tagName || '').toUpperCase() === 'DETAILS') {
      el.open = !!open;
      return;
    }
    var details = el.querySelector ? el.querySelector('details') : null;
    if (details) details.open = !!open;
  }

  // 这个 <details> 是不是我们造的（靠 summary 文案认）
  function isOurDetails(el) {
    var summary = el.querySelector ? el.querySelector('summary') : null;
    if (!summary) return false;
    var text = String(summary.textContent || '').trim();
    for (var i = 0; i < BLOCKS.length; i++) {
      if (BLOCKS[i].label && BLOCKS[i].label === text) return true;
    }
    return false;
  }

  // 生成结束的收尾：把流式期间展开的块收回默认折叠态
  // （正常情况下酒馆会在结束时重排一次，这些块本来就会重建；这里兜住不重排的情况）
  function closeStreamedBlocks(container) {
    if (!container || !container.hasAttribute || !container.hasAttribute(STREAM_ATTR)) return;
    container.removeAttribute(STREAM_ATTR);
    var details = container.querySelectorAll('details');
    for (var i = 0; i < details.length; i++) {
      if (isOurDetails(details[i])) details[i].open = false;
    }
  }

  // ===================== 调度 =====================
  var state = {
    disposed: false,
    generating: false,
    internal: 0,
    debounceTimer: 0,
    msgTimer: 0,
    streamTimer: 0,
    scanTimer: 0,
    idleTimer: 0,
    initTimers: [],
    pendingMessages: [],
    observer: null,
    stopList: [],
    listeners: 0,
  };

  function getMessageElements() {
    var doc = getAppDocument();
    var out = [];
    var nodes = doc.querySelectorAll('#chat > .mes');
    for (var i = 0; i < nodes.length; i++) {
      if (String(nodes[i].getAttribute('is_user')) === 'true') continue;
      if (nodes[i].querySelector('.mes_text')) out.push(nodes[i]);
    }
    return out;
  }

  // 正在编辑的楼层查一次就够（原来是每条消息查一次 #curEditTextarea，高楼层很贵）
  function findEditingMessageEl() {
    try {
      var doc = getAppDocument();
      var textarea = doc.querySelector('#chat #curEditTextarea');
      if (!textarea) return null;
      return textarea.closest ? textarea.closest('.mes') : null;
    } catch (_) {
      return null;
    }
  }

  function processMessageEl(messageEl, editingEl, streaming) {
    if (!messageEl || (editingEl && messageEl === editingEl)) return 0;
    var container = messageEl.querySelector ? messageEl.querySelector('.mes_text') : null;
    if (!container) return 0;
    state.internal += 1;
    try {
      return processContainer(container, !!streaming);
    } catch (error) {
      warn('处理消息失败 mesid=' + messageEl.getAttribute('mesid'), error);
      return 0;
    } finally {
      state.internal -= 1;
    }
  }

  // 流式那一趟只要最后一条助手楼层：从末尾往前找，通常一两下就命中，
  // 不用像全扫那样把整屏楼层都过一遍。
  function getLastMessageElement() {
    var doc = getAppDocument();
    var nodes = doc.querySelectorAll('#chat > .mes');
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (String(nodes[i].getAttribute('is_user')) === 'true') continue;
      if (nodes[i].querySelector('.mes_text')) return nodes[i];
    }
    return null;
  }

  function runScan(reason, streaming) {
    if (state.disposed) return;
    if (streaming) {
      var last = getLastMessageElement();
      if (!last) return;
      var madeStream = processMessageEl(last, findEditingMessageEl(), true);
      if (madeStream > 0) log('装配 ' + madeStream + ' 个块（' + (reason || 'scan') + '/流式）');
      return;
    }
    var list = getMessageElements();
    if (!list.length) return;
    window.clearTimeout(state.scanTimer);
    state.scanTimer = 0;
    runScanChunk(list, 0, findEditingMessageEl(), reason, 0, Date.now());
  }

  // 全扫按时间预算分片：一次最多占主线程 scanBudgetMs，剩下的挪到下一帧继续。
  // 几百层的聊天在加载/切换时就不会卡那一下。
  function runScanChunk(list, startIndex, editingEl, reason, total, startedAt) {
    var i = startIndex;
    var start = startedAt || Date.now();
    for (; i < list.length; i++) {
      if (!list[i].isConnected) continue;
      total += processMessageEl(list[i], editingEl, false);
      if (Date.now() - start > CONFIG.scanBudgetMs) {
        i += 1;
        break;
      }
    }
    if (i < list.length && !state.disposed) {
      state.scanTimer = window.setTimeout(function () {
        state.scanTimer = 0;
        runScanChunk(list, i, editingEl, reason, total, Date.now());
      }, 0);
      return total;
    }
    state.scanTimer = 0;
    if (total > 0) log('装配 ' + total + ' 个块（' + (reason || 'scan') + '）');
    return total;
  }

  // 只处理「刚刚变动过的那几个楼层」（DOM 变动走这条路，不再全聊天扫）
  function runScanMessages(list, reason) {
    if (state.disposed || !list.length) return;
    var editingEl = findEditingMessageEl();
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      if (!list[i].isConnected) continue;
      total += processMessageEl(list[i], editingEl, false);
    }
    if (total > 0) log('装配 ' + total + ' 个块（' + (reason || 'dom') + '）');
  }

  function scheduleMessages(list, reason, delay) {
    if (state.disposed) return;
    for (var i = 0; i < list.length; i++) {
      if (state.pendingMessages.indexOf(list[i]) === -1) state.pendingMessages.push(list[i]);
    }
    window.clearTimeout(state.msgTimer);
    state.msgTimer = window.setTimeout(function () {
      var pending = state.pendingMessages;
      state.pendingMessages = [];
      runScanMessages(pending, reason);
    }, Math.max(0, delay === undefined ? CONFIG.debounceMs : delay));
  }

  // 事件里通常带着楼层号：能定位就只处理那一层，定不到再全扫
  function scheduleFromEventId(id, reason, delay) {
    var num = Number(id);
    if (Number.isFinite(num) && num >= 0) {
      try {
        var mes = getAppDocument().querySelector('#chat > .mes[mesid="' + num + '"]');
        if (mes) {
          scheduleMessages([mes], reason, delay);
          return;
        }
      } catch (_) {
        /* fallthrough */
      }
    }
    schedule(reason, delay);
  }

  // 标记正则变了 / 装配逻辑升级：清掉「已装配」标记，让所有消息重装一遍
  function clearDoneMarks() {
    try {
      var nodes = getAppDocument().querySelectorAll('[' + DONE_ATTR + ']');
      for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute(DONE_ATTR);
    } catch (_) {
      /* noop */
    }
  }

  function schedule(reason, delay) {
    if (state.disposed) return;
    if (state.generating) {
      // 生成中：走流式那一趟（节流，不是防抖，否则一直有 token 就永远不触发）
      scheduleStream();
      return;
    }
    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(function () {
      runScan(reason, false);
    }, Math.max(0, delay === undefined ? CONFIG.debounceMs : delay));
  }

  // 流式：同一时刻只排一趟。默认 streamingThrottleMs = 0，也就是酒馆每次重排之后
  // 立刻装一遍，未装配的原始文本几乎不会露出来；上一趟太慢（机器吃力）就自动放缓。
  var streamCostMs = 0;
  var streamSyncOk = true;
  function scheduleStream() {
    if (state.disposed || !CONFIG.streamingRender) return;
    if (state.streamTimer) return;
    var wait = Math.max(0, CONFIG.streamingThrottleMs || 0);
    if (!streamSyncOk || streamCostMs > CONFIG.streamSlowMs) wait = Math.max(wait, 120);
    state.streamTimer = window.setTimeout(function () {
      state.streamTimer = 0;
      if (state.disposed || !state.generating) return;
      var startedAt = Date.now();
      runScan('stream', true);
      streamCostMs = Date.now() - startedAt;
    }, wait);
  }

  // 同步路：DOM 一变化就在 MutationObserver 回调里装。
  // MutationObserver 回调是微任务，跑在浏览器「这一帧绘制」之前，
  // 所以装好的块会跟酒馆的重排一起出现在同一帧里——这是不闪的关键。
  function runStreamPassSync() {
    if (state.disposed || !CONFIG.streamingRender || !streamSyncOk || state.streamBusy) return;
    state.streamBusy = true;
    var startedAt = Date.now();
    try {
      runScan('stream', true);
    } finally {
      state.streamBusy = false;
    }
    streamCostMs = Date.now() - startedAt;
    if (streamCostMs > CONFIG.streamSlowMs) {
      // 长消息或慢机器：不再同步跟，改用定时兜底，别把主线程占满
      streamSyncOk = false;
      scheduleStream();
      log('流式装配单趟 ' + streamCostMs + 'ms，本轮改用节流兜底');
    }
  }

  function noteActivity(reason) {
    if (state.disposed) return;
    var wasGenerating = state.generating;
    state.generating = true;
    if (!wasGenerating) {
      // 新的一轮生成：重置流式同步路的成本判断
      streamCostMs = 0;
      streamSyncOk = true;
    }
    window.clearTimeout(state.idleTimer);
    state.idleTimer = window.setTimeout(function () {
      if (!state.generating) return;
      state.generating = false;
      window.clearTimeout(state.streamTimer);
      state.streamTimer = 0;
      schedule('idle-fallback', 120);
      log('生成兜底结束（' + (reason || '') + '）');
    }, CONFIG.idleFallbackMs);
  }

  function endGeneration() {
    if (state.disposed) return;
    window.clearTimeout(state.idleTimer);
    window.clearTimeout(state.streamTimer);
    state.streamTimer = 0;
    state.generating = false;
    streamCostMs = 0;
    streamSyncOk = true;
    schedule('generation-ended', 220);
  }

  // 从任意节点找到它所属的楼层元素（找不到就说明不在聊天区里）
  function messageElementOf(node) {
    if (!node) return null;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return null;
    if (el.classList && el.classList.contains('mes')) return el;
    return el.closest ? el.closest('.mes') : null;
  }

  function startObserver() {
    var Observer = getAppWindow().MutationObserver || window.MutationObserver;
    var doc = getAppDocument();
    if (!Observer || !doc.body) return;
    // 观察点收到 #chat 上：楼层之外（输入框、菜单…）的变动直接不看了
    var root = doc.querySelector('#chat') || doc.body;

    state.observer = new Observer(function (mutations) {
      if (state.disposed || state.internal > 0 || state.streamBusy) return;

      // 只挑出「刚刚变动过的那几个楼层」，不再每次变动都全聊天扫
      var dirty = [];
      var broad = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        var mes = messageElementOf(m.target);
        if (!mes) {
          var added = m.addedNodes || [];
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            var hit = messageElementOf(node);
            if (!hit && node.nodeType === 1 && node.querySelector) hit = node.querySelector('.mes');
            if (hit) mes = hit;
            else if (node.nodeType === 1) broad = true; // 整块换掉了（换聊天、加载更多…）
          }
        }
        if (mes && dirty.indexOf(mes) === -1) dirty.push(mes);
      }

      if (state.generating) {
        noteActivity('dom');
        if (CONFIG.streamingRender) {
          if (streamSyncOk) runStreamPassSync();
          else scheduleStream();
        }
        return;
      }

      if (broad || !dirty.length) {
        schedule('dom', CONFIG.debounceMs);
        return;
      }
      scheduleMessages(dirty, 'dom', CONFIG.debounceMs);
    });

    state.observer.observe(root, { childList: true, subtree: true, characterData: true });
    state.stopList.push(function () {
      if (state.observer) state.observer.disconnect();
      state.observer = null;
    });
  }

  function getEventMap() {
    try {
      if (typeof tavern_events !== 'undefined' && tavern_events) return tavern_events;
    } catch (_) {
      /* noop */
    }
    try {
      var source = getST();
      var context = source && source.getContext && source.getContext();
      if (context && context.event_types) return context.event_types;
    } catch (_) {
      /* noop */
    }
    return {};
  }

  function listenEvent(eventName, listener, last) {
    var map = getEventMap();
    var event = map[eventName] || eventName;
    if (!event) return;
    var wrapped = typeof errorCatched === 'function' ? errorCatched(listener) : listener;
    try {
      if (typeof eventOn === 'function') {
        var ret = last && typeof eventMakeLast === 'function' ? eventMakeLast(event, wrapped) : eventOn(event, wrapped);
        if (ret && typeof ret.stop === 'function') state.stopList.push(ret.stop);
        state.listeners += 1;
        return;
      }
    } catch (error) {
      warn('eventOn 绑定失败 ' + eventName, error);
    }
    try {
      var source = getST();
      var context = source && source.getContext && source.getContext();
      var es = context && context.eventSource;
      if (es && typeof es.on === 'function') {
        es.on(event, wrapped);
        state.listeners += 1;
        state.stopList.push(function () {
          if (typeof es.off === 'function') es.off(event, wrapped);
        });
      }
    } catch (error) {
      warn('eventSource 绑定失败 ' + eventName, error);
    }
  }

  function bindEvents() {
    listenEvent('CHAT_CHANGED', function () {
      schedule('chat-changed', 260);
    }, true);
    listenEvent('CHAT_LOADED', function () {
      schedule('chat-loaded', 260);
    }, true);
    listenEvent('chatLoaded', function () {
      schedule('chat-loaded', 260);
    }, true);
    listenEvent('MORE_MESSAGES_LOADED', function () {
      schedule('more-loaded', 320);
    }, true);
    listenEvent('MESSAGE_SWIPED', function () {
      schedule('swiped', 320);
    }, true);
    listenEvent('MESSAGE_EDITED', function () {
      schedule('edited', 260);
    }, true);
    listenEvent('MESSAGE_DELETED', function () {
      schedule('deleted', 260);
    }, true);
    listenEvent('MESSAGE_UPDATED', function (id) {
      if (state.generating) noteActivity('updated');
      else scheduleFromEventId(id, 'updated', 260);
    }, false);
    listenEvent('MESSAGE_RECEIVED', function (id) {
      if (state.generating) noteActivity('received');
      else scheduleFromEventId(id, 'received', 260);
    }, false);
    listenEvent('CHARACTER_MESSAGE_RENDERED', function (id) {
      if (state.generating) noteActivity('rendered');
      else scheduleFromEventId(id, 'rendered', 260);
    }, false);
    listenEvent('GENERATION_STARTED', function () {
      noteActivity('generation-started');
    }, false);
    listenEvent('MESSAGE_SENT', function () {
      noteActivity('message-sent');
    }, false);
    listenEvent('STREAM_TOKEN_RECEIVED', function () {
      noteActivity('stream-token');
    }, false);
    listenEvent('GENERATION_ENDED', endGeneration, false);
    listenEvent('GENERATION_STOPPED', endGeneration, false);
  }

  function scheduleInitDelays() {
    CONFIG.initDelays.forEach(function (delay) {
      var timer = window.setTimeout(function () {
        schedule('init-' + delay, 0);
      }, delay);
      state.initTimers.push(timer);
    });
  }

  // ===================== 兼容性提示 =====================
  function checkCompatibility() {
    // 聊天没打开时不吭声，等事件驱动再处理
    try {
      var doc = getAppDocument();
      return Boolean(doc.querySelector('#chat'));
    } catch (_) {
      return false;
    }
  }

  // 「编码标签」开着的话，酒馆会把消息里的 < > 转义，美化块会整块失效
  // （原来那几条正则也一样会失效），所以明确提示一句。
  function checkEncodeTags() {
    try {
      var box = getAppDocument().getElementById('encode_tags');
      if (box && box.checked) {
        warn('检测到「用户设置 → 编码标签」是开着的：消息里的 HTML 会被转义，美化块不会生效。请把它关掉。');
      }
    } catch (_) {
      /* noop */
    }
  }

  function findLegacyRegexes() {
    var TH = getTavernHelper();
    var getRegexes = (TH && TH.getTavernRegexes) || bareGlobal('getTavernRegexes');
    if (typeof getRegexes !== 'function') return [];
    try {
      var list = getRegexes(regexScopeOption()) || [];
      return list.filter(function (r) {
        return r && r.enabled && legacyRegexHit(r);
      });
    } catch (_) {
      return [];
    }
  }

  function warnLegacyIfAny() {
    var legacy = findLegacyRegexes();
    if (!legacy.length) return;
    var names = legacy.map(function (r) {
      return r.script_name;
    });
    warn(
      '检测到 ' + legacy.length + ' 条旧美化正则还在启用：' + names.join('、') + '\n' +
        '它们和本脚本抢同一批标签（谁先跑谁生效）。想搬干净的话，在控制台执行：\n' +
        '  ' + VARIANT_GLOBAL + '.migrate()    // 停用旧正则（可 unmigrate 还原）',
    );
    toast('银月·美化块：还有 ' + legacy.length + ' 条旧正则在跑，点控制台看提示', 'warning');
  }

  // ===================== 生命周期 =====================
  function exposeDebugApi() {
    try {
      var api = {
        version: 'block-styler A (inline) v' + VERSION,
        variant: VARIANT,
        config: CONFIG,
        blocks: BLOCKS,
        markerRegex: { find: MARKER_FIND_STRING, replace: CONFIG.markerReplace },
        state: state,
        status: function () {
          return {
            markerRegex: markerRegexState,
            generating: state.generating,
            streamingRender: CONFIG.streamingRender,
            streamingOpen: CONFIG.streamingOpen,
            variant: VARIANT,
            legacyEnabled: findLegacyRegexes().map(function (r) {
              return r.script_name;
            }),
          };
        },
        scan: function () {
          runScan('manual', false);
        },
        process: function (messageId, opts) {
          var doc = getAppDocument();
          var el = doc.querySelector('#chat > .mes[mesid="' + String(messageId) + '"] .mes_text');
          if (!el) return 0;
          return processContainer(el, !!(opts && opts.streaming));
        },
        migrate: migrateLegacy,
        unmigrate: unmigrateLegacy,
        uninstallMarkerRegex: removeMarkerRegex,
        installMarkerRegex: ensureMarkerRegex,
        cleanup: cleanup,
        isInside: function (node) {
          return Boolean(node && node.closest && node.closest('[' + DONE_ATTR + ']'));
        },
      };
      getAppWindow()[VARIANT_GLOBAL] = api;
      window[VARIANT_GLOBAL] = api;
      return api;
    } catch (_) {
      return null;
    }
  }

  function cleanup() {
    state.disposed = true;
    state.stopList.forEach(function (fn) {
      try {
        fn();
      } catch (_) {
        /* noop */
      }
    });
    state.stopList = [];
    state.initTimers.forEach(function (t) {
      window.clearTimeout(t);
    });
    state.initTimers = [];
    state.pendingMessages = [];
    window.clearTimeout(state.debounceTimer);
    window.clearTimeout(state.msgTimer);
    window.clearTimeout(state.streamTimer);
    window.clearTimeout(state.scanTimer);
    window.clearTimeout(state.idleTimer);
  }

  function init() {
    if (state.disposed) return;
    cleanup(); // 防御：脚本被重新加载时先清掉旧实例的定时器与监听
    state.disposed = false;

    var app = getAppWindow();
    if (app[OTHER_GLOBAL]) {
      warn('检测到另一个变体（' + OTHER_GLOBAL + '）也在运行，请只装一个，否则会重复装配。');
    }

    checkCompatibility();
    checkEncodeTags();
    exposeDebugApi();
    bindEvents();
    startObserver();
    scheduleInitDelays();
    schedule('init', 0);

    Promise.resolve()
      .then(ensureMarkerRegex)
      .then(function () {
        // 标记正则刚装/刚改，酒馆会重新载入消息，等一下再扫一遍
        schedule('marker-ready', 400);
        setTimeout(warnLegacyIfAny, 1200);
      })
      .catch(function (error) {
        warn('初始化标记正则失败。', error);
      });

    window.addEventListener('pagehide', cleanup);
    log('SilverMoon blocks styler (inline) initialized.');
  }

  if (typeof $ === 'function') {
    $(function () {
      if (typeof errorCatched === 'function') errorCatched(init)();
      else init();
    });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
