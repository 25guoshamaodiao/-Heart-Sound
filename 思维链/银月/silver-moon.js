(function () {
  const VERSION = "1.4.3";
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
  //    这里改成字面量。注意：早先注释里写的「和 default-user/reasoning/明月.json 一致」
  //    已经过期 —— 那个模板文件在本机 reasoning/ 目录下并不存在（只有 Blank / DeepSeek /
  //    Gemma 4 / OpenAI Harmony / Think XML / 梦鲸思客思考）。权威值就是下面 canonicalPrefix
  //    / canonicalSuffix 这两个字面量本身。
  const CONFIG = {
    manageReasoningConfig: true,
    onlyIfUnset: true,
    prefix: "[metacognition]",
    suffix: "</thinking>",
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

    // ============ 注入按钮（v1.4 起，v1.4.2 改成常驻）============
    // 背景：本脚本过去除 init() 之外没有任何触发点，安装归一化正则和写 reasoning 配置都只
    // 发生一次。开局探针没过就永久卡在 probe-failed，玩家唯一能自救的动作是「在脚本库里关
    // 一下再开」——重跑 init()。v1.4 把它变成一个按钮，但那时的设计是**只在失败时出现**，
    // 结果是：它一出现就说明已经坏了，成功时反而什么都没有，人看不到「到底在没在工作」。
    //
    // v1.4.2 改成**常驻**（injectButtonAlways: true，默认）：按钮永远在脚本库/快捷栏里，
    // 状态不写进名字（见下），而是走 mode —— 成功/让位/关着时按钮在但点了只提示一句，
    // 「本次没注入上」时才绑点击、点一下就地重试注入。
    // 关掉 injectButtonAlways 可以退回 v1.4 的「只在失败时露面」。
    showInjectButton: true,
    injectButtonAlways: true,
    // ⚠️ 按钮名必须恒定：「条目身份」（findIndex by name）和「事件名」（getButtonEvent(name)）
    // 都锚在这个字符串上，改名字会被当成新按钮 → 列表里堆重复条目。所以状态不写进名字，
    // 靠 status().injectButton.mode 与弹窗表达。
    injectButtonName: "银月·注入",
    // 老配置项，v1.4.2 起只是注释性质的默认文案。
    injectButtonDescription: "思维链归一没接管上。点一下立刻重试注入一次。",
    // 哪些状态算「这次没注入上」，按钮走「可重试」模式（银月·注入）。刻意**不含** yielded：
    // yielded 是「有别的正则在管同一批标签，银月主动让位」，属于设计行为，不是失败。
    // 想让它也进可重试模式就往数组里加 "yielded"。
    injectRetryStates: ["probe-failed", "failed"],

    // 酒馆助手 4.11.3 实测：把按钮写进列表之后、APP_READY 之前，那次写会被
    // 静默丢掉（store 里 enabled_scripts_with_source 还是空数组）。所以写完必须
    // 回读校验，没写进去就隔 injectStoreRetryDelayMs 再补，最多补 injectStoreRetryMax 次。
    injectStoreRetryDelayMs: 300,
    injectStoreRetryMax: 20,
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

  // ===================== 实例归属权（多实例 / iframe 重建防护）=====================
  //
  // 酒馆助手把每个脚本跑在各自的 iframe 里，但**共享同一份 ST 设置**
  // （power_user.reasoning / extension_settings.regex / 脚本按钮列表）。于是有两个坑：
  //
  //  ① 重建 iframe 时的「拆除竞态」：改脚本内容、切预设、重载设置都会把旧 iframe 拆掉再建
  //     一个新的。新实例 init 完（正则、样式、reasoning 都铺好）之后，旧 iframe 的 pagehide
  //     才触发 —— 它一 cleanup 就把新实例刚铺好的东西全摘了：正则没了 → 思维链缩不进去
  //     （字面 wrapper 直接留在正文里）；样式没了 → 美化消失。这正是「有时候缩不进去」
  //     「得去脚本库开关一次脚本才好」的真因。
  //  ② 同时跑两份银月（脚本库里一份 + 某个预设的「一键启动器」import 的 CDN 一份）：
  //     两份互相拆、互相写，谁最后动手谁说了算。
  //
  // 对策：在 ST 顶层 window 上放一个归属标记，按版本号让最新的一份说了算；
  // pagehide 只放弃归属，**绝不碰共享设置**（那正是新实例要用的）。
  // 真想彻底卸载走 __silverMoon.uninstall()。
  const OWNER_KEY = "__silverMoonOwner";
  let ownsInstance = true;

  function stTopWindow() {
    try {
      return window.top || window;
    } catch (_) {
      return window;
    }
  }

  function readOwner() {
    try {
      const o = stTopWindow()[OWNER_KEY];
      return o && typeof o === "object" ? o : null;
    } catch (_) {
      return null;
    }
  }

  function writeOwner() {
    try {
      stTopWindow()[OWNER_KEY] = { id: SCRIPT_ID, version: VERSION, ts: Date.now() };
    } catch (_) { /* noop */ }
  }

  function releaseOwner() {
    try {
      const top = stTopWindow();
      const cur = top[OWNER_KEY];
      if (cur && cur.id === SCRIPT_ID) delete top[OWNER_KEY];
    } catch (_) { /* noop */ }
  }

  function stillOwner() {
    const cur = readOwner();
    return !cur || cur.id === SCRIPT_ID;
  }

  // "1.4.10" > "1.4.9"；认不出来的（老版本没有 VERSION）算 0。
  function versionRank(v) {
    return String(v || "")
      .split(".")
      .map((x) => parseInt(x, 10) || 0)
      .reduce((acc, n) => acc * 1000 + Math.min(n, 999), 0);
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

  // ============ 注入按钮（v1.4 起 / v1.4.1 修真实 API / v1.4.2 改常驻） ============
  //
  // 为什么要它：本脚本过去除 init() 之外没有任何触发点，安装归一化正则和写 reasoning
  // 配置都只发生一次。开局探针没过就永久卡在 probe-failed，玩家唯一能自救的动作是
  // 「脚本库里关一下再开」——重跑 init()。这里把它变成一个按钮。
  //
  // 【v1.4.1 修的是什么】v1.4 照小 cot 的写法用了「注册按钮」+「监听」两个名字，但酒馆
  // 助手 4.11.3 **没有这两个全局**（全仓 0 命中，连 node_modules 里都没有）：
  //   · 那个「注册」函数不存在 —— 公开 API 里只有读/写整个按钮列表的那一对；
  //   · 「监听」那个名字也不存在 —— 小 cot 里同名的是它自己在 cot-heart-soundV3.js:1358
  //     定义的**局部函数**，不是酒馆助手给的全局，照抄必然拿不到。
  // 后果：按钮其实注册上了，但点击回调绑不上，点了没反应，人还是只能回去开关脚本。
  //
  // 真实可用的 API（src/iframe/predefine.js:14-18 把 _bind 的键去掉下划线绑到 iframe 上）：
  //   · 读：`getScriptButtons()` —— 返回的是 **klona 克隆**（src/function/script.ts:64），
  //     改返回值没用，必须写回去；
  //   · 写：`replaceScriptButtons(list)` —— 写回本脚本自己的按钮列表（src/function/script.ts:73-83）；
  //   · 事件名：`getButtonEvent(名字)`；
  //   · 绑定：`eventOn(事件名, 处理函数)` —— 返回 { stop() }（src/function/event.ts:86）。
  //
  // 【第二个坑：写会被静默丢掉】`_replaceScriptButtons` 先从 store 里查脚本
  // （src/store/iframe_runtimes/script.ts:27 的 enabled_scripts_with_source 在
  // global_settings.app_ready 为假时返回空数组），查不到就 `if(!script) return;`
  // （src/function/script.ts:76-78）**静默返回**。脚本 iframe 常挂在 app_ready 之前，
  // 那一次写就白写了，之后没人补 —— 这就是「要手动在脚本库里建一个按钮才看得到」的真因。
  // 对策：写完立刻回读校验，没写进去就按间隔重试，等 app_ready 之后再补一次。
  //
  // 全流程 try/catch：酒馆助手全局不存在时只降级（按钮没有），绝不打断 init()。
  let injectButtonEvent = null;
  let injectButtonEventBound = false;
  let injectButtonOff = null; // eventOn 返回的 { stop() }，cleanup 时解绑
  let injectButtonRegistered = false;
  let injectButtonVisible = false;
  let injectButtonStoreReady = false; // 回读校验过：store 真的接受了这次写入
  let injectStoreRetryTimer = null;
  let injectStoreRetryCount = 0;
  let injectStoreGaveUp = false;
  let injectRetrying = false;
  let injectRetryCount = 0;

  function scriptButtonApi() {
    const get = bareGlobal("getScriptButtons");
    const replace = bareGlobal("replaceScriptButtons");
    const getEvent = bareGlobal("getButtonEvent");
    const on = bareGlobal("eventOn");
    if (typeof get !== "function" || typeof replace !== "function") return null;
    return { get, replace, getEvent, on };
  }

  // 按钮这次该是「可重试」还是「已就位」。必须看 state.state —— no-wrappers 时
  // normalizeState.enabled 也是 true。注意返回的是**布尔**：只要开着常驻按钮，
  // 两种情况都得有按钮，区别只在绑不绑点击（名字恒定，不随状态变）。
  function injectButtonMode(state) {
    const s = state || normalizeState;
    if (!CONFIG.showInjectButton) return false;
    if (!CONFIG.adoptLeadingThink) return false;
    const list = Array.isArray(CONFIG.injectRetryStates) ? CONFIG.injectRetryStates : [];
    return list.indexOf(s.state) !== -1;
  }

  function injectButtonLabel() {
    // 名字必须恒定，见 CONFIG.injectButtonName 的注释。这个函数留着，是为了把
    // 「名字是身份、不是状态」这件事写在一处，将来真要显示状态也是加 description 之类，
    // 而不是改 name。
    return CONFIG.injectButtonName;
  }

  function onInjectButtonClick() {
    if (injectRetrying) return Promise.resolve(false);
    // 常驻按钮 → 成功态也可点。点了就别白跑一遍探测（重跑 syncLeadingThink 会重写
    // reasoning 配置、重装正则），直接告诉玩家「已经在位、不用点」。
    if (!injectButtonMode(normalizeState)) {
      toast("银月：思维链归一已就位，不用点它。", "info");
      return Promise.resolve(true);
    }
    injectRetrying = true;
    injectRetryCount += 1;
    toast("银月：正在重试注入……", "info");
    log("注入按钮被点了（第 " + injectRetryCount + " 次）");
    return Promise.resolve()
      .then(() => syncLeadingThink())
      .then((state) => {
        const mode = injectButtonMode(state);
        const ok = state && (state.state === "installed" || state.state === "present");
        if (ok) {
          toast("银月：思维链归一已就位。", "success");
        } else {
          const why = (state && state.note) || (state && state.state) || "未知";
          toast("银月：还是没注入上（" + ((state && state.state) || "?") + "）。" + why + "　详情：控制台 __silverMoon.status()", "warning");
        }
        log("重试结果：" + JSON.stringify({ state: state && state.state, note: state && state.note, mode: mode ? "retry" : "ok" }));
        return ok;
      })
      .catch((error) => {
        warn("注入按钮重试时抛错：", error);
        toast("银月：重试注入时出错，看控制台。", "warning");
        return false;
      })
      .then((ok) => {
        injectRetrying = false;
        syncInjectButton(); // 按新状态刷新按钮（写法幂等，名字恒定）
        return ok;
      });
  }

  // 幂等：syncLeadingThink() 落地后、每次重试后、app_ready 等事件后、cleanup() 时都会调。
  //
  // v1.4.2 起是**常驻**按钮：
  //   · 成功（installed / present）→ 按钮在，但不绑点击（点了只提示一句「不用点」）；
  //   · 失败（probe-failed / failed）→ 按钮在，绑上点击 → 重试注入；
  //   · 两者都要按钮存在且 visible；名字恒定（见 injectButtonLabel() 的注释）。
  // injectButtonAlways:false 时才退回 v1.4 的「失败才露面」。
  // 写入仍然要回读校验：app_ready 之前那次写会被静默丢掉（见本段开头注释）。
  function syncInjectButton() {
    try {
      if (injectRetrying) return;
      const api = scriptButtonApi();
      const mode = injectButtonMode(normalizeState);

      // 功能整个关掉了才撤按钮 + 收掉重试预算（见 showInjectButton / adoptLeadingThink）。
      // ⚠️ 别在「拿不到 API」或「store 没就绪」时清预算：常驻按钮会频繁同步，清一次就等于
      // 把补写循环重置，store 长时间不就绪时会变成无限重试（v1.4.2 开发中真踩到过：
      // storeGaveUp 永远为假、计数卡在 1）。
      if (!CONFIG.showInjectButton || !CONFIG.adoptLeadingThink) {
        if (api && injectButtonRegistered) setScriptButtonVisible(api, false);
        clearInjectStoreRetry();
        return;
      }

      if (!api) {
        if (mode) {
          warn("银月：注入按钮不可用 —— 拿不到 getScriptButtons / replaceScriptButtons（酒馆助手 4.11.3 起才有）。" +
            "失败原因看上面的弹窗和 __silverMoon.status()；也可以直接调 __silverMoon.retryInject()。");
        }
        return;
      }

      // injectButtonAlways:false → 退回 v1.4 的「只在没注入上时露面」。
      // （常驻是默认；这条只是给不想一直看到按钮的人留的开关。）
      if (!mode && !CONFIG.injectButtonAlways) {
        if (injectButtonRegistered && !setScriptButtonVisible(api, false)) scheduleInjectStoreRetry();
        return;
      }

      if (!registerInjectButton(api)) {
        warn("银月：写入注入按钮失败，失败时只能看弹窗。");
        return;
      }

      if (mode) {
        if (!injectButtonEventBound) bindInjectButtonEvent(api);
      }
      // 已就位 → **不在这里解绑**：syncLeadingThink() 中途会把 normalizeState 重置成
      // off（那一刻 mode 也是 ok），在这里解绑会把「重试中」的点击通道误拆掉。
      // 交给 onInjectButtonClick() 自己按 mode 判断该不该干活。

      const ready = setScriptButtonVisible(api, true);
      if (!ready) scheduleInjectStoreRetry();
    } catch (error) {
      warn("银月：同步注入按钮时出错（已忽略）：", error);
    }
  }

  // 把「本脚本的按钮」在列表里收敛成唯一一条：同名重复项全部丢掉，只留第一条被改写的。
  // 必须去重 —— 常驻按钮会在每次事件同步时重写列表，如果只是 push，列表里会堆出
  // 一堆同名条目（v1.4.2 开发中真的踩到过：一次成功切换就被写成两条）。
  // getScriptButtons() 给的是克隆，所以只能读出来 → 改 → replaceScriptButtons 写回去。
  function writeInjectButtonEntry(api, visible) {
    const name = CONFIG.injectButtonName;
    const all = api.get();
    const list = Array.isArray(all) ? all.slice() : [];
    let hit = false;
    const out = [];
    for (const item of list) {
      if (!item || item.name !== name) { out.push(item); continue; }
      if (hit) continue; // 重复的同名条目：丢掉
      hit = true;
      // 注意：这里不能采纳别的键。酒馆助手的 ScriptButton 只有 name + visible，
      // 多塞键反而可能让写入静默失败。
      out.push(Object.assign({}, item, { name: name, visible: !!visible }));
    }
    if (!hit) out.push({ name: name, visible: !!visible });
    api.replace(out);
  }

  // 让按钮存在于「本脚本自己的」按钮列表里，并把 visible 写成 true。
  function registerInjectButton(api) {
    try {
      writeInjectButtonEntry(api, true);
      injectButtonRegistered = true;
      injectButtonVisible = true;
      return true;
    } catch (error) {
      warn("银月：写入注入按钮列表失败：", error);
      return false;
    }
  }

  // 切换可见性，并**回读校验** store 到底收没收下这次写入。
  // 返回 true = 回读里按钮确实存在且可见性与期望一致；false = 这次写被丢了（多半是
  // app_ready 还没到，_replaceScriptButtons 查不到脚本，静默 return）。
  function setScriptButtonVisible(api, visible) {
    const name = CONFIG.injectButtonName;
    try {
      writeInjectButtonEntry(api, visible);

      const back = api.get();
      const found = (Array.isArray(back) ? back : []).find((b) => b && b.name === name);
      const ok = !!found && !!found.visible === !!visible;
      injectButtonVisible = ok ? !!visible : false;
      if (ok) injectButtonStoreReady = true;
      log("注入按钮可见性 → " + (visible ? "显示" : "隐藏") + "（回读" + (ok ? "一致" : "不一致：这次写被丢了") + "）");
      return ok;
    } catch (error) {
      warn("银月：切换注入按钮可见性失败（已忽略）：", error);
      injectButtonVisible = false;
      return false;
    }
  }

  // store 没就绪时的补写。只补「让按钮出现」这一段，**绝不重跑 syncLeadingThink()/探测**，
  // 免得把 probe-failed 这类状态搅乱。
  function scheduleInjectStoreRetry() {
    if (injectStoreRetryTimer) return;
    if (injectStoreGaveUp) return;
    const max = Math.max(0, Number(CONFIG.injectStoreRetryMax) || 0);
    if (injectStoreRetryCount >= max) {
      if (!injectStoreGaveUp) {
        injectStoreGaveUp = true;
        warn("银月：注入按钮试了 " + max + " 次还是写不进酒馆助手按钮列表（多半是酒馆助手还没就绪）。" +
          "失败原因仍看弹窗与 __silverMoon.status()；也可以等页面稳一点再点一次。");
      }
      return;
    }
    injectStoreRetryCount += 1;
    try {
      const doc = getTopDocument();
      if (doc && doc.hidden) return; // 页面在后台就别空转，等 visibilitychange 补
    } catch (_) { /* noop */ }
    const delay = Math.max(0, Number(CONFIG.injectStoreRetryDelayMs) || 0);
    try {
      injectStoreRetryTimer = setTimeout(() => {
        injectStoreRetryTimer = null;
        syncInjectButton();
      }, delay);
    } catch (_) {
      injectStoreRetryTimer = null;
    }
  }

  function clearInjectStoreRetry() {
    if (injectStoreRetryTimer) {
      try { clearTimeout(injectStoreRetryTimer); } catch (_) { /* noop */ }
      injectStoreRetryTimer = null;
    }
    injectStoreRetryCount = 0;
    injectStoreGaveUp = false;
  }

  // 解绑点击（幂等）。成功态用它把重试入口摘掉；cleanup() 也用它。
  function unbindInjectButtonEvent() {
    if (!injectButtonOff) {
      injectButtonEventBound = false;
      return;
    }
    const off = injectButtonOff;
    injectButtonOff = null;
    injectButtonEventBound = false;
    try {
      if (typeof off.stop === "function") off.stop();
      else if (typeof off === "function") off();
    } catch (_) { /* noop */ }
  }

  // 事件名走 getButtonEvent，绑定走 eventOn —— 这两条才是酒馆助手真实的通道。
  // （那个「注册全局」和「监听全局」在 4.11.3 都不存在，见本段开头。）
  // 常驻按钮下**只绑一次、整条生命周期不解绑**（除了 cleanup）：已就位时点击的处理
  // 交给 onInjectButtonClick() 自己判断，见那里的注释。
  function bindInjectButtonEvent(api) {
    try {
      if (injectButtonEventBound) return;
      const name = CONFIG.injectButtonName;
      let eventName = injectButtonEvent;
      if (!eventName && typeof api.getEvent === "function") eventName = api.getEvent(name);
      if (!eventName) {
        warn("银月：按钮写进去了，但拿不到按钮事件（getButtonEvent 不可用或列表里还没这个按钮），" +
          "点了不会有反应 —— 请改用 __silverMoon.retryInject()。");
        return;
      }
      injectButtonEvent = eventName;
      if (typeof api.on !== "function") {
        warn("银月：拿不到 eventOn，注入按钮点了不会有反应 —— 请改用 __silverMoon.retryInject()。");
        return;
      }
      injectButtonOff = api.on(eventName, onInjectButtonClick);
      injectButtonEventBound = true;
      log("注入按钮事件已绑定：" + String(eventName));
    } catch (error) {
      warn("银月：绑定注入按钮事件失败（已忽略）：", error);
    }
  }

  function hideInjectButton() {
    clearInjectStoreRetry();
    unbindInjectButtonEvent();
    if (!injectButtonRegistered || !injectButtonVisible) return;
    const api = scriptButtonApi();
    if (!api) return;
    setScriptButtonVisible(api, false);
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

  // 注入按钮的对外快照（status().injectButton 和 __silverMoon.injectButton() 共用）。
  // mode 是 v1.4.2 新增字段：true = 「可重试」（点了会重跑 syncLeadingThink()），
  // false = 「已就位」（点了只提示一句、不重跑探测）。want 保留为旧名（= mode）。
  function injectButtonSnapshot() {
    const mode = injectButtonMode(normalizeState);
    return {
      name: CONFIG.injectButtonName,
      // 名字恒定（见 CONFIG.injectButtonName 注释）；mode 才是状态
      label: injectButtonLabel(),
      always: !!CONFIG.injectButtonAlways,
      mode: mode ? "retry" : "ok",
      registered: injectButtonRegistered,
      visible: injectButtonVisible,
      want: mode,
      event: injectButtonEvent,
      bound: injectButtonEventBound,
      // false = 回读校验发现按钮写不进酒馆助手列表（多半是 app_ready 还没到）
      storeReady: injectButtonStoreReady,
      retrying: injectRetrying,
      retryCount: injectRetryCount,
      storeRetryCount: injectStoreRetryCount,
      storeGaveUp: injectStoreGaveUp,
    };
  }

  // 我还在管吗？（多实例：让位的那份 mine=false，什么都不做）
  function ownerSnapshot() {
    const cur = readOwner();
    return {
      self: SCRIPT_ID,
      version: VERSION,
      mine: ownsInstance && stillOwner(),
      // 现在 ST 页面上登记的归属（null = 还没有人登记）
      current: cur ? { id: cur.id, version: cur.version } : null,
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
          injectButton: injectButtonSnapshot(),
          // 多实例时看这里：mine=false 表示这一份已经让位给更新的实例
          owner: ownerSnapshot(),
        }),
        selfCheck,
        probe: probeCanonicalParse,
        conflicts: findConflicts,
        reasoning: reasoningSnapshot,
        normalizeRegex: () => buildNormalizeRules().map((r) => ({ name: r.name, find: r.find, replace: r.replace, streaming: r.streaming })),
        // 注入重试按钮的状态（v1.4 / v1.4.1）
        injectButton: injectButtonSnapshot,
        // 等价于点一下注入按钮（按钮不可用时的替代入口）
        retryInject: onInjectButtonClick,
        // 强制接管：忽略冲突，装归一化正则
        takeOver: () => {
          forcedTakeOver = true;
          return syncLeadingThink().then((s) => { syncInjectButton(); return s; });
        },
        // 重新读一次 CONFIG / ST 配置再同步（改完 CONFIG 不用刷页面）
        refresh: () => {
          injectConfig();
          return syncLeadingThink().then((s) => { syncInjectButton(); return s; });
        },
        uninstall: () => {
          // 完整拆卸（摘正则 + 去样式 + 收按钮 + 还原 reasoning），并且放弃归属，
          // 免得下一份实例因为「已有更新的一份在跑」而错误让位。
          cleanup();
          forcedTakeOver = false;
          log("SilverMoon 已完整拆卸（uninstall）。");
          return true;
        },
        install: () => {
          forcedTakeOver = false;
          return syncLeadingThink().then((s) => { syncInjectButton(); return s; });
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

  // 样式还在不在（顶层文档和当前文档都要看；任何一个缺了都算缺）。
  function styleMissing() {
    const topDoc = getTopDocument();
    const hasTop = !!topDoc?.getElementById?.(STYLE_ID);
    const hasSelf = !!document?.getElementById?.(STYLE_ID);
    if (topDoc === document) return !hasTop;
    return !hasTop || !hasSelf;
  }

  // 完整拆卸：移除样式 + 卸载归一化正则 + 恢复被本脚本改动的 reasoning 配置 + 收掉按钮。
  // 顺序重要：必须**先**摘掉归一化正则，再还原 prefix/suffix。反过来的话，
  // 正则还在往正文里写 wrapper、ST 却已经不再解析它，正文就会留下字面 wrapper。
  //
  // ⚠ 这是「用户明确要卸载」用的（__silverMoon.uninstall()）。**pagehide 不走这里**
  // （一旦被更新的实例接管，这份就不该再动共享设置，只摘自己那份样式）。
  function cleanup() {
    if (ownsInstance && stillOwner()) {
      removeNormalizeRegex();
      removeStyle();
      hideInjectButton();
      restoreReasoningConfig();
    }
    releaseOwner();
  }

  // iframe 被拆掉时**只放弃归属 + 收掉自己的定时器**，绝不碰 ST 设置、正则、样式。
  // 原因见文件上方「实例归属权」：pagehide 经常发生在新实例 init **之后**，
  // 这里要是执行完整 cleanup，就会把新实例刚铺好的正则/样式/reasoning 一起拆掉，
  // 表现就是「思维链缩不进去 / 美化时有时无 / 得开关一次脚本才好」。
  function onPageHide() {
    clearInjectStoreRetry();
    releaseOwner();
  }

  // 自愈：被别的实例收摊、或设置被重载时把我们自己的归一化正则/样式摘掉了，就补装回来。
  // 只在「我们本来是装好的」情况下动作：让位态（yielded）、探针没过（probe-failed）
  // 本来就不该装，不去打扰。
  function resyncIfStripped() {
    try {
      if (!ownsInstance) return;
      const wasLive = normalizeState.state === "installed" || normalizeState.state === "present";
      if (!wasLive) return;

      // 样式单独算一路：v1.2 那种老实例的 cleanup() 会按同一个 STYLE_ID 把样式删掉，
      // 表现就是用户说的「明月本身也不美化了」。正则还在也要把样式补回去。
      if (styleMissing()) {
        injectStyle();
        log("自愈：样式被摘掉了，补回来了。");
      }

      if (hasNormalizeRegex()) return;
      warn("银月：归一化正则被摘掉了（多半是别的实例收摊或设置重载），重新装上。");
      syncLeadingThink().then(syncInjectButton);
    } catch (_) { /* noop */ }
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
    // ① 同一个 window 里被跑第二遍（重复 import / 双重加载）就别再来一次，
    //    否则两套状态互相覆盖。
    try {
      if (window.__silverMoonRuntime) {
        warn("银月：这个 window 里已经跑过一份了，跳过重复初始化。");
        return;
      }
      window.__silverMoonRuntime = true;
    } catch (_) { /* noop */ }

    // ② 已经有**更新**的一份银月在跑就让位：两份同时写共享设置只会互相拆。
    const owner = readOwner();
    if (owner && owner.id !== SCRIPT_ID && versionRank(owner.version) > versionRank(VERSION)) {
      ownsInstance = false;
      warn(
        `银月：已有一份更新的在跑（v${owner.version}），这一份（v${VERSION}）让位，不做任何改动。` +
          `　想确认状态：__silverMoon.status()`,
      );
      return;
    }
    ownsInstance = true;
    writeOwner();

    // 注意：这里**不调用 cleanup()**（v1.4.3 起）。旧版 init 开头 cleanup 是为了清
    // 「同窗口重复加载」的残留，但那会跨 iframe 拆掉另一个实例刚铺好的正则/样式 ——
    // 见文件上方「实例归属权」。本窗口第一次初始化，要装的都由 injectStyle() /
    // syncLeadingThink() 幂等补上。
    injectConfig();
    injectStyle();
    checkCompatibility();
    syncLeadingThink().then(syncInjectButton); // 接管其他预设的开头思维链（默认开，见 CONFIG.adoptLeadingThink）
    exposeApi();
    window.addEventListener("pagehide", onPageHide);
    // 给「不想开控制台」的人留一个重新注入的口子：
    //   window.dispatchEvent(new Event("silver-moon:sync"))
    window.addEventListener("silver-moon:sync", () => {
      syncLeadingThink().then(syncInjectButton);
    });
    bindPassiveSyncTriggers();
    log(`SilverMoon styler initialized (v${VERSION}).`);
  }

  // 纯兜底：
  //  · syncInjectButton() —— 确保常驻按钮真的写进列表、模式是对的（**不重跑
  //    syncLeadingThink()**，不碰 ST 配置、不动探测结果）。
  //  · resyncIfStripped() —— 只在我们本来是装好的、而现在正则没了的时候补装一次
  //    （多实例互拆 / 设置重载后的自愈）。
  //  · app_ready：酒馆助手把按钮目的地（聊天输入框那条 #qr--bar）挂出来的时刻，
  //    也是之前那次「写着写着被 store 丢掉」之后最该补一次的时刻。
  //  · chat_id_changed / settings_loaded：切聊天、重载设置后按钮列表会重建。
  //  · visibilitychange：页面从后台回来时把因 document.hidden 而暂停的重试续上。
  function bindPassiveSyncTriggers() {
    const on = bareGlobal("eventOn");
    const names = ["app_ready", "chat_id_changed", "settings_loaded"];
    if (typeof on === "function") {
      for (const name of names) {
        try {
          on(name, () => { syncInjectButton(); resyncIfStripped(); });
        } catch (_) { /* 老版本没有这个事件就跳过 */ }
      }
    }
    try {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          syncInjectButton();
          resyncIfStripped();
        }
      });
    } catch (_) { /* noop */ }
  }

  // 启动（使用 jQuery 以确保在动态加载时也能正确执行）
  $(() => {
    errorCatched(init)();
  });
})();