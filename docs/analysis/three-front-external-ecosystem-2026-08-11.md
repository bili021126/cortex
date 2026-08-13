# Cortex 三端外部生态调研报告（2026-08-11 · 联网调研）

> 调研方式：三端并行联网调研（WebSearch 29 次 + 关键页面全文抓取 8 次）+ 关键决策事实二次验证（Ink 版本实测）
> 定位：把 CLI/TUI/桌面端技术选型放到 2026-08 行业现状下验证——为 three-front-engineering-argumentation-2026-08-11.md 的决策提供外部依据
> 配套：docs/analysis/audit-full-2026-08-11.md（代码库内部审计）、docs/analysis/three-front-engineering-argumentation-2026-08-11.md（落地论证）

---

## 〇、结论速览（外部生态对三端决策的验证）

| 决策点 | 内部论证结论 | 外部生态验证 | 修正/加强 |
|---|---|---|---|
| CLI 降格为 daemon 客户端 | daemon 唯一宿主 | ✅ **行业仅 Claude Code 明确 daemon 化**（claude daemon run/status/stop），CocoIndex 有同构重构先例；主流 AI CLI 均未重度依赖 commander 系 | 加强：降格路线正确；新增 daemon 生命周期风险清单 |
| TUI 保持 Ink 5 | 两轮重构资产已围绕 Ink 建全 | ✅ **Ink 是 Claude Code/Gemini CLI/Qwen Code 三巨头共用底座**；2026-08 生态活跃（v7.1.1 实测，GitHub 39.6k★） | 修正：**升级检查点**——v5 是 React 18 基线，上游已到 v7 + React 19，冻结期需设定版本对齐决策点 |
| TUI P5（raw stdin/Kitty） | 留作 Core-3 决策点 | ✅ Node 侧完全可行：kitty-keys 解析库 + terminal-kit grabInput 先例；**但 xterm.js CSI-U 未合并（Web 端缺口）** | 加强：可行性确认，方案有现成库 |
| 桌面端不换 Tauri | 四层收敛优先 | ✅ WebView2 对 Live2D/透明窗支持存疑 + Rust 重写成本——**继续 Electron 获生态验证**；Electron + Live2D + AI 是 2026 桌宠主流组合（Live2DPet/OpenPets/AI Desk Pet） | 加强：技术栈组合被生态验证 |
| 桌面端 sandbox:false 债 | 列为缺陷待修 | ✅ **官方明确方案**：preload 打包单文件 CJS + 恢复 sandbox:true（sandboxed preload 无法用 ESM import 是官方文档事实） | 修正：**优先级升至最高**——2026 出现沙箱绕过 CVE（CVE-2026-70608），sandbox 是核心防线 |
| 桌面端 IPC 双份手维护 | D5 修复项 | ✅ 行业四层模式（类型化 channel → contextBridge → IPC client → handler）与"client 原语"计划吻合 | 加强：单份 TS 类型源生成双端 |
| Live2D 依赖（pixi-live2d-display 0.5.0-beta） | 未评估 | ❌ **已停止迭代**（README 停留 PixiJS v6 时代）；社区 fork 承接（pixi-live2d5：PixiJS 8 + Cubism 5）；官方 CubismWebFramework 持续维护 | 新增：**渲染层抽象 + 官方 SDK 备选**；Cubism SDK 年营收超 1000 万日元需 Release License |

---

## 一、CLI 端生态

### 1.1 竞品架构对标（2025-2026）

| 维度 | Claude Code | Codex CLI | Gemini CLI | Cortex（现状/目标） |
|---|---|---|---|---|
| 启动架构 | **daemon 化**（claude daemon run/status/stop） | Rust 原生 + 本地/云端双执行 | 单进程 | daemon 化（server 宿主）+ 客户端（目标） |
| daemon 用途 | background sessions 演进 | — | — | engine 唯一宿主 + 会话/记忆/工具收敛 |
| CLI 框架 | 自研 | 自研（Rust） | 自研 | 自研 CommandRegistry（冻结面） |

**关键事实**：三家竞品中仅 Claude Code 明确 daemon 化，且是 background sessions 演进的产物——**daemon 化非必需，但适合"重状态复用"场景**（正合 Cortex 内嵌引擎已冻结的现状）。

### 1.2 daemon+客户端先例：CocoIndex Invisible Daemon（最贴合案例）

ML 工具 CLI → daemon 客户端重构的工程要点（可直接作为 Cortex 降格后的验收清单）：
- **首次使用自动拉起**：CLI 探测 daemon 不存在时自动 spawn
- **版本握手透明升级**：协议版本协商，daemon 版本落后时自动重启
- **按请求建连**（其持久连接方案引发三类 bug，全部因切换建连模式而消失——Cortex 的 WS 长连接需警惕同类问题）
- **PID 文件作为退出信号**（Cortex 已有 .cortex-daemon.pid ✅）

