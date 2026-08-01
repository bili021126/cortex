# Cortex 全量项目代码调研——全景报告（机器模型视角）

> 日期：2026-06-20 ｜ 视角：用户「机器 = 构件（域）→ 零件（包）」模型；状态口径：**秩序**（结构清晰、真相源明确、已厘定）/ **混沌**（散落、双源、未兑现）/ **空转**（接了线但无生产方或消费方）
> 方法：三路并行只读调研（底层域 / 核心域 / 混沌审计），全部证据文件:行号，脚本留存 .cortex/chaos-audit/ 可复跑

## 1. 机器全景：构件状态图（29 包）

| 域 | 包 | 状态 | 一句话 |
|---|---|---|---|
| 底层 | **config** | 秩序外壳 + 内嵌空转 | 分层清晰（L1-L4 + root 域 + 机制层），但 registry 空转、agents 双轨、三处数值冲突 |
| 底层 | **shared** | 秩序为主 | 域分桶 barrel 清晰；toolkit.ts 字面量镜像 config 枚举（注释维系） |
| 底层 | **notification** | 秩序 | 四通道物理分层，better-sqlite3 动态加载 |
| 底层 | **llm** | 秩序为主 | 结构小清晰；硬编码常量自含未进 config；头部注释宣称过时 |
| 底层 | **scheduler** | 秩序外壳 + 混沌 | 四抽象清晰；信任分公式镜像 engine（双源）、1457 行超大文件 |
| 底层 | **memory** | 秩序外壳 + 混沌 | 存储清晰；cyrene 子系统自带完整 RAG 栈（与 memory-store 重叠）；index.ts 注释宣称依赖 config 未兑现 |
| 底层 | **memory-store** | 秩序外壳 + 空转 | cognitive-engine 自标 @frozen 仍导出；迁移残留注释 |
| 底层 | **platform** | 秩序 | Toolkit + 20 工具 + MCP，核心/工具分离 |
| 核心 | **engine** | 秩序（含空转子件） | 插件化装配、barrel 收敛；治理零 emit、SimulationRunner 未注入、AgentRegistry 无注册 |
| 核心 | **server** | 秩序（类型未兑现项） | 路由/WS 面完整；ObservabilityInfo 类型已定义端点未返回；client 8 方法 404 |
| 核心 | **telemetry** | 秩序（读取端缺） | 写端完整，生产读取端无 |
| 核心 | **governance** | 秩序（链路上游断） | 修宪管线自洽；engine 治理事件零生产 |
| 核心 | **tools/protocol/client/resilience/fsm-compiler/plugin-runner/prompt-kit/skill-kit/logging/testing/doctor/parser** | 秩序（部分悬空） | 消费链清晰；client 部分方法悬空、parser 边缘、context-manager 混沌混合 |

## 2. config 配合面全图

- **走 ConfigRegistry**：仅 1 处运行时生产方（engine/bootstrap-engine.ts:47），注册 1 域（context-policies）
- **走 loader**（CONFIG_DOMAINS 域加载）：agents/cognition/docs/eventRouting（engine 三 loader）+ mcpServers（cli）
- **走 Store**（ModelStore/KeyStore/AgentManifestStore/TuningStore）：server/engine-host、cli/config-manager
- **直读绕过**：约 40 个 src 文件直接 import 常量/默认值/词汇表（engine 24 文件 + scheduler 14 文件 + 其余）
- **结论**：单源定义成立（defaults.ts:20-73 唯一定义点），但**读取无统一门面**——registry 形同虚设

## 3. 混沌分布：五处结构性负债（config 开刀的直接目标）

### 负债 1：engine 平行类型体系（§1.3A）
`engine/src/bootstrap/factory/types.ts` 定义与 `@cortex/config/interfaces` 语义平行的 15+ 接口（AgentManifest/EventRoutingConfig/CommitteeRule/SelfExaminationConfig/...），消费同一批 JSON 却全部用 engine 自建类型——**图纸双份**。

