# DSH 环境笔记：插件更新被阻塞 + 启动器修复

- 记录时间：2026-09-12（会话 `session-932c519f-e563-4713-8042-f5fb1d5e2072`）
- 工作区：`D:\-Heart-Sound`
- 结论状态：**profile 完好，无需修复；插件更新暂时做不了，已放弃更新**

---

## 0. 一句话结论

这台机器上**不要**用 `pnpm add` / `pnpm update` 或插件市场去更新 web profile 的插件：
任何会重新解析依赖的操作都会因 `@deepseek-ai/dsh-settings@>=0.1.2 <0.2.0-0` 找不到版本而失败。
原因不是插件本身，而是**镜像源只发布了预发布版（rc/alpha），没有稳定版 0.1.2+**，
而 profile 里跟随移动分支的 git 依赖在重新解析后会要求稳定版。

---

## 1. 环境事实（2026-09-12 核对）

| 项 | 值 |
|---|---|
| DSH_HOME | `C:\Users\10355\.dsh` |
| CLI 版本 | `0.1.2-rc.1`（npm 全局：`C:\Users\10355\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`） |
| CLI 入口 | `C:\Users\10355\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js`（junction → 上面那个 npm 全局目录） |
| web profile | `C:\Users\10355\.dsh\profiles\web`（**pnpm** 管理，pnpm 11.24.0） |
| registry | `https://registry.npmmirror.com` |
| GUI | `http://127.0.0.1:3080`（`dsh web`，等价 `dsh --profile web`） |
| profile bundles | `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dsh-web`、`dshmarket`、`upstream-radar` |
| 已验证的启动命令 | `node "C:\Users\10355\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js" web --no-open` |

注意：junction 的指向会随更新变化（曾指向 checkout `E:\deepseek\deepseek-harness\apps\cli`，
更新后指向 npm 全局目录）。路径本身不变，所以按上面的固定路径启动始终有效。

---

## 2. 触发的问题

想更新 `@anweat/dsh-browser`：
- 已装 `0.1.10`，package.json 声明 `^0.1.10`
- registry 上最新稳定 `0.1.12`，另有 `0.1.13-alpha.1`、`0.1.14-alpha.1`

失败信息（插件市场日志与手工复现完全一致）：

```
ERR_PNPM_NO_MATCHING_VERSION: No matching version found for
@deepseek-ai/dsh-settings@>=0.1.2 <0.2.0-0 while fetching it from https://registry.npmmirror.com/
（同一次还报了 @deepseek-ai/dsh-tools@>=0.1.2 <0.2.0-0）
The latest release of @deepseek-ai/dsh-settings is "0.0.1-rc.1"
Other releases are: alpha: 0.1.5-alpha.2 / next: 0.1.5-rc.2
```

日志位置：`C:\Users\10355\.dsh\profiles\web\.dsh-market\log.ndjson`，关键三条：

1. `update-blocked: @anweat/dsh-browser: refused while agents are running — session-932c519f…`
   → 插件市场在**有 agent 会话运行期间拒绝更新插件**，所以 dsh-browser 其实**从未真正尝试**更新。
2. `update-rollback: dshmarket: failed update command and restoration of the previous build could not be verified`
3. `update: dshmarket -> github:dsh-market/dsh-market#main exit=1`（`dsh-settings` 版本不匹配）

---

## 3. 根因（已复现验证，不是猜测）

1. profile 的 `package.json` 里有两个依赖**跟随移动分支**：
   `dsh-web` = `git+https://github.com/zhu1090093659/dsh-web-ui.git#main`、
   `dshmarket` = `github:dsh-market/dsh-market#main`。
   更新任何一个包时 pnpm 都会重新解析它们 → 拉到最新 main。
2. 最新 main 要求**稳定版** `@deepseek-ai/dsh-settings@^0.1.2` / `dsh-tools@^0.1.2`，
   而镜像上这些框架包**只有预发布版**（`dsh-settings` 共 21 个版本，dist-tags 为
   `latest=0.0.1-rc.1`、`alpha=0.1.5-alpha.2`、`next=0.1.5-rc.2`，**无 0.1.2 稳定版**）。
3. semver 的稳定区间 `>=0.1.2 <0.2.0-0` **不匹配任何预发布版** → 必然失败。

已排除的其他嫌疑：

- **与 dsh-browser 本身无关**：`0.1.11` / `0.1.12` 的 peerDependencies 与已装且正常的 `0.1.10` **完全一致**
  （`dsh-tools ^0.1.1-rc.2` 等），且 `@deepseek-ai/dsh-client-runtime` 存在满足 `^0.1.1-rc.2` 的 `0.1.1-rc.2`。
- **钉住 commit 也绕不过**：把 `dsh-web` 钉到 `#ae035ca42bb6d840667a3c210c3aef4c01ed9c9c`、
  `dshmarket` 钉到 `#3828a34c36ad083d6b33b640666a07e8cd348baa`（当前锁文件里的 commit）后演练，**仍然同样报错**。

