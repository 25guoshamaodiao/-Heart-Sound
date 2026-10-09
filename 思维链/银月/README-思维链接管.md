# 银月 · 接管「其他预设的开头思维链」（v1.4.4，默认**开**）

对应脚本：`silver-moon.js`（就是"老的那个"，和 `silver-moon-blocks-*.js` 是两回事）

---

## 0. 一句话

银月多管一件事：把**别的预设**写在消息开头的思维链包裹
（`<think>…</think>`、`[metacognition]…</thinking>`、`<基础确认>…` 等）
统一改写成银月自己的那对 wrapper，交给 ST 原生那条 reasoning 通道 ——
于是不管哪个预设，思维链都是银月那个月亮块的样子，**跟着流式一起长出来**，
而且**不会出现两个块**。

默认打开。想关：

```js
__silverMoon.config.adoptLeadingThink = false;
__silverMoon.refresh();
```

**v1.4 加的**：脚本库会常驻一个 `银月·注入` 按钮。注入没成功（探针没过 / 安装失败）时
它就是「点一下就地重试一次」，不用再靠「脚本库里关一下再开」重跑 `init()`；
已经就位时按钮**照样在**（v1.4.2 起常驻），只是点了只提示一句「不用点」。
详见第 4.1 节。

---

## 1. 为什么必须用「归一化」而不是「把正则写宽」

对着本机 ST（`E:\share\SillyTavern`，1.14.0）源码核过的三条：

```js
// scripts/reasoning.js:1238
const regex = new RegExp(
  `${strict ? '^\\s*?' : ''}${escapeRegex(prefix)}(.*?)${escapeRegex(suffix)}`, 's');
```

1. **prefix/suffix 是字面量，不是正则** —— 会被 `escapeRegex()`（`scripts/utils.js:1269`）
   转义，**写不成 alternation**。所以「一条正则匹配所有变体」在 ST 这一层做不到，
   只能在银月这边把各种包裹**改写成同一对**。
2. 老脚本里的 `"\\[metacognition\\]"` 是"ST 把 prefix 当正则"那个年代的写法，
   在现在的 ST 上会被再转义一次，只能匹配**带反斜杠的** `\[metacognition\]`，
   正文里正常的 `[metacognition]` 永远匹配不到。
   已改成字面量。**权威值就是源码里 `CONFIG.canonicalPrefix` / `canonicalSuffix`
   这两个字面量本身**（`silver-moon.js:61-62`）：
   ```
   canonicalPrefix = "[metacognition]"    canonicalSuffix = "</thinking>"
   ```
   > 注：本节早先写的「和 `E:\sillydata\default-user\reasoning\明月.json` 逐字一致」
   > 已经**过期** —— 本机 `reasoning\` 目录下并没有那个模板（只有 Blank / DeepSeek /
   > Gemma 4 / OpenAI Harmony / Think XML / 梦鲸思客思考）。`明月` 是**酒馆助手脚本库
   > 里那个脚本的名字**，不是 ST 的 reasoning 模板。别再去找那个文件了。
3. `strict` 默认 true → 匹配锚在**消息开头**（`^\s*?`），且 `String.replace` 不带 `g`
   → 一条消息只吃**第一处**。

### 1.5 银月认哪些开头包裹

`CONFIG.leadingThinkWrappers`（`silver-moon.js:46-58`）是**字面量对**，不是正则：

| 开 | 闭 | |
|---|---|---|
| `<think>` | `</think>` | |
| `<thinking>` | `</thinking>` | |
| `<thought>` | `</thought>` | |
| `<reasoning>` | `</reasoning>` | |
| `<analysis>` | `</analysis>` | |
| `[metacognition]` | `</thinking>` | ← **秋青那套就是这一对** |
| `[metacognition]` | `[/metacognition]` | |
| `<基础确认>` | `</基础确认>` | |
| `<思考>` | `</思考>` | |
| `[思考]` | `[/思考]` | |
| `<思维链>` | `</思维链>` | |

**关键：这一对是「外层包裹」的起止，不是「必须紧贴」。** 所以
`<thinking>` + 换行 + `[metacognition]` + 换行 + 思维链 + 换行 + `</thinking>`
这种「外层 `<thinking>` 套着 `[metacognition]`」的写法，会被**整段**吃下来，
`$1` 就是里面含 `[metacognition]` 那一行的全部内容 —— 归一化仍然成功。
（`.work/silver-moon-button-test.js` 的 J 段把这个形状钉住了。）

### 1.6 你机器上的实际状态

（读 `E:\sillydata\default-user\settings.json` 得到）
里面有**你没设过** `power_user.reasoning`，`loadReasoningSettings()`（`reasoning.js:722`）
也不会在启动时套用模板 —— 所以运行时生效的是 ST 默认值
`<think>\n` / `\n</think>`、**`auto_parse: false`**：文本里的思维链**根本不会被解析**，
月亮块只出现在"模型自带 reasoning 字段"的消息上。
这也是「银月为什么必须自己写 ST 的 reasoning 配置」的原因（探针 + `applyCanonicalConfig`）。

---

## 2. 流式：思维块跟着字长出来（v1.2 修的就是这个）

### 机制（为什么以前是"出完字才渲染"）

ST 的流式是**每个 token 都走一遍**：

```js
// script.js:3307-3357  onProgressStreaming
let processedText = cleanUpMessage({ … });        // 3323 ← 每 token 跑一次「改消息本身」的正则
chat[messageId]['mes'] = processedText;           // 3347
await this.reasoningHandler.process(…);           // 3356 ← 紧接着做流式 reasoning 解析
```

而流式解析的判定是（`scripts/reasoning.js:427,440-442`）：

```js
if (parseTarget.startsWith(power_user.reasoning.prefix) && parseTarget.length > prefix.length) {
    this.isParsingReasoning = true;
    this.state = ReasoningState.Thinking;      // ← 流式期间就进「思考中」态
}
this.reasoning = parseTarget.slice(prefix.length);   // 正在流的字全搬进思维块
message.mes = '';
```

**流式成不成立，全看 `message.mes` 的第一个字是不是字面等于 `prefix`。**

v1.1 只装了「闭合才换」的那一条正则：

```
/^\s*(?:<think>|…)([\s\S]*?)(?:<\/think>|…)/s     ← 流式时 </think> 还没到 → 不匹配
```

于是 `mes` 一直是 `<think>…`，`startsWith('[metacognition]\n…')` 当场失败，
ST 一直不进思考态；只有等生成结束、闭合标签到了才被换掉 ——
**这就是你看到的「出完字了才渲染」。**

### 修法：多一条「只换开标签」的规则

现在装**两条**（都在「改消息本身」那一档、`placement = AI 输出`、编辑时也生效）：

| 名字 | 查找 | 替换 |
|---|---|---|
| `银月 · 思维链归一（勿删）` | `/^(?!canonical)\s*(?:开…)([\s\S]*?)(?:闭…)/s` | `[metacognition]\n$1\n</thinking>` |
| `银月 · 思维链归一·流式（勿删）` | `/^(?!canonical)\s*(?:开…)([\s\S]*)$/s` | `[metacognition]\n$1` ← **绝不补闭合标签** |

第二条只把**开标签**换成银月的开标签：ST 于第一个 token 之后就 `startsWith` 成立、
进入思考态，把正在流的字一路搬进思维块；闭合标签到了再切回正文流。
补上闭合标签会让 ST 以为思维链结束、立刻切回去，所以那条坚决不补。

### 自检台跑出来的逐 token 表

```
"<thi"                    → state=null      块内=""      正文="<thi"
"<think"                  → state=null      块内=""      正文="<think"
"<think>"                 → state=null      块内=""      正文="[metacognition]\n"
"<think>思"               → state=thinking  块内="思"    正文=""
"<think>思考"             → state=thinking  块内="思考"  正文=""
"<think>思考</think>"     → state=thinking  块内="思考"  正文=""
"<think>思考</think>正"   → state=thinking  块内="思考"  正文="正"
"<think>思考</think>正文" → state=thinking  块内="思考"  正文="正文"
```

反过来把 `CONFIG.normalizeWhileStreaming = false`，同一串 token 会变成
「前三个 token 一直没有块、生成结束那一刻才出现」—— 自检台 S10 就是这个反证。

### 开关

```js
CONFIG.normalizeWhileStreaming = true    // 默认；false = 回到「出完字才渲染」
```

---

## 3. 「两个都有」会不会发生

两条通道要分清：

| 通道 | 什么时候跑 | 谁管它 |
|---|---|---|
| 酒馆显示正则 | 渲染时（链式，前一条输出喂给后一条） | 预设自带的美化正则、美化块脚本的标记正则 |
| ST 原生 reasoning 解析 | 收到 / 编辑消息时 | ST 自己 |

它们**不抢同一份文本**，所以"谁先跑谁把标签吃掉"这层天然互斥在跨通道时**不存在** ——
这正是"两个都有"会真实发生的地方。归一化把两条并成一条：

```
收到 AI 回复（每个 token）
  └─ cleanUpMessage → getRegexedString(mes, AI_OUTPUT)   ← 银月这两条正则在这里
        · 开标签/整段包裹 → [metacognition]…</thinking>
        · 原标签被吃掉
  └─ reasoningHandler.process                            ← ST 流式搬进思维块
  └─ MESSAGE_RECEIVED → reasoning.js:1337-1343            ← 把包裹从 mes 里永久删掉
