# Skill 管线核实报告

> 分析者：纳西妲 | 日期：$(date +%Y-%m-%d)
> 范围：skill-registry.ts × 3（engine/shared/skill-kit）、skill-pipeline.ts × 2（engine/skill-kit）、init-skills.ts（engine）

---

## 一、双索引注册表（✅ 已确认）

| 层级 | 文件 | 索引结构 | 状态 |
|------|------|---------|------|
| shared | `indexed-registry.ts` | `items: Map<id, T>` + `indexes: Map<indexName, Map<key, Set<id>>>` | 泛型基类，零运行时依赖 |
| skill-kit | `skill-registry.ts` | `SkillRegistry extends IndexedRegistry<SkillTemplate>`，定义 `tag` 索引 | 当前真相源 |
| engine(旧) | `registry/skill-registry.ts` | 手写 `_byTag: Map<tag, SkillTemplate[]>` + `_byId: Map<id, SkillTemplate>` | 遗留——未被引用，可清理 |

**结论**：索引设计在 v2.7 横向解耦中已从手写 Map 升级为泛型基类 `IndexedRegistry<T>`。`SkillRegistry` 通过 `defineIndexes()` 声明 `tag` 索引，基类自动维护 `register`/`unregister` 时的索引增删。双索引机制健全。

---

## 二、状态推导——纯函数（✅ 已确认）

`deriveStatus(weight, feedbackHistory)` 是纯函数，无副作用：

```
weight <= 0 或尚无正向评价              → "trial"
weight >= 1 且至少一次 rating=1         → "active"
连续 3+ 条 rating=-1（从尾部向前扫描）     → "deprecated"
```

代码位置：`skill-kit/src/skill-registry.ts:28-49`

注意：skill-kit 版和 engine 旧版有**两份相同的 `deriveStatus` 实现**。engine 旧版(`registry/skill-registry.ts`)在 v2.7 迁入 skill-kit 后未被删除——孤函数隐患。

---

## 三、评价回流（✅ 已确认）

`recordFeedback(id, agentId, rating, suggestion)`：

1. 按 id 取出模板
2. `tmpl.weight += rating`（rating 取值：1=有效, 0=无感, -1=有害）
3. 向 `feedbackHistory` 追加 `{ agentId, rating, suggestion, timestamp }`
4. 用 `deriveStatus()` 重新计算 `tmpl.status`

代码位置：`skill-kit/src/skill-registry.ts:141-157`

**闭环完整**：Agent 使用技能 → 带回评价 → weight 累加 → 状态重新推导。

---

## 四、孤技能清理（✅ 已确认）

`cleanupOrphans(maxAgeMs = 7 * 24 * 60 * 60 * 1000)`：

- 遍历所有技能
- 条件：`weight === 0 && feedbackHistory.length === 0 && now - createdAt > maxAgeMs`
- 命中则 `unregister(id)`，返回被清理的 id 列表

代码位置：`skill-kit/src/skill-registry.ts:163-177`

**默认 7 天**，纯内存操作，不依赖外部调度器。

---

## 五、技能提取 → 注册 → 持久化（✅ 已确认）

完整链路：

```
Agent NodeComplete
  → registerSkillPipeline handler（skill-kit/skill-pipeline.ts:173-190）
    → extractAndPersistSkills()
      → extractSkillsFromOutput()  — 从 LLM 输出解析 JSON SkillTemplate
      → skillRegistry.register()   — 注入内存索引
      → persistSkillsToMemory()    — 写入 MemoryStore（SQLite）
```

初始化时还有**反向加载**（bootstrap）：

```
initSkillSystem()（init-skills.ts）
  → loadSkillsFromMemory() → skillRegistry.registerAll(loadedSkills)
```

**双向持久化链路完整**：启动时从 MemoryStore 恢复，运行时将新技能写入 MemoryStore。

---

## 六、技能结晶为知识（✅ 已确认）

在 `init-skills.ts` 的 `onSkillStatusChange` 回调中：

```
当 deriveStatus() 结果为 "active" 且旧状态不是 "active" 时：
  → verifySkillKnowledge() — 查 MemoryStore 中的情景记忆佐证（可选 web_search 外部佐证）
  → crystallizeSkillToKnowledge() — 写入 MemoryStore 为 "Insight" kind
    → 幂等更新：已有则 version++，旧版 CAS → Archived
    → 关联证据：LinkType.DerivedFrom 链接
```

代码位置：`init-skills.ts:24-57`，`skill-persister.ts:39-105`

