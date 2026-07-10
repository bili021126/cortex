# @cortex/tui — 包定位

## 层级
接口层（Interface）— 终端用户界面

## 核心职责
- WebUI — 基于 Web 的终端用户界面
- TUI 桥接（tui-bridge）— 与 engine/shared 的通信通道

## 依赖
- @cortex/config
- @cortex/engine
- @cortex/llm
- @cortex/platform
- @cortex/scheduler
- @cortex/shared
- @cortex/skill-kit

## 被依赖
- @cortex/cli — CLI 启动时可选挂载 TUI