```

* **银月不会造成两个块**（自检台 B5/B6/B7、S7/S8）；
* **别人的显示正则也吃不到标签了**（D10：接管后对方那条正则一个产物都没有）；
* 让位判定不靠顺序（D1-D5）。

### 让位必须「让干净」——别只让一半（v1.3 修的就是这个）

**这是拿你真实预设 + 那条真实消息（`[metacognition]` + `<dream_plot>`）跑出来的事故：**

你的预设 `梦鲸思客V4-0902` 自己用 `<think>` 管思维链，里面有三条正则在动它：

```
[🥷隐藏]思考正则格式化        md=0 pr=0  find: ^(?!<think>)([\s\S]*\S[\s\S]*)(?:</think>|(<dream_plot>)(?=\r?\n))
                                          replace: <think>\n$1\n</think>\n$2
[🦋美化]思考正则隐藏 - 二选一  md=1 pr=0  find: /<think>([\s\S]*)<\/think>/i     replace:（空 = 显示时藏掉）
[🥷隐藏]删除额外标签          md=1 pr=0
```

v1.2 的行为是：银月**认出了冲突、正确地让位**（不装自己的正则），
**但 `injectConfig` 早就把 ST 的 `reasoning.prefix/suffix/auto_parse` 改成 canonical 了**。
于是流式时 `[4]` 还没触发（它的 find 要等收尾），正文仍以 `[metacognition]` 开头
→ **ST 的原生解析自己上了**：思维块一路 thinking，1318 字的思维链被从 `mes` 里搬走，
`mes` 从 2570 字缩到 1223 字、开头变成 `</think>\n\n</think>\n<dream_plot>…`，
你预设的 `<think>` 包装链（格式化 → 隐藏 → 提示词侧隐藏）全部落空。

修法：**铺配置挪到守卫之后**（`applyCanonicalConfig()`），任何一步不过都调
`revertOwnReasoningConfig()` 把配置原样还回去。现在这条消息的结果是：

| | 默认（接管开着） | `takeOver()` 之后 |
|---|---|---|
| 状态 | `yielded`，`configApplied=false` | `installed`，`configApplied=true` |
| ST 配置 | `<think>\n` / `\n</think>` / auto_parse=false（原样） | `[metacognition]` / `</thinking>` / true |
| 流式思维块 | 没有 | 一路 thinking |
| `mes` | **2570 字，和接管关着时逐字一致** | 1223 字（思维链被搬进 `extra.reasoning`） |

这就是 `.work/dream-check2.js` 那 12 条断言钉住的东西（R4 是核心那条）。
想确认你现在是哪种状态：`__silverMoon.status().normalize.configApplied`。

### 唯一剩下的坑（自检能报出来）

消息**已经带了 reasoning 字段**时，ST 会**跳过解析**（`reasoning.js:1311-1314`），
刚写进正文的 wrapper 就留在正文里。自检台 G2/G3/G4 把这个坑跑出来了，
`__silverMoon.selfCheck().dom` 里会看到 `bothInOneMessage > 0`。

---

## 4. 控制台接口

```js
__silverMoon.status()        // reasoning 生效值 / 归一化状态 / 冲突清单 / 注入按钮状态
__silverMoon.selfCheck()     // 上面这些 + 探针 + DOM 自检（有没有漏 wrapper、有没有两个都有）
__silverMoon.normalizeRegex()// 现在这两条正则长什么样
__silverMoon.conflicts()     // 只看冲突
__silverMoon.takeOver()      // 忽略冲突，强制接管
__silverMoon.uninstall()     // 摘掉两条正则（不动样式、不动配置）
__silverMoon.refresh()       // 改完 CONFIG 调用，立即重新同步
__silverMoon.injectButton()  // 注入按钮现在什么样：{name, label, always, mode, registered, visible, want, event, bound, storeReady, retrying, retryCount, storeRetryCount, storeGaveUp}
__silverMoon.retryInject()   // 等价于点一下注入按钮（按钮拿不到时的替代入口），返回 Promise<boolean>
```

`normalize.state`：`off`（接管开关关着）/ `no-wrappers`（包裹表是空的）/
`probe-failed`（ST 不认这对 wrapper，**没装**）/ `yielded`（有冲突，让位）/
`installed` · `present`（装好了）/ `failed`（ST 的正则接口回绝了这两条）。
`normalize.configApplied`：银月现在有没有占着 ST 的 reasoning 配置 ——
`yielded` / `probe-failed` / `off` 时它必须是 `false`（配置已还回去）。

### 4.1 注入按钮（v1.4 起，v1.4.1 修好点击，v1.4.2 常驻，v1.4.4 起两种状态都能点）

**它解决什么**：本脚本过去除 `init()` 之外没有任何触发点，安装正则、写 `reasoning`
配置都只发生一次。开局探针没过就永久卡在 `probe-failed`——
以前唯一的自救动作是**在脚本库里把银月关一下再开**（重跑 `init()`）。

```
syncLeadingThink() 落地 / app_ready / chat_id_changed / settings_loaded
  └─ syncInjectButton()
        → 写「银月·注入」并可见，**并且绑好点击**（v1.4.4 起不分状态，之前只绑失败态）
