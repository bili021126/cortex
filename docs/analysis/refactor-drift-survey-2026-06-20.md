# 重构前调研：行为契约漂移全景（2026-06-20）

> 触发：用户"从根源上重整，借重构重整底层——有些调用路径期望行为与实际不符"
> 方法：633 条漂移信号注释全仓扫描 + 关键断层线逐条代码实证 + 包价值密度评估

## 一、总览

| 维度 | 数值 |
|---|---|
| 漂移信号注释 | 633 条（A 迁移声明 30 / B 预留未完成 228 / C 兼容 268 / D 占位 30 / E 临时 19 / F 设计意图 86） |
| 过滤误报后真断层线 | ~40 处，已实证 12+ 条关键 |
| 迁移执行三结局 | 干净迁移 / 假迁移双源 / 完全没迁 |
| 未消费公共 API | 782（v4 审计） |
| 死代码 | 40 |

## 二、五类漂移实证清单

### A. 假迁移·双源（行为漂移风险最高）

**A1. shared/toolkit.ts 三枚举双源** ⭐⭐⭐
- 注释宣言：L71 "ToolCategory 定义已迁至 @cortex/config"、L127 "可逆性等级（定义已迁至 @cortex/config）"、L158 "信任模型（定义已迁至 @cortex/config）"
- 实际：`ToolCategory`（L15）、`ReversibilityLevel`（L26）、`TrustLevel`（L48）、`toReversibilityClass`（L36）**定义全未删**，仍在 shared 被消费
- config 侧：`vocabularies/tool-enums.ts` 建有同名全套定义，同样在被消费
- 影响：两套 enum 并存，跨包传值时若任一侧演进（增删成员/改顺序），**同一语义在不同包行为不一致**——直接命中"期望行为与实际不符"。toReversibilityClass 逻辑两份，改一处漏一处。
- 修复方向：删 shared 定义 → config 单源，消费方改 import

**A2. telemetry/alert-engine.ts:47 预置规则**（✅ 已修复，2026-06-20 P0 接线）
- 注释宣言："预置规则已迁至 @cortex/config PRESET_ALERT_RULES，由 bootstrap 注入"
- 实际：bootstrap 长期未注入，alertEngine 零消费（声明式 threshold 与命令式 condition 类型不匹配是根因）
- 现态：bootstrap-engine.ts §6.0.0c 已接线 + 60s 周期 + shutdown 清理——转为好案例

### B. 契约上迁·兼容层残留（新旧双入口）

**B1. engine/meta-agent.ts:695 IntentClarification re-export** ⭐⭐
- 注释宣言："契约已上迁至 @cortex/shared，此处 re-export 以兼容旧消费方"
- 实际：re-export 仍在，旧消费方可继续从 engine 拿契约——**同一类型双入口**，新消费方走 shared、旧消费方走 engine，消费方分裂

**B2. engine/meta-agent.ts:702 旧版 tag→策略路由 fallback** ⭐⭐⭐
- 注释宣言："旧版 tag→策略路由（Phase 3 fallback —— ContextManager 未注入时使用）"
- 实际：**活路径**。bootstrap-engine.ts:232-239 `setContextManager` 在 try/catch 中，注入失败时仅 `console.warn("[bootstrap] ContextManager 注入失败（回退 tag→策略路由）")` 后静默回退旧版路由——降级无指标、无审计记录、无状态可观测
- 影响：**期望走新版场景路由，注入失败时静默走旧版 tag 路由，行为不可预期**——"新架构但底层旧一套"的运行时实例
- 修复方向：要么证明 contextRegistry 构造永不失败（删 fallback），要么把降级纳入可观测（指标 + 审计 + 显式文档化）

### C. 完全没迁（注释即预言未兑现）

- 已核对 A 类 30 条中的 8 条；除 A1 外，`session-persistence.ts`（system 消息丢弃、queryLoop 重新注入——设计意图 vs 实现的取舍记录）等属设计说明，非漂移
- 建议：A 类剩余 22 条需在重构实施时逐条过（已完成初步清单，见附录）

### D. 包建了但价值悬空（写了用处不大）

**D1. cyrene/rag/ 能力层悬空** ⭐⭐⭐（昔涟记忆层）
- 实际：`packages/memory/src/cyrene/rag/` 9 文件（chunk/embedding/file-ingest/reranker/retriever/vectorstore/worldbook/worldbook-constants）**只有 2 个入口函数被接线**（ragAddMemory/ragSearchMemoryEntries，经 engine/bootstrap/init-memory.ts initCyreneMemory → MemoryManager.deps.addMemory/searchMemoryEntries）
- 悬空能力：file-ingest 的文件摄取、worldbook 全套、reranker 重排、retriever 检索、vectorstore、chunk——memory 包 89 个未消费 API 的主体
- 注：RAG init 失败时优雅降级（`ragReady=false` → 空实现）——**降级路径使"看似可用实则空转"更隐蔽**

**D2. protocol 双契约** ⭐⭐（上轮审计已确认）
- protocol 包建 20+ WS 类型（106 导出、49 未消费），server 实际用自有 `OnCommandFn` 契约——新协议未落地，双契约并存