### 1.3 框架生态（2026）

Commander ~35M / yargs ~30M / oclif ~200K 周下载——**主流 AI CLI 均未重度依赖 commander 系**；Cortex 保留冻结的自研 CommandRegistry 反而是正确的冻结面策略（无需为降格引入新框架依赖）。

### 1.4 风险警示（Claude Code daemon 缺陷实录）

- Windows 启动失败
- `daemon stop --any` 误杀
- 残留 daemon 干扰（issue #65971）

**启示**：daemon 生命周期管理是 CLI 降格后的最高风险区——Cortex 需在降格验收清单中加入：自动拉起/健康探测/优雅停止/残留清理四件套的边界测试。

---

## 二、TUI 端生态

### 2.1 Ink 生态健康度（2026-08 实测验证）

- **v7.1.1 为最新**（GitHub releases 实测；reactlibraries 显示 6.5.1 为数据滞后）；39.6k★；发布活跃
- **Ink 是 Claude Code / Gemini CLI / Qwen Code 三巨头共用底座**——"保持 Ink 5"决策获最强外部验证
- **注意**：v5 是 React 18 基线；上游已跨到 v7 + React 19——Cortex 的 5.2.1 滞后 2 个 major，**冻结期需设升级检查点**（升级动因：React 19 破坏性变更、Ink 7 的 API 变化）

### 2.2 终端框架横向对比（2026）

| 框架 | 语言 | 维护状态 | 适用 | 对 Cortex |
|---|---|---|---|---|
| Ink | JS/React | 🟢 活跃（v7.1.1） | React 团队/复用组件体系 | ✅ 当前选型正确 |
| Blessed/NeoBlessed | JS | 🔶 缓慢 | 老牌 TUI | 不适用 |
| Textual | Python | 🟢 活跃 | Python 工具 | 不适用（栈不符） |
| Bubble Tea | Go | 🟢 活跃 | Go 工具 | 不适用 |
| Ratatui | Rust | 🟢 活跃 | Rust 工具 | 不适用 |

### 2.3 P5（raw stdin/Kitty）可行性——Node 侧确认可行

- **kitty-keys**（Node/Deno/Bun）现成解析库
- **terminal-kit** `grabInput()` / **node-fzf** 管道+raw 共存先例
- **缺口**：xterm.js 的 CSI-U 支持仍未合并——**Web 端是缺口**（桌面端若走 Web 渲染需注意）

### 2.4 Windows 兼容性实践

行业证据：Windows 渲染问题多在**终端层**（Atlas Engine 闪烁、1ms 延迟连写 bug）——应用层只能靠节流+重绘容忍。**Cortex 的补丁+50ms 节流方案方向正确**，与行业结论一致。

### 2.5 AI TUI 设计模式对标（Claude Code 源码级分析）

- **事件流驱动 UI**（queryLoop 生成器）——与 Cortex `TuiEvent` + 事件桥架构同构 ✅
- **权限 UI 转向"分层授权"而非堆弹窗**（93% 批准率数据驱动）——对 Cortex ConfirmGate 桌面/TUI 化的启示：分层授权优于逐次弹窗

---

## 三、桌面端生态

### 3.1 Electron 2026 现状

- **43.3.0**（2026-08-04，Chromium 150 / Node 24）；8 周节奏；41/42/43 在支持期，40 已 EOL
- **安全**：sandbox 是官方核心防线；**2026 出现 CVE-2026-70608 沙箱绕过漏洞**——sandbox:false 是真实风险敞口
- **ESM**：主进程支持；**sandboxed preload 不支持 ESM import**（官方文档事实）

### 3.2 Electron vs Tauri 2.x（2026）

| 维度 | Electron 43 | Tauri 2.x |
|---|---|---|
| 安装包 | ~120-200MB | ~3-10MB |
| 空闲内存 | ~150-400MB | ~40-80MB |
| 移动端 | 无 | iOS/Android |
| JS 生态 | 直接复用 | Rust 重写成本 |

**Cortex 结论**：核心资产（Live2D/PixiJS/Monaco）均为 Web 技术，WebView2 对 Live2D/透明窗支持存疑 + main 进程 Rust 重写与"四层收敛"增量路线冲突——**继续 Electron，不迁移**。

### 3.3 Live2D 集成生态（重要新发现）

- **pixi-live2d-display 已停止迭代**（0.5.0-beta 最后版，README 停留 PixiJS v6 时代）——Cortex 当前依赖是**冻结依赖**
- 社区承接：`pixi-live2d-display-advanced`（PixiJS 7 + Cubism 4）、`omniwaifu/pixi-live2d5`（PixiJS 8 + Cubism 5）
- 官方 `CubismWebFramework` 持续维护，可直接加载 Cubism 4/5 模型
- **许可**：年营收超 1000 万日元的商业实体须另购 Release License
- **启示**：渲染层预留抽象边界（Live2DManager 接口化），长期可切官方 SDK 直用——窗口/IPC 层不受影响