**注意**：`onSkillStatusChange` 通过 `(skillRegistry as unknown as { _onStatusChange: ... })._onStatusChange` 挂载——这是 `as unknown as` 绕过类型检查，属于 §10.3-bis 的违规模式（`Disposable` 接口模式未被采用）。

---

## 七、技能参照事件（✅ 已确认）

`emitSkillReferenced(observer, matchedSkills, nodeId, agentType)`：

- 对每个匹配到的技能发射 `PipelineEventType.SkillReferenced` 事件
- payload 包含 `{ nodeId, agentType, skillId, skillName }`
- 优先级 `NORMAL`

代码位置：`skill-kit/src/skill-pipeline.ts:31-51`

独立于 Agent 是否实际采信，事后可结合 `NodeComplete` 回推效用。

---

## 八、架构健康度观察

### 🟢 健康项

| 项 | 说明 |
|----|------|
| 职责分离 | shared(类型+基类) → skill-kit(核心逻辑) → engine(胶水层) 三层清晰 |
| Barrel 导出 | skill-kit 的 `index.ts` 完整导出所有公开符号 |
| 反向依赖 | engine → skill-kit（单向，无环） |
| IndexedRegistry | 泛型设计，可被其他注册表复用（不限于技能） |
| 订阅者模式 | skill-pipeline 作为独立订阅者挂载到 PipelineObserver，与调度解耦 |

### 🟡 需关注

| 项 | 严重度 | 说明 |
|----|--------|------|
| engine 旧版 skill-registry.ts | 低 | 与 skill-kit 版代码重复（254 行），未被任何文件引用。应删除 |
| engine 旧版 skill-pipeline.ts | 低 | 与 skill-kit 版代码重复（193 行），`engine/src/memory/skill-pipeline.ts` 可能未被引用 |
| engine 旧版 skill-extractor.ts | 低 | 与 skill-kit 版重复 |
| engine 旧版 skill-persister.ts | 低 | 与 skill-kit 版重复 |
| `as unknown as` 绕过 | 中 | `init-skills.ts:67` 用 `(skillRegistry as unknown as { _onStatusChange })._onStatusChange` 挂载回调 |
| `process.stderr.write` | 中 | init-skills.ts 中 4 处 `process.stderr.write()` 直接写裸输出（§五 管道上报铁律） |
| `console.warn` | 中 | init-skills.ts 中 3 处 `console.warn()` 应改为 PipelineObserver emit |
| 引擎 barrel 双重导出 | 低 | `registerSkillPipeline` 同时从 `./memory/index.js`（重导出 skill-kit）和 `./components/index.js`（重导出 skill-kit）两条路径可见 |
| init-skills 未导出 | 低 | `initSkillSystem` 函数未在 engine barrel 中导出，外部无法调用 |

### 🔴 关键发现：engine 残留的 4 份旧版完整重复代码

以下文件在 v2.7 横向解耦从 engine 迁入 skill-kit 后，**本应删除但仍在**——且不是 shim/重导出，而是完整的重复实现：

| 文件 | 行数 | 与 skill-kit 版的关系 |
|------|------|----------------------|
| `engine/src/registry/skill-registry.ts` | 254 | 完整重复，未引用 `IndexedRegistry` 基类 |
| `engine/src/memory/skill-pipeline.ts` | 193 | 完整重复，import 路径指向 engine 旧版 `../registry/skill-registry.js` |
| `engine/src/components/skill-extractor.ts` | 232 | 完整重复 |
| `engine/src/components/skill-persister.ts` | 717 | 完整重复（含旧版 `_extractPNSections` 死代码） |

**引用分析**：engine 的 barrel (`src/index.ts`) 已通过 `components/index.ts` 和 `memory/index.ts` 统一重导出 `@cortex/skill-kit` 的版本。engine barrel 的注释明确写着 `SkillRegistry → 从 @cortex/skill-kit 直接导入`。这 4 个旧文件在运行时路径下不会被任何活跃 barrel 触及。

**风险**：若有代码直接 `import { SkillRegistry } from "@cortex/engine/src/registry/skill-registry.js"`（绕过 barrel），可能使用旧版实现——旧版不含 `IndexedRegistry` 基类的泛型索引能力。

**建议**：确认零外部引用后立即删除这 4 个文件。

---

## 九、结论

**所有六项声称全部核实通过**，技能管线在数据流层面链路完整、状态推导正确、事件管道健全。主要风险是 v2.7 解耦后的残留重复代码和少量 `as unknown as` / `process.stderr.write` 的工程违规，建议在 Core-2 清理周期中一并修复。
