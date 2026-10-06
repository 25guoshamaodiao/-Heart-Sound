# 银月 · 接管「其他预设的开头思维链」（v1.2，默认**开**）

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
   已改成字面量，和 `E:\sillydata\default-user\reasoning\明月.json`
   （`[metacognition]\n` / `\n</thinking>`）**逐字一致**。
3. `strict` 默认 true → 匹配锚在**消息开头**（`^\s*?`），且 `String.replace` 不带 `g`
   → 一条消息只吃**第一处**。

你机器上的实际状态（读 `E:\sillydata\default-user\settings.json` 得到）：
里面有**你没设过** `power_user.reasoning`，`loadReasoningSettings()`（`reasoning.js:722`）
也不会在启动时套用模板 —— 所以运行时生效的是 ST 默认值
`<think>\n` / `\n</think>`、**`auto_parse: false`**：文本里的思维链**根本不会被解析**，
月亮块只出现在"模型自带 reasoning 字段"的消息上。

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
__silverMoon.status()        // reasoning 生效值 / 归一化状态 / 冲突清单
__silverMoon.selfCheck()     // 上面这些 + 探针 + DOM 自检（有没有漏 wrapper、有没有两个都有）
__silverMoon.normalizeRegex()// 现在这两条正则长什么样
__silverMoon.conflicts()     // 只看冲突
__silverMoon.takeOver()      // 忽略冲突，强制接管
__silverMoon.uninstall()     // 摘掉两条正则（不动样式、不动配置）
__silverMoon.refresh()       // 改完 CONFIG 调用，立即重新同步
```

`normalize.state`：`off` / `no-wrappers` / `probe-failed`（ST 不认这对 wrapper，**没装**）/
`yielded`（有冲突，让位）/ `installed` · `present`（装好了）。
`normalize.configApplied`：银月现在有没有占着 ST 的 reasoning 配置 ——
`yielded` / `probe-failed` / `off` 时它必须是 `false`（配置已还回去）。

---

## 5. 四道守卫

| 守卫 | 防的是什么 | 自检台 |
|---|---|---|
| **探针**（用 ST 自己的 `parseReasoningFromString` 试一遍） | 我们写进去的 wrapper 真会被解析掉吗？不过就**坚决不装**，否则等于往正文里写一串没人认的 wrapper | E1-E5 |
| **让位**（`yieldToOtherRegexes`） | 别的启用正则在管同一批标签时不抢 | D1-D5 + `.work/live-conflict-check.js` |
| **让位要连配置一起还**（`revertOwnReasoningConfig`） | 只让一半：正则没装、ST 的 reasoning 配置却被改了 → ST 自己去搬思维链、预设的包装链还在 → 正文和聊天记录被改坏 | R4-R8（真实预设 + 真实消息） |
| **DOM 自检** | 事后可观测：有没有消息既出现块、又漏了 wrapper | G3/G4 |

另外两道**幂等**保护（都是自检台抓出来才补上的）：

* 两条正则都带 `(?!canonical)` 负向预查 —— 规则不能对自己的产物再动手，
  否则 `[metacognition]\n思考` 会被再拼一次前缀，思维块开头多一个空行；
* 转义函数会把真换行写成 `\n` —— `canonicalPrefix` 自带换行，
  真换行塞进 `findRegex` 会让 ST 的 `regexFromString`（`utils.js:1279`）当场解析失败。

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
node .work\st-reasoning-test.js        # 68 条断言（合成样本），报告写到 .work\st-reasoning-report.txt
node .work\dream-check2.js             # 12 条断言（你真实的预设 + 真实消息），报告写到 .work\dream-report.txt
node .work\live-conflict-check.js      # 拿你真实的正则列表查冲突（只读，不回写）
```

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
| 连样式一起不要 | 在脚本库里关掉银月，刷新。清理会**先摘两条正则、再还原 reasoning 配置**（顺序不能反） |
| 手滑删了正则 | `__silverMoon.refresh()` 会重新装 |
| 确认现在什么状态 | `__silverMoon.status()` |

---

## 9. 更新记录

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
