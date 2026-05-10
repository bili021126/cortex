# Meso-Lite 工程文档

**阶段**：Meso-Lite 实施  
**起始日期**：2026-05-04  
**最后更新**：2026-05-05（类型加固收尾）  
**前置**：Meso v1.1 概念设计（七份议题全量修正完成，宪法修宪完成）

---

## 目录结构

```
docs/
├── Cortex 概念顶层设计 v1.1-已废弃.md      ← v1.1 宪法（保留参考，已废弃）
├── Cortex 概念顶层设计 v2.0.md            ← v2.x 宪法级文档（全阶段共享）
├── core/                                  ← Core 阶段全部产出
│   ├── Core-1-第四轮-记忆系统设计反思与工程教训.md
│   ├── v1.1-关键设计理念保留.md             ← 从废弃 v1.1 提取的保留理念
│   └── ... (Core 相关文档、v1.1 历史审查报告等)
└── meso-lite/                             ← Meso-Lite 阶段全部产出（已整理合并）
    ├── README.md                          ← 阶段状态看板
    ├── Cortex Meso 阶段——概念设计落地产出文档.md  ← Meso 概念设计最终修正版
    ├── Meso反思-完整记录.md                ← 合并：架构决策 + 一致性检查 + 误判正判
    ├── 过渡阶段-交付与验收.md               ← 合并：交付规划 + 执行清单 + 关卡检查表
    ├── 工程实践反思合集.md                  ← 合并：概念vs实践对照 + 类型加固教训 + 内外源复杂度
    ├── Nano+ 阶段数据回顾与 Meso-Lite 决策追溯.md
    ├── 原型验证全量审查与修宪启动.md
    ├── 议题一～七 (7 份原始议题)            ← 概念设计过程记录
    └── 预备修宪清单.md                     ← 潜在违宪场景追踪
```

---

## 工程实施基线

| 维度 | 状态 |
|------|------|
| **运行时** | 单进程 + async 协程 |
| **存储** | sql.js (MemoryStore) + InMemoryTransport (EventBus) |
| **包结构** | 10 包 monorepo: 9 运行时 + 1 测试 |
| **交互形态** | CLI, stdin/stdout (ConsoleChannel 确认门) |
| **LLM** | DeepSeek API (OpenAI 兼容协议), 有 Key 走 DeepSeekLLMInvoker, 无 Key 回退 SimpleLLMInvoker |
| **Meso-Lite 不实现** | 向量检索、冻结/湮灭态流转、脊髓合并/关联/反射、Committee 三级收束、哨兵、脑干、retrieval_feedback 自动调参 |

---

## 核心交付 (议题五 Section 4.5)

### 运行时
- [x] CortexEngine (`@cortex/cortex-engine`) — DI 组装所有子包
- [x] MetaAgent — 关键词分类 + 模板任务树生成
- [x] CoroutineRunner (`@cortex/pillar`) — ReAct 循环 (Think→Act→Observe)
- [x] Scheduler (`@cortex/scheduler`) — 拓扑排序 + 节点调度
- [x] DeepSeekLLMInvoker — 真实 LLM 驱动工具调用

### 记忆
- [x] MemoryStore + MemoryAccessorAdapter (`@cortex/memory`)
- [x] 取向维度过滤 + 私密记忆隔离
- [x] active ↔ archived 双态流转

### Committee
- [x] CommitteeManager — 会话管理 (convene/dissolve/report)
- [x] 时间盒: critical→120s, high→60s, medium→30s, low→15s

### 确认门
- [x] ToolGateway (`@cortex/pillar`) — L2/L3 不可逆操作拦截
- [x] ConsoleChannel — stdin/stdout 两阶段确认
- [x] 7 个真实工具: read_file, write_file (L2), list_dir, run_shell (L1), search_code, git_diff, git_log

### 脊髓
- [x] InMemoryTransport (`@cortex/event-bus`) — 环形缓冲, 定向订阅
- [x] 节点生命周期事件: NODE_STARTED/PROGRESS/COMPLETED/FAILED/SKIPPED
- [x] CortexEventType 完整目录 (原则三: 事实描述, 非指令式)

### 测试
- [x] 151 测试, 全部通过
- [x] Mock 全链路 (57) + 关键词管线 (43) + 确认门 (9) + 管线验证 (21) + 稳定性 (1)
- [x] E2E LLM 工具调用 (13) — Suite A~E, 覆盖 3 种取向 + 多步串联 + 容错
- [x] 手动多步验证脚本 (`tests/manual/manual-e2e-verify.ts`)

---

## 退出标准评估 (议题五 Section 4.9)

| 指标 | 目标 | 当前 | 状态 |
|------|------|------|------|
| 多柱并发无死锁 | 1000 任务 0 deadlock | ✅ 1000 任务 0 blocked | **达标** |
| BFS 延迟 | <100ms | 1ms (关键词分类) | **达标** |
| 确认门率 | L2/L3 100% 拦截 | ✅ 100% | **达标** |
| 冷启动旁路 | 模板生成 <5ms | 1ms | **达标** |
| 真实场景 E2E | ≥3 场景 | ✅ 3 场景 (手动 58 调用 + Suite E 多步/监理/容错) | **达标** |
| retrieval_feedback | >50 条 | 0 (Core-3a 启用) | **阶段外** |

### 差距分析
1. **retrieval_feedback**: 按设计 Meso-Lite 为"沉默观察期", 表结构已预留但 Core-3a 才启用自动调参。当前不阻塞退出。
2. **LLM 收敛**: maxIterations 已进 config (默认 15), 真实场景建议 30+。已验证多步任务在 maxIterations=5 下可完成工具链串联。