**D3. UI/服务层测试裸奔** ⭐⭐
- desktop：50 导出、**0 测试文件**；design-tokens：29 导出、**0 测试**；server：34 导出、2 测试
- 三端（tui/desktop/webui）中 desktop 与 design-tokens 无任何测试保护

**D4. platform Toolkit 编排层化但 tools 未消费** ⭐
- toolkit.ts:62 "@refactor v2.2 工具 Handler 拆至 ./tools/ 子目录，Toolkit 退化为编排层"——tools 包 20 个导出未消费

### E. 干净迁移（重构保留的模式）✅

| 案例 | 状态 |
|---|---|
| PRESET_CONTEXT_POLICIES | 定义单源在 config，shared 只剩注释，消费方全走 config |
| scheduler 契约（ITaskBoard/ISchedulerAgentPool/IAgentPool） | 接口在 shared/scheduler-contracts.ts，AgentPool/TaskBoard 纯 implements |
| setSearchAggregator | toolkit setter 被 cli/bootstrap/mcp.ts:102 真实注入 |
| memory-store 适配器 | 委托 @cortex/memory 后端，适配器职责清晰 |
| resilience | 67 条信号中 65 条为"兼容/临时"词误报，实际健康 |

## 三、根因分析（为什么漂移会发生）

1. **迁移只有"迁"没有"移"**：定义复制到新家（config），旧家没拆（shared）——双源产生。迁移 = 复制 + 删除，缺了后一半
2. **迁移完成态无门禁验证**：没有"旧符号迁移后必须删除或标 deprecated + 扫描器验证"的规则，注释撒谎无人查
3. **@layer 分层声明与真实依赖脱节**：@layer 标注是文档不是机制，无"宣称层 vs 实际 import"验证
4. **接线无消费闭环**：setter/注入点建了不验证是否有人调用（alertEngine 悬空 4+ 轮次）
5. **包建设冲动先行、消费者后置**：cyrene RAG / design-tokens / protocol 先建壳，消费者没跟上，壳沉淀为债务

## 四、重构目标态（建议骨架）

1. **单源真相**：每个契约/枚举/常量只有一个定义点（config 或 shared）；迁移完成后旧定义必须删除或 deprecated+到期日
2. **消灭双入口**：re-export 兼容层（B1 类）设置迁移到期日，到期后消费方强制改 import 并删桥
3. **接线闭环**：注入点/聚合点纳入零消费审计（复用 v4 扫描工具）
4. **价值门槛**：包级未消费率阈值（如 >30% 需解释或收敛）；0 测试包（desktop/design-tokens/server）补齐保护
5. **fallback 显式化**：旧路径（B2 类）要么证明永不触发（删），要么标记为正式降级路径（文档化 + 日志可观测）

## 附录：A 类剩余待核对清单（22 条，实施时逐条过）

- engine/bootstrap/bootstrap-engine.ts:340（@layer 规划-执行层：模型路由注入）
- engine/core/degradation-boundary.ts:25/37/43（由 bootstrap 注入×3——已接线，待验证注入完整性）
- engine/core/loop-strategy-registry.ts:42/44（默认/直接管道由外部 setter 注入）
- engine/core/meta-agent.ts:698（系统提示已迁移至 config/constants/meta-agent.ts）
- engine/execution/pool-aware.ts:27（PipelineObserver 由外部注入）
- memory-store/schema.ts:4（常量迁至 config/constants/memory.ts——待验证双源）
- pattern-extractor ×3（只读字段由调用方注入——设计说明）
- platform/toolkit.ts:61（M6 修复已迁至 ./tools/search-code.ts——待验证 toolkit 残留）
- platform/toolkit.ts:99（搜索聚合器由 main.ts 注入——✅ 已确认落地）
- scheduler/dispatch-steps/types.ts:16（只读配置由 Scheduler 注入）
- shared/infra.ts:415（模型能力声明由注册表注入）
- cli/tui/query-loop.ts:45（AGENT_TYPE_TO_DIR 已迁 shared——待验证双源）

## 数据附录：包价值密度（2026-06-20）

| 包 | 导出 | src文件 | 测试 | 未消费API | 信号数 | 判定 |
|---|---|---|---|---|---|---|
| cli | 525 | 120 | 25 | 245 | 60 | 应用层，未消费偏高但属内部复用 |
| config | 319 | 59 | 9 | 115 | 57 | 常量层，部分需归属审计 |
| engine | 279 | 74 | 100 | 33 | 117 | 核心，信号密集但测试最厚 |
| shared | 231 | 30 | 8 | - | 57 | **双源残留重灾区** |
| memory | 226 | 35 | 9 | 89 | 20 | **cyrene RAG 悬空主体** |
| protocol | 106 | 23 | 2 | 49 | 7 | **双契约** |
| scheduler | 103 | 28 | 9 | - | 58 | 契约上迁干净 |
| desktop | 50 | 26 | **0** | - | 9 | **零测试** |
| design-tokens | 29 | 4 | **0** | - | 3 | **零测试** |
| server | 34 | 15 | 2 | - | - | 测试薄弱 |
| resilience | 52 | 9 | 7 | - | 67 | 信号误报，健康 |