点按钮 → onInjectButtonClick()
  └─ 一律重跑一遍 syncLeadingThink()（v1.4.4 起）
        ├─ installed / present → toast「思维链归一已就位」
        ├─ yielded             → toast 告警「让位了（N 处冲突）」
        └─ probe-failed 等     → toast 告警（带失败原因），可以再点
```

| 状态 | 按钮 | 点击 |
|---|---|---|
| `installed` / `present` | 在，`mode: "ok"` | 再同步一次 → toast「已就位」 |
| `probe-failed` / `failed` | 在，`mode: "retry"` | 再同步一次 → 没好就 toast 告警 |
| `yielded`（主动让位） | 在，`mode: "ok"` | 再同步一次 → toast「让位了（N 处冲突）」 |
| `off` / `no-wrappers` | 在，`mode: "ok"` | 再同步一次 |
| `CONFIG.injectButtonAlways = false` | 只在 `probe-failed` / `failed` 时出现（v1.4 老行为） | 同上 |

> 为什么改成常驻：v1.4 的设计是「只在失败时出现」，结果按钮一出现就说明已经坏了，
> 成功时反而什么都看不到，没法回答「它到底在没在工作」。常驻之后状态不写进名字，
> 而是走 `status().injectButton.mode`。
>
> **v1.4.4 修的是「常驻按钮是个摆设」**：v1.4.2 / v1.4.3 只在失败态才绑点击，所以
> 「一开页面就直接成功」的用户点它**毫无反应**（连提示都没有），而成功态那段
> 「点了提示一句」的代码根本执行不到。现在两种状态都绑点击、都真跑一遍同步。
> 代价很小：正则没变化时 `installNormalizeRegex()` 会先比一遍、直接跳过写入（见 §5 第 4 条），
> 所以点它**不会重排聊天**。

**真实 API（这一节是踩坑记录，别改回去）**：酒馆助手 4.11.3 **没有**
`registerScriptButton`，也**没有** `listenEvent`（全仓 0 命中，`dist/index.js` 里都搜不到）。
小 cot 里那个 `listenEvent` 是它自己在 `小cot/cot-heart-soundV3.js:1358` 定义的**局部函数**。
照抄它的后果就是 v1.4 的样子：按钮注册上了、点击回调绑不上，点了没反应，
人还是只能回去开关脚本 —— 也就是「脚本里好像要改一下明月才有按钮」那个反馈的真因。

4.11.3 真正能用的四个全局（`src/iframe/predefine.js:14-18` 把 `_bind` 的键去掉下划线
绑到 iframe 上）：

| 用途 | 全局 | 注意 |
|---|---|---|
| 读按钮列表 | `getScriptButtons()` | 返回的是 **klona 克隆**（`src/function/script.ts:64`），改返回值无效 |
| 写按钮列表 | `replaceScriptButtons(list)` | 只能写**本脚本自己**的列表；未就绪时**静默返回**（`src/function/script.ts:76-78`） |
| 拿事件名 | `getButtonEvent("银月·注入")` | 返回 `${script_id}_${hash}` |
| 绑点击 | `eventOn(事件名, fn)` | 返回 `{ stop() }`，`cleanup()` 时用它解绑 |

**第二个坑：写会被静默丢掉。** `replaceScriptButtons` 先从运行时的 store 里查本脚本
（`src/store/iframe_runtimes/script.ts:27` 的 `enabled_scripts_with_source` 在
`global_settings.app_ready` 为假时返回空数组），查不到就 `return` —— 不报错、不抛异常。
脚本 iframe 常挂在 `app_ready` 之前，那一次写就白写了，之后没人补。
所以本脚本写完会**立刻回读校验**，没写进去就按 `CONFIG.injectStoreRetryDelayMs`（默认 300ms）
重试，最多 `CONFIG.injectStoreRetryMax`（默认 20）次，并在每次 `visibilitychange`
（标签页切回来）时补一次。重试期间没写成功的状态就是 `storeReady: false`。

* 注册配置里**只有 `name` + `visible`** —— 4.11.3 的 zod schema（`src/type/scripts.ts:4-7`）
  就只有这两个字段，写 `description` 会被丢掉。
* **按钮名必须恒定**：列表条目的身份和 `getButtonEvent` 的事件名都锚在这个字符串上，
  改名字会被当成新按钮 → 列表里堆重复条目。所以状态不写进名字，走 `mode` 和弹窗；
  写入路径（`writeInjectButtonEntry()`）还会**按名字去重**，同名重复条目只留一条。
* 酒馆助手的按钮全局一个都没有时（老版本 / 脚本不在 iframe 里跑）：只打一条 warn，
  脚本照常跑，用 `__silverMoon.retryInject()` 兜底。
* **`yielded`（让位）也能点**（v1.4.4 起）：点了是「把冲突重查一遍」，不是「重试注入」；
  仍然让位就如实 toast「让位了（N 处冲突）」，不假装成功。
* 常驻模式下**不再有「成功就撤掉按钮」**这一步；`hideInjectButton()` 只在
  `cleanup()` / `uninstall()` / `showInjectButton` 关掉时跑。
* **`uninstall()` 是粘性的**（v1.4.4 起）：它会停掉全部被动监听（`app_ready` /
  `chat_id_changed` / `settings_loaded` / `visibilitychange` / `silver-moon:sync`）并把状态打到
  `off`，所以卸载之后**不会**被下一次 `app_ready` 把按钮和正则又装回来；
  想重新接管走 `__silverMoon.install()`（会重新武装监听）。

开关 / 排查：

```js
__silverMoon.config.showInjectButton = false;         // 整个功能关掉（按钮会被撤掉）
__silverMoon.config.injectButtonAlways = false;       // 退回 v1.4 的「只在失败时出现」
__silverMoon.config.injectRetryStates.push("yielded"); // 让让位也算可重试
__silverMoon.config.injectButtonName = "银月·注入";    // 改名（改完 refresh()）
__silverMoon.injectButton()   // {name, label, always, mode, registered, visible, want, event, bound, storeReady, retrying, retryCount, storeRetryCount, storeGaveUp}
__silverMoon.retryInject()    // 等价于点一下按钮
```

`injectButton().mode`：`"retry"` = 可点重试；`"ok"` = 已就位（点了只提示）。
`want` 保留为旧名（= `mode === "retry"`）。
`injectButton().storeReady === false` 就是上面那个 `app_ready` 坑：按钮列表还没接住这次写入，
脚本正在按间隔补写；`storeGaveUp === true` 表示重试用完还没成功（这时至少
`__silverMoon.retryInject()` 还能用）。

### 4.2 实例归属权：为什么「缩不进去 / 美化时有时无」要往回找 iframe 重建

**v1.4.3 修的就是这个。** 酒馆助手把每个脚本跑在**各自的 iframe** 里，但所有 iframe
**共享同一份 ST 设置**（`power_user.reasoning` / `extension_settings.regex` / 脚本按钮列表）。
于是有两个会互相拆家的场景：

1. **重建 iframe 的拆除竞态**：改脚本内容、切预设、重载设置都会把旧 iframe 拆掉、再建一个新的。
   新实例 `init()` 完（正则、样式、`reasoning` 都铺好了）之后，**旧 iframe 的 `pagehide` 才到**。
   v1.4.2 以前 `pagehide` 直接绑 `cleanup()` —— 于是旧实例临死前把新实例刚铺的东西全摘了：

   | 被摘掉的东西 | 你看到的现象 |
   |---|---|
   | 两条归一化正则 | wrapper 留在正文里 → **思维链缩不进去** |
   | `#reasoning-style-*` 样式 | **美化块不见了 / 时有时无** |
   | `power_user.reasoning` 还原成 ST 默认 | ST 不再把开头那段当思维链解析 |

   实测（`.work/double-instance-diag.js`，修复前）：单跑 v1.4.2 → 2 条正则、`auto_parse: true`、
   1 个样式；再派发一次 `pagehide` → 正则 **0 条**、`reasoning` 回到 `<think>\n`/`\n</think>`、
   样式 **0 个**、按钮不可见 —— 和用户报的现象逐条对上。

