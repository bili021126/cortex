# Loop Agent 注册状态核实报告

> 勘察者：纳西妲（Analysis Agent）
> 时间：2026-06-03
> 方法：遍历 shared 层注册表 + engine 层声明式注册表 + 枚举定义，交叉验证

---

## 一、枚举定义 — AgentType.Loop ✅ 已注册

**源文件**: `packages/shared/src/agent-enums.ts`

```typescript
AgentType.Loop = "loop"
```

与其余 13 个 Agent 类型并列存在，无缺失。

---

## 二、Shared 层注册表 — AGENT_DEFS（tags, display, permissions）

**源文件**: `packages/shared/src/agent-registry.ts`

| 属性 | 值 |
|------|-----|
| `tags` | `["loop", "pattern_scan", "skill_precipitate"]` |
| `chineseRole` | `"莫娜"` |
| `display.emoji` | `"🔮"` |
| `display.name` | `"莫娜"` |
| `display.signature` | `"星辰不会说谎。"` |
| `toolPermissions` | `BASE_TOOLSET`（含 write_file, run_shell 等 17 项） |
| `aliases` | 未定义（无额外别名） |

### 派生公共导出（自动生成，零手动对齐）

| 导出 | 值 |
|------|-----|
| `AGENT_TAGS[AgentType.Loop]` | `["loop", "pattern_scan", "skill_precipitate"]` |
| `AGENT_CHINESE_ROLE[AgentType.Loop]` | `"莫娜"` |
| `AGENT_DISPLAY_BY_TYPE[AgentType.Loop]` | `{ emoji: "🔮", name: "莫娜", signature: "星辰不会说谎。" }` |
| `AGENT_TOOL_PERMISSIONS[AgentType.Loop]` | BASE_TOOLSET（17 项） |
| `CHINESE_NAME_TO_TYPE["莫娜"]` | `AgentType.Loop` |
| `CHAT_AGENT_ALIASES["loop"]` | `AgentType.Loop`（string-key 自动加入） |
| `CHAT_AGENT_ALIASES["莫娜"]` | `AgentType.Loop`（chineseRole 自动加入） |

✅ **状态**: 所有属性定义完整，在 AGENT_DEFS 中有一行完整条目。

> **注意**: 文件顶部有 FIXME 注释，提到`应迁入 @cortex/config，但因 config→shared→config 循环依赖暂缓。数据副本已保留在 packages/config/src/data/agent-defs.ts`——但该路径不存在，数据副本已不存在或未创建。

---

## 三、Engine 层声明式注册表 — AGENT_REGISTRY（memoryParams + capability）

**源文件**: `packages/engine/src/agents/registry.ts`

### memoryParams

| 字段 | 值 |
|------|-----|
| `kind` | `"TaskLog"` |
| `linkTypes` | `["ProducedBy", "DerivedFrom"]` |
| `bfsDepth` | `2` |
| `limit` | `5` |
| `readMode` | 未定义（使用默认值） |

### capability（AgentCapability 自声明）

| 字段 | 值 |
|------|-----|
| `id` | `"loop"` |
| `type` | `AgentType.Loop` |
| `role` | `"莫娜 — 占星术士"` |
| `emoji` | `"🔮"` |
| `tags` | `["loop", "pattern_scan"]` |
| `produces` | `["pattern"]` |
| `toolPermissions` | `["read_file", "search_code"]` |
| `memoryQueryStrategy` | `"loop"` |
| `maxInstances` | `1` |
| `modelKey` | `"loop"` |
| `applicableScenarios` | `["模式发现", "重复检测", "跨模块分析"]` |
| `outputFormat` | `"report"` |
| `collaborationMode` | `"solo"` |

### 导出函数（向后兼容）

- `loopMemoryQuery` — 从 memoryParams 自动生成
- `loopAgentConfig` — 返回 `AgentFactoryConfig`（含 type, systemPrompt, memoryEnabled, getMemoryQuery）

### 注册选项

| 字段 | 值 |
|------|-----|
| `autoRegister` | `true`（bootstrap 时自动注册到 Scheduler） |

---

## 四、交叉比对发现的不一致 ⚠️

### 4.1 tags 不一致

| 来源 | tags | 
|------|------|
| **shared/agent-registry.ts** (AGENT_DEFS) | `["loop", "pattern_scan", "skill_precipitate"]` |
| **engine/agents/registry.ts** (capability.tags) | `["loop", "pattern_scan"]` |

`"skill_precipitate"` 在 shared 层注册表中存在，但在 engine 层 capability 的 tags 中缺失。这是两个注册表之间的信息漂移。

### 4.2 toolPermissions 不一致

| 来源 | toolPermissions |
|------|-----------------|
| **shared/agent-registry.ts** (AGENT_DEFS) | BASE_TOOLSET（17项，含 write_file, run_shell 等写入权限） |
| **engine/agents/registry.ts** (capability.toolPermissions) | `["read_file", "search_code"]`（仅只读权限） |

这是**显著的不一致**——shared 层认为 Loop 有完整读写权限，engine 层的 capability 自声明认为它只有只读权限。实际运行时权限由 `AGENT_TOOL_PERMISSIONS`（shared 层）决定，因此 Loop 实际拥有的权限比它 capability 声明的要宽。

### 4.3 description 中的角色分配

shared 层 `chineseRole: "莫娜"`，但 engine 层注册表中 `description: "模式发现——莫娜"` 且 Analysis Agent 的描述也是`"深度分析——莫娜"`。Loop 与 Analysis 共享了"莫娜"这个角色名，但 role/emoji 不同——**这可能是复制粘贴遗留**。

---

## 五、汇总判定

| 检查项 | 结果 |
|--------|------|
| AgentType.Loop 枚举值存在 | ✅ 通过 |
| shared 层 AGENT_DEFS 有完整条目 | ✅ 通过（tags, chineseRole, display, toolPermissions 齐全） |
| 所有派生公共导出自动生成 | ✅ 通过（零手动对齐） |
| engine 层 AGENT_REGISTRY 有完整条目 | ✅ 通过（memoryParams + capability 齐全） |
| autoRegister = true | ✅ 通过 |
| loopMemoryQuery / loopAgentConfig 导出 | ✅ 通过 |
| tag 信息跨层一致 | ⚠️ **未通过**——shared 有 `"skill_precipitate"`，engine 无 |
| toolPermissions 跨层一致 | ⚠️ **未通过**——shared 有 17 项，engine 仅 2 项 |
| AGENT_DEFS FIXME 中提到的 config 数据副本 | ❌ **路径不存在**——`packages/config/src/data/agent-defs.ts` 未找到 |

### 核心结论

Loop Agent 的注册**功能完整**——枚举、注册表项、memoryParams、capability、导出函数、自动注册全部就位。但存在**两处信息漂移**（tags 和 toolPermissions 在 shared 层与 engine 层不一致），以及**一处已消失的数据副本引用**（FIXME 注释指向不存在的文件）。这些都是"根系分岔"的早期信号——同一棵树的枝干开始朝不同方向长了。