### 负债 2：agents 旧域 vs agentManifests 新域双轨（§1.3B）
agents.json 标 @deprecated，但 engine 主路径仍消费旧域；agent-manifests.json 仅 server 消费，engine 零接触——**新域空转，旧域苟活**。

### 负债 3：engine.json vs DEFAULT_ENGINE_CONFIG vs constants 三处数值冲突（§1.3C）

| 语义 | constants | defaults.ts（自称唯一真相源） | engine.json |
|---|---|---|---|
| maxTotalReplans | 10 | 10 | **3** ← 漂移 |
| executeAllTimeoutMs | 300_000 | **600_000** | 600_000 |
| defaultMaxLoops | — | 32 | **64** ← 死配置 |

**"唯一真相源"元宣称失效**——这正是 config 重整要消灭、却还残留的形态。

### 负债 4：4 个空转配置域（§3.3）
crossVerification / governancePipeline / seedMemories / selfExamination——加载进配置对象后 engine 运行时 0 读取。

### 负债 5：公差表覆盖不足 + 双校验体系（§5/§6）
18 域仅 6 域有 JSON Schema；engine 消费的 12 域全部无 schema 校验；engine 各 loader 自建 `_validateStructure` 与 config 的 `validateDomainWithSchema` 互不调用。

## 4. 断链总表（核心域）

| 链路 | 生产方 | 消费方 | 状态 |
|---|---|---|---|
| 治理事件（emitter → observer） | **无**（零 emit） | 订阅方已就位 | 🔴 断在源头 |
| 治理决策（DECISION_REQUIRED → ConfirmGate） | **无** | DecisionGateBridge 已 start | 🔴 断在源头 |
| SimulationRunner 仿真 | **无**（未注入） | scheduler.ts:193 检查点 | 🔴 断在注入 |
| AgentRegistry（engine） | **无**（零 register） | index.ts:154 已导出 | 🔴 双源+空转 |
| RAG file-ingest / reranker / worldbook | **无**（零 import / 恒跳过） | 调用方均为 null 守卫 | 🔴 完全悬空 |
| MemoryManager（cyrene） | init-memory.ts:166 创建 | 无人持有 | 🟠 实例悬空 |
| 通知 WS 链路 | NotificationRuntime 已启动 | bridgeNotifications 已接线 | 🟢 完整 |
| telemetry/audit | FileCollector/AuditTrail 已接线 | 生产读取端无 | 🟠 写通读断 |
| client↔daemon 共面 | 27 方法 | daemon 14 端点 + capabilities 声明 | 🟡 部分对齐 |

## 5. 秩序锚点（已厘定，基准）

- config 词汇表单源（tool-enums/tags/agent-enums）+ defaults.ts 对齐注释（P1-2）
- memory-store/schema.ts Phase 4 收敛桥、rlm-decompose MAX_RLM_DEPTH 转发
- notification 四通道 + persistence 最小接口（P1-2）
- shared 禁止子路径导入契约 + DOMAINS.md 同步约束
- engine 插件化装配（v3.0/v3.2 收敛）、barrel 显式收敛声明
- 用户亲手厘定：config L1-L4 分层 + tuning 覆盖链（77c5fd65）+ L3 agent 域聚合

## 6. 对「核心主体稳定」的含义

1. **config 开刀起点明确**：负债 3（数值冲突）是最尖锐的——同一包内三处真相源打架，先归一；负债 1（平行类型）次之——engine 停止自建类型，改消费 config interfaces
2. **读取门面**：约 40 处直读 → 统一入口（registry/resolveConfig），这是"真相源唯一"的兑现条件
3. **公差补齐**：engine 消费的 12 域补 schema（负债 5）
4. **空转域处置**：4 个空转配置域要么接消费方要么收敛（负债 4）
5. **端侧后置确认**：cli/desktop/webui/tui 的交互厘定不在本次范围（已有四端解剖报告为基线）

## 附：审计脚本留存

.cortex/chaos-audit/（event-scan / domain-scan / comment-scan / dual-source-scan / dead-export-scan*.mjs）——可复跑核验，与 scripts/audit-unconsumed.ts 口径互补。
