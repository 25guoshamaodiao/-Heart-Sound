(function () {
  'use strict';

  var DEBUG = true;
  var SCRIPT_ID = (typeof getScriptId === 'function' ? getScriptId() : 'maya_allinone_v7');
  var STYLE_ID_COT = SCRIPT_ID + '-cot';
  var STYLE_ID_REASONING = SCRIPT_ID + '-reasoning';

  // ========== 环境检测 ==========
  var isInIframe = (function () {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();

  var rootWindow = isInIframe ? window.parent : window;
  var rootDocument = isInIframe ? window.parent.document : document;

  var rootjQuery = null;
  if (isInIframe) {
    try { rootjQuery = rootWindow.$ || null; } catch (e) { rootjQuery = null; }
  } else {
    rootjQuery = (typeof $ !== 'undefined') ? $ : null;
  }

  function getRootDoc() { return isInIframe ? window.parent.document : document; }
  function getRootWindow() { return isInIframe ? window.parent : window; }
  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }
  function updateBlock(id, msg) {
    try {
      if (typeof window.updateMessageBlock === 'function') window.updateMessageBlock(Number(id), msg);
      else if (typeof updateMessageBlock === 'function') updateMessageBlock(Number(id), msg);
    } catch (e) {}
  }

  function getST() { return typeof SillyTavern !== 'undefined' ? SillyTavern : null; }
  function getChatArray() {
    var st = getST();
    if (st && Array.isArray(st.chat)) return st.chat;
    if (Array.isArray(window.chat)) return window.chat;
    return null;
  }
  function getChatMessages(id, opts) {
    try { if (typeof window.getChatMessages === 'function') return window.getChatMessages(id, opts); } catch (e) {}
    return null;
  }

  // =====================================================================
  // REASONING 月相思维链（保持不变）
  // =====================================================================
  var REASONING = {
    domCache: new Map(),
    getConfig: function () {
      var context = getST()?.getContext?.();
      var config = context?.powerUserSettings?.reasoning;
      if (config) {
        return {
          prefix: config.prefix || '-',
          suffix: config.suffix || '  思考结束  ',
          auto_expand: config.auto_expand
        };
      }
      return { prefix: '-', suffix: '  思考结束  ', auto_expand: true };
    },
    injectStyle: function () {
      if (document.getElementById(STYLE_ID_REASONING)) return;
      var style = document.createElement('style');
      style.id = STYLE_ID_REASONING;
      style.textContent = String.raw`
/* 月相思维链样式 */
.mes_reasoning_details { margin: 16px 0 !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; width: 100% !important; background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%) !important; border: 1px solid rgba(148, 163, 184, 0.2) !important; border-radius: 18px !important; box-shadow: 0 4px 24px rgba(251, 191, 36, 0.15), inset 0 1px 0 rgba(148, 163, 184, 0.1) !important; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important; overflow: hidden !important; box-sizing: border-box !important; padding: 0 !important; position: relative !important; }
.mes_reasoning_details::before { content: '' !important; position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background-image: radial-gradient(circle at 20% 30%, rgba(251, 191, 36, 0.08) 1px, transparent 1px), radial-gradient(circle at 70% 60%, rgba(251, 191, 36, 0.06) 1px, transparent 1px) !important; background-size: 40px 40px !important; pointer-events: none !important; animation: stars-drift 3s ease-in-out infinite !important; opacity: 0.4 !important; }
@keyframes stars-drift { 0%, 100% { transform: translateX(0) translateY(0); } 50% { transform: translateX(8px) translateY(4px); } }
.mes_reasoning_summary { position: relative !important; margin: 0 !important; width: 100% !important; box-sizing: border-box !important; padding: 12px 16px !important; background: transparent !important; border: none !important; color: #e2e8f0 !important; font-weight: 500 !important; cursor: pointer !important; outline: none !important; list-style: none !important; display: flex !important; align-items: center !important; justify-content: space-between !important; }
.mes_reasoning_summary::-webkit-details-marker { display: none !important; }
.mes_reasoning_header { background: transparent !important; border: none !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; display: flex !important; align-items: center !important; cursor: pointer !important; flex: 1 !important; }
.mes_reasoning_header::before { content: "🌙" !important; font-size: 1.3rem !important; margin-right: 10px !important; display: inline-block !important; filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.7)) !important; animation: moon-pulse 1.5s ease-in-out infinite !important; min-width: 60px !important; text-align: center !important; }
@keyframes moon-pulse { 0%, 100% { transform: scale(1); filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.7)); } 50% { transform: scale(1.05); filter: drop-shadow(0 0 16px rgba(251, 191, 36, 0.9)); } }
.mes_reasoning_details[data-state="done"] .mes_reasoning_header::before { content: "🌕" !important; animation: none !important; filter: drop-shadow(0 0 12px rgba(176, 212, 255, 0.8)) !important; }
.mes_reasoning_header_title { font-size: 0 !important; cursor: pointer !important; display: flex !important; align-items: center !important; }
.mes_reasoning_details:not([data-state="done"]) .mes_reasoning_header_title::after { content: "思绪如星，散落夜空·" !important; font-size: 1.15rem !important; color: #fde68a !important; text-shadow: 0 0 4px rgba(251, 191, 36, 0.5) !important; font-weight: 500 !important; letter-spacing: 1px !important; white-space: pre !important; animation: thinking-dots 1.5s steps(3, end) infinite !important; }
@keyframes thinking-dots { 0% { content: "思绪如星，散落夜空·"; } 33% { content: "思绪如星，散落夜空··"; } 66% { content: "思绪如星，散落夜空···"; } }
.mes_reasoning_details[data-state="done"] .mes_reasoning_header_title::after { content: "月满如镜，思绪澄明" !important; font-size: 1.15rem !important; font-family: 'Noto Serif SC', 'STKaiti', '楷体', 'KaiTi', serif !important; font-weight: 600 !important; color: #e9d5ff !important; text-shadow: 0 0 8px rgba(123, 164, 235, 0.5) !important; letter-spacing: 1px !important; animation: none !important; }
.mes_reasoning { padding: 16px 24px !important; margin: 0 !important; border: none !important; border-top: 1px solid rgba(148, 163, 184, 0.2) !important; background: rgba(15, 23, 42, 0.3) !important; color: #cbd5e1 !important; font-size: 0.95em !important; line-height: 1.7 !important; max-height: 400px !important; overflow-y: auto !important; white-space: pre-wrap !important; }
.mes_reasoning::-webkit-scrollbar { width: 6px !important; }
.mes_reasoning::-webkit-scrollbar-track { background: #0f172a !important; }
.mes_reasoning::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.3) !important; border-radius: 3px !important; }
      `;
      document.head.appendChild(style);
      try {
        var topDoc = window.top?.document;
        if (topDoc && !topDoc.getElementById(STYLE_ID_REASONING)) {
          var ts = topDoc.createElement('style');
          ts.id = STYLE_ID_REASONING;
          ts.textContent = style.textContent;
          topDoc.head.appendChild(ts);
        }
      } catch (e) {}
    },
    extract: function (text) {
      if (!text) return { reasoning: '', cleaned: text, state: 'none' };
      var config = REASONING.getConfig();
      var prefix = config.prefix;
      var suffix = config.suffix;
      if (!prefix || !suffix) return { reasoning: '', cleaned: text, state: 'none' };
      var escPrefix = escapeRegExp(prefix);
      var escSuffix = escapeRegExp(suffix);
      var fullRe = new RegExp(escPrefix + '\\s*([\\s\\S]*?)\\s*' + escSuffix, 'i');
      var fullMatch = text.match(fullRe);
      if (fullMatch) {
        return { reasoning: fullMatch[1].trim(), cleaned: text.replace(fullMatch[0], '').trim(), state: 'done' };
      }
      if (text.includes(prefix) && !text.includes(suffix)) {
        var idx = text.indexOf(prefix);
        var after = text.slice(idx + prefix.length);
        var contentIdx = after.indexOf('<content>');
        if (contentIdx !== -1) after = after.slice(0, contentIdx);
        return { reasoning: after.trim(), cleaned: text.slice(0, idx).trim(), state: 'thinking' };
      }
      return { reasoning: '', cleaned: text, state: 'none' };
    },
    applyToMessageData: function (messageId, force) {
      var chat = getChatArray();
      if (!chat) return;
      var id = Number(messageId);
      if (isNaN(id) || id < 0 || id >= chat.length) return;
      var msg = chat[id];
      if (!msg || msg.is_user) return;
      var fullText = String(msg.mes || '');
      var extracted = REASONING.extract(fullText);
      if (extracted.state !== 'none') {
        if (!msg.extra) msg.extra = {};
        if (force || !msg.extra.reasoning) {
          msg.extra.reasoning = extracted.reasoning;
          msg.extra.reasoning_state = extracted.state;
          msg.mes = extracted.cleaned;
          updateBlock(id, msg);
        }
      }
      return extracted;
    },
    updateDOMOnly: function (messageId, reasoningText, state) {
      var details = document.querySelector('#chat [mesid="' + messageId + '"] .mes_reasoning_details');
      if (!details) return;
      var content = details.querySelector('.mes_reasoning');
      if (content && content.textContent !== reasoningText) content.textContent = reasoningText;
      if (details.getAttribute('data-state') !== state) details.setAttribute('data-state', state);
    },
    processMessage: function (messageId, isStreaming) {
      var chat = getChatArray();
      if (!chat) return;
      var id = Number(messageId);
      if (isNaN(id) || id < 0 || id >= chat.length) return;
      var msg = chat[id];
      if (!msg || msg.is_user) return;
      var fullText = String(msg.mes || '');
      var extracted = REASONING.extract(fullText);
      if (extracted.state !== 'none') {
        if (!isStreaming) {
          if (!msg.extra) msg.extra = {};
          if (!msg.extra.reasoning) {
            msg.extra.reasoning = extracted.reasoning;
            msg.extra.reasoning_state = extracted.state;
            msg.mes = extracted.cleaned;
            updateBlock(id, msg);
          }
        } else {
          REASONING.updateDOMOnly(id, extracted.reasoning, extracted.state);
        }
      }
    },
    cleanup: function () {
      var s = document.getElementById(STYLE_ID_REASONING);
      if (s) s.remove();
      REASONING.domCache.clear();
    }
  };

  // =====================================================================
  // 小 COT（修复闪烁版）
  // =====================================================================
  var COT = {
    NAMESPACE: 'maya-small-cot',
    _defaultKindKeys: ['信息判定', '行为逻辑', '心里话'],
    _defaultKindLabel: { '信息判定': '信息判定', '行为逻辑': '行为逻辑', '心里话': '心里话' },
    _kindKeys: ['信息判定', '行为逻辑', '心里话'],
    KIND_LABEL: { '信息判定': '信息判定', '行为逻辑': '行为逻辑', '心里话': '心里话' },
    RECENT_LIMIT: 3,
    OPEN_RE: /<((?:[\w\u4e00-\u9fa5])+_(?:信息判定|行为逻辑|心里话))\s*>/g,
    NAME_RE: /^([\s\S]*?)_(信息判定|行为逻辑|心里话)$/,
    signatures: new Map(),
    touchedIds: new Set(),
    disposed: false,
    timer: undefined,
    debounceTimer: undefined,
    // [FIX] 新增：标记是否正在生成中，生成期间跳过 COT 渲染
    isGenerating: false,
    // [FIX] 新增：标记是否正在由 COT 自身修改 DOM，避免 MutationObserver 自循环
    isMutating: false,

    injectConfig: function () {
      try {
        var st = getST();
        var ctx = st && st.getContext && st.getContext();
        var cfg = ctx && ctx.powerUserSettings && ctx.powerUserSettings.cot_fold;
        if (!cfg) return;
        if (cfg.kind_labels && typeof cfg.kind_labels === 'object' && Object.keys(cfg.kind_labels).length > 0) {
          COT.KIND_LABEL = {};
          COT._kindKeys = [];
          Object.keys(cfg.kind_labels).forEach(function (k) {
            COT.KIND_LABEL[k] = String(cfg.kind_labels[k]);
            COT._kindKeys.push(k);
          });
        } else {
          COT.KIND_LABEL = Object.assign({}, COT._defaultKindLabel);
          COT._kindKeys = COT._defaultKindKeys.slice();
        }
        COT.RECENT_LIMIT = (typeof cfg.recent_limit === 'number' && cfg.recent_limit >= 1) ? cfg.recent_limit : 3;
        COT._rebuildRegex();
      } catch (e) {}
    },

    _rebuildRegex: function () {
      var alt = COT._kindKeys.map(function (k) { return escapeRegExp(k); }).join('|');
      COT.OPEN_RE = new RegExp('<((?:[\\w\\u4e00-\\u9fa5])+_(?:' + alt + '))\\s*>', 'g');
      COT.NAME_RE = new RegExp('^([\\s\\S]*?)_(' + alt + ')$');
    },

    styleId: function () { return STYLE_ID_COT; },

    parseTag: function (tag) {
      var m = String(tag).match(COT.NAME_RE);
      return m ? { actor: m[1], kind: m[2] } : null;
    },

    moonSvg: function () {
      return '<svg class="' + COT.NAMESPACE + '-moon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="display:block;width:12px;height:12px;max-width:12px;max-height:12px;min-width:12px;min-height:12px;overflow:hidden;flex:0 0 12px;"><path class="' + COT.NAMESPACE + '-moon-fill" d="M14.7 2.2a8.8 8.8 0 1 0 7.1 13.9 7.2 7.2 0 1 1-7.1-13.9Z" fill="currentColor"/></svg>';
    },

    chevronSvg: function () {
      return '<svg class="' + COT.NAMESPACE + '-chevron-svg" width="12" height="12" viewBox="0 0 20 20" aria-hidden="true" focusable="false" style="display:block;width:12px;height:12px;max-width:12px;max-height:12px;min-width:12px;min-height:12px;overflow:hidden;flex:0 0 12px;"><path d="M7.2 4.8 12.4 10l-5.2 5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    },

    getMessageFromChat: function (messageId) {
      try {
        var messages = getChatMessages(messageId, {
          role: 'assistant',
          hide_state: 'all',
          include_swipes: true,
        });
        if (!messages || messages.length === 0) return null;
        var msg = messages[0];
        var swipeId = msg.swipe_id || 0;
        return msg.message || (msg.swipes && (msg.swipes[swipeId] || msg.swipes[0])) || '';
      } catch (e) { return null; }
    },

    getRecentAssistantIds: function (extraMessageId) {
      var ids = [];
      try {
        if (typeof getLastMessageId === 'function') {
          var lastId = getLastMessageId();
          if (lastId >= 0) {
            var messages = getChatMessages('0-' + lastId, {
              role: 'assistant',
              hide_state: 'all',
              include_swipes: true,
            });
            if (messages) ids = messages.map(function (m) { return m.message_id; });
          }
        }
      } catch (e) {}

      if (ids.length === 0) {
        var doc = getRootDoc();
        var allMes = doc.querySelectorAll('#chat .mes');
        var assistantMes = [];
        for (var i = 0; i < allMes.length; i++) {
          var el = allMes[i];
          if (el.getAttribute('is_user') !== 'true' && el.getAttribute('is_system') !== 'true') {
            var mid = Number(el.getAttribute('mesid'));
            if (Number.isFinite(mid)) assistantMes.push(mid);
          }
        }
        ids = assistantMes.slice(-COT.RECENT_LIMIT);
      }

      if (extraMessageId !== undefined && !ids.includes(extraMessageId)) ids.push(extraMessageId);
      return new Set(ids.slice(-COT.RECENT_LIMIT));
    },

    getDisplayedIds: function () {
      var doc = getRootDoc();
      var allMes = doc.querySelectorAll('#chat .mes');
      var ids = [];
      for (var i = 0; i < allMes.length; i++) {
        var el = allMes[i];
        if (el.getAttribute('is_user') !== 'true' && el.getAttribute('is_system') !== 'true') {
          var mid = Number(el.getAttribute('mesid'));
          if (Number.isFinite(mid)) ids.push(mid);
        }
      }
      return ids;
    },

    isEditing: function (id) {
      var doc = getRootDoc();
      var ta = doc.getElementById('curEditTextarea');
      if (!ta) return false;
      var $ = rootjQuery || $;
      if (!$) return false;
      return Number($(ta).closest('.mes').attr('mesid')) === id;
    },

    buildFoldHtml: function (tag, content, mode) {
      var parsed = COT.parseTag(tag);
      if (!parsed) return null;
      var actorLabel = escapeHtml(parsed.actor);
      var kindLabel = COT.KIND_LABEL[parsed.kind] || parsed.kind;
      var tagLabel = escapeHtml('<' + tag + '>');
      var contentHtml = escapeHtml(content.trim()) || escapeHtml('（无内容）');
      if (mode === 'hidden') {
        return '<span class="' + COT.NAMESPACE + '-hidden" style="display:none">' + escapeHtml('<' + tag + '>' + content + '</' + tag + '>') + '</span>';
      }
      return '<details class="' + COT.NAMESPACE + '-fold" style="display:inline-block;width:auto;max-width:min(100%,28rem);margin:0.12rem 0 0.18rem;overflow:hidden;vertical-align:middle;color:rgba(233,236,244,.94);background:linear-gradient(135deg,rgba(19,21,28,.96),rgba(30,35,45,.94));border:1px solid rgba(172,189,224,.24);border-radius:7px;box-shadow:0 3px 10px rgba(0,0,0,.16);font-size:0.82em;line-height:1.2;box-sizing:border-box;"><summary class="' + COT.NAMESPACE + '-summary" style="display:flex;align-items:center;gap:0.28rem;min-height:1.35rem;padding:0.14rem 0.42rem;cursor:pointer;list-style:none;user-select:none;"><span class="' + COT.NAMESPACE + '-icon" style="display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:0 0 12px;color:#d7c88d;overflow:hidden;">' + COT.moonSvg() + '</span><span class="' + COT.NAMESPACE + '-title" style="display:inline-flex;align-items:baseline;gap:.12rem;white-space:nowrap;color:rgba(246,241,220,.96);font-weight:650;">' + kindLabel + '</span><span class="' + COT.NAMESPACE + '-meta" style="min-width:0;overflow:hidden;color:rgba(188,198,218,.78);font-size:.82em;text-overflow:ellipsis;white-space:nowrap;opacity:.72;">' + actorLabel + ' · 已收束</span><span class="' + COT.NAMESPACE + '-chevron" style="display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:0 0 12px;overflow:hidden;color:rgba(205,216,240,.76);">' + COT.chevronSvg() + '</span></summary><div class="' + COT.NAMESPACE + '-body" style="max-height:12rem;overflow-y:auto;border-top:1px solid rgba(172,189,224,.18);background:rgba(10,12,17,.28);padding:.46rem .56rem .2rem;"><section class="' + COT.NAMESPACE + '-section" style="margin:0 .42rem 0;"><div class="' + COT.NAMESPACE + '-section-head" style="display:flex;align-items:center;gap:.34rem;margin-bottom:.22rem;line-height:1.2;"><span class="' + COT.NAMESPACE + '-kind" style="flex:0 0 auto;padding:.06rem .34rem;color:rgba(244,236,199,.96);background:rgba(180,158,93,.16);border:1px solid rgba(205,188,125,.26);border-radius:999px;font-size:.78em;font-weight:650;">' + kindLabel + '</span><span class="' + COT.NAMESPACE + '-tag" style="min-width:0;overflow:hidden;color:rgba(176,190,219,.68);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78em;text-overflow:ellipsis;white-space:nowrap;">' + tagLabel + '</span></div><div class="' + COT.NAMESPACE + '-content" style="color:rgba(229,233,242,.9);line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap;">' + contentHtml + '</div></section></div></details>';
    },

    hasCotElements: function (messageId) {
      var el = getRootDoc().querySelector('#chat .mes[mesid="' + messageId + '"] .mes_text');
      if (!el) return false;
      return el.querySelector('.' + COT.NAMESPACE + '-fold, .' + COT.NAMESPACE + '-hidden') !== null;
    },

    // [FIX] 核心渲染函数：增加生成期保护 + 更稳定的"是否需要重渲染"判断
    renderMessage: function (messageId, recentAssistantIds) {
      if (COT.disposed || !Number.isFinite(messageId) || COT.isEditing(messageId)) return;
      // [FIX] 生成期间完全跳过 COT，避免流式文本变化导致反复重建
      if (COT.isGenerating) return;
      if (!recentAssistantIds) recentAssistantIds = COT.getRecentAssistantIds();

      var doc = getRootDoc();
      var msgEl = doc.querySelector('#chat .mes[mesid="' + messageId + '"][is_user="false"][is_system="false"]');
      if (!msgEl) return;
      var textEl = msgEl.querySelector('.mes_text');
      if (!textEl) return;

      var showFold = recentAssistantIds.has(messageId);
      var mode = showFold ? 'fold' : 'hidden';

      var msgText = COT.getMessageFromChat(messageId);
      if (!msgText) return;

      // [FIX] 如果 DOM 中已存在 COT 元素，检查是否需要更新
      if (COT.hasCotElements(messageId)) {
        var currentSignature = COT.signatures.get(messageId);
        // [FIX] 只有当模式改变时才重建；流式期间文本变化不再触发重建
        if (currentSignature && currentSignature.startsWith(mode + '|')) {
          return; // 已渲染且模式一致，跳过
        }
        // 模式改变（如从 hidden 变为 fold），需要重建
        var html = textEl.innerHTML;
        html = html.replace(new RegExp('<details[^>]*class="[^"]*' + COT.NAMESPACE + '-fold[^"]*"[^>]*>[\\s\\S]*?</details>', 'gi'), '');
        html = html.replace(new RegExp('<span[^>]*class="[^"]*' + COT.NAMESPACE + '-hidden[^"]*"[^>]*>[\\s\\S]*?</span>', 'gi'), '');
        // [FIX] 标记自身修改，避免 MutationObserver 自循环
        COT.isMutating = true;
        textEl.innerHTML = html;
        COT.isMutating = false;
      }

      // 提取所有完整闭合的 COT 对
      var regions = [];
      var pairRe = /<([^<>\s/]+_(?:信息判定|行为逻辑|心里话))\s*>([\s\S]*?)<\/\1>/g;
      var m;
      while ((m = pairRe.exec(msgText)) !== null) {
        regions.push({ tag: m[1], content: m[2] });
      }
      if (regions.length === 0) return;

      try {
        var html = textEl.innerHTML;
        var searchFrom = 0;

        for (var i = 0; i < regions.length; i++) {
          var region = regions[i];
          var foldHtml = COT.buildFoldHtml(region.tag, region.content, mode);
          if (!foldHtml) continue;

          var escapedOpen = escapeHtml('<' + region.tag + '>');
          var escapedClose = escapeHtml('</' + region.tag + '>');

          var startIdx = html.indexOf(escapedOpen, searchFrom);
          if (startIdx === -1) continue;

          var endIdx = html.indexOf(escapedClose, startIdx + escapedOpen.length);
          if (endIdx !== -1) {
            html = html.slice(0, startIdx) + foldHtml + html.slice(endIdx + escapedClose.length);
            searchFrom = startIdx + foldHtml.length;
          } else {
            // 闭标签被删除的兜底逻辑
            var contentText = region.content.trim();
            if (contentText) {
              var plainContent = contentText.replace(/[*_~`]/g, '');
              var anchor = escapeHtml(plainContent.slice(-30));
              var anchorPos = html.indexOf(anchor, startIdx + escapedOpen.length);
              if (anchorPos !== -1) {
                var fullEnd = anchorPos + anchor.length;
                var trailing = html.slice(fullEnd).match(/^(\s*<\/[a-z]+>)*/i);
                if (trailing && trailing[0]) fullEnd += trailing[0].length;
                html = html.slice(0, startIdx) + foldHtml + html.slice(fullEnd);
                searchFrom = startIdx + foldHtml.length;
              } else {
                html = html.slice(0, startIdx) + foldHtml + html.slice(startIdx + escapedOpen.length);
                searchFrom = startIdx + foldHtml.length;
              }
            } else {
              html = html.slice(0, startIdx) + foldHtml + html.slice(startIdx + escapedOpen.length);
              searchFrom = startIdx + foldHtml.length;
            }
          }
        }

        // [FIX] 标记自身修改，避免 MutationObserver 自循环
        COT.isMutating = true;
        textEl.innerHTML = html;
        COT.isMutating = false;
        msgEl.setAttribute('data-' + COT.NAMESPACE, mode);
        // [FIX] 签名只记录 mode，不再记录完整文本，避免流式变化导致失效
        COT.signatures.set(messageId, mode + '|' + regions.length);
        COT.touchedIds.add(messageId);
      } catch (e) {
        COT.isMutating = false;
        if (DEBUG) console.warn('[COT] render failed msgId=' + messageId + ':', e);
      }
    },

    renderDisplayed: function (extraRecentMessageId) {
      if (COT.disposed) return;
      var recentIds = COT.getRecentAssistantIds(extraRecentMessageId);
      var ids = COT.getDisplayedIds();
      ids.forEach(function (id) { COT.renderMessage(id, recentIds); });
    },

    queueAll: function (delay, extraRecentMessageId) {
      window.clearTimeout(COT.timer);
      COT.timer = window.setTimeout(function () {
        COT.renderDisplayed(extraRecentMessageId);
      }, delay || 80);
    },

    debouncedQueueAll: function (delay) {
      window.clearTimeout(COT.debounceTimer);
      COT.debounceTimer = window.setTimeout(function () {
        COT.renderDisplayed();
      }, delay || 300);
    },

    ensureStyle: function () {
      var doc = getRootDoc();
      var sid = COT.styleId();
      if (doc.getElementById(sid)) return;
      var style = doc.createElement('style');
      style.id = sid;
      style.textContent = '#chat [class*="' + COT.NAMESPACE + '-fold"]{display:inline-block!important;width:auto!important;max-width:min(100%,28rem)!important;margin:0.12rem 0 0.18rem!important;overflow:hidden!important;vertical-align:middle!important;border-radius:7px!important;font-size:0.82em!important;line-height:1.2!important;box-sizing:border-box!important}\n#chat [class*="' + COT.NAMESPACE + '-summary"]{display:flex!important;align-items:center!important;gap:0.28rem!important;min-height:1.35rem!important;padding:0.14rem 0.42rem!important;list-style:none!important;cursor:pointer!important;user-select:none!important}\n#chat [class*="' + COT.NAMESPACE + '-summary"]::marker{content:""!important;font-size:0!important}\n#chat [class*="' + COT.NAMESPACE + '-summary"]::-webkit-details-marker{display:none!important}\n#chat [class*="' + COT.NAMESPACE + '-moon"],#chat [class*="' + COT.NAMESPACE + '-chevron-svg"]{display:block!important;width:12px!important;height:12px!important;min-width:12px!important;min-height:12px!important;max-width:12px!important;max-height:12px!important;overflow:hidden!important;flex:0 0 12px!important}\n#chat [class*="' + COT.NAMESPACE + '-icon"],#chat [class*="' + COT.NAMESPACE + '-chevron"]{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:12px!important;height:12px!important;flex:0 0 12px!important;overflow:hidden!important}\n#chat [class*="' + COT.NAMESPACE + '-fold"][open] [class*="' + COT.NAMESPACE + '-chevron-svg"]{transform:rotate(90deg)}\n#chat [class*="' + COT.NAMESPACE + '-body"]{max-height:12rem!important;overflow-y:auto!important}\n#chat [class*="' + COT.NAMESPACE + '-body"]::-webkit-scrollbar{width:6px}\n#chat [class*="' + COT.NAMESPACE + '-body"]::-webkit-scrollbar-thumb{background:rgba(170,184,214,0.32);border-radius:999px}';
      doc.head.appendChild(style);
    },

    cleanup: function () {
      var doc = getRootDoc();
      COT.touchedIds.forEach(function (id) {
        try {
          var msgEl = doc.querySelector('#chat .mes[mesid="' + id + '"]');
          if (msgEl) {
            var textEl = msgEl.querySelector('.mes_text');
            if (textEl) {
              var html = textEl.innerHTML;
              html = html.replace(new RegExp('<details[^>]*class="[^"]*' + COT.NAMESPACE + '-fold[^"]*"[^>]*>[\\s\\S]*?</details>', 'gi'), '');
              html = html.replace(new RegExp('<span[^>]*class="[^"]*' + COT.NAMESPACE + '-hidden[^"]*"[^>]*>[\\s\\S]*?</span>', 'gi'), '');
              textEl.innerHTML = html;
            }
          }
        } catch (e) {}
      });
      COT.touchedIds.clear();
      COT.signatures.clear();
      var s = document.getElementById(COT.styleId());
      if (s) s.remove();
    }
  };

  // =====================================================================
  // 主控制器
  // =====================================================================
  function init() {
    COT.injectConfig();
    COT.ensureStyle();
    REASONING.injectStyle();

    var stopList = [];
    function listen(event, listener, last) {
      if (typeof eventOn !== 'function') return;
      var wrapped = typeof errorCatched === 'function' ? errorCatched(listener) : listener;
      var ret = last && typeof eventMakeLast === 'function' ? eventMakeLast(event, wrapped) : eventOn(event, wrapped);
      if (ret && typeof ret.stop === 'function') stopList.push(ret.stop);
    }

    listen('chatLoaded', function () {
      var chat = getChatArray();
      if (chat) for (var i = 0; i < chat.length; i++) if (!chat[i].is_user) REASONING.processMessage(i, false);
      COT.debouncedQueueAll(500);
    }, true);

    if (typeof tavern_events !== 'undefined') {
      listen(tavern_events.CHAT_CHANGED, function () {
        COT.signatures.clear();
        COT.touchedIds.clear();
        var chat = getChatArray();
        if (chat) for (var i = 0; i < chat.length; i++) if (!chat[i].is_user) REASONING.processMessage(i, false);
        COT.debouncedQueueAll(500);
      });
      listen(tavern_events.MORE_MESSAGES_LOADED, function () {
        var chat = getChatArray();
        if (chat) for (var i = 0; i < chat.length; i++) if (!chat[i].is_user) REASONING.processMessage(i, false);
        COT.debouncedQueueAll(400);
      });

      // 流式过程中只处理 REASONING，不处理 COT
      listen(tavern_events.STREAM_TOKEN_RECEIVED, function (messageId) {
        REASONING.processMessage(messageId, true);
      });

      // [FIX] 新增：生成开始时标记状态，冻结 COT 渲染
      if (tavern_events.GENERATION_STARTED) {
        listen(tavern_events.GENERATION_STARTED, function () {
          COT.isGenerating = true;
        });
      }

      // [FIX] 生成结束后统一执行一次 COT，并解除冻结
      listen(tavern_events.MESSAGE_RECEIVED, function (id) {
        setTimeout(function () {
          REASONING.processMessage(id, false);
          // [FIX] 生成期间不触发 COT，等 GENERATION_ENDED 统一处理
          if (!COT.isGenerating) {
            COT.debouncedQueueAll(350);
          }
        }, 100);
      });
      listen(tavern_events.GENERATION_ENDED, function () {
        COT.isGenerating = false; // [FIX] 解除冻结
        COT.debouncedQueueAll(400);
      });
      listen(tavern_events.GENERATION_STOPPED, function () {
        COT.isGenerating = false; // [FIX] 解除冻结
        COT.debouncedQueueAll(400);
      });

      listen(tavern_events.MESSAGE_SWIPED, function () {
        var chat = getChatArray();
        if (chat) for (var i = 0; i < chat.length; i++) if (!chat[i].is_user) REASONING.processMessage(i, false);
        COT.debouncedQueueAll(400);
      }, true);
      listen(tavern_events.MESSAGE_EDITED, function (id) {
        if (id !== undefined && id !== null) {
          var doc = getRootDoc();
          var msgEl = doc.querySelector('#chat .mes[mesid="' + id + '"]');
          if (msgEl) msgEl.removeAttribute('data-' + COT.NAMESPACE);
          REASONING.processMessage(id, false);
          COT.renderMessage(id, COT.getRecentAssistantIds());
        } else {
          var chat = getChatArray();
          if (chat) for (var i = 0; i < chat.length; i++) if (!chat[i].is_user) REASONING.processMessage(i, false);
          COT.debouncedQueueAll(400);
        }
      }, true);
      listen(tavern_events.MESSAGE_UPDATED, function (id) {
        setTimeout(function () {
          if (id !== undefined && id !== null) {
            var doc = getRootDoc();
            var msgEl = doc.querySelector('#chat .mes[mesid="' + id + '"]');
            if (msgEl) msgEl.removeAttribute('data-' + COT.NAMESPACE);
            REASONING.processMessage(id, false);
            COT.renderMessage(id, COT.getRecentAssistantIds());
          } else {
            REASONING.processMessage(id, false);
            COT.debouncedQueueAll(300);
          }
        }, 100);
      });
      listen(tavern_events.MESSAGE_DELETED, function () {
        COT.signatures.clear();
        COT.touchedIds.clear();
        COT.debouncedQueueAll(300);
      }, true);
    }

    // 观察聊天区域变化，作为最后保障
    var observer = new MutationObserver(function () {
      if (COT.disposed) return;
      // [FIX] 如果变化是由 COT 自身修改引起的，直接忽略
      if (COT.isMutating) return;
      COT.debouncedQueueAll(500);
    });
    var chatContainer = getRootDoc().getElementById('chat');
    if (chatContainer) {
      observer.observe(chatContainer, { childList: true, subtree: true });
    }

    $(window).on('pagehide', function () {
      COT.disposed = true;
      observer.disconnect();
      stopList.forEach(function (s) { s(); });
      COT.cleanup();
      REASONING.cleanup();
    });
    window.COT = COT;
    window.REASONING = REASONING;
    console.info('[Maya] All-in-One v7 (COT 防闪烁修复版) 已加载');
  }

  window.COT = COT;
  window.REASONING = REASONING;
  $(function () {
    var run = typeof errorCatched === 'function' ? errorCatched(init) : init;
    run();
  });
})();