# Core-1 第四轮——记忆系统设计反思与工程教训

> Core-1 第四轮产出。包含审查修复记录、HCA/CSA→has/cas 设计直觉对齐、记忆系统 v1.1↔v2.0 差距分析、优化路线裁决。
> 归档于 Core 阶段，与 Meso-Lite 准入文档同级。

---

## 一、审查与修复（8 项）

本轮对重规划机制 + E2E 脚本做全量审查，发现 4 🟡 Warning + 4 🔵 Note，全部修复。

### 修复清单

| # | 严重度 | 问题 | 文件 | 修复 |
|---|--------|------|------|------|
| 1 | 🟡 | `node.failed` 事件仅异常路径发射，返回失败（如 No agent matches）不触发 | scheduler.ts:165-177 | `_dispatchNode` 中 non-exception 失败也 emit `node.failed` |
| 2 | 🟡 | `_tryReplan` 失败返回缺 `error` 字段 | scheduler.ts:222-229 | 分离成功/失败返回值，失败携带 `error` |
| 3 | 🟡 | MetaAgent 返回空数组浪费 1 轮重规划额度 | scheduler.ts:222 | 显式返回 `error: "MetaAgent returned no alternatives"` |
| 4 | 🟡 | `search_code` 工具无深度/文件大小限制 | e2e-real-llm.ts:87 | 加 MAX_DEPTH=4 + MAX_FILE_BYTES=100KB |
| 5 | 🔵 | `REPLAN_SYSTEM` 未列完整标签词汇表 | meta-agent.ts:185 | 补全 16 个有效标签 + 指导利用失败原因选标签 |
| 6 | 🔵 | `mini-react-test.ts` 硬编码模型名 | mini-react-test.ts:23 | 改用 `process.env.DEEPSEEK_CHAT_MODEL` |
| 7 | 🔵 | `replanCount` Map 缺线程安全文档 | scheduler.ts:65 | 标注 Node.js 单线程安全，对齐 TaskBoard.claim() |
| 8 | 🔵 | `REPLAN_SYSTEM` 未指导 LLM 利用失败原因 | meta-agent.ts:165 | 新增规则 "Analyze the error reason to choose different tags" |

验证：67/67 测试通过，typecheck 零错误。

---

## 二、HCA/CSA ↔ has/cas 设计直觉对齐

### 宪法 v1.1 原文（第九章）

> DeepSeek V4 的 CSA（压缩稀疏注意力）和 HCA（重度压缩注意力）为 Cortex 的规划与执行分离提供了硬件级实现路径。
> 1. Meta-Agent 用 HCA 做全局规划（略读——广而浅，把握全局骨架）
> 2. 功能柱用 CSA 做局部执行（精读——窄而深，聚焦局部细节）

### 对应关系

| | 全局（Meta-Agent） | 粒度（Agent） |
|---|-------------------|--------------|
| **宪法定义** | HCA：广而浅，把握骨架 | CSA：窄而深，聚焦细节 |
| **记忆映射** | `has`：存在断言，不取内容 | `cas`：期望校验，状态精准流转 |

### 设计直觉

不是刻意追求对称。是两处独立面对各自的约束——上下文窗口有限 + 状态流转不可逆——各自收敛到了 "轻判断 + 重校验" 的配对形态。同一个约束逻辑：贵的是资源，所以用配对设计省着用。

---

## 三、记忆系统设计差距分析

### 三套设计的对照

| 层 | v1.1 宪法第七章 | 议题四（SQL 落地） | v2.0 宪法第九章 | 当前代码 |
|----|-----------------|-------------------|-----------------|---------|
| 存储 | 两层四分（4 类型 × 公私分区） | 统一 memories 表，memory_type 区分 | 30 天热数据窗口 | Map<id, Entry>，类型有枚举但无差 |
| 状态 | 遗忘四态，每条有触发条件 | state 字段 + 流转状态机 | 无 | 四态枚举有，archive() 无条件覆写 |
| 关联 | 单一基础关联 ≤2 层 | memory_link_log + memory_links 双表，7 LinkType | 无 | LinkType 7 种全有，有 link()，无 BFS |
| 检索 | 关联→向量辅助 | 四级：BFS→排序→旁路→降级 | 无 | 仅关键词过滤 |
| 投影 | 三取向不同权重系数 | projection-rules.ts 静态配置 | 无（三取向已废） | 不存在 |
| 隐私 | 私密物理隔离 | is_private + 静默拒绝 + audit_records | 管家存储独立 | is_private 有，read() 过滤有，无审计 |
| 自迭代 | ε-贪心防回音室 | retrieval_feedback 表 + LoopController | 无 | 不存在 |