---

## 代码审查修复 (2026-05-05)

本轮审查聚焦 `cortex-engine` / `pillar` / `scheduler` 三个核心包，发现并修复：

| 等级 | 文件 | 问题 | 修复 |
|------|------|------|------|
| 🔴 | 引擎 `index.ts` | `executeTaskTree` 不复位 `currentTaskTree` → 跨请求复用旧树 | 执行末尾 `this.currentTaskTree = null` |
| 🔴 | 调度器 `index.ts` | `contextFactory` 抛异常（取向抑制等）被 `allSettled` 吞掉→静默黑洞 | 外包 try-catch, 发布 NODE_FAILED + 记录 nodeResults |
| 🟡 | Pillar `index.ts` | `maxIterations <= 0` 时返回无信息的 `{success:false}` | 立即返回带明确错误码的结果 |
| 🟡 | Pillar `index.ts` | `history.push` 在两个分支重复 14 行 | 提取到 if/else 之后统一执行 |
| 🟡 | Pillar `index.ts` | `parseAction` 正则 `/ACTION:\s*(\w+)\(([^)]*)\)/` 遇 JSON 含 `)` 即断裂 | 改为平衡括号嵌套深度扫描 |

### Bug 修复记录

| 日期 | 问题 | 修复 |
|------|------|------|
| 2026-05-04 | 审查: 引擎跨请求复用旧任务树 | `executeTaskTree` 末尾清空 `currentTaskTree` |
| 2026-05-04 | 审查: 调度器静默吞 contextFactory 异常 | try-catch + 发布 NODE_FAILED |
| 2026-05-04 | 审查: CoroutineRunner maxIterations=0 边界无错误信息 | 早期返回明确 error |
| 2026-05-04 | 审查: history.push 重复代码 | DRY 提取 |
| 2026-05-04 | 审查: parseAction 不支持 JSON 含 `)` | 平衡括号扫描 |
| 2026-05-04 | `maxIterations=15` 硬编码 → 3/4 节点超时 | 进 `SchedulerConfig.maxIterations`, 默认 15 不变 |
| 2026-05-04 | `init()` 覆盖 `startTime` → uptime 恒为 0 | 移除 init() 中的 `this.startTime = Date.now()` |
| 2026-05-04 | `run_shell`/`git_diff`/`git_log` 三次重复动态 import | 提取 `execShell()` 辅助函数 |
| 2026-05-04 | `Tool.irreversible` → TS2339 | 迁移到 `reversibility` + `staining` |
| 2026-05-04 | Mock 测试 `apiKey: "mock-key"` 误触发 DeepSeek API | 改为空字符串 `""` |
| 2026-05-05 | ToolStaining 旧值残留 → 7 处 TS 错误 (`"read"/"write_reversible"/"write_irreversible_local"`) | `"execution_only"` / `"restricted"` 替换 |
| 2026-05-05 | MemoryType 旧值残留 → 10 处编译错误 (`"experiential"/"conceptual"`) | `"EPISODIC"` / `"CONCEPTUAL"` 替换 |
| 2026-05-05 | MemoryEntry 缺失 `state` 字段 → 类型不匹配 | 补齐 `state: "active"` |
| 2026-05-05 | CortexEventType `import type` 无法用于值访问 → 5 处错误 | 拆分为独立 `import { CortexEventType }` |
| 2026-05-05 | EventBus `publish(type: CortexEventType)` 过窄 → 任意字符串被拒 | 改为 `CortexEventType \| (string & {})`（目录非穷举） |
| 2026-05-05 | EventBus `subscribe`/`queryByType`/`unsubscribe` 留裸 `string` → 前后门不对称 | 统一为 `CortexEventType \| (string & {})` + Map 泛型同步 |
| 2026-05-05 | 死 `import type { CortexEventType }` + 测试事件点分隔命名 | 清理 + 统一冒号分隔 |

---

## 变更记录

| 日期 | 内容 | 类型 |
|------|------|------|
| 2026-05-04 | 代码审查: 修复 2 个 Critical + 3 个 Medium 缺陷 | 修复 |
| 2026-05-04 | E2E Suite E: 多步串联 + 监理取向 + 容错 (3 测试) | 测试 |
| 2026-05-04 | DeepSeekLLMInvoker + 7 工具注册 + CoroutineRunner 传史 | LLM 集成 |
| 2026-05-04 | 文档按阶段归档至 docs/meso-lite/ | 归档 |
| 2026-05-04 | 修复 3 个 bug + 提取 execShell | 修复 |
| 2026-05-04 | 初始化目录, 归档 Meso v1.1 概念设计产出 | 初始化 |
| 2026-05-05 | 类型加固: ToolStaining/MemoryType/CortexEventType 全量迁移, 零旧值残留 | 修复 |
| 2026-05-05 | 类型加固: EventBus API 四方法签名统一为 `CortexEventType \| (string & {})` | 修复 |
| 2026-05-05 | 清理: 死 import + 测试事件命名统一冒号分隔 | 清理 |
| 2026-05-04 | Mock 全链路 57 测试 + 关键词管线 43 测试 | 测试 |
| 2026-05-04 | **文档整理合并**：28→16 文档。3 反思合并、3 过渡合并、3 工程实践合并；5 Core 相关文件移出；2 v1.1 历史审查报告移出；v1.1 关键设计理念提取至 `docs/core/v1.1-关键设计理念保留.md` | 归档 |
