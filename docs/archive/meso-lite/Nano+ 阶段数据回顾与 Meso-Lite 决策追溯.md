# Nano+ 阶段数据回顾与 Meso-Lite 决策追溯

**性质**：Meso-Lite 反思阶段产出——Nano+ 交付物、压测数据、硬教训到 Meso-Lite 设计决策的可追溯映射
**创建日期**：2026-05-05

---

## 一、Nano+ 交付物清单（全 7 项）

| # | 交付物 | 工程产出 | 为 Meso 提供的核心数据 |
|---|--------|---------|----------------------|
| ① | 原则④确认门 | ToolGateway 拦截逻辑（CONFIRMATION_REQUIRED 错误码），三层分离：ToolGateway 机械拦截 → ReActLoop 缓存+事件发布 → CortexEngine stdin 确认+恢复 | 不可逆操作触发频率、确认/拒绝比、用户等待时长分布 |
| ② | normalizeNode 越界索引日志 | LLM 输出越界索引时记录 WARN 日志 | LLM 输出质量统计：越界频率、集中出现的任务类型 |
| ③ | git_diff + git_log 工具 | 工具集从 5 个扩展到 7 个（read_file, write_file, list_dir, run_shell, search_codebase + git_diff + git_log） | 多工具环境下的选择正确率、错误选择模式 |
| ④ | 取向分类配置化 | 硬编码关键词列表抽取为 `orientation-keywords.json` | 关键词 vs LLM 分类的差异率、LLM 分类延迟分布 |
| ⑤ | MockLLM 管线稳定性 | 1000 任务单柱内存管线压测（`stability-overnight.test.ts`） | Heap GC 行为、环形缓冲稳定态、stuck 累积率 |
| ⑥ | subscribeAll 强制 reason 参数 | EventBus 通配符订阅增加必填 reason（`subscribeAll(reason, handler)`） | 为 Meso 事件拓扑文档生成提供静态审计线索 |
| ⑦ | shared 包顶部边界声明 | "此包只包含类型定义和接口签名，不包含任何运行时实现" | 工程纪律硬约束，保障议题二原则 B |

### 稳定性测试结果

| 指标 | 结果 |
|------|------|
| 1000 任务连续运行 | 0 崩溃，0 阻塞 |
| Heap GC | 正常回收（15MB → 30MB → GC 后 3.2MB） |
| 环形缓冲 | 稳定在 5002，未溢出 |
| 事件总线 | 无消息丢失或投递异常 |
| 测试覆盖 | 9 管线 + 21 原有 + 7 真实 = 37/37 全通过 |

---

## 二、5 条硬教训 → Meso-Lite 设计决策可追溯矩阵

| # | Nano+ 硬教训 | 根因 | Meso-Lite 设计决策 | 对应议题 | 解决/缓解/遗留 |
|---|------------|------|-------------------|---------|--------------|
| ① | try/catch 吞异常 → 静默黑洞 | `allSettled` 吞 `contextFactory` 异常，外部无感知 | 结构化错误码：`NodeResult` 包含 errorCode + errorMessage；调度器 try-catch 外包 + 发布 NODE_FAILED | 议题三（Scheduler）、议题四（事件错误码） | ✅ 解决——Meso-Lite 代码审查再次发现同类问题并修复 |
| ② | 关键词分类瓶颈 → 误分类积累 | 硬编码关键词优先级链无歧义处理，单取向输入下正确多取向无回退 | LLM 分类 + 关键词 fallback 双轨；MetaAgent 先走 LLM 分类，失败时回退关键词 | 议题三（MetaAgent 分类策略） | ✅ 解决——但被单进程遮蔽（P-10），多用户/多取向时需重新验证 |
| ③ | EventBus 是隐藏全局变量 → 无契约可审计 | 任意字符串事件名，订阅关系不可追溯 | CortexEventType 目录（基于枚举的命名空间）+ subscribeAll 强制 reason + 事件拓扑文档 | 议题四（EventBus 协议） | ✅ 解决——Meso-Lite 进一步统一 publish/subscribe/queryByType/unsubscribe 四方法签名 |
| ④ | 线性 for-loop 触顶 → 单柱阻塞拖死全局 | Nano 的 `for (const node of plan)` 顺序执行，一柱阻塞即全局停摆 | 图执行调度器：拓扑排序 + 就绪队列扫描 + blocked 不阻塞全局 | 议题三（Scheduler） | ✅ 解决——1000 任务多柱并发 0 死锁验证 |
| ⑤ | 单轨测试不可迁移 → Mock 通过的结论真实 LLM 无效 | Nano 只有 MockLLM 测试，加入真实 LLM 后大面积失败 | MockLLM + 真实 LLM 双轨测试体系强制继承；每个阶段必须有两套测试 | 议题一 1.4（测试基础设施） | ✅ 解决——Meso-Lite 151 测试：Mock 88 + 真实 E2E 13 + 其他 50 |

