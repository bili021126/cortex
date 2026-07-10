# Cortex Core-2 逐层审计报告

> 2026-07-04 | 18 项核心功能全覆盖

---

## 基础层

### 1. Engine Bootstrap
**状态**: 稳 | **优先级**: Core-2 早期
- adapter 工厂收进 EnginePlugin，消除 CLI/E2E 重复创建
- 插件 `dependsOn` 显式声明，不再依赖 JSON 声明顺序
- `extraBody.thinking` 收敛为 `LlmAdapterConfig.capabilities`

### 2. LLM 适配层
**状态**: 稳 | **优先级**: Core-3
- 统一抽象接口方向认可，当前 DeepSeek 适配已稳（全 200，零 400）
- `reasoning_effort` 守卫、`tool_choice` 不传、`extraBody.thinking` 仅 reasoner
- 多供应商支持再等——过早工程

### 3. Toolkit 工具系统
**状态**: 通 | **优先级**: Core-2 中期
- 三方定义分散（cortex-agents.json / Toolkit.register / TOOL_DISCIPLINE）
- 收束方向：从"配置外化"升级为"能力声明"
- Agent 声明"什么场景下调什么工具、以什么约束调"

### 4. ConfirmGate
**状态**: 设计定稿 | **优先级**: Core-2 中期
- 已落文档 `docs/core/confirmgate-agent-design.md`
- 从静态 L0-L3 分级升级为 Agent，信任分 + 审计 + E2E 自动放行
- 不需要 LLM——纯计算

---

## 调度层

### 5. 甘雨任务规划
**状态**: 通 | **优先级**: Core-2 中期
- 仿真层 pre+post 插入：分配前对抗圆桌 → SimulationResult → 甘雨基于结果拆任务
- 执行后偏差回传 → 归档 → 信任更新
- 增强按需触发：3+文件/核心模块/近期失败 → 启用仿真

### 6. Scheduler 调度
**状态**: 稳 | **优先级**: Core-2 后期
- 拓扑排序、分层并行、失败重规划——通
- 需接 SimulationResult 的 `needsVerify` 标记
- 角色定位模糊：拓扑排序/节点分发/超时控制混在一起

### 7. ReAct 循环引擎
**状态**: 通但需数据 | **优先级**: 基准线采集优先
- DirectStep→React 路由、write_file 硬检测——修了
- 硬检测太硬：需改为梯度升级（轻提醒→强提醒→扔回甘雨）
- `TOOL_DISCIPLINE` 嵌在代码里，与工具治理方向矛盾
- **必须先跑 10 次 e2e-minimal 采集基准线**

### 8. 多 Agent 角色体系
**状态**: 稳 | **优先级**: Core-2 后期
- +1 ConfirmGate Agent（15 个）
- 人格 prompt 需收束到统一加载器

---

## 记忆层

### 9. MemoryStore
**状态**: 稳 | **优先级**: Core-2 后期
- dbPath 回退、kind 推断、source 字段——修了
- O(n) 全表扫描（MS-01）需加索引
- WAL 模式 → 读不阻塞写
- 批量 flush → 500ms 合并一条事务

### 10. MemoryPipeline
**状态**: 通 | **优先级**: Core-2 后期
- 被动写入改主动写入——Agent 每轮 flush 一次
- 知识库原子事实 → 概念论证，等仿真层偏差归档器有数据

---

## 观测层

### 11. PipelineObserver / 遥测
**状态**: 概念论证 | **优先级**: Core-2 中期
- 深度：LLM 请求体大小、Context 膨胀曲线、AgentPool 空闲率
- 广度：事件分级（TELEMETRY/NOTICE/ALERT）+ 预警触发器（规则引擎）
- 治理层用指标：Agent 成功率、任务耗时分布、错误复现率、fcall 准确率
- 遥测数据存 MemoryStore，自审视直接读取做趋势分析

### 12. WebUI
**状态**: 暂缓 | **优先级**: Core-3
- 抄成熟范式（Cursor/Windsurf）
- 不需要从零构建 UI 设计

---

## 验证层

### 13. 软约束自审视
**状态**: 设计定稿 | **优先级**: 基准线采集优先
- v2 对称攻防：6 Agent → 3 对互攻 → 纳西妲裁决 → 钟离+霜凝 → 凝光合
- E2E 复刻到 `packages/engine/tests/manual/e2e/self-exam-soft.ts`
- 检测率待验证

### 14. CI 门禁
**状态**: 稳 | **优先级**: Core-2 中期
- tsc/vitest/lint——通
- 缺：E2E 分层（push→minimal, PR→full, release→self-exam）
- 缺：基线对比（测试数变化检测）
- E2E 良性膨胀治理：@covers 注释声明覆盖矩阵

---

## 交互层

### 15. TUI 终端
**状态**: 通但需优化 | **优先级**: 基准线采集后
- 甘雨 payload 需带产出路径
- react-loop 第一条消息注入目标文件路径
- 落盘验证：executeWithStream 返回后 TUI 自检
- 参考 Claude Code：Agent 产出 = 文件，确认门后移

### 16. CLI 命令
**状态**: 稳 | **优先级**: Core-2 后期
- ICortexApi 收敛：CLI 只面对一个稳定契约
- 接口裁剪：未使用的方法标记 deprecated

---

## 治理层

### 17. 宪法治理
**状态**: 通 | **优先级**: Core-2 后期
- 修宪管线完整
- 合规报告 → 自审视 claims（自动转化）

### 18. Persona 系统
**状态**: 稳 | **优先级**: Core-2 后期
- persona-talk 对齐 4 份剧情台词
- 跨窗口一致性：统一加载器

---

## 设计文档

| 文档 | 路径 |
|------|------|
| 世界模型仿真层 | `docs/core/world-model-simulation-layer.md` |
| ConfirmGate Agent | `docs/core/confirmgate-agent-design.md` |

## E2E 资产

7 文件，覆盖 7 条核心链路：

| 文件 | 覆盖链路 |
|------|----------|
| e2e-minimal.ts | TUI 执行链 |
| cortex-e2e-full.ts | 全 Agent 冒烟 |
| solo-flight.ts | 系统基准 |
| self-exam-soft.ts | 自审视链 |
| governance-amendment-e2e.ts | 修宪管线 |
| e2e-utils.ts | 基础库 |
| panorama-tracker.ts | 追踪库 |