### 3.4 sandbox:false 债的行业答案（官方明确方案）

**打包器将 preload 构建为单文件 CJS + 恢复 sandbox:true**（sandboxed preload 无法使用 ESM import 是设计约束，非缺陷）。electron-vite 的 unsandboxed+.mjs 是其自身开发模式约束，不等于官方推荐。

**对 Cortex**：保留 contextIsolation:true，preload 依赖内联打包，恢复 sandbox——**优先级最高**（CVE-2026-70608 语境下）。

### 3.5 IPC 治理（IPC_CHANNELS 双份手维护的行业解法）

行业四层模式：① 类型安全 channel 定义 → ② contextBridge 安全桥 → ③ 前端 IPC client → ④ 后端 handler 管理；原则"每个 channel 映射单一操作"。**与 Cortex"client 原语"计划吻合**——以单份 TS 类型文件为唯一事实源，双端由类型源生成。

### 3.6 AI 桌宠生态（技术栈验证）

2026 年 Electron + Live2D + AI 是主流组合：Live2DPet（Electron 桌宠 + 大模型对话 + 截屏/窗口感知，架构与 Cortex 高度同构）、OpenPets、Anysoul AI、AI Desk Pet（Steam）、Desktop Mate（VRM 3D 方向）。**Cortex 技术栈选择被生态验证**。

### 3.7 Monaco 嵌入验证

monaco-editor 0.56 核心 ESM 入口 ~163.5kB min / 24.4kB gzip（不含语言包与 worker）；动态 import 是主流首屏优化。**Cortex 方案正确**；剩余工作点：worker 通道配置（独立 URL 加载可能导致首帧白屏，建议常驻 worker 复用）。

---

## 四、外部生态驱动的行动项（并入审计 P0-P3）

| 优先级 | 行动项 | 来源 |
|---|---|---|
| P0 | 桌面端恢复 sandbox（preload 打包单文件 CJS）——CVE-2026-70608 语境 | 桌面端 §3.4 |
| P0 | CLI 降格验收清单加入 daemon 生命周期四件套（自动拉起/健康/优雅停止/残留清理）边界测试 | CLI §1.4 |
| P1 | Ink 升级检查点：评估 v5→v7 + React 19 对齐时机（冻结期设定决策点） | TUI §2.1 |
| P1 | pixi-live2d-display 渲染层抽象（Live2DManager 接口化 + 官方 SDK 备选） | 桌面端 §3.3 |
| P1 | Electron 版本升级至受支持 major（41+），建立依赖升级纪律 | 桌面端 §3.1 |
| P2 | Monaco worker 通道配置（常驻 worker 复用） | 桌面端 §3.7 |
| P2 | 权限 UI 分层授权演进（对标 Claude Code 93% 批准率数据驱动） | TUI §2.5 |
| P3 | P5 落地用 kitty-keys 库（Node 侧现成），Web 端 CSI-U 缺口标注 | TUI §2.3 |

---

## 五、信息来源清单（核心 URL）

**CLI**：Claude Code 官方文档（daemon 命令）、CocoIndex Invisible Daemon 架构文、WorkOS CLI 鉴权指南、pkgpulse 框架对比数据、Claude Code issue #65971
**TUI**：[github.com/vadimdemedes/ink](https://github.com/vadimdemedes/ink)（v7.1.1 实测）、[npm/ink](https://www.npmjs.com/package/ink)、kitty-keys、terminal-kit、Claude Code 架构分析（arXiv 源码级）
**桌面端**：[endoflife.date/electron](https://endoflife.date/electron)、[Electron 安全教程](https://electronjs.org/docs/latest/tutorial/security)、[Electron ESM 教程](https://electronjs.org/docs/latest/tutorial/esm)、[SentinelOne CVE-2026-70608](https://www.sentinelone.com/vulnerability-database/cve-2026-70608/)、[guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)、[omniwaifu/pixi-live2d5](https://github.com/omniwaifu/pixi-live2d5)、[Live2D SDK 许可](https://www.live2d.com/en/sdk/about/)、[Bundlephobia monaco-editor](https://bundlephobia.com/package/monaco-editor)、[Loongphy preload 实践](https://loongphy.com/blog/electron-preload-cjs-with-sandbox/)、[Live2DPet](https://github.com/x380kkm/Live2DPet)、[OpenPets](https://openpets.dev/)

*调研完成（2026-08-11）——三端联网 29 次检索 + 8 次全文抓取 + 关键事实二次验证。*
