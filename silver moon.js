(function () {
  const SCRIPT_ID = typeof getScriptId === "function" ? getScriptId() : "silver_moon_styler";
  const STYLE_ID = `reasoning-style-${SCRIPT_ID}`;
  const DEBUG = false; // 关闭调试日志

  function log(...args) {
    if (DEBUG) console.log("[SilverMoon]", ...args);
  }

  function getTopDocument() {
    try {
      return window.top?.document || document;
    } catch {
      return document;
    }
  }

  function getST() {
    return typeof SillyTavern !== "undefined" ? SillyTavern : null;
  }

  // 主动创建并覆盖 reasoning 配置，确保本脚本样式生效
  function injectConfig() {
    const context = getST()?.getContext?.();
    if (!context) return;
    const settings = context.powerUserSettings ?? (context.powerUserSettings = {});
    if (!settings.reasoning) settings.reasoning = {};
    const config = settings.reasoning;
    config.auto_parse = true;
    config.prefix = "[metacognition]";
    config.suffix = "</thinking>";
  }

  // ===================== CSS（性能优化版） =====================
  const REASONING_CSS = String.raw`
/* ========================================================= */
/*  主题：银月 · 掬水月在手（优化版）                        */
/* ========================================================= */

#chat .mes_reasoning_details[data-state="thinking"],
#chat .mes_reasoning_details[data-state="done"] {
    margin: 16px 0 !important;
    width: 100% !important;
    position: relative !important;
    isolation: isolate !important;
    background: linear-gradient(172deg, #0b1525 0%, #0d1b30 45%, #0b1525 100%) !important;
    border: 1px solid rgba(180, 195, 215, 0.08) !important;
    border-left: 3px solid rgba(180, 195, 215, 0.20) !important;
    border-radius: 20px 6px 20px 6px !important;
    overflow: hidden !important;
    box-shadow: 0 4px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(180,195,215,0.04) !important;
    transition: border-color 0.7s ease, box-shadow 0.7s ease !important;
    box-sizing: border-box !important;
    padding: 0 !important;
    display: block !important;
}

#chat .mes_reasoning_details[data-state="done"] {
    border-color: rgba(180, 195, 215, 0.12) !important;
    border-left-color: rgba(180, 195, 215, 0.35) !important;
    box-shadow: 0 4px 40px rgba(180,195,215,0.05), inset 0 1px 0 rgba(180,195,215,0.06) !important;
}

/* 星空背景（静态） */
#chat .mes_reasoning_details[data-state]::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
        radial-gradient(1px 1px at 12% 8%,  rgba(255,255,255,0.65), transparent),
        radial-gradient(1px 1px at 28% 4%,  rgba(255,255,255,0.35), transparent),
        radial-gradient(1.5px 1.5px at 52% 11%, rgba(255,255,255,0.72), transparent),
        radial-gradient(1px 1px at 72% 6%,  rgba(255,255,255,0.28), transparent),
        radial-gradient(1px 1px at 88% 16%, rgba(255,255,255,0.48), transparent),
        radial-gradient(1.4px 1.4px at 18% 28%, rgba(255,255,255,0.18), transparent),
        radial-gradient(1px 1px at 82% 22%, rgba(255,255,255,0.32), transparent),
        radial-gradient(1.2px 1.2px at 6% 42%,  rgba(255,255,255,0.22), transparent),
        radial-gradient(1px 1px at 94% 38%,  rgba(255,255,255,0.3), transparent);
}

/* 进度光带（仅思考态，纯 transform） */
#chat .mes_reasoning_details[data-state="thinking"]::after {
    content: '';
    position: absolute;
    bottom: 4px;
    left: 12%;
    width: 76%;
    height: 2px;
    z-index: 5;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(180,195,215,0.35), transparent);
    border-radius: 1px;
    animation: sm-progress-slide 2.6s ease-in-out infinite;
}
@keyframes sm-progress-slide {
    0%   { transform: scaleX(0.15); opacity: 0.25; }
    50%  { transform: scaleX(1);    opacity: 0.75; }
    100% { transform: scaleX(0.15); opacity: 0.25; }
}

/* 头部 */
#chat .mes_reasoning_details[data-state] .mes_reasoning_summary,
#chat .mes_reasoning_details[data-state] .mes_reasoning_header_block,
#chat .mes_reasoning_details[data-state] .mes_reasoning_header {
    margin: 0 !important;
    width: 100% !important;
    box-sizing: border-box !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
}
#chat .mes_reasoning_details[data-state] .mes_reasoning_summary {
    position: relative;
    z-index: 10;
    padding: 20px !important;
    min-height: 64px;
    color: rgba(180,195,220,0.65) !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    list-style: none !important;
    display: flex !important;
    align-items: center !important;
    transition: background 0.3s ease !important;
    user-select: none !important;
}
#chat .mes_reasoning_details[data-state] .mes_reasoning_summary:hover {
    background: rgba(180,195,215,0.03) !important;
}
#chat .mes_reasoning_details[data-state] .mes_reasoning_summary::-webkit-details-marker {
    display: none !important;
}
#chat .mes_reasoning_details[data-state] .mes_reasoning_summary::marker {
    content: '';
    font-size: 0;
}
#chat .mes_reasoning_details[data-state] .mes_reasoning_header {
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    width: 100% !important;
    cursor: pointer !important;
    position: relative;
    z-index: 10;
}

/* 屏蔽原生图标 */
#chat .mes_reasoning_details[data-state] .thinking-icon,
#chat .mes_reasoning_details[data-state] .icon-svg,
#chat .mes_reasoning_details[data-state] .mes_reasoning_arrow,
#chat .mes_reasoning_details[data-state] .mes_reasoning_header_text {
    display: none !important;
    font-size: 0 !important;
    opacity: 0 !important;
}

/* 标题文字 */
#chat .mes_reasoning_details[data-state] .mes_reasoning_header_title {
    padding-left: 66px !important;
    font-family: 'Noto Serif SC', serif !important;
    font-size: 1rem !important;
    font-weight: 500 !important;
    letter-spacing: 0.2em !important;
    color: rgba(180,195,220,0.65) !important;
    transition: color 0.8s ease !important;
    flex: 1 !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    flex-wrap: wrap !important;
}

/* 思考中标题（带呼吸动画，仅 opacity + transform） */
#chat .mes_reasoning_details[data-state="thinking"] .mes_reasoning_header_title::before {
    content: '\2726 掬水月在手，弄花香满衣';
    color: rgba(180,195,215,0.70);
    text-shadow: 0 0 18px rgba(180,195,215,0.20);
    animation: sm-title-pulse 3.2s ease-in-out infinite;
}
@keyframes sm-title-pulse {
    0%, 100% { opacity: 0.5; transform: scale(0.92); }
    50%      { opacity: 0.95; transform: scale(1.06); }
}

/* 完成时标题（静态，无动画） */
#chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header_title::before {
    content: '\2726 银月照积雪';
    color: #bcc8d8;
    text-shadow: 0 0 28px rgba(180,195,215,0.50), 0 0 56px rgba(180,195,215,0.20);
    /* 无动画 */
}
/* 副标题（淡入一次） */
#chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header_title::after {
    content: '\2014\2014 银月照积雪，流光正徘徊 \2014\2014';
    font-size: 0.68rem;
    font-family: 'Noto Serif SC', 'STKaiti', 'KaiTi', serif;
    color: rgba(180,195,215,0.50);
    letter-spacing: 0.16em;
    opacity: 0;
    animation: sm-poem-fade-in 2s 0.6s forwards;
}
@keyframes sm-poem-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* 内容区 */
#chat .mes_reasoning_details[data-state] .mes_reasoning {
    position: relative;
    z-index: 8;
    padding: 20px 24px 24px !important;
    margin: 0 !important;
    border: none !important;
    border-top: 1px solid rgba(180,195,215,0.08) !important;
    background: linear-gradient(to top, rgba(6,18,33,0.6), transparent) !important;
    color: rgba(220,228,242,0.92) !important;
    font-size: 0.9rem !important;
    line-height: 1.85 !important;
    max-height: 340px;
    overflow-y: auto;
    font-weight: 400;
}
#chat .mes_reasoning_details[data-state] .mes_reasoning::-webkit-scrollbar { width: 4px; }
#chat .mes_reasoning_details[data-state] .mes_reasoning::-webkit-scrollbar-track { background: transparent; }
#chat .mes_reasoning_details[data-state] .mes_reasoning::-webkit-scrollbar-thumb {
    background: rgba(180,195,215,0.12);
    border-radius: 2px;
    transition: background 0.22s ease;
}
#chat .mes_reasoning_details[data-state] .mes_reasoning::-webkit-scrollbar-thumb:hover {
    background: rgba(180,195,215,0.20);
}

/* ========== 月亮系统（性能优化） ========== */
/* 共用定位 */
#chat .mes_reasoning_details[data-state="thinking"] .mes_reasoning_header::before,
#chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 50%;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    z-index: 12;
    flex-shrink: 0;
    transform: translateY(-50%);
}

/* 思考态：月牙 + 呼吸（仅 opacity + scale） */
#chat .mes_reasoning_details[data-state="thinking"] .mes_reasoning_header::before {
    background: #0b1525;
    box-shadow:
        inset 9px -5px 3px 2px rgba(235,242,250,0.72),
        inset 8px -4px 6px 3px rgba(200,215,235,0.58),
        inset 7px -4px 12px 4px rgba(175,195,220,0.48),
        inset 6px -3px 20px 5px rgba(150,170,195,0.32),
        inset 5px -2px 30px 6px rgba(125,145,170,0.16),
        0 0 0 1px rgba(11,21,37,0.35),
        0 0 12px rgba(180,195,215,0.35),
        0 0 26px rgba(180,195,215,0.20);
    animation: sm-crescent-breathe 3.2s ease-in-out infinite;
}
@keyframes sm-crescent-breathe {
    0%, 100% { opacity: 0.5;  transform: translateY(-50%) scale(0.9);  }
    50%      { opacity: 0.95; transform: translateY(-50%) scale(1.08); }
}

/* 完成态：圆月（静态，无动画） */
#chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header::before {
    background: radial-gradient(circle at 36% 34%,
        #f4f7fa 0%, #c0cce0 32%, #9aaec4 65%, #708098 92%, #4e5d70 100%);
    box-shadow:
        0 0 20px rgba(180,195,215,0.50),
        0 0 44px rgba(180,195,215,0.35),
        0 0 72px rgba(175,195,220,0.1);
    /* 无动画，保持静态 */
}

/* 发光层（仅思考态有微呼吸，完成态静态） */
#chat .mes_reasoning_details[data-state="thinking"] .mes_reasoning_header::after,
#chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header::after {
    content: '';
    position: absolute;
    left: 8px;
    top: 50%;
    width: 80px;
    height: 80px;
    transform: translate(-19px, -50%);
    border-radius: 50%;
    z-index: 11;
    pointer-events: none;
    filter: blur(7px);
}
#chat .mes_reasoning_details[data-state="thinking"] .mes_reasoning_header::after {
    background: radial-gradient(circle at 36% 34%, rgba(180,200,225,0.1) 0%, transparent 62%);
    animation: sm-crescent-glow 3.2s ease-in-out infinite;
}
@keyframes sm-crescent-glow {
    0%, 100% { opacity: 0.25; transform: translate(-19px, -50%) scale(0.88); }
    50%      { opacity: 0.55; transform: translate(-19px, -50%) scale(1.18); }
}
#chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header::after {
    background: radial-gradient(circle at 36% 34%, rgba(205,220,240,0.15) 0%, transparent 60%);
    /* 静态，无动画 */
}

/* 响应式 */
@media (max-width: 600px) {
    #chat .mes_reasoning_details[data-state] .mes_reasoning_summary {
        padding: 14px 12px !important;
        min-height: 50px;
    }
    #chat .mes_reasoning_details[data-state="thinking"] .mes_reasoning_header::before,
    #chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header::before {
        width: 32px;
        height: 32px;
        left: 4px;
    }
    #chat .mes_reasoning_details[data-state="thinking"] .mes_reasoning_header::after,
    #chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header::after {
        width: 60px;
        height: 60px;
        left: 4px;
        transform: translate(-14px, -50%);
    }
    #chat .mes_reasoning_details[data-state] .mes_reasoning_header_title {
        padding-left: 50px !important;
        font-size: 0.88rem !important;
        letter-spacing: 0.14em !important;
    }
    #chat .mes_reasoning_details[data-state] .mes_reasoning {
        padding: 12px 16px !important;
    }
    @keyframes sm-crescent-glow {
        0%, 100% { opacity: 0.25; transform: translate(-14px, -50%) scale(0.88); }
        50%      { opacity: 0.55; transform: translate(-14px, -50%) scale(1.18); }
    }
}

/* 对 motion 敏感用户降级 */
@media (prefers-reduced-motion: reduce) {
    #chat .mes_reasoning_details[data-state] * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}
`;

  // ===================== 注入与卸载 =====================
  function injectStyleOnce(doc) {
    if (!doc || !doc.head) return;
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
      doc.head.appendChild(style);
    }
    style.textContent = REASONING_CSS;
  }

  function injectStyle() {
    const topDoc = getTopDocument();
    injectStyleOnce(topDoc);
    // 避免重复注入主文档（若 topDoc === document 则只注入一次）
    if (topDoc !== document) injectStyleOnce(document);
  }

  function removeStyle() {
    const topDoc = getTopDocument();
    for (const doc of [topDoc, document]) {
      const style = doc?.getElementById?.(STYLE_ID);
      if (style) style.remove();
    }
  }

  function init() {
    injectConfig();
    injectStyle();
    window.addEventListener("pagehide", removeStyle);
    log("SilverMoon styler initialized (lightweight).");
  }

  // 启动（使用 jQuery 以确保在动态加载时也能正确执行）
  $(() => {
    errorCatched(init)();
  });
})();