2. **同时跑两份银月**（脚本库里一份 + 某个预设的「一键启动器」`import` 的 CDN 一份）：
   v1.2.0 那份没有归属概念，会照样把 v1.4.3 的正则摘掉。

**v1.4.3 的对策**（三条，都在 `silver-moon.js` 里；v1.4.4 又加固了两处）：

* **归属标记**：ST 顶层 window 上的 `__silverMoonOwner = {instance, id, script, version, ts}`。
  启动时比版本号（`versionRank()`）：已有**更新**的一份在跑，这一份就**让位**（什么都不做，只 warn）。
  **v1.4.4 起同版本也要分高低**：v1.4.3 只比版本号，而「脚本库那份」和「CDN 那份」是**两个
  不同的 `SCRIPT_ID`**，同为 v1.4.4 时两边都判「owner 不是我 → 让位」会同时不成立，于是
  两份一起写共享设置。现在再加一个 **per-instance 身份**（`INSTANCE_ID`，优先 `getIframeName()`），
  同版本时比对启动时刻（`INSTANCE_START_TS`）：**后来者接管**，`stillOwner()` 也用 instance 判，
  被接管的那份从此不再自愈抢装。`status().owner` 能看现状（`mine: false` = 已让位/已卸载）。
* **`pagehide` 只放弃归属**（`onPageHide()`）：`clearInjectStoreRetry()` + `releaseOwner()`，
  **绝不碰**正则、样式、`reasoning`。想真卸载走 `__silverMoon.uninstall()`（唯一会做完整拆卸的入口，
  顺序是「先摘正则 → 再样式 → 再按钮 → 最后（且只有自己确实是归属者才）还原 `reasoning`」）。
  **v1.4.4 起卸载是粘性的**：`cleanup()` 会置 `disposed`、停掉全部被动监听，并只在摘掉自己的东西时
  还原自己铺的配置 —— v1.4.3 的问题是卸载之后来一次 `app_ready`，按钮和正则又被装回来了。
  想重新接管：`__silverMoon.install()`。
* **自愈**（`resyncIfStripped()`）：被动事件（`app_ready` / `chat_id_changed` / `settings_loaded` /
  标签页切回来）时，如果「我们本来是装好的、现在正则却没了」，就补装一次。只在**原本装好**
  且**仍然归我管**（`disposed` 为假、`stillOwner()` 为真）的状态才自愈：让位态（`yielded`）、
  探针没过（`probe-failed`）、已卸载都不去打扰。
  这一条是对「只能去脚本库关一下再开」的正面回应 —— **不需要手动开关脚本了**。
  **样式也单独算一路**：`<style id="reasoning-style-…">` 被别的实例按同名 id 摘掉时（老版
  v1.2 的 `cleanup()` 就会这么干，用户看到的是「明月本身也不美化了」），正则还在也照样把样式补回去 ——
  实测 `.work/double-instance-diag.js`：`pagehide` 后样式 0 个，补一个被动事件回来就是 1 个，
  正则始终 2 条、没被重装成 4 条。

另外 `init()` 开头**不再调用 `cleanup()`**（那正是跨 iframe 互拆的源头），同一 window 重复加载
由 `window.__silverMoonRuntime` 挡掉（否则会堆出两套同样的正则）。

排查命令：

```js
__silverMoon.status().owner      // {self, version, mine, current} —— mine:false = 已让位
__silverMoon.uninstall()         // 完整拆卸（摘正则/样式/按钮 + 还原 reasoning + 放弃归属）
__silverMoon.status().normalize  // 看 state 是不是 installed/present
```

> 部署建议：**别同时挂两份银月**。如果你的「一键启动器」还指向
> `...@v1.2.0/思维链/银月/silver-moon.js`，把 URL 的 tag 换成新版本（或干脆删掉那一条），
> 否则那份老代码没有归属逻辑，会继续和新版互拆。

---

## 5. 四道守卫