---

## 三、Nano+ 交付物到 Meso-Lite 设计决策的继承链

| Nano+ 交付物 | 直接输入 Meso-Lite 的产物 | 验证状态 |
|-------------|------------------------|---------|
| ① 确认门（三层分离） | ToolGateway L0-L3 可逆性等级 + ConsoleChannel 两阶段确认 | ✅ 100% L2/L3 拦截 |
| ② normalizeNode 日志 | NodeResult 结构化错误码（errorCode + errorMessage） | ✅ 已纳入调度器 |
| ③ 工具集 5→7 | Meso-Lite 7 个真实工具注册（read_file, write_file, list_dir, run_shell, search_codebase, git_diff, git_log） | ✅ 全部可用 |
| ④ 取向分类配置化 | MetaAgent 双轨分类（LLM 优先 + keyword fallback） | ✅ 关键词管线 43 测试通过 |
| ⑤ MockLLM 压测 | Mock 全链路 57 + 关键词管线 43 + 管线验证 21 | ✅ 88 Mock 测试全通过 |
| ⑥ subscribeAll 强制 reason | EventBus subscribeAll(reason, handler) + 事件拓扑可追溯 | ✅ 已实现 |
| ⑦ shared 包边界声明 | shared 包仅类型/接口 + `import type` 与 value import 区分 | ✅ 已实现——但在类型加固中暴露 `import type` 陷阱（见 B2） |

---

## 四、Nano+ 暴露但未在 Meso-Lite 解决的结构性问题

以下问题在 Nano+ 已出现，但在 Meso-Lite 概念设计中被归入后续阶段，不属于 Meso-Lite 范围：

| 问题 | Nano+ 表现 | 归属阶段 | 当前状态 |
|------|-----------|---------|---------|
| 无 Committee 管线 | Nano+ 无多柱，无分歧场景 | Core-1b | 待实现 |
| 无图执行调度器 | Nano+ 线性 for-loop | Meso-Lite（✅ 已实现） | 已实现 |
| 无向量检索 | Nano+ 无持久化记忆 | Core-1a | 待实现 |
| 无哨兵/脑干 | Nano+ 无监控 | Core-2b / Full-1a | 待实现 |

---

## 五、从 Nano+ 到 Meso-Lite 的数据驱动决策证据

| Meso-Lite 设计决策 | 依赖的 Nano+ 数据 | 数据支撑 |
|-------------------|-------------------|---------|
| 延续 sql.js（不切 better-sqlite3） | Nano+ 1000 任务 0 崩溃在 sql.js 上 | 保持已知基线，降低调试复杂度 |
| 单进程 async 协程（不切 Worker Threads） | Nano+ 单进程 Heap GC 正常、无泄漏 | 多柱并发复杂性已经高，不叠加 IPC |
| 确认门三层分离架构 | Nano+ 确认门三层实现验证可行 | 架构已证可工作，Meso-Lite 扩展 L0-L3 |
| 图执行调度器（替代线性 for-loop） | Nano+ 硬教训④：线性模型触顶 | 直接证据——多柱场景必须 |
| 双轨测试强制继承 | Nano+ 硬教训⑤：单轨测试不可迁移 | 直接证据——每一阶段必须 |

---

**文档状态**：已完成。为概念设计 vs 工程实践对照分析（C 组）提供基线数据。