安全复现方式（**不安装任何东西**，只解析）：

```powershell
$t = Join-Path $env:TEMP 'dsh-upd-test'
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $t -Force | Out-Null
$web = 'C:\Users\10355\.dsh\profiles\web'
Copy-Item "$web\package.json","$web\pnpm-lock.yaml","$web\pnpm-workspace.yaml" $t
Push-Location $t
pnpm add '@anweat/dsh-browser@0.1.12' --lockfile-only   # 或 pnpm install --lockfile-only
Pop-Location
```

（临时目录演练会联网访问 git 依赖；报错即复现成功。）

---

## 4. 当前状态：profile 是完好的，不要"修"

日志里"回滚未能验证"看着吓人，但已核对：

- `package.json` 与 `pnpm-lock.yaml` **互相一致**，4 个依赖全部可解析：
  `@anweat/dsh-browser 0.1.10` / `dsh-web #ae035ca4…` / `dshmarket 3828a34c…` / `upstream-radar 0.45.0`
- `node <bin.js> web --dump-config` → 输出 19959 字符、**exit=0**
- 被移除的插件（`@nanmicoder/dsh-agent-teams`、`dsh-find-plugin`、`dsh-at-file`、
  `@nonamelego/dsh-catppuccin`）pnpm 已清理干净，顶层无孤儿包

→ **没有半更新残留，不需要任何修复动作。**

---

## 5. 已做的清理（勿重复做）

| 已删除 / 修改 | 原因 |
|---|---|
| `profiles\web\package.json.bak` | 与 `package.json` **逐字节相同**，纯冗余 |
| `settings.yaml.bak` | 与当前配置只差宠物坐标（`right`/`bottom`），无独有配置 |
| `catppuccin-state.json` | 属于已被移除的 `@nonamelego/dsh-catppuccin` 的孤儿状态 |
| `pnpm-workspace.yaml` 中 `efce445f…` 那条 dshmarket `allowBuilds` | 与锁文件实际使用的 `3828a34c…` 不符，是失败更新的残留 |

另外：`pnpm store prune` → **回收 0**（那 1695 MB 全是在用缓存，不是垃圾，别当垃圾删）。

**勿删**：`.dsh\skin-center`(8.6MB)、`pet.json`、`skin-center-active.json`
——它们属于**仍在用**的插件（`@linxin666/dsh-client-ui-skin-center`、`dsh-pet`）。

---

## 6. 遗留待决（当时未动）

`@anweat/dsh-browser` 仍在 `dependencies` 里，但**已不在 `dsh.profile.bundles` 里**
→ 装了但不加载，属死重量（连同 `playwright`/`patchright`/`opencli` 约 49 MB）。
清理它必须跑 pnpm install，而那会撞上第 3 节的阻塞，所以**不建议现在动**。

---

## 7. 以后真要想更新插件时（以下 4 条均**未验证**）

1. 先确认**没有正在运行的 agent 会话**——否则插件市场会直接拒绝（日志里的 `update-blocked`）。
2. 等框架发布稳定版 `0.1.2+`；或改用能解析预发布版的源 / `pnpm.overrides` 强制指定版本。
3. 或把 `dsh-web` / `dshmarket` 从移动分支 `#main` 改成固定 commit，消除重新解析的触发条件。
4. 无论走哪条，先用第 3 节的临时目录演练确认**能解析成功**，再动真目录。

---

## 8. 桌面一键启动（已修复，勿重复修）

- 快捷方式：`C:\Users\10355\Desktop\DeepSeek-Harness.lnk`
  → `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\10355\.dsh\desktop-launcher\launcher.ps1`
- 脚本：`C:\Users\10355\.dsh\desktop-launcher\launcher.ps1`（图标 `dsh.ico` / `dsh.png` 同目录）
- 行为：已在运行 → 直接开浏览器；未运行 → 弹启动动画 → 起服务 → 60s 内就绪后自动开浏览器

踩过的两个坑（修好后勿回退）：

1. **不能只依赖 PATH 上的 `dsh`**：本机 PATH 里没有 `dsh`（CLI 装在 DSH_HOME 下）。
   已加级联回退：PATH 的 `dsh` → `node` + `profiles\node_modules\@deepseek-ai\dsh\lib\bin.js web --no-open`
   → checkout 源码 `node --import tsx/esm E:\deepseek\deepseek-harness\apps\cli\src\bin.ts web`。
2. **`.ps1` 必须存成 UTF-8 带 BOM**（首字节 `EF BB BF`）：快捷方式调用的是 Windows PowerShell 5.1，
   它把无 BOM 文件按系统 ANSI(GBK) 解码，含中文的弹窗代码会直接语法报错。

⚠️ 若 `desktop-launcher` 被重新生成（升级/市场操作），上面两处修复会被覆盖，需要重打。
检查方法：首字节是否为 `239,187,191`、脚本里是否有 `Resolve-DshLaunch`。
