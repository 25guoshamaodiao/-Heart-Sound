(function () {
  'use strict';

  const NAMESPACE = 'maya-small-cot';
  const RECENT_ASSISTANT_LIMIT = 3;
  const COT_OPEN_RE = /<([^<>\s/]+_(?:信息判定|行为逻辑|心里话))\s*>/g;
  const COT_NAME_RE = /^(.*)_(信息判定|行为逻辑|心里话)$/;
  const KIND_LABEL = {
    信息判定: '信息判定',
    行为逻辑: '行为逻辑',
    心里话: '心里话',
  };

  const processedSignatures = new Map();
  const touchedMessageIds = new Set();
  let disposed = false;
  let renderAllTimer;
  let isGenerating = false;

  // ========== mvu 保护 ==========
  let mvuUpdating = false;
  let mvuRetryTimer = null;

  function stripMvuVariables(text) {
    return String(text).replace(/\{\{[^}]+\}\}/g, '');
  }
  // ========== 工具函数 ==========
  function getCurrentScriptId() {
    try { return typeof getScriptId === 'function' ? getScriptId() : 'standalone'; } catch { return 'standalone'; }
  }
  function styleId() {
    return `${NAMESPACE}-style-${String(getCurrentScriptId()).replace(/[^\w-]/g, '_')}`;
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => {
      const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return escapes[char] || char;
    });
  }
  function parseCotTag(tag) {
    const match = String(tag).match(COT_NAME_RE);
    if (!match) return null;
    return { actor: match[1], kind: match[2] };
  }
  function moonSvg() {
    return `<svg class="${NAMESPACE}-moon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="display:block;width:12px;height:12px;max-width:12px;max-height:12px;min-width:12px;min-height:12px;overflow:hidden;flex:0 0 12px;"><path class="${NAMESPACE}-moon-fill" d="M14.7 2.2a8.8 8.8 0 1 0 7.1 13.9 7.2 7.2 0 1 1-7.1-13.9Z" fill="currentColor"/></svg>`;
  }
  function chevronSvg() {
    return `<svg class="${NAMESPACE}-chevron-svg" width="12" height="12" viewBox="0 0 20 20" aria-hidden="true" focusable="false" style="display:block;width:12px;height:12px;max-width:12px;max-height:12px;min-width:12px;min-height:12px;overflow:hidden;flex:0 0 12px;"><path d="M7.2 4.8 12.4 10l-5.2 5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function getCurrentMessageText(message) {
    const swipeId = message.swipe_id || 0;
    return message.message || (message.swipes && (message.swipes[swipeId] || message.swipes[0])) || '';
  }

  function getAssistantMessageIds(extraMessageId) {
    let lastMessageId = -1;
    try { lastMessageId = getLastMessageId(); } catch { return new Set(extraMessageId === undefined ? [] : [extraMessageId]); }
    if (lastMessageId < 0) return new Set(extraMessageId === undefined ? [] : [extraMessageId]);
    const assistantMessages = getChatMessages(`0-${lastMessageId}`, {
      role: 'assistant',
      hide_state: 'all',
      include_swipes: true,
    });
    const ids = assistantMessages.map(m => m.message_id);
    if (extraMessageId !== undefined && !ids.includes(extraMessageId)) ids.push(extraMessageId);
    return new Set(ids.slice(-RECENT_ASSISTANT_LIMIT));
  }

  function getDisplayedAssistantMessageIds() {
    return $('#chat > .mes[is_user="false"][is_system="false"]')
      .toArray()
      .map(node => Number($(node).attr('mesid')))
      .filter(Number.isFinite);
  }

  function isEditingMessage(messageId) {
    const $textarea = $('#chat').find('#curEditTextarea');
    if ($textarea.length === 0) return false;
    return Number($textarea.closest('.mes').attr('mesid')) === messageId;
  }

  function getMessageFromChat(messageId) {
    const messages = getChatMessages(messageId, {
      role: 'assistant',
      hide_state: 'all',
      include_swipes: true,
    });
    if (!messages || messages.length === 0) return null;
    return getCurrentMessageText(messages[0]);
  }

  // ========== DOM 扫描与展开/包裹（完全复用旧版） ==========
  function collectTextNodes(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (parent && parent.closest(`.${NAMESPACE}-fold, .${NAMESPACE}-hidden`)) continue;
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function parseCotRegionsFromSource(sourceText) {
    const regions = [];
    const re = /<([^<>\s/]+_(?:信息判定|行为逻辑|心里话))\s*>/g;
    let match;
    while ((match = re.exec(sourceText)) !== null) {
      const tag = match[1];
      const parsed = parseCotTag(tag);
      if (!parsed) continue;
      const openStart = match.index;
      const openEnd = match.index + match[0].length;
      const closeTag = `</${tag}>`;
      const closeStart = sourceText.indexOf(closeTag, openEnd);
      if (closeStart === -1) continue;
      const closeEnd = closeStart + closeTag.length;
      const content = sourceText.slice(openEnd, closeStart);
      regions.push({
        tag,
        actor: parsed.actor,
        kind: parsed.kind,
        content,
        openStart,
        openEnd,
        closeStart,
        closeEnd,
      });
      re.lastIndex = closeEnd;
    }
    // 标记相邻区域之间是否有正文（用于边界判定）
    for (let i = 0; i < regions.length - 1; i++) {
      const between = sourceText.slice(regions[i].closeEnd, regions[i + 1].openStart);
      if (between.replace(/[\s ]+/g, '').length > 0) {
        regions[i].bodyTextAfter = true;
      }
    }
    if (regions.length > 0) {
      regions[regions.length - 1].bodyTextAfter = true;
    }
    return regions;
  }

  function normalizeText(text) {
    return text.replace(/[\s ]+/g, ' ').trim();
  }

  function findContentMatchEnd(normSrc, normAcc) {
    if (!normSrc) return 0;
    let si = 0;
    for (let ai = 0; ai < normAcc.length; ai++) {
      if (normAcc[ai] === normSrc[si]) {
        si++;
        if (si === normSrc.length) return ai + 1;
      }
    }
    return -1;
  }

  function mapNormalizedOffsetToRaw(rawText, normOffset) {
    let rawIdx = 0, normIdx = 0;
    while (normIdx < normOffset && rawIdx < rawText.length) {
      if (/[\s ]/.test(rawText[rawIdx])) { rawIdx++; continue; }
      rawIdx++; normIdx++;
    }
    return rawIdx;
  }

  function findCotRanges(container, sourceText) {
    const sourceRegions = parseCotRegionsFromSource(sourceText);
    if (sourceRegions.length === 0) return [];

    const textNodes = collectTextNodes(container);
    const domOpenTags = [];
    for (let i = 0; i < textNodes.length; i++) {
      const text = textNodes[i].textContent;
      COT_OPEN_RE.lastIndex = 0;
      let m;
      while ((m = COT_OPEN_RE.exec(text)) !== null) {
        const tag = m[1];
        const parsed = parseCotTag(tag);
        if (!parsed) continue;
        domOpenTags.push({
          tag,
          actor: parsed.actor,
          kind: parsed.kind,
          nodeIndex: i,
          node: textNodes[i],
          openStartOffset: m.index,
          openEndOffset: m.index + m[0].length,
        });
      }
    }

    const matchCount = Math.min(domOpenTags.length, sourceRegions.length);
    const ranges = [];
    for (let idx = 0; idx < matchCount; idx++) {
      const domTag = domOpenTags[idx];
      const srcRegion = sourceRegions[idx];
      if (domTag.tag !== srcRegion.tag) continue;

      let closeEndNode = null;
      let closeEndOffset = -1;
      const useContentMatch = srcRegion.bodyTextAfter || idx + 1 >= domOpenTags.length;

      if (!useContentMatch && idx + 1 < domOpenTags.length) {
        const nextTag = domOpenTags[idx + 1];
        closeEndNode = nextTag.node;
        closeEndOffset = nextTag.openStartOffset;
      } else {
        const cleanSrcContent = srcRegion.content
          .replace(/^[ \t]*[\d]+[\.\、]?[ \t]+/gm, '')
          .replace(/^[ \t]*[-•*+][ \t]+/gm, '');
        const normalizedSrcContent = normalizeText(cleanSrcContent);
        let accumulated = '';
        for (let j = domTag.nodeIndex; j < textNodes.length; j++) {
          const nodeText = textNodes[j].textContent;
          const toAdd = (j === domTag.nodeIndex) ? nodeText.slice(domTag.openEndOffset) : nodeText;
          accumulated += toAdd;
          const normalizedAcc = normalizeText(accumulated);
          const matchEnd = findContentMatchEnd(normalizedSrcContent, normalizedAcc);
          if (matchEnd >= 0) {
            const rawOffset = mapNormalizedOffsetToRaw(accumulated, matchEnd);
            if (j === domTag.nodeIndex) {
              closeEndOffset = domTag.openEndOffset + rawOffset;
            } else {
              const prevLen = accumulated.length - toAdd.length;
              closeEndOffset = rawOffset - prevLen;
            }
            closeEndNode = textNodes[j];
            break;
          }
        }
      }

      if (!closeEndNode) {
        if (idx + 1 < domOpenTags.length) {
          const nextTag = domOpenTags[idx + 1];
          closeEndNode = nextTag.node;
          closeEndOffset = nextTag.openStartOffset;
        } else {
          const lastNode = textNodes[textNodes.length - 1];
          closeEndNode = lastNode;
          closeEndOffset = lastNode.textContent.length;
        }
      }

      ranges.push({
        actor: domTag.actor,
        kind: domTag.kind,
        tag: domTag.tag,
        openStartNode: domTag.node,
        openStartOffset: domTag.openStartOffset,
        contentStartNode: domTag.node,
        contentStartOffset: domTag.openEndOffset,
        closeStartNode: closeEndNode,
        closeStartOffset: closeEndOffset,
        closeEndNode: closeEndNode,
        closeEndOffset: closeEndOffset,
      });
    }
    return ranges;
  }

  function groupCotRanges(ranges) {
    if (ranges.length === 0) return [];
    const groups = [];
    let currentGroup = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const prev = ranges[i - 1];
      const next = ranges[i];
      let split = false;
      if (prev.actor !== next.actor) split = true;
      else if (currentGroup.some(r => r.kind === next.kind)) split = true;
      if (split) {
        groups.push(currentGroup);
        currentGroup = [next];
      } else {
        currentGroup.push(next);
      }
    }
    groups.push(currentGroup);
    return groups;
  }

  function unwrapCot(container) {
    const foldBlocks = container.querySelectorAll(`.${NAMESPACE}-fold`);
    for (let i = foldBlocks.length - 1; i >= 0; i--) {
      const foldBlock = foldBlocks[i];
      const original = foldBlock.querySelector(`.${NAMESPACE}-original`);
      if (original) {
        const fragment = document.createDocumentFragment();
        while (original.firstChild) fragment.appendChild(original.firstChild);
        foldBlock.replaceWith(fragment);
      }
    }
    const hiddenSpans = container.querySelectorAll(`.${NAMESPACE}-hidden`);
    for (let i = hiddenSpans.length - 1; i >= 0; i--) {
      const span = hiddenSpans[i];
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
      }
    }
  }

  function createFoldElement(group, originalFragment) {
    const actorNames = Array.from(new Set(group.map(r => r.actor)));
    const actorLabel = escapeHtml(actorNames.join(' / '));
    const countLabel = `${group.length}段`;

    const sections = group.map(r => {
      const tagLabel = escapeHtml(`<${r.tag}>`);
      let contentHtml = '';
      try {
        const contentRange = document.createRange();
        contentRange.setStart(r.contentStartNode, r.contentStartOffset);
        contentRange.setEnd(r.closeStartNode, r.closeStartOffset);
        const fragment = contentRange.cloneContents();
        const temp = document.createElement('div');
        temp.appendChild(fragment);
        contentHtml = temp.innerHTML.trim();
      } catch (e) { contentHtml = ''; }
      if (!contentHtml || contentHtml === '<br>' || /^\s*$/.test(contentHtml.replace(/<[^>]*>/g, ''))) {
        contentHtml = escapeHtml('（无内容）');
      }
      return `<section class="${NAMESPACE}-section" style="margin:0 0 .42rem 0;"><div class="${NAMESPACE}-section-head" style="display:flex;align-items:center;gap:.34rem;margin-bottom:.22rem;line-height:1.2;"><span class="${NAMESPACE}-kind" style="flex:0 0 auto;padding:.06rem .34rem;color:rgba(244,236,199,.96);background:rgba(180,158,93,.16);border:1px solid rgba(205,188,125,.26);border-radius:999px;font-size:.78em;font-weight:650;">${KIND_LABEL[r.kind]}</span><span class="${NAMESPACE}-tag" style="min-width:0;overflow:hidden;color:rgba(176,190,219,.68);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78em;text-overflow:ellipsis;white-space:nowrap;">${tagLabel}</span></div><div class="${NAMESPACE}-content" style="color:rgba(229,233,242,.9);line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap;">${contentHtml}</div></section>`;
    }).join('');

    const html = `<details class="${NAMESPACE}-fold" style="display:inline-block;width:auto;max-width:min(100%,28rem);margin:0.12rem 0 0.18rem;overflow:hidden;vertical-align:middle;color:rgba(233,236,244,.94);background:linear-gradient(135deg,rgba(19,21,28,.96),rgba(30,35,45,.94));border:1px solid rgba(172,189,224,.24);border-radius:7px;box-shadow:0 3px 10px rgba(0,0,0,.16);font-size:0.82em;line-height:1.2;box-sizing:border-box;"><summary class="${NAMESPACE}-summary" style="display:flex;align-items:center;gap:0.28rem;min-height:1.35rem;padding:0.14rem 0.42rem;cursor:pointer;list-style:none;user-select:none;"><span class="${NAMESPACE}-icon" style="display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:0 0 12px;color:#d7c88d;overflow:hidden;">${moonSvg()}</span><span class="${NAMESPACE}-title" style="display:inline-flex;align-items:baseline;gap:.12rem;white-space:nowrap;color:rgba(246,241,220,.96);font-weight:650;">小COT</span><span class="${NAMESPACE}-meta" style="min-width:0;overflow:hidden;color:rgba(188,198,218,.78);font-size:.82em;text-overflow:ellipsis;white-space:nowrap;opacity:.72;">${actorLabel} · ${countLabel} · 已收束</span><span class="${NAMESPACE}-chevron" style="display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:0 0 12px;overflow:hidden;color:rgba(205,216,240,.76);">${chevronSvg()}</span></summary><div class="${NAMESPACE}-body" style="max-height:12rem;overflow-y:auto;border-top:1px solid rgba(172,189,224,.18);background:rgba(10,12,17,.28);padding:.46rem .56rem .2rem;">${sections}</div><span class="${NAMESPACE}-original" style="display:none" aria-hidden="true"></span></details>`;

    const temp = document.createElement('div');
    temp.innerHTML = html;
    const details = temp.firstChild;
    const originalSpan = details.querySelector(`.${NAMESPACE}-original`);
    if (originalSpan && originalFragment) {
      originalSpan.appendChild(originalFragment.cloneNode(true));
    }
    return details;
  }

  function wrapCotRanges(container, ranges, mode) {
    const groups = groupCotRanges(ranges);
    if (groups.length === 0) return false;
    for (let g = groups.length - 1; g >= 0; g--) {
      const group = groups[g];
      const first = group[0];
      const last = group[group.length - 1];
      try {
        const range = document.createRange();
        range.setStart(first.openStartNode, first.openStartOffset);
        range.setEnd(last.closeEndNode, last.closeEndOffset);
        if (mode === 'fold') {
          const originalFragment = range.cloneContents();
          const foldEl = createFoldElement(group, originalFragment);
          range.deleteContents();
          range.insertNode(foldEl);
        } else {
          const fragment = range.cloneContents();
          const hiddenSpan = document.createElement('span');
          hiddenSpan.className = `${NAMESPACE}-hidden`;
          hiddenSpan.style.display = 'none';
          hiddenSpan.appendChild(fragment);
          range.deleteContents();
          range.insertNode(hiddenSpan);
        }
      } catch (e) { /* ignore */ }
    }
    return true;
  }

  // ========== 渲染入口 ==========
  function renderMessage(messageId, recentAssistantIds) {
    if (disposed) return;
    if (!Number.isFinite(messageId)) return;
    if (isEditingMessage(messageId)) return;
    // 生成期间跳过
    if (isGenerating) return;

    const $message = $(`#chat > .mes[mesid="${messageId}"][is_user="false"][is_system="false"]`).first();
    if ($message.length === 0) return;

    const $text = $message.find('.mes_text').first();
    if ($text.length === 0) return;

    const container = $text[0];
    const showFold = recentAssistantIds.has(messageId);

    // 获取源文本（含完整标签）
    const msgText = getMessageFromChat(messageId);
    if (msgText === null) return;

    // 签名：使用完整源文本（最稳定）
    const signature = `${showFold ? 'fold' : 'hidden'}\n${msgText}`;
    const currentState = $message.attr(`data-${NAMESPACE}`);

    if (processedSignatures.get(messageId) === signature && currentState === (showFold ? 'fold' : 'hidden')) {
      return; // 完全匹配，不进行任何 DOM 操作
    }

    try {
      // 展开已有处理
      unwrapCot(container);

      // 扫描 COT 区间
      const ranges = findCotRanges(container, msgText);
      const hasCot = ranges.length > 0;

      if (hasCot) {
        wrapCotRanges(container, ranges, showFold ? 'fold' : 'hidden');
      }

      $message.attr(`data-${NAMESPACE}`, hasCot ? (showFold ? 'fold' : 'hidden') : 'none');
      processedSignatures.set(messageId, signature);
      touchedMessageIds.add(messageId);
    } catch (e) {
      console.warn('[COT聚合] renderMessage失败:', e);
    }
  }

  function renderDisplayedAssistantMessages(extraRecentMessageId) {
    if (disposed) return;
    const recentAssistantIds = getAssistantMessageIds(extraRecentMessageId);
    const displayedIds = getDisplayedAssistantMessageIds();
    for (const id of displayedIds) {
      renderMessage(id, recentAssistantIds);
    }
  }

  function queueRenderAll(delay, extraRecentMessageId) {
    window.clearTimeout(renderAllTimer);
    renderAllTimer = window.setTimeout(() => {
      renderDisplayedAssistantMessages(extraRecentMessageId);
    }, delay || 250);
  }

  // ========== 样式 ==========
  function ensureStyle() {
    const id = styleId();
    let $style = $(`head > style#${id}`);
    if ($style.length === 0) {
      $style = $('<style>').attr('id', id).appendTo('head');
    }
    $style.text(`
#chat [class*="${NAMESPACE}-fold"] {
  display: inline-block !important;
  width: auto !important;
  max-width: min(100%, 28rem) !important;
  margin: 0.12rem 0 0.18rem !important;
  overflow: hidden !important;
  vertical-align: middle !important;
  border-radius: 7px !important;
  font-size: 0.82em !important;
  line-height: 1.2 !important;
  box-sizing: border-box !important;
}
#chat [class*="${NAMESPACE}-summary"] {
  display: flex !important;
  align-items: center !important;
  gap: 0.28rem !important;
  min-height: 1.35rem !important;
  padding: 0.14rem 0.42rem !important;
  list-style: none !important;
  cursor: pointer !important;
  user-select: none !important;
}
#chat [class*="${NAMESPACE}-summary"]::marker {
  content: "" !important;
  font-size: 0 !important;
}
#chat [class*="${NAMESPACE}-summary"]::-webkit-details-marker {
  display: none !important;
}
#chat [class*="${NAMESPACE}-moon"],
#chat [class*="${NAMESPACE}-chevron-svg"] {
  display: block !important;
  width: 12px !important;
  height: 12px !important;
  min-width: 12px !important;
  min-height: 12px !important;
  max-width: 12px !important;
  max-height: 12px !important;
  overflow: hidden !important;
  flex: 0 0 12px !important;
}
#chat [class*="${NAMESPACE}-icon"],
#chat [class*="${NAMESPACE}-chevron"] {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 12px !important;
  height: 12px !important;
  flex: 0 0 12px !important;
  overflow: hidden !important;
}
#chat [class*="${NAMESPACE}-fold"][open] [class*="${NAMESPACE}-chevron-svg"] {
  transform: rotate(90deg);
}
#chat [class*="${NAMESPACE}-body"] {
  max-height: 12rem !important;
  overflow-y: auto !important;
}
#chat [class*="${NAMESPACE}-body"]::-webkit-scrollbar {
  width: 6px;
}
#chat [class*="${NAMESPACE}-body"]::-webkit-scrollbar-thumb {
  background: rgba(170, 184, 214, 0.32);
  border-radius: 999px;
}
`);
  }

  // ========== 清理 ==========
  function restoreTouchedMessages() {
    window.clearTimeout(renderAllTimer);
    for (const id of touchedMessageIds) {
      try {
        const $message = $(`#chat > .mes[mesid="${id}"]`).first();
        if ($message.length) {
          const $text = $message.find('.mes_text').first();
          if ($text.length) unwrapCot($text[0]);
        }
      } catch (e) { /* ignore */ }
    }
    touchedMessageIds.clear();
    processedSignatures.clear();
    $(`#chat > .mes[data-${NAMESPACE}]`).removeAttr(`data-${NAMESPACE}`);
  }

  // ========== 事件监听 ==========
  function listen(stopList, event, listener, last) {
    if (typeof eventOn !== 'function') return;
    const wrapped = typeof errorCatched === 'function' ? errorCatched(listener) : listener;
    const ret = last && typeof eventMakeLast === 'function'
      ? eventMakeLast(event, wrapped)
      : eventOn(event, wrapped);
    if (ret && typeof ret.stop === 'function') stopList.push(ret.stop);
  }

  function init() {
    ensureStyle();
    const stopList = [];

    // 基础事件
    listen(stopList, 'chatLoaded', () => queueRenderAll(250), true);

    if (typeof tavern_events !== 'undefined') {
      // 聊天切换
      listen(stopList, tavern_events.CHAT_CHANGED, () => {
        processedSignatures.clear();
        queueRenderAll(300);
      });

      // 加载更多
      listen(stopList, tavern_events.MORE_MESSAGES_LOADED, () => queueRenderAll(300));

      // 收到消息（非流式）
      listen(stopList, tavern_events.MESSAGE_RECEIVED, () => {
        if (!isGenerating) queueRenderAll(200);
      });

      // 生成结束/停止 —— 清除标志并立即渲染
      listen(stopList, tavern_events.GENERATION_ENDED, () => {
        isGenerating = false;
        queueRenderAll(80);
      });
      listen(stopList, tavern_events.GENERATION_STOPPED, () => {
        isGenerating = false;
        queueRenderAll(80);
      });

      // 如果存在 GENERATION_STARTED，设置标志
      if (tavern_events.GENERATION_STARTED) {
        listen(stopList, tavern_events.GENERATION_STARTED, () => {
          isGenerating = true;
        });
      }

      // 滑动、编辑、删除
      listen(stopList, tavern_events.MESSAGE_SWIPED, () => queueRenderAll(250), true);
      listen(stopList, tavern_events.MESSAGE_EDITED, () => queueRenderAll(250), true);
      listen(stopList, tavern_events.MESSAGE_DELETED, () => {
        processedSignatures.clear();
        touchedMessageIds.clear();
        queueRenderAll(300);
      }, true);

      // 注意：不监听 MESSAGE_UPDATED，避免频繁触发
    }

    // 首次渲染（延迟，确保 DOM 就绪）
    queueRenderAll(400);

    // 卸载清理
    $(window).on('pagehide', () => {
      disposed = true;
      stopList.forEach(stop => stop());
      restoreTouchedMessages();
      $(`head > style#${styleId()}`).remove();
    });

    console.info('[COT聚合] 脚本已加载（稳定版 + 生成控制）');
  }

  $(() => {
    const run = typeof errorCatched === 'function' ? errorCatched(init) : init;
    run();
  });
})();