| 守卫 | 防的是什么 | 自检台 |
|---|---|---|
| **探针**（用 ST 自己的 `parseReasoningFromString` 试一遍） | 我们写进去的 wrapper 真会被解析掉吗？不过就**坚决不装**，否则等于往正文里写一串没人认的 wrapper | E1-E5 |
| **让位**（`yieldToOtherRegexes`） | 别的启用正则在管同一批标签时不抢 | D1-D5 + `.work/live-conflict-check.js` |
| **让位要连配置一起还**（`revertOwnReasoningConfig`） | 只让一半：正则没装、ST 的 reasoning 配置却被改了 → ST 自己去搬思维链、预设的包装链还在 → 正文和聊天记录被改坏 | R4-R8（真实预设 + 真实消息） |
| **无变化不写回**（v1.4.4） | 酒馆助手 `updateTavernRegexesWith` 落地是 `saveSettings()` + `render_tavern_regexes_debounced()`（`tavern_regex.ts:249-256`）= **重排整段聊天**。规则没变还照写，就是每次开页面白排一次 | O1-O4 + A7/C7 |
| **DOM 自检** | 事后可观测：有没有消息既出现块、又漏了 wrapper | G3/G4 |

另外几道**幂等 / 粘性**保护（都是自检台抓出来才补上的）：

* **流式那条**带 `(?!canonicalPrefix)` 负向预查 —— 它不能对自己的产物再动手，
  否则 `[metacognition]思考` 会被再拼一次前缀，思维块开头多一个前缀/空行。
* **闭合那条**（v1.4.4 改）挡的是「**已经是完整 canonical 对**」（`(?!(?:cp)[\s\S]*?(?:cs))`），
  **不是**「以 canonicalPrefix 开头」。只看开头会留下一个死角：别的预设直接吐
  `[metacognition]思考[/metacognition]` 或 `[metacognition]思考</think>`（识别名单
  `leadingThinkWrappers` 里本来就有这两对）时，闭合规则被挡住、流式规则又只认「没闭合」的情形，
  两条都不动手 → **这种预设的思维链永远缩不进去**。改成看「完整对」之后这两种都能归一，
  而已经写成 canonical 对的消息仍然幂等、也不会被思维链里引用的字面 close 标签提前截断。
* 转义函数会把真换行写成 `\n` —— `canonicalPrefix` / `canonicalSuffix` 现在的字面量不带换行，
  但这个转义照样要留着：真换行塞进 `findRegex` 会让 ST 的 `regexFromString`（`utils.js:1279`）
  当场解析失败。

---

## 6. 与美化块脚本（`silver-moon-blocks-*.js`）的关系

互不干扰，可以同时装：银月的两条只管**消息开头、整段 CoT 那个外层包裹**；
美化块的标记正则管 `<thinking_left>`、`<thinking_right>` 这些**内层块**。

拿你机器上真实生效的 7 条全局正则跑过（`.work/live-conflict-check.js`，只读）：
**不会误判冲突**。

但**预设层**要另说：你现在用的 `梦鲸思客V4-0902` 自带那三条 `<think>` 正则 →
银月**会让位**（`configApplied=false`，什么都不动），这是正确结果 ——
那个预设自己就把思维链藏好了，月亮块用不上；要强行接管才 `takeOver()`（代价见第 3 节表）。

> ⚠️ 观察点：如果某个预设把**内层块一起包在一个外层 `<think>` 里**，整段 CoT
>（连同内层字面标签）会被抽进月亮块，而美化块脚本的标记正则作用范围是"AI 输出"，
> 管不到 reasoning 内容 —— 月亮块里会看到裸露的内层标签。真遇到了再说
>（那属于美化块脚本要加 `reasoning: true` 作用范围的事，本文件没碰那两个脚本）。

---

## 7. 自检台

```powershell
node .work\st-reasoning-test.js        # 73 条断言（合成样本），报告写到 .work\st-reasoning-report.txt
node .work\dream-check2.js             # 12 条断言（你真实的预设 + 真实消息），报告写到 .work\dream-report.txt
node .work\live-conflict-check.js      # 拿你真实的正则列表查冲突（只读，不回写）
node .work\silver-moon-button-test.js  # 151 条断言（A 常驻+可点 / B 失败态与写入重试 / C 点击重试 / D 无 API 降级 / E 同名复用 / F 让位 / G uninstall 完整拆卸+粘性 / G2 非归属实例 uninstall / H 静态接线 / J 秋青形状 / K 导入 json / L 常驻开关 / M 多实例归属权 / N pagehide 非破坏性 + 自愈（含只补样式不重装正则）），报告写到 .work\button-report.txt
node .work\double-instance-diag.js     # 复现「旧 iframe 的 pagehide 把新实例的成果拆掉」（只读诊断，用来验收 v1.4.3）
node .work\dream-check.js              # 真实 <dream_plot> 消息的观察记录（不断言，只看输出）
```

按钮那套的桩在 `.work/silver-moon-button-test.js` 顶部用字符串内联，保证在银月之前执行 ——
断言的是**真源码**，不是照着实现再实现一遍。桩**故意只桩 4.11.3 真实存在的那四个全局**
（`getScriptButtons` / `replaceScriptButtons` / `getButtonEvent` / `eventOn` + `toastr`），
**不放** `registerScriptButton` / `listenEvent` —— 桩里再放，就是继续测一个不存在的世界
（H6-H8、K9 就是钉这条的）。`replaceScriptButtons` 的桩还复刻了
「`app_ready` 之前静默丢弃」，用来跑 `storeReady=false → 重试 → 成功` 那条路径。

jsdom 装在 `.work\node_modules`（DSH 每次命令的 `TEMP` 都是新的随机目录，
所以不能用 `%TEMP%`；`.work/jsdom-loader.js` 会按优先级去找）。
`.work` 是临时目录，看完可以整个删掉。

`.work/ref/st-mirror.js` 是从 ST 1.14.0 源码逐字搬来的迷你 ST：
`escapeRegex` / `parseReasoningFromString` / `getRegexedString` / `cleanUpMessage` 那一趟 /
流式的 `#autoParseReasoningFromMessage` / 酒馆助手的格式转换（`tavern_regex.ts:136-194`）。
所以断言不是"照着自己的实现再实现一遍"。

---

## 8. 回滚

| 想做的事 | 怎么做 |
|---|---|
| 只关掉接管 | `CONFIG.adoptLeadingThink = false` → `__silverMoon.refresh()` |
| 只要不流式改写 | `CONFIG.normalizeWhileStreaming = false` → `refresh()` |
| 连样式一起不要 | `__silverMoon.uninstall()`（完整拆卸：先摘两条正则 → 去样式 → 收按钮 → 还原 `reasoning` → 放弃归属）。⚠️ **在脚本库里关掉银月不会再拆了**（v1.4.3 起 `pagehide` 只放弃归属，见 §4.2）——不然别的实例/新实例刚铺好的东西会被临死的那一份拆掉 |
| 手滑删了正则 | `__silverMoon.refresh()`；装好过的话，被动事件（切聊天/重载设置/切回标签页）也会**自愈**补装 |
| 确认现在什么状态 | `__silverMoon.status()` |
| 酒馆里那份「明月」还是旧版 | 用仓库的 `酒馆助手脚本-明月.json` 重新导入，或（酒馆关着的时侯）跑 `node .work/patch-live-mingyue.js` — 只换 `content`，文件先备份到 `.work/settings-backup-*.json`，想还原就把备份讴回去 |
| 按钮看着不对 | `node .work/patch-live-mingyue.js --check` 只看不写，对一下版本和 id |

