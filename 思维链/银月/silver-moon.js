(function () {
  const VERSION = "1.3";
  const SCRIPT_ID = typeof getScriptId === "function" ? getScriptId() : "silver_moon_styler";
  const STYLE_ID = `reasoning-style-${SCRIPT_ID}`;
  const BACKUP_KEY = `__silvermoon_backup_${SCRIPT_ID}`;
  const DEBUG = false; // 关闭调试日志

  // ===================== 可配置项 =====================
  //
  // ⚠️ prefix / suffix 是**字面量**，不是正则。
  //    ST 的 parseReasoningFromString（scripts/reasoning.js:1238）是
  //        new RegExp(`^\\s*?${escapeRegex(prefix)}(.*?)${escapeRegex(suffix)}`, 's')
  //    —— 它会把这两个字符串 escape 一遍再编译（escapeRegex 见 scripts/utils.js:1269）。
  //    所以老写法 "\\[metacognition\\]"（正则年代的转义）在现在的 ST 上只会去匹配
  //    「带反斜杠的 \[metacognition\]」，正文里正常的 [metacognition] 永远匹配不到。
  //    这里改成字面量，和 default-user/reasoning/明月.json 里的值保持一致。
  const CONFIG = {
    manageReasoningConfig: true,
    onlyIfUnset: true,
    prefix: "[metacognition]\n",
    suffix: "\n</thinking>",
    autoParse: true,
    thinkingTitle: "✦ 掬水月在手，弄花香满衣",
    doneTitle: "✦ 银月照积雪",
    doneSubtitle: "—— 银月照积雪，流光正徘徊 ——",

    // ============ 接管「其他预设的开头思维链」（默认开，见 README「流式」一节）============
    // 背景：ST 的 reasoning 解析只认**一对字面量** prefix/suffix，换个预设就得手动换模板。
    // 打开这个开关后，银月会装正则把各种开头的思维链包裹（<think>…</think>、
    // [metacognition]…</thinking>、<基础确认>… 等）统一改写成银月自己的那对 wrapper，
    // 于是所有预设的思维链都走 ST 原生那**一条**通道 —— 结构上不可能出现两个块。
    adoptLeadingThink: true,

    // 流式期间也改写（**这条决定你会不会"出完字才渲染"，默认必须开**）。
    // ST 每个 token 都会跑一次 cleanUpMessage（script.js:3323 → :6020），
    // 而流式解析的判定是 message.mes.startsWith(prefix)（reasoning.js:427）。
    // 只有开标签时就先把开标签换掉，ST 才会从第一个 token 起进入「思考中」态、
    // 把正在流的字一路搬进思维块（reasoning.js:440-442），思维块跟着字长出来。
    normalizeWhileStreaming: true,

    // 认哪些「开头包裹」：一对对字面量（不是正则）。只匹配**消息开头**，
    // 正文里出现的同款标签一律不动（正则带 ^ 锚，且不带 g，只吃第一处）。
    leadingThinkWrappers: [
      ["<think>", "</think>"],
      ["<thinking>", "</thinking>"],
      ["<thought>", "</thought>"],
      ["<reasoning>", "</reasoning>"],
      ["<analysis>", "</analysis>"],
      ["[metacognition]", "</thinking>"],
      ["[metacognition]", "[/metacognition]"],
      ["<基础确认>", "</基础确认>"],
      ["<思考>", "</思考>"],
      ["[思考]", "[/思考]"],
      ["<思维链>", "</思维链>"],
    ],

    // 银月写给 ST 的那对 wrapper（归一化的目标）。和 明月.json 模板同款。
    canonicalPrefix: "[metacognition]",
    canonicalSuffix: "</thinking>",

    // 归一化正则放哪一层：'global'（全局正则）/ 'preset'（预设正则）/ 'character'（角色卡正则）
    // 默认全局：切预设也还在。注意 ST 的执行顺序是 全局 → 预设 → 角色卡（engine.js:11-16）。
    normalizeScope: "global",
    // 归一化正则的名字（在「酒馆正则」列表里看到的就是它们）
    normalizeScriptName: "银月 · 思维链归一（勿删）",
    normalizeStreamScriptName: "银月 · 思维链归一·流式（勿删）",

    // 有别的「启用中、会显示」的正则在管同一批标签时：银月让位（不装归一化正则），只告警。
    // 想强制接管：控制台 __silverMoon.takeOver()
    yieldToOtherRegexes: true,
    // 让位判定扫哪些作用域
    arbitrationScopes: ["global", "preset", "character"],
    // 控制台多说一点
    verbose: false,
  };

  function log(...args) {
    if (!DEBUG && !CONFIG.verbose) return;
    console.log("[SilverMoon]", ...args);
  }

  function warn(...args) {
    try {
      console.warn("[SilverMoon]", ...args);
    } catch (_) { /* noop */ }
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

  // 将用户可配置文案安全插入 CSS 字符串字面量（单引号内）
  function cssEscape(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r?\n/g, "\\A ");
  }

  // 优先同步保存，回退到防抖保存。pagehide 时防抖版可能来不及落盘。
  function persistSettings() {
    const st = getST();
    const sync = st?.saveSettings;
    if (typeof sync === "function") {
      try { sync(); return; } catch (_) { /* fallthrough */ }
    }
    const deb = st?.saveSettingsDebounced;
    if (typeof deb === "function") {
      try { deb(); } catch (_) { /* noop */ }
    }
  }

  // ===================== reasoning 配置管理 =====================
  // 原版会无条件覆盖用户的 reasoning 解析配置（auto_parse / prefix / suffix），
  // 有两个问题：
  //   1. 用户自己配置好的解析标记会被静默破坏；
  //   2. prefix/suffix 会被 SillyTavern 当作正则编译，
  //      未转义的 "[metacognition]" 会变成字符类，导致解析错乱。
  // 现改为：仅在用户从未配置时写入默认值（可强制），并在脚本清理时恢复现场。
  //
  // 备份通过 window[BACKUP_KEY] 跨实例共享：脚本被重新加载时，新实例
  // 能先拿回旧实例留下的原始配置并恢复，再重新备份干净状态，避免配置丢失。

  let savedReasoningState = window[BACKUP_KEY] ?? null;

  function injectConfig() {
    if (!CONFIG.manageReasoningConfig) return;
    const context = getST()?.getContext?.();
    if (!context) return;
    const settings = context.powerUserSettings ?? (context.powerUserSettings = {});

    // 备份必须在创建 settings.reasoning 之前完成，
    // 否则 hasOwnProperty 永远为 true，existed 判断失效。
    if (savedReasoningState === null) {
      savedReasoningState = {
        existed: Object.prototype.hasOwnProperty.call(settings, 'reasoning'),
        auto_parse: settings.reasoning?.auto_parse,
        prefix: settings.reasoning?.prefix,
        suffix: settings.reasoning?.suffix,
      };
      try { window[BACKUP_KEY] = savedReasoningState; } catch (_) { /* noop */ }
    }

    if (!settings.reasoning) settings.reasoning = {};
    const config = settings.reasoning;

    // 接管其他预设的开头思维链时，wrapper 必须由银月来定（归一化正则写进去的就是它）。
    // ⚠️ 但这**不能**在这里做：铺配置必须等探针和冲突检查都过了才允许
    // （syncLeadingThink 里的 applyCanonicalConfig），否则会出现「让位了、却把
    // ST 的 reasoning 配置改了一半」的状态 —— 那时 ST 会自己去搬 `[metacognition]…</thinking>`，
    // 而预设自己的 `<think>` 包装链还在，两边一起动，正文和聊天记录都会被改坏。
    if (CONFIG.adoptLeadingThink) return;

    let changed = false;
    const userConfigured = Boolean(config.prefix || config.suffix);
    if (CONFIG.onlyIfUnset && userConfigured) {
      // 尊重用户配置：仅当 auto_parse 从未显式设置时才补一个默认开启
      if (config.auto_parse === undefined) {
        config.auto_parse = CONFIG.autoParse;
        changed = true;
      }
    } else {
      if (config.auto_parse !== CONFIG.autoParse) { config.auto_parse = CONFIG.autoParse; changed = true; }
      if (config.prefix !== CONFIG.prefix) { config.prefix = CONFIG.prefix; changed = true; }
      if (config.suffix !== CONFIG.suffix) { config.suffix = CONFIG.suffix; changed = true; }
    }

    // 仅在确有改动时持久化，避免无谓写入
    if (changed) persistSettings();
  }

  // 把配置还原成「银月动手之前」的样子；备份留着，之后还能再铺一次
  function revertOwnReasoningConfig() {
    if (savedReasoningState === null) return false;
    try {
      const settings = getST()?.getContext?.()?.powerUserSettings;
      if (!settings) return false;
      const config = settings.reasoning;
      if (!config) return false;
      config.auto_parse = savedReasoningState.auto_parse;
      config.prefix = savedReasoningState.prefix;
      config.suffix = savedReasoningState.suffix;
      // 原本不存在 reasoning 键时整体移除，避免残留空对象
      if (!savedReasoningState.existed) delete settings.reasoning;
      persistSettings();
      return true;
    } catch (_) {
      return false;
    }
  }

  function restoreReasoningConfig() {
    if (savedReasoningState === null) return;
    revertOwnReasoningConfig();
    savedReasoningState = null;
    try { delete window[BACKUP_KEY]; } catch (_) { /* noop */ }
  }

  // ===================== 接管其他预设的「开头思维链」 =====================
  //
  // 下面每条结论都对着本机 ST 源码核过（E:\share\SillyTavern，1.14.0）：
  //
  //  1. scripts/reasoning.js:1231-1258 parseReasoningFromString
  //       new RegExp(`^\\s*?${escapeRegex(prefix)}(.*?)${escapeRegex(suffix)}`, 's')
  //     · prefix/suffix 是**字面量**（escapeRegex，utils.js:1269）→ 写不成 alternation；
  //     · strict 时锚在**消息开头**（^\\s*?）；
  //     · String.replace 没带 g → 一条消息只吃**第一处**。
  //  2. 同文件 1337-1343：解析成功后 message.mes = parsedReasoning.content 并保存
  //     → 包裹被**永久删掉**，同一条通道内部不可能出现两份内容。
  //     解析挂在 MESSAGE_RECEIVED / MESSAGE_UPDATED（同文件 1354）。
  //  3. extensions/regex/engine.js:293-300 的准入条件：
  //       (markdownOnly && isMarkdown) || (promptOnly && isPrompt) ||
  //       (!markdownOnly && !promptOnly && !isMarkdown && !isPrompt)
  //     第三条 = 「改消息本身」那一趟，发生在 script.js:6020（收到 AI 回复、入账之前），
  //     **早于**第 2 条的 reasoning 解析。
  //     → 归一化正则只要那两个「仅…」都不勾，就一定吃在解析之前；标签被吃掉了，
  //       别人预设的美化正则再也 find 不到 —— 这才是「不会两个都有」的机制，不靠运气。
  //  4. extensions/regex/engine.js:11-16,44：脚本顺序由 Object.values(SCRIPT_TYPES) 决定
  //     → 全局(0) → 预设(2) → 角色卡(1)。银月默认装全局，所以吃在预设正则之前。
  //
  // 仍然会「看起来多了一个」的两种情况（下面用探针 + 让位 + 自检兜住）：
  //   a. 消息已经带了 reasoning 字段时 ST 会**跳过**解析（reasoning.js:1311-1314），
  //      我们刚写进正文的 wrapper 就没被删掉；
  //   b. 别人预设的显示正则在**旧消息**上照常渲染（那些消息没经过归一化）→ 新旧外观不一致。
  //   两者都会在 __silverMoon.status() / selfCheck() 里报出来。

  const normalizeState = {
    enabled: false,
    state: 'off', // off | no-wrappers | probe-failed | yielded | installed | present | failed
    regex: '',
    replace: '',
    rules: [],
    conflicts: [],
    probe: null,
    note: '',
    forced: false,
    // 银月现在有没有占着 ST 的 reasoning 配置（让位时必须还回去）
    configApplied: false,
  };
  let forcedTakeOver = false;

  function toast(message, type) {
    try {
      const fn = typeof toastr !== "undefined" && toastr && toastr[type || "success"];
      if (typeof fn === "function") fn.call(toastr, message);
    } catch (_) { /* noop */ }
  }

  function getTavernHelper() {
    try {
      if (typeof window !== "undefined" && window.TavernHelper) return window.TavernHelper;
    } catch (_) { /* noop */ }
    return null;
  }

  function bareGlobal(name) {
    try {
      if (typeof window !== "undefined" && typeof window[name] === "function") return window[name];
    } catch (_) { /* noop */ }
    return null;
  }

  // ST 的 findRegex 存成 "/source/flags"，所以：
  //   · source 里的 / 要转义
  //   · 换行/回车/制表必须写成 \n \r \t —— 真换行放进去会让 ST 的
  //     regexFromString（utils.js:1279，用的是 `.` 不匹配换行的那套解析）当场解析失败。
  //     canonicalPrefix 是 "[metacognition]\n"，带真换行，这里必须处理。
  function regexEscapeLiteral(text) {
    return String(text).replace(/[\\\n\r\t.*+?^${}()|[\]\/]/g, (ch) => {
      if (ch === "\n") return "\\n";
      if (ch === "\r") return "\\r";
      if (ch === "\t") return "\\t";
      return "\\" + ch;
    });
  }

  function wrapperAlternation() {
    const wrappers = Array.isArray(CONFIG.leadingThinkWrappers) ? CONFIG.leadingThinkWrappers : [];
    const opens = [];
    const closes = [];
    for (const pair of wrappers) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const open = String(pair[0] || "");
      const close = String(pair[1] || "");
      if (!open || !close) continue;
      if (!opens.includes(open)) opens.push(open);
      if (!closes.includes(close)) closes.push(close);
    }
    if (!opens.length || !closes.length) return null;
    return { opens: opens.map(regexEscapeLiteral).join("|"), closes: closes.map(regexEscapeLiteral).join("|") };
  }

  // 两条规则，都只认**消息开头**那一处
  // （^ 锚；不带 g 只替换第一处；不带 m，所以 ^ 就是整个字符串的开头）：
  //   ① 闭合时：整个包裹 → 银月那对 wrapper
  //   ② 只有开标签时（流式正在写）：只把开标签换成银月的开标签，
  //      **绝不补上闭合标签** —— 补了 ST 会以为思维链已经结束、马上切回正文流。
  function buildNormalizeRules() {
    const alt = wrapperAlternation();
    if (!alt) return [];
    // `(?!canonical)` 很关键：规则不能对自己的产物再动手。
    // canonicalPrefix 是 "[metacognition]\n"，而名单里也有 "[metacognition]"，
    // 不加这个负向预查，规则 2 会把刚写好的 "[metacognition]\n思考" 再拼一次前缀，
    // 变成 "[metacognition]\n\n思考"（思维块开头多一个空行）。
    const guard = CONFIG.canonicalPrefix ? "(?!" + regexEscapeLiteral(CONFIG.canonicalPrefix) + ")" : "";
    const rules = [
      {
        name: CONFIG.normalizeScriptName,
        find: "/^" + guard + "\\s*(?:" + alt.opens + ")([\\s\\S]*?)(?:" + alt.closes + ")/s",
        replace: CONFIG.canonicalPrefix + "$1" + CONFIG.canonicalSuffix,
        streaming: false,
      },
    ];
    if (CONFIG.normalizeWhileStreaming) {
      rules.push({
        name: CONFIG.normalizeStreamScriptName,
        find: "/^" + guard + "\\s*(?:" + alt.opens + ")([\\s\\S]*)$/s",
        replace: CONFIG.canonicalPrefix + "$1",
        streaming: true,
      });
    }
    return rules;
  }

  // 卸载时按这张固定名单找，免得「关掉流式后旧条目留在酒馆里」
  function normalizeScriptNames() {
    return [CONFIG.normalizeScriptName, CONFIG.normalizeStreamScriptName];
  }

  function normalizeScopeOption() {
    const scope = String(CONFIG.normalizeScope || "global");
    if (scope === "preset") return { type: "preset", name: "in_use" };
    if (scope === "character") return { type: "character", name: "current" };
    return { type: "global" };
  }

  // 酒馆助手（JS-Slash-Runner）格式
  // destination 两个都是 false = 「只改消息本身」，正好是 engine.js:299 那一支
  function makeNormalizeScriptTH(name, find, replace) {
    return {
      id: "silver-moon-normalize" + (name === CONFIG.normalizeStreamScriptName ? "-stream" : ""),
      script_name: name,
      enabled: true,
      find_regex: find,
      replace_string: replace,
      trim_strings: [],
      source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
      destination: { display: false, prompt: false },
      run_on_edit: true,
      min_depth: null,
      max_depth: null,
    };
  }

  // 酒馆原生格式（直接写 extension_settings.regex 时用）
  function makeNormalizeScriptNative(name, find, replace) {
    return {
      id: "silver-moon-normalize" + (name === CONFIG.normalizeStreamScriptName ? "-stream" : ""),
      scriptName: name,
      findRegex: find,
      replaceString: replace,
      trimStrings: [],
      placement: [2], // 2 = AI 输出
      disabled: false,
      markdownOnly: false, // 关键：两个「仅…」都不勾 = 改消息本身，吃在 reasoning 解析之前
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    };
  }

  function getRegexApi() {
    const TH = getTavernHelper();
    return {
      get: (TH && TH.getTavernRegexes) || bareGlobal("getTavernRegexes"),
      update: (TH && TH.updateTavernRegexesWith) || bareGlobal("updateTavernRegexesWith"),
    };
  }

  // 从 ST 读「当前真正生效」的 reasoning 配置（不是 CONFIG 里的）
  function reasoningSnapshot() {
    try {
      const r = getST()?.getContext?.()?.powerUserSettings?.reasoning;
      if (!r) return null;
      return {
        name: r.name,
        auto_parse: !!r.auto_parse,
        prefix: r.prefix,
        suffix: r.suffix,
        separator: r.separator,
        add_to_prompts: !!r.add_to_prompts,
      };
    } catch (_) {
      return null;
    }
  }

  // 铺银月那对 wrapper。**只允许在探针 + 冲突检查都过了之后调用**，
  // 否则就会出现「让位了、配置却被改了一半」的坏状态。
  function applyCanonicalConfig() {
    if (!CONFIG.manageReasoningConfig) return false;
    try {
      const settings = getST()?.getContext?.()?.powerUserSettings;
      if (!settings) return false;
      if (!settings.reasoning) settings.reasoning = {};
      const config = settings.reasoning;
      let dirty = false;
      if (config.auto_parse !== true) { config.auto_parse = true; dirty = true; }
      if (config.prefix !== CONFIG.canonicalPrefix) { config.prefix = CONFIG.canonicalPrefix; dirty = true; }
      if (config.suffix !== CONFIG.canonicalSuffix) { config.suffix = CONFIG.canonicalSuffix; dirty = true; }
      if (dirty) persistSettings();
      return true;
    } catch (_) {
      return false;
    }
  }

  // 用 ST 自己的解析器当探针：我们写进正文、又指望 ST 吃掉的那对 wrapper，
  // 真的会被解析成 reasoning 块吗？过不了就不装正则（否则正文里会留下一串没人认的 wrapper）。
  function getParseFn() {
    try {
      const ctx = getST()?.getContext?.();
      if (ctx && typeof ctx.parseReasoningFromString === "function") return ctx.parseReasoningFromString;
    } catch (_) { /* noop */ }
    try {
      if (typeof parseReasoningFromString === "function") return parseReasoningFromString;
    } catch (_) { /* noop */ }
    return null;
  }

  function probeCanonicalParse() {
    const fn = getParseFn();
    if (typeof fn !== "function") {
      return { ok: false, reason: "拿不到 ST 的 parseReasoningFromString（SillyTavern.getContext() 没暴露？）" };
    }
    const marker = "sm-probe-" + Date.now();
    const sample = CONFIG.canonicalPrefix + marker + CONFIG.canonicalSuffix;
    try {
      const parsed = fn(sample);
      const reasoning = String((parsed && parsed.reasoning) || "");
      const content = String((parsed && parsed.content) || "");
      const ok = !!parsed && reasoning === marker && content.indexOf(marker) === -1;
      return {
        ok,
        reason: ok ? "ok" : "ST 没把这对 wrapper 解析成 reasoning 块（prefix/suffix 现在生效的是什么？看 status().reasoning）",
        sample,
        parsed: parsed ? { reasoning: parsed.reasoning, content: parsed.content } : null,
      };
    } catch (error) {
      return { ok: false, reason: "探针抛错：" + (error && error.message), sample };
    }
  }

  // ---- 冲突检测（C：让位）----
  function isEnabledRegexItem(item) {
    if (!item) return false;
    if (typeof item.enabled === "boolean") return item.enabled;
    return !item.disabled;
  }

  // 只看「会影响显示」的正则：纯提示词侧（destination.prompt && !display）不参与仲裁
  function regexTouchesDisplay(item) {
    if (!item) return false;
    if (item.destination) {
      const display = !!item.destination.display;
      const prompt = !!item.destination.prompt;
      return display || !prompt;
    }
    const md = !!item.markdownOnly;
    const pr = !!item.promptOnly;
    return md || !pr;
  }

  function collectForeignRegexes() {
    const out = [];
    const seen = {};
    const api = getRegexApi();
    if (typeof api.get !== "function") return out;
    const scopes = Array.isArray(CONFIG.arbitrationScopes) && CONFIG.arbitrationScopes.length
      ? CONFIG.arbitrationScopes
      : ["global"];
    for (const scopeName of scopes) {
      const scope = scopeName === "preset"
        ? { type: "preset", name: "in_use" }
        : scopeName === "character"
          ? { type: "character", name: "current" }
          : { type: "global" };
      let list = [];
      try {
        list = api.get(scope) || [];
      } catch (_) {
        continue;
      }
      for (const item of list) {
        if (!isEnabledRegexItem(item) || !regexTouchesDisplay(item)) continue;
        const name = String(item.script_name || item.scriptName || "(未命名)");
        // 自己那两条当然不算冲突（否则第二次 refresh 就会自己让位给自己）
        if (isOurNormalizeName(name)) continue;
        const find = String(item.find_regex || item.findRegex || "");
        if (!find) continue;
        const key = name + "\u0000" + find;
        if (seen[key]) continue;
        seen[key] = true;
        out.push({ name, find, scope: scopeName });
      }
    }
    return out;
  }

  // 从 wrapper 字面量里取出标签名，用来判断别的正则是不是在管同一批标签
  function wrapperCores() {
    const cores = [];
    const push = (core, style) => {
      if (!core) return;
      if (!cores.some((c) => c.core === core && c.style === style)) cores.push({ core, style });
    };
    const wrappers = Array.isArray(CONFIG.leadingThinkWrappers) ? CONFIG.leadingThinkWrappers : [];
    for (const pair of wrappers) {
      if (!Array.isArray(pair)) continue;
      for (const literal of pair) {
        const text = String(literal || "").trim();
        let m = text.match(/^<\/?([^<>\/\s]+)>$/);
        if (m) { push(m[1], "xml"); continue; }
        m = text.match(/^\[\/?([^\[\]\/\s]+)\]$/);
        if (m) push(m[1], "bracket");
      }
    }
    return cores;
  }

  // 判定要精确到「标签名 + 边界」：<think> 的规则不该被 <thinking_left> 误判成冲突
  function regexHitsWrapper(find, core, style) {
    const text = String(find || "");
    if (!text) return false;
    const forms = style === "bracket"
      ? ["[" + core + "]", "[/" + core + "]", "[\\/" + core + "]", "[\\s*" + core + "\\s*]"]
      : ["<" + core + ">", "</" + core + ">", "<" + core + "\\s", "<\\/" + core + ">", "<\\/" + core + "\\s", "<\\s*" + core + "\\s*>"];
    return forms.some((f) => text.indexOf(f) !== -1);
  }

  function findConflicts() {
    const cores = wrapperCores();
    const hits = [];
    for (const r of collectForeignRegexes()) {
      for (const c of cores) {
        if (!regexHitsWrapper(r.find, c.core, c.style)) continue;
        const label = c.style === "bracket" ? "[" + c.core + "]" : "<" + c.core + ">";
        if (!hits.some((h) => h.regex === r.name && h.tag === label)) {
          hits.push({ regex: r.name, scope: r.scope, tag: label });
        }
      }
    }
    return hits;
  }

  // ---- 装卸归一化正则 ----
  // 注意：酒馆助手的 updateTavernRegexesWith 写完会 render_tavern_regexes_debounced()
  // （tavern_regex.ts:249-258）——**重排整个聊天**。所以没有实际变化时一律不碰它。
  function isOurNormalizeName(name) {
    return normalizeScriptNames().indexOf(String(name || "")) !== -1;
  }

  function scopeHasNormalizeRegex(api, scope) {
    if (typeof api.get !== "function") return false;
    try {
      return (api.get(scope) || []).some((r) => r && isOurNormalizeName(r.script_name || r.scriptName));
    } catch (_) {
      return false;
    }
  }

  function installNormalizeRegex() {
    const rules = buildNormalizeRules();
    if (!rules.length) return Promise.resolve("no-wrappers");
    const api = getRegexApi();
    const scope = normalizeScopeOption();
    const existed = scopeHasNormalizeRegex(api, scope);
    if (typeof api.get === "function" && typeof api.update === "function") {
      return Promise.resolve()
        .then(() => api.update((regexes) => {
          const wanted = rules.map((r) => r.name);
          const nameOf = (r) => (r && (r.script_name || r.scriptName)) || "";
          // 先把「不再需要的自己人」摘掉（比如刚把流式那条关掉），剩下的再 upsert
          const next = (regexes || []).filter((r) => !(r && isOurNormalizeName(nameOf(r)) && wanted.indexOf(nameOf(r)) === -1));
          // 中途被关掉（比如 init 那次安装还没落地、用户就 takeOver/uninstall 了）：
          // 这一趟改成「摘干净」，别把已经关掉的东西又写回去。
          if (!CONFIG.adoptLeadingThink) {
            return next.filter((r) => !(r && isOurNormalizeName(nameOf(r))));
          }
          for (const rule of rules) {
            let hit = false;
            for (let i = 0; i < next.length; i++) {
              if (next[i] && (next[i].script_name === rule.name || next[i].scriptName === rule.name)) {
                next[i] = Object.assign({}, next[i], {
                  enabled: true,
                  find_regex: rule.find,
                  replace_string: rule.replace,
                  source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
                  // display/prompt 都是 false ↔ markdownOnly/promptOnly 都是 false（tavern_regex.ts:154-157）
                  destination: { display: false, prompt: false },
                  run_on_edit: true,
                });
                hit = true;
              }
            }
            if (!hit) next.push(makeNormalizeScriptTH(rule.name, rule.find, rule.replace));
          }
          return next;
        }, scope))
        .then(() => (existed ? "present" : "installed"))
        .catch((error) => {
          warn("装归一化正则失败，退回原生设置。", error);
          return installNormalizeRegexNative(rules);
        });
    }
    return Promise.resolve(installNormalizeRegexNative(rules));
  }

  function installNormalizeRegexNative(rules) {
    try {
      const ctx = getST()?.getContext?.();
      const settings = ctx && ctx.extension_settings;
      if (!settings) return "failed";
      if (!Array.isArray(settings.regex)) settings.regex = [];
      const wanted = rules.map((r) => r.name);
      // 同样先摘掉不再需要的自己人
      settings.regex = settings.regex.filter((r) => !(r && isOurNormalizeName(r.scriptName) && wanted.indexOf(r.scriptName) === -1));
      let anyFound = false;
      for (const rule of rules) {
        let found = false;
        for (const item of settings.regex) {
          if (item && item.scriptName === rule.name) {
            item.findRegex = rule.find;
            item.replaceString = rule.replace;
            item.disabled = false;
            item.markdownOnly = false;
            item.promptOnly = false;
            item.placement = [2];
            item.runOnEdit = true;
            found = true;
          }
        }
        if (!found) settings.regex.push(makeNormalizeScriptNative(rule.name, rule.find, rule.replace));
        anyFound = anyFound || found;
      }
      if (typeof ctx.saveSettingsDebounced === "function") ctx.saveSettingsDebounced();
      return anyFound ? "present" : "installed";
    } catch (error) {
      warn("写 extension_settings.regex 失败。", error);
      return "failed";
    }
  }

  function removeNormalizeRegex() {
    // 先把原生列表里那两条**同步**摘掉（不等微任务）：cleanup() 紧接着就会还原
    // prefix/suffix，必须保证「正则已经不在、配置才被改回去」这个顺序。
    let removed = false;
    try {
      const ctx = getST()?.getContext?.();
      const settings = ctx && ctx.extension_settings;
      const list = settings && Array.isArray(settings.regex) ? settings.regex : null;
      if (list && list.some((r) => r && isOurNormalizeName(r.scriptName))) {
        settings.regex = list.filter((r) => !(r && isOurNormalizeName(r.scriptName)));
        if (typeof ctx.saveSettingsDebounced === "function") ctx.saveSettingsDebounced();
        removed = true;
      }
    } catch (error) {
      warn("卸载归一化正则失败。", error);
    }
    // 预设 / 角色卡作用域走酒馆助手（默认是 global，走不到这里）
    const api = getRegexApi();
    const scope = normalizeScopeOption();
    if (scope.type !== "global" && scopeHasNormalizeRegex(api, scope) && typeof api.update === "function") {
      return Promise.resolve(
        api.update((regexes) => (regexes || []).filter((r) => !(r && isOurNormalizeName(r.script_name || r.scriptName))), scope),
      ).catch((error) => warn("卸载归一化正则失败。", error));
    }
    return Promise.resolve(removed ? "removed" : "absent");
  }

  function hasNormalizeRegex() {
    const api = getRegexApi();
    if (scopeHasNormalizeRegex(api, normalizeScopeOption())) return true;
    try {
      const settings = getST()?.getContext?.()?.extension_settings;
      return !!(settings && Array.isArray(settings.regex) && settings.regex.some((r) => r && isOurNormalizeName(r.scriptName)));
    } catch (_) {
      return false;
    }
  }

  // ---- 总调度 ----
  // 顺序很重要：**先铺配置（探针要用）→ 探针 → 冲突 → 才决定装不装**；
  // 任何一步不过，都要把刚铺的配置**还回去**（revertOwnReasoningConfig）。
  // 之前就是漏了这一步，才出现「让位了、ST 的 reasoning 配置却被改了一半」：
  // ST 会自己去搬 `[metacognition]…</thinking>`，而预设自己的 `<think>` 包装链照跑，
  // 两边一起动手 → 正文和聊天记录都被改坏（真实消息 <dream_plot> 那条就是这个症状）。
  function syncLeadingThink() {
    normalizeState.enabled = !!CONFIG.adoptLeadingThink;
    normalizeState.forced = forcedTakeOver;
    normalizeState.conflicts = [];
    normalizeState.note = "";
    normalizeState.probe = null;
    normalizeState.configApplied = false;

    if (!CONFIG.adoptLeadingThink) {
      normalizeState.state = "off";
      normalizeState.regex = "";
      normalizeState.replace = "";
      normalizeState.rules = [];
      revertOwnReasoningConfig();
      removeNormalizeRegex();
      return Promise.resolve(normalizeState);
    }

    const rules = buildNormalizeRules();
    normalizeState.rules = rules;
    normalizeState.regex = rules.map((r) => r.find).join("\n");
    normalizeState.replace = rules.map((r) => r.replace).join("\n");
    if (!rules.length) {
      normalizeState.state = "no-wrappers";
      normalizeState.note = "leadingThinkWrappers 是空的";
      revertOwnReasoningConfig();
      removeNormalizeRegex();
      warn("银月：adoptLeadingThink 开着，但 leadingThinkWrappers 是空的，没装归一化正则。");
      return Promise.resolve(normalizeState);
    }

    // 铺配置（只在真正要接管的情况下才会留下来）
    normalizeState.configApplied = applyCanonicalConfig();

    // 守卫一：探针 —— ST 真的会把这对 wrapper 解析成 reasoning 块吗
    const probe = probeCanonicalParse();
    normalizeState.probe = probe;
    if (!probe.ok) {
      normalizeState.state = "probe-failed";
      normalizeState.note = probe.reason;
      revertOwnReasoningConfig();
      normalizeState.configApplied = false;
      removeNormalizeRegex();
      warn("银月：探针没过，**没装**归一化正则，也把你原来的 reasoning 配置还回去了。\n" +
        "  原因：" + probe.reason + "\n  探针串：" + JSON.stringify(probe.sample) +
        "\n  现在生效的 reasoning 配置：控制台 __silverMoon.status().reasoning");
      toast("银月：reasoning 探针没过，归一化没接管（看控制台）", "warning");
      return Promise.resolve(normalizeState);
    }

    // 守卫二：冲突让位 —— 别的正则在管同一批标签就不接管
    const conflicts = findConflicts();
    normalizeState.conflicts = conflicts;
    if (conflicts.length && CONFIG.yieldToOtherRegexes && !forcedTakeOver) {
      normalizeState.state = "yielded";
      normalizeState.note = "有 " + conflicts.length + " 处冲突，银月让位";
      revertOwnReasoningConfig();
      normalizeState.configApplied = false;
      removeNormalizeRegex();
      warn("银月：这些标签有别的正则在管，银月让位（没装归一化正则，配置也还回去了）：\n" +
        conflicts.map((c) => "  · " + c.tag + " ← " + c.regex + "（" + c.scope + "）").join("\n") +
        "\n  要强制由银月接管：控制台 __silverMoon.takeOver()");
      toast("银月：思维链归一让位（" + conflicts.length + " 处冲突，看控制台）", "warning");
      return Promise.resolve(normalizeState);
    }

    return Promise.resolve(installNormalizeRegex()).then((state) => {
      normalizeState.state = state;
      if (state === "installed" || state === "present") {
        log("归一化正则已就位（" + rules.length + " 条）：\n" + rules.map((r) => "  " + r.name + " → " + r.find).join("\n"));
      } else {
        warn("归一化正则没装成，状态：" + state);
      }
      return normalizeState;
    });
  }

  // ---- 自检：把「会不会两个都有」变成可以看的事实 ----
  function domSnapshot() {
    try {
      const doc = getTopDocument();
      const messages = Array.from(doc.querySelectorAll("#chat > .mes"));
      const prefix = String(CONFIG.canonicalPrefix || "").trim();
      const suffix = String(CONFIG.canonicalSuffix || "").trim();
      let reasoningBlocks = 0;
      let messagesWithBlock = 0;
      let wrapperLeftInBody = 0;
      let bothInOneMessage = 0;
      for (const mes of messages) {
        const blocks = mes.querySelectorAll(".mes_reasoning_details").length;
        reasoningBlocks += blocks;
        if (blocks) messagesWithBlock += 1;
        const bodyEl = mes.querySelector(".mes_text");
        const text = bodyEl ? String(bodyEl.textContent || "") : "";
        const leaked = text.indexOf(prefix) !== -1 || text.indexOf(suffix) !== -1;
        if (leaked) {
          wrapperLeftInBody += 1;
          if (blocks) bothInOneMessage += 1;
        }
      }
      return { messages: messages.length, reasoningBlocks, messagesWithBlock, wrapperLeftInBody, bothInOneMessage };
    } catch (error) {
      return { error: String(error && error.message) };
    }
  }

  function selfCheck() {
    return {
      reasoning: reasoningSnapshot(),
      probe: probeCanonicalParse(),
      normalize: Object.assign({}, normalizeState),
      conflicts: findConflicts(),
      dom: domSnapshot(),
      normalizeRegex: buildNormalizeRules().map((r) => ({ name: r.name, find: r.find, replace: r.replace, streaming: r.streaming })),
    };
  }

  function exposeApi() {
    try {
      const api = {
        version: `silver-moon v${VERSION}（reasoning）`,
        config: CONFIG,
        status: () => ({
          reasoning: reasoningSnapshot(),
          normalize: Object.assign({}, normalizeState),
          conflicts: findConflicts(),
        }),
        selfCheck,
        probe: probeCanonicalParse,
        conflicts: findConflicts,
        reasoning: reasoningSnapshot,
        normalizeRegex: () => buildNormalizeRules().map((r) => ({ name: r.name, find: r.find, replace: r.replace, streaming: r.streaming })),
        // 强制接管：忽略冲突，装归一化正则
        takeOver: () => {
          forcedTakeOver = true;
          return syncLeadingThink();
        },
        // 重新读一次 CONFIG / ST 配置再同步（改完 CONFIG 不用刷页面）
        refresh: () => {
          injectConfig();
          return syncLeadingThink();
        },
        uninstall: () => removeNormalizeRegex(),
        install: () => {
          forcedTakeOver = false;
          return syncLeadingThink();
        },
      };
      window.__silverMoon = api;
      try {
        window.top.__silverMoon = api;
      } catch (_) { /* cross-origin */ }
      return api;
    } catch (_) {
      return null;
    }
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
    content: '${cssEscape(CONFIG.thinkingTitle)}';
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
    content: '${cssEscape(CONFIG.doneTitle)}';
    color: #bcc8d8;
    text-shadow: 0 0 28px rgba(180,195,215,0.50), 0 0 56px rgba(180,195,215,0.20);
    /* 无动画 */
}
/* 副标题（淡入一次） */
#chat .mes_reasoning_details[data-state="done"] .mes_reasoning_header_title::after {
    content: '${cssEscape(CONFIG.doneSubtitle)}';
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
    will-change: transform, opacity;
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

  // 完整清理：移除样式 + 卸载归一化正则 + 恢复被本脚本改动的 reasoning 配置
  // 顺序重要：必须**先**摘掉归一化正则，再还原 prefix/suffix。反过来的话，
  // 正则还在往正文里写 wrapper、ST 却已经不再解析它，正文就会留下字面 wrapper。
  function cleanup() {
    removeStyle();
    removeNormalizeRegex();
    restoreReasoningConfig();
  }

  function checkCompatibility() {
    // 本脚本针对较新版本 SillyTavern 的 reasoning 显示结构
    // （#chat .mes_reasoning_details[data-state]）。当前页面若不存在该结构，
    // 样式会静默失效——这里给出提示而不是让用户无从排查。
    // 注意：init 时常常尚无消息渲染，只有在确实有消息却没有结构时才判定为不兼容，
    // 否则会误报。
    try {
      const doc = getTopDocument();
      if (doc.querySelector('#chat .mes_reasoning_details')) return;
      if (!doc.querySelector('#chat .mes')) return; // 连消息都没有，无从判定
      console.warn(
        '[SilverMoon] 未检测到 reasoning 显示结构（.mes_reasoning_details）。' +
          '请确认 SillyTavern 版本支持思考块显示（较新版本），否则银月样式不会生效。',
      );
    } catch (_) { /* noop */ }
  }

  function init() {
    cleanup(); // 防御：脚本被重新加载时先清理旧实例残留，避免重复叠加
    injectConfig();
    injectStyle();
    checkCompatibility();
    syncLeadingThink(); // 接管其他预设的开头思维链（默认关，见 CONFIG.adoptLeadingThink）
    exposeApi();
    window.addEventListener("pagehide", cleanup);
    log(`SilverMoon styler initialized (v${VERSION}).`);
  }

  // 启动（使用 jQuery 以确保在动态加载时也能正确执行）
  $(() => {
    errorCatched(init)();
  });
})();