### 核心问题

1. **v1.1 是完整的认知架构**——怎么写、怎么查、怎么忘、怎么跨取向投影，全定义了
2. **v2.0 是工期妥协**——"30 天热数据窗口"解决的是"现在没时间做"，不是架构问题
3. **当前代码是两套设计的残影拼合**——四态枚举来自 v1.1，但无状态机；LinkType 来自议题四，但无 BFS 遍历

### 代码级缺陷（5 项）

| # | 缺陷 | 影响 |
|---|------|------|
| 1 | `read()` 直接改 `accessCount`/`lastAccessedAt` | 规划扫描和执行检索同权累加，污染访问统计 |
| 2 | `get()` 返回裸引用 | 可绕过 CAS 直改 `m.state`，状态机形同虚设 |
| 3 | `link()` 不校验目标状态 | Obliterated 记忆仍可建边，BFS 遍历时脏引用 |
| 4 | 无写入去重 | 同一经验连续写入生成多条 Entry，无幂等键 |
| 5 | `archive()` 无条件覆写 | Obliterated 可被"复活"到 Archived，违反四态约束 |

---

## 四、优化路线裁决

### Core-1 第四轮落地（4 项）

| 项 | 内容 | 理由 |
|----|------|------|
| **CAS 状态机** | `has()` + `cas()` + `archive/freeze/obliterate` 全部走 CAS | 四态枚举已有，状态机缺失是设计遗漏非延期 |
| **审计留痕** | 非管家 Agent 触及私密记忆写 auditRecords | is_private 过滤已有，审计是闭环最后一块 |
| **read() 去副作用** | `accessCount` 从即时 ++ 改为批量 `batchTouch(ids)` | 区分规划扫描和执行检索，HCA/CSA 直觉落地 |
| **batchTouch** | ReAct 循环结束时统一回调 | 需要 AgentRunner↔MemoryStore 契约 |

### Core-2 延期项（不写代码，标记设计位）

| 项 | 延期到 | 理由 |
|----|--------|------|
| BFS 检索 | Core-2 | Core-1 数据量下关联子图长期为空，BFS 是空架子 |
| 投影规则 | Core-2 | 三取向已废，6 Agent 平权，需重新设计投影维度 |
| 自迭代 + ε-贪心 | Core-3 | 需要 LoopAgent + feedback 表 + 策略评估闭环 |
| 级联冻结 | Core-2 | 依赖 CASCADE_TO 链完整遍历 + BFS 稳定 |
| 向量检索 | Core-2 | LanceDB WASM，当前数据量关键词足够 |

### 不做的理由

BFS 在 Core-1 数据量下大部分时间是冷启动旁路——Agent 刚写完记忆，关联边还没积累到有意义的密度。BFS 的检索价值要等 Core-2 关联积累量上来。Core-1 最该保证的是状态不脏、审计不漏、副作用不混淆——这是地基，BFS 是二楼。

---

## 五、经验教训

### 正判：设计直觉不是风格偏好

HCA/CSA 和 has/cas 不是刻意追求对称。两个独立领域（上下文管理、状态管理）各自面对"有限资源 + 误用高代价"的约束，各自独立收敛到了"轻判断 + 重校验"的配对形态。这说明这个设计直觉是普遍正确的——当某域出现类似约束时，可以直接复用这个模式做初始设计，不需要重新从零收敛。

### 误判：BFS 在 Core-1 不是优先级

初审优化路线时把 BFS + 投影规则排了进去。但仔细推演后确认——数据量不够、关联边密度不足——BFS 在 Core-1 是空架子，真正该优先的是 CAS 状态机和去副作用。教训：优化路线的排列不是"把所有好东西排进去"，而是"准确判断每个好东西在当前数据量下的真实生效时间"。

### 规律：宪法版本间的设计漂移需主动审计

v1.1 被标记"已废弃"后，遗忘四态、BFS 检索、投影规则、自迭代等关键设计在 v2.0 中无痕迹。但代码层面仍残留 v1.1 的枚举和类型（四态、LinkType 等）——这说明工程直觉比宪法文本诚实。教训：宪法版本跃迁时，被删除的设计宜显式出具"不再适用声明"，说明删除原因和替代路径，而非静默消失。

---

**文档状态**：Core-1 第四轮归档。与 Meso-Lite 准入文档同级，可被 DocGovernAgent 审计引用。