---

## 9. 「思维链缩不进去」排查（附：和秋青那套有什么区别）

### 9.1 两种「格式」不是一回事

经常被混在一起说的两样东西：

| | 秋青那套 | 银月 |
|---|---|---|
| 谁在写这对包裹 | **预设自己**（提示词里让模型照着吐） | 模型吐它自己的（`<think>`／`[metacognition]`…），**银月事后改写**成 canonical |
| 包裹长什么样 | `<thinking>` + 换行 + `[metacognition]` + 换行 + 思维链 + 换行 + `</thinking>` + `{{getvar::timeline}}` | `[metacognition]` + 思维链 + `</thinking>` |
| 谁把它变成月亮块 | 预设自带的**美化正则**（「酒馆显示正则」那一档，渲染时跑） | **ST 原生 reasoning 解析**（收到/编辑消息时跑，走 `power_user.reasoning`） |
| 换预设后 | 得带着那批正则走 | 全局正则，切预设还在 |

**能对上的地方**：光看「开标签 + 换行」这一层，两边是同一个
`[metacognition]`（`CONFIG.canonicalPrefix`）。所以秋青预设吐出来的
`<thinking>…[metacognition]…</thinking>`，银月认得出（第 1.5 节那张表的第 6 对，
**整段**吃下来，里面那行 `[metacognition]` 原样留在 `$1` 里），归一化后 ST 解析出的
思维链正文仍然是 `[metacognition]\n思维链…` —— 和秋青预设期望的形状一致。
钉住这条断言的实测输出（`.work/silver-moon-button-test.js` 的 J1/J2/J4）：

```
输入 : "<thinking>\n[metacognition]\n[思维链内容，必须思考每一条不得跳过！]\n</thinking>{{getvar::timeline}}\n\n真正的正文。"
块里 : "[metacognition]\n[思维链内容，必须思考每一条不得跳过！]"
正文 : "{{getvar::timeline}}\n\n真正的正文。"
```

**对不上的地方**（三条，决定了「缩不进去」）：

