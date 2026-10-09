# 思维链 · 索引

一页导航：**装哪个、跑在哪一层、和谁冲突、坏了看哪份文档**。
机制与纪律见 [技术指导-思维链美化体系.md](技术指导-思维链美化体系.md)；细节见各产物自己的 README/设计文档。

## 分层速查

```
L0 提示词侧   →  精简/剥离，进上下文的文本
L1 消息改写   →  改 message.mes + 写 power_user.reasoning（决定 CoT 归属）
L2 显示正则   →  messageFormatting 里把文本变成 HTML 片段（必须 markdownOnly）
L3 DOM 装配   →  MutationObserver 微任务里把位置标记装配成块（必须同步，否则闪）
L4 样式/容器  →  主题 CSS；状态栏那种"每消息一份的小应用"
```

## 产物清单

| 产物 | 装在哪 | 层 | 别和谁一起装 | 文档 |
|---|---|---|---|---|
| 银月 `银月/silver-moon.js`（导入用 `银月/酒馆助手脚本-明月.json`） | 酒馆助手脚本库，一份 | L1 + L4 | 同类多实例由归属权处理，但**只留一份**最省事 | [README-思维链接管.md](银月/README-思维链接管.md) |
| 美化块变体 A（内联样式）`银月/silver-moon-blocks-inline.js` | 酒馆助手脚本库 | L2 + L3 | **不要**和变体 B 同装 | [README-美化块.md](银月/README-美化块.md) + [设计思路-美化块.md](银月/设计思路-美化块.md) |
| 美化块变体 B（CSS 类名版）`银月/zhinao.js`（脚本库条目名「智脑」） | 酒馆助手脚本库 | L2 + L3 | 同上 | 同上 |
| 小cot `小cot/cot-heart-soundV3.js`（另有 `稳定/V1`、`激进/V2`） | 酒馆助手脚本库 | L3 | 三份**只能装一个**（都自称 `maya-cot-v3`） | 文件头注释 |
| 弹幕 `.work/beautify/hs-danmaku.js` | 酒馆助手脚本库（或整段插进预设） | L2 + L3 | 可与美化块共存（标签族不同） | 文件头注释 |
| 预设版美化块 `.work/beautify/hs-blocks.js` | 预设/脚本库 | L2 + L3 | 与弹幕模块配套 | 文件头注释 |
| 弹幕提示词侧改法 `.work/beautify/弹幕规则-改法.md` | 预设文本 | L0 | —— | 文件本身 |
| 状态栏 `regex-状态栏.json` / `regex-状态栏.optimized.json` | 酒馆正则（一条，`placement=[2]`） | L2 + L4 | 同一时间只留一条同名正则 | [状态栏卡顿-诊断与优化报告.md](../状态栏卡顿-诊断与优化报告.md) / [状态栏性能复核-2.md](../状态栏性能复核-2.md) |
| 思维链美化总纲 | —— | —— | —— | [技术指导-思维链美化体系.md](技术指导-思维链美化体系.md) |

## 三条最容易踩的规矩

1. **显示类正则必须勾「仅格式显示」（`markdownOnly`）**，否则同一段替换会跑进提示词污染上下文。
2. **大载荷（状态栏那种几十 KB）必须整个待在一对 ` ``` ` 围栏里**，否则 markdown 会把它切碎，酒馆助手拿不到完整前端。⚠️ 现在 `regex-状态栏.optimized.json` **缺围栏**，直接导入会碎。
3. **自定义标签过 DOMPurify 会掉，只留文字**；分界必须靠一条极简"标记正则"提前换成 `<span data-…>`，样式与结构由脚本在 DOM 里装配。

## 自检台怎么跑

```powershell
cd .work; npm install; cd ..          # 依赖已移出版本控制，先装一次

node .work\st-reasoning-test.js        # 73 条：reasoning / 归一化 / 流式
node .work\silver-moon-button-test.js  # 151 条：按钮 / 生命周期 / 归属 / 无变化不写回
node .work\dream-check2.js             # 12 条：真实预设 + 真实消息回归
node .work\live-conflict-check.js      # 只读：当前正则列表冲突检查
```

> jsdom 往 stderr 打 `[csstree-match] BREAK` 会让 `node` exit 1，**判据是报告里的 PASS/FAIL 行**。