1. **`{{getvar::timeline}}` 不是格式的一部分。** 那是 ST-Prompt-Template 一类的
   宏，靠「有没有装那个扩展 + 变量有没有值」在**生成/发送**阶段展开。
   本机 `E:\sillydata\extensions\` 下**并没有装**（只有 `JS-Slash-Runner`、`shujuku`、
   `sillytavern-novel-chapter-injector` 三个），所以照抄这条字面量不会有东西被展开，
   只会往正文里写一串死文本。要用它得先确认那个扩展在、且变量有值。
   银月**不会去动它**（J6）：它落在正文里，`</thinking>` 之后，位置和秋青那份一样。
2. **两条通道不抢同一份文本**（第 3 节那张表）：银月的正则改的是**消息本身**
   （`AI_OUTPUT`），秋青的美化正则改的是**显示层**（`MD_DISPLAY`）。
   银月接管后原标签已经被吃掉，对方那条美化正则找不到自己的 `find`，自然「缩不进去」。
3. **预设自带正则在管同一批标签时银月会让位**（`yielded`，`configApplied=false`），
   此时两套都不完整 —— 这正是 v1.3 修「让位只让了一半」的那个事故。

### 9.2 四步排查

```js
const s = __silverMoon.status().normalize;
s.state            // 先看这个
s.configApplied     // 银月有没有占着 ST 的 reasoning 配置
__silverMoon.status().reasoning   // ST 现在实际生效的 prefix / suffix / auto_parse
__silverMoon.conflicts()          // 谁在跟我抢同一批标签
```

| `state` | 意思 | 怎么办 |
|---|---|---|
| `installed` / `present` | 归一化装好了 | 缩不进去是**别的**原因（看第 9.3 节） |
| `probe-failed` | ST 不认这对 wrapper，**没装** | 看 `status().reasoning`：`auto_parse` 是不是 `false`、prefix/suffix 是不是被别人改了。改回来再点一次 `银月·注入` 按钮 |
| `yielded` | 有别的正则在管同一批标签，银月让位 | 要么留着对方（对方自己会藏）、要么 `__silverMoon.takeOver()` 强行接管（代价见第 3 节表） |
| `failed` | ST 的正则接口回绝了这两条 | 看控制台 warn；`__silverMoon.refresh()` 再试一次 |
| `no-wrappers` | `leadingThinkWrappers` 是空的 | 一般是 CONFIG 被改坏了，`refresh()` |
| `off` | `adoptLeadingThink` 关着 | `CONFIG.adoptLeadingThink = true; refresh()` |

### 9.3 装好了还是「缩不进去」

排查顺序建议从第 4 条往上——**最常见的是它**：

* **刚重载过脚本 / 改过脚本内容**（v1.4.2 及以前）：旧 iframe 的 `pagehide` 把新实例刚铺好的
  正则和 `reasoning` 配置拆了。典型特征是「重载后好一下、过一会儿全没」，而且
  `status().normalize.state` 不是 `installed`/`present`。v1.4.3 起不再发生（§4.2），
  真被拆了被动事件也会自愈。
* **同时挂了两份银月**（脚本库一份 + 预设启动器 import 的 CDN 一份，尤其 tag 还是 `@v1.2.0`）：
  老那份没有归属逻辑，会继续摘新版的正则。看 `status().owner.mine`：
  `false` 就是这一份让位了。**留一份就好**（§4.2 末尾的部署建议）。
* **消息已经带了 reasoning 字段**：ST 会跳过解析（`reasoning.js:1311-1314`），
  刚写进正文的 wrapper 就留在正文里。`__silverMoon.selfCheck().dom` 里
  `bothInOneMessage > 0` 就是它（第 3 节末尾那条）。
* **预设的显示正则在 `MD_DISPLAY` 档**：那一档永远看不到 `[metacognition]`
  （在「改消息本身」时就被吃掉了）。要它生效就得让银月让位（`yielded`），
  别 `takeOver()`。
* **`auto_parse` 是 `false`**：银月只在探针通过后才写配置。探针不过 →
  配置原样还回去 → 正文里的包裹没人解析。这是**刻意的**（宁可不出块，
  也不要往正文里写一串没人认的 wrapper）。

### 9.4 想统一成「一个块、跟着流式长出来」

那就是 `takeOver()` 之后的状态：ST 的 `reasoning` 配置被占成 canonical、
两条归一化正则管住消息本身、思维块从第一个 token 起跟着长（第 2 节）。
代价是预设自己那套 `<think>` 包装链和美化正则全部落空 ——
所以它是个**手动按钮**（`__silverMoon.takeOver()`），不是默认行为。

---

## 10. 更新记录

* **v1.4.4**（一轮外部代码审查之后，只挑**在真实代码 + 真实 SillyTavern 上复现过**的 7 项修）
  * **常驻按钮不再是摆设**：v1.4.2/1.4.3 只在失败态绑点击，所以「一开页面就直接成功」的用户
    点它**毫无反应**（连提示都没有），而成功态那段「点了提示一句」的代码根本到不了。
    现在两种状态都绑点击；点击语义统一成「**再同步一次并播报结果**」（成功 → success，
    让位 → 如实告警，没好 → 告警重试）。见 §4.1。
  * **无变化不写回**：`installNormalizeRegex()` 先读现有列表逐条比对，规则一模一样就直接
    `present` 跳过写入。酒馆助手 `updateTavernRegexesWith` 落地是 `saveSettings()` +
    `render_tavern_regexes_debounced()`（`tavern_regex.ts:249-256`）= **重排整段聊天**，
    以前每次开页面/每次 `refresh()` 都白排一次。见 §5。回退/`takeOver` 语义不变。
  * **闭合规则的 guard 从「开头是 canonicalPrefix」改成「已经是完整 canonical 对」**：
    旧写法留下一个死角 —— 别的预设直接吐 `[metacognition]思考[/metacognition]` 或
    `[metacognition]思考</think>`（识别名单里本来就有这两对）时，闭合规则被挡住、流式规则又
    只认「没闭合」的情形，两条都不动手 → **这种预设的思维链永远缩不进去**。
    改完这两种都能归一；已经写成 canonical 对的消息仍然幂等，也不会被思维链里引用的字面 close
    标签提前截断（B10a-e 钉住）。
  * **后台不再白扣重试预算**：`scheduleInjectStoreRetry()` 改成先查 `document.hidden` 再计数
    （以前反着写，页面挂后台时会把 20 次预算耗光）。
  * **卸载是粘性的 + 被动监听解绑**：`uninstall()` 之前只摘东西、不停监听，于是下一次
    `app_ready` / `chat_id_changed` 会把按钮和正则**又装回来**。现在 `cleanup()` 置 `disposed`、
    停掉全部 `eventOn` 句柄与 `visibilitychange` / `silver-moon:sync` 监听，状态打到 `off`；
    `__silverMoon.install()` 能重新武装。返回值改成真实回执（本来没在管就是 `false`）。
  * **归属标记加 per-instance 身份**：旧记录只有 `{id: SCRIPT_ID, version, ts}`，而脚本库那份与
    CDN 那份是**两个不同的 `SCRIPT_ID`** → 同版本时两边都判「owner 不是我」，谁都不让位、一起写。
    现在记 `{instance, id, script, version, ts}`（`INSTANCE_ID` 优先取 `getIframeName()`），
    同版本比启动时刻：**后来者接管**；`stillOwner()` 与 `resyncIfStripped()` 也按 instance 判，
    被接管的那份不再自愈抢装。见 §4.2。
  * **非归属实例 `uninstall()` 不再撒谎**：强制路径只摘**自己名字**的正则/样式/按钮，
    但**不还原别人的 `reasoning` 配置**，也不删别人的归属登记（G2 段钉住）。
  * 自检台：`st-reasoning-test.js` 68 → **73 条**，`silver-moon-button-test.js` 127 → **151 条**，
    `dream-check2.js` 12 条不变；导入用 json 按新源码重新打包（`content` 75637 字符，逐字一致）。
  * **没改的三项**（审查里提到，我判定不该动）：冲突检测不扩到 `\[metacognition\]` 转义写法
    （引擎本来就接受，放宽会让银月**更常让位** = 正是「缩不进去」的方向）；
    `domSnapshot()` 仍用 `textContent`；非 global 作用域与原生回退路径的老边角。
  * 顺带纠正审查里的一处误判：审查说「流式规则的自锁会让 `</think>` 永远变不成 `</thinking>`，
    思维块长到一半僵住」——**不成立**。真 ST 每个 token tick 都拿**原始累积文本**重跑一边
    （`public/script.js:3659-3665` 的 `cleanUpMessage({getMessage: text})` + `:3886-3896`
    的 `this.continueMessage + text`），不是拿上一轮的正则输出接着跑；自检台 S1-S9 全绿也是这个原因。

* **v1.4.3**
  * **修「整个没用了 / 思维链缩不进去 / 美化时有时无」的头号原因**：旧 iframe 的 `pagehide`
    会执行完整 `cleanup()`，而酒馆助手重建脚本 iframe 时 `pagehide` 经常落在**新实例 `init()`
    之后** —— 临死的旧实例把新实例刚铺好的两条正则、样式、`reasoning` 配置全摘了。
    实测（`.work/double-instance-diag.js`）：修复前单跑 v1.4.2 有 2 条正则 + 1 个样式 +
    `auto_parse: true`，再派发一次 `pagehide` 就变成 0 条正则 / 0 个样式 / ST 默认 reasoning。
  * **`pagehide` 改成只放弃归属**（`onPageHide()` = 清重试计时器 + `releaseOwner()`），
    不再碰任何共享设置；**完整拆卸只由 `__silverMoon.uninstall()` 触发**（顺序：先摘正则 →
    去样式 → 收按钮 → 还原 `reasoning` → 放弃归属），`uninstall()` 现在有明确返回值。
  * **`init()` 开头不再调用 `cleanup()`**（跨 iframe 互拆的源头）；同一 window 重复加载由
    `window.__silverMoonRuntime` 挡掉，避免堆出两套同样的正则。
  * **多实例归属权**：ST 顶层 window 上的 `__silverMoonOwner = {id, version, ts}`，
    启动时按 `versionRank()` 比版本 —— 已有更新的在跑就让位（什么都不写，只 warn），
    自己更新就接管。新增 `status().owner`（`mine:false` = 已让位）。
  * **自愈**（`resyncIfStripped()`）：被动事件（`app_ready` / `chat_id_changed` /
    `settings_loaded` / 标签页切回来）发现「本来是装好的、现在正则没了」就补装一次；
    **样式被摘也一样**（`styleMissing()` 单独看样式，补样式不重装正则）。
    只在原本装好的状态自愈，让位/探针没过不打扰。**这就是「不用再去脚本库开关一次脚本」的兑现。**
  * 自检台 93 → **127 条**（G 段改成钉 `uninstall()` 的完整拆卸与顺序；新增 M 段 12 条钉
    多实例让位/接管/同窗口重复加载；N 段 14 条钉 `pagehide` 非破坏性 + 自愈 + 只补样式 +
    自愈不去打扰失败态；
    B3 段改成先钉住 `document.hidden` 再测「后台不空转」，上限放大到 8 以便区分
    「1ms 定时器空转」和「被真实事件顺手推了一两次」）。

* **v1.4.2**
  * **按钮改成常驻**（`CONFIG.injectButtonAlways`，默认 `true`）。以前是「只在
    `probe-failed` / `failed` 时出现」，等于按钮一出现就说明已经坏了，成功时反而看不见 ——
    没法回答「它到底在没在工作」。现在四个状态（`ok` / `retry` / 让位 / 关着）按钮都在，
    状态走 `status().injectButton.mode`：`"retry"` = 可点重试，`"ok"` = 已就位。
    点已就位态的按钮只 toast 一句「不用点」，**不重跑探测**（v1.4 语义是点了就重跑）。
    想要回老行为：`CONFIG.injectButtonAlways = false`。
  * **按钮名不再随状态改**。试过用「银月·已注入」当成功态标签，结果发现条目身份和
    `getButtonEvent` 的事件名都锚在名字这个字符串上，改名会被当成新按钮、列表里堆重复条目。
    所以名字恒定 `银月·注入`，状态只在 `mode` 和弹窗里体现；写入路径
    `writeInjectButtonEntry()` 另外**按名字去重**。
  * **修一个让重试预算失效的 bug**：`syncInjectButton()` 每次都把重试计时器和预算清零，
    于是 `storeRetryCount` 永远停在 1、`storeGaveUp` 永远不为真。现在只在
    「功能被关掉」时才清预算；stub 里 `visibilitychange` 触发的补偿写入不再重置预算。
  * `injectButton()` 快照加 `label` / `always` / `mode`（`want` 保留为旧名，= `mode === "retry"`）；
    `hideInjectButton()` 只在 `cleanup()` / 关掉功能时跑，不再因为「成功」而收起按钮。
  * 自检台 87 → **93 条**（A 段改成钉常驻、C 段改成钉「已就位态点击不重跑」、F 段钉让位态
    按钮在但不可点、H12 钉常驻开关真接线了、L 段钉 `injectButtonAlways:false` 能退回老行为）。
    导入用 `酒馆助手脚本-明月.json` 重新打包（`content` 仍与源码逐字一致）。
* **v1.4.1**
  * **修好「按钮在、点了没反应」**。v1.4 照小 cot 的写法用了两个名字 —— 一个「注册按钮」的
    全局和一个「监听」的全局，但酒馆助手 4.11.3 **两个都没有**：前者全仓 0 命中，
    后者是小 cot 自己定义的局部函数（`小cot/cot-heart-soundV3.js:1358`）。结果按钮
    注册上了、点击回调绑不上，人还是只能回脚本库开关一次脚本。
    现在改成真实存在的通道：`getScriptButtons()` 读（klona 克隆，必须写回）→
    `replaceScriptButtons(list)` 写 → `getButtonEvent(name)` 取事件名 →
    `eventOn(id, fn)` 绑（`cleanup()` 用返回的 `{stop()}` 解绑）。详见第 4.1 节。
  * **补 `app_ready` 那个坑**：脚本 iframe 常常在 `app_ready` 之前挂载，那时
    `replaceScriptButtons` 会**静默返回**（`src/function/script.ts:76-78` +
    `src/store/iframe_runtimes/script.ts:27`），那一次写就白写了 ——
    这才是「好像得手动去脚本库里建个按钮才看得到」的真因。现在写完立刻**回读校验**，
    没写进去就按 `injectStoreRetryDelayMs`（300ms）× `injectStoreRetryMax`（20 次）重试，
    并在 `visibilitychange` 时补一次；状态暴露成 `injectButton().storeReady`。
  * `init()` 额外挂 `app_ready` / `chat_id_changed` / `settings_loaded` 三个事件
    （已经就位时只重跑**按钮同步**，不重跑归一化）。
  * 导入用 `思维链/银月/酒馆助手脚本-明月.json` 重新打包：`content` 现在与
    `silver-moon.js` **逐字一致**（`.work/build-mingyue-json.js` 把这条钉成断言）。
  * 源码里不再出现那两个不存在的名字（连注释也不写），自检台 K9 钉这条。
  * 自检台从 50 条扩到 **87 条**：桩改成只桩 4.11.3 真实存在的四个全局，
    新增「伪造 API 不会通过」「`storeReady=false` → 重试 → 成功」「重试用尽」
    「只绑一次事件」「导入 json 的 content 与源码逐字一致」等断言（K 段）。
* **v1.4**
  * **加 `银月·注入` 重试按钮**：注入失败（`probe-failed` / `failed`）时在脚本库挂一个
    按钮，点一下就地重跑 `syncLeadingThink()`，成功自动消失、失败弹告警并保留。
    解决「只弹窗一次，之后必须开关脚本才能继续注入」。见第 4.1 节。
    （⚠️ v1.4 的绑定方式用的是当时以为存在的两个全局，点击其实绑不上，v1.4.1 修。）
  * 新增 `__silverMoon.injectButton()` / `__silverMoon.retryInject()`；
    `status().injectButton` 一并暴露；`cleanup()` 会先把按钮收起来再还原 reasoning 配置。
  * 新增自检台 `.work/silver-moon-button-test.js`。
  * 文档：新增第 1.5 节（认哪些包裹）与第 9 节（「缩不进去」排查 / 和秋青的区别）；
    订正「和 `reasoning\明月.json` 逐字一致」这条**过期**说法 —— 本机没有那个模板，
    权威值就是 `CONFIG.canonicalPrefix` / `canonicalSuffix` 本身。
* **v1.3**
  * **修「让位只让了一半」**：铺 `reasoning` 配置挪到探针/冲突检查**之后**
    （`applyCanonicalConfig`），让位或探针失败时调 `revertOwnReasoningConfig` 原样还回去。
    这条是拿你真实的 `梦鲸思客V4-0902` + 真实 `<dream_plot>` 消息跑出来的事故（见第 3 节）。
  * `status().normalize.configApplied` 让你一眼看出银月有没有占着配置。
  * 新增真实数据回归 `.work/dream-check2.js`（12 条）。
* **v1.2**
  * 默认打开接管（`adoptLeadingThink: true`）。
  * **修流式**：补一条「只换开标签」的正则，思维块从第一个 token 起就跟着长
    （v1.1 的那条必须等闭合，所以成了"出完字才渲染"）；`normalizeWhileStreaming` 可关。
  * 自检台抓出并修掉三个真 bug：规则对自己的产物再动手（多空行）；
    转义函数没处理真换行（`findRegex` 直接解析失败）；关掉流式/接管后旧条目没摘干净。
  * 冲突扫描不再把银月自己那两条算成冲突（否则第二次 refresh 就会自己让位给自己）。
* **v1.1**
  * 加了归一化 + 让位 + 探针 + 自检；修掉 `\\[metacognition\\]` 那个反斜杠 bug。
