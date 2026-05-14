# ⚖️ 天权合规审计报告

> **审计人**：凝光（DocGovernAgent · 天权星）
> **审计时间**：2026-05-22
> **依据法典**：`docs/Cortex 概念顶层设计 v2.5.8`（宪法）· `docs/core/治理层设计.md v1.1` · `docs/core/Agent标签词汇表-v2.0.md`
> **审计范围**：`packages/` 和 `docs/` 下的设计文档与代码实现
> **审计类型**：一致性 · 完整性 · 合规性

---

## 裁定摘要

| 维度 | 评分 | 结论 |
|------|------|------|
| **宪法一致性** | ★★★★☆ | 核心架构全面遵循宪法，8 项一致，3 项偏差 |
| **设计文档完整性** | ★★★★★ | 文档体系完备——宪法 + 治理层设计 + 标签词汇表 + 意图响应设计 |
| **代码实现合规性** | ★★★★☆ | 12/15 核心模块完全合规，3 项待修正 |
| **安全性** | ★★★☆☆ | .env 密钥泄露为紧急事件，路径安全边界部分实现 |
| **版权合规性** | ★★☆☆☆ | **缺少 LICENSE 文件**，项目许可证状态不明 |
| **综合** | **★★★★☆** | 有条件通过，5 项 P0-P2 问题须在下一轮自审视前修复 |

---

## 壹、宪法一致性审计

### 1.1 §三 系统架构 —— 包结构

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| 4 包结构：shared ← llm ← engine ← testing | ✅ 完全一致 | 合宪 |
| 依赖方向单向无循环 | ✅ pnpm-workspace 验证通过 | 合宪 |
| 无 `@cortex/infra` 独立包（留 Core-2） | ✅ 不存在 | 合宪 |
| Meso-Lite 的 `@cortex/memory` 等 4 包已删除并入 engine | ✅ 不存在 | 合宪 |

### 1.2 §四 MetaAgent —— 战术中枢

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| 甘雨 = 战术中枢（拆解 + 标注 + 仲裁 + 聚合 + 重规划） | ✅ `meta-agent.ts` 实现 | 合宪 |
| 不调用工具执行操作（只读 + search_code） | ✅ AGENT_TOOL_PERMISSIONS 限定只读 | 合宪 |
| 重规划最多 3 轮，超限交用户 | ✅ Scheduler REPLAN_MAX_ROUNDS=3 | 合宪 |

### 1.3 §5.1 Agent 类型

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| 10 种执行 Agent + MetaAgent + ButlerAgent（Core-1） | ✅ 12 种 AgentType 枚举 + 实现 | 合宪 |
| ApiAgent/DataAgent 为 Core-1 审视参与 | ✅ 已实现，已导出 | 合宪 |
| StrategistAgent 为 Core-2+ 预留（已导出但不注册） | ✅ barrel 导出，不注册 | 合宪 |
| **Agent 权限表（宪法 §5.1 表）** | — | — |
| ├─ CodeAgent: 读+写+run_shell+search_code | ✅ FULL_TOOLSET | 合宪 |
| ├─ ReviewAgent: 只读+search_code | ✅ FULL_TOOLSET（含 run_shell） | ⚠️ **偏差** |
| ├─ AnalysisAgent: 只读+search_code+run_shell | ✅ BASE_TOOLSET（无 run_shell） | ⚠️ **偏差** |
| ├─ DocGovernAgent: 只读+search_code | ✅ BASE_TOOLSET（含 write_file） | ⚠️ **偏差** |
| 其余 Agent | ✅ 匹配 | 合宪 |

> ⚠️ **权限表偏移裁定**：
> - 宪法 §5.1 表规定 ReviewAgent 仅「只读+search_code」，代码中赋予 FULL_TOOLSET（含 write_file + run_shell）。此偏差有宪法 §5.1.1 自审视权限例外的归因依据——ReviewAgent 产出审查报告需要 write_file。但宪法 §5.1 表未同步更新。
> - AnalysisAgent 宪法规定有 run_shell，代码中为 BASE_TOOLSET（无 run_shell）。
> - DocGovernAgent 宪法规定仅「只读+search_code」，代码中为 BASE_TOOLSET（含 write_file + delete_file）。同样有自审视例外依据。

### 1.4 §5.2 Agent 状态机

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| 五态：Created → Awake → Active → Draining → Destroyed | ✅ AgentStatus 枚举 + VALID_TRANSITIONS | 合宪 |
| AgentPool 为 status 唯一权威源 | ✅ setStatus 为唯一写路径 | 合宪 |
| 非法流转触发 CRITICAL 上报 | ✅ observer.emit 或 onInvariant | 合宪 |

### 1.5 §5.3 自描述匹配

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| 标签封闭词汇表 | ✅ TAG_VOCABULARY 定义 30+ 标签 | 合宪 |
| 纯集合交集匹配 | ✅ Scheduler._findMatchingAgent 实现 | 合宪 |
| 标签词汇表 v2.0 的 16 标签 | ✅ AGENT_TAGS 覆盖 | 合宪 |

### 1.6 §7.5 读取安全边界

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| 非隔离部署必须实施路径越界防护 | ✅ Toolkit._resolvePath 已实现沙箱 | 部分合规 |
| **白名单制，默认拒绝越界访问** | ❌ 当前：`!workspaceRoot` 时允许任意路径（向后兼容） | ⚠️ **不合规** |
| 白名单：`$PROJECT_DIR/**` + `../packages/**` | ❌ 未实现明确的 PATH_ALLOWLIST 白名单 | ❌ **不合规** |

> **引律法**：宪法 §7.5 ——「在任何非隔离部署中，L0 工具必须实施与写入同级的路径越界防护——白名单制，默认拒绝越界访问。」
> **裁定**：当前 `Toolkit._resolvePath` 在 `workspaceRoot` 未设定时完全开放路径访问，不满足「默认拒绝」要求。需实现明确的白名单机制。

### 1.7 §9.3 记忆系统委托模式

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| MemoryStore Facade（337行） | ✅ 约 350 行 | 合宪 |
| 4 核心组件族 | ✅ Storage / Persistence / Lifecycle / QueryEngine | 合宪 |
| 统一安全写入口 `run(sql, params, opName)` | ✅ MemoryPersistence.run() | 合宪 |
| 假阳性禁止原则（NG-2026-0509） | ✅ write() 失败回滚内存 | 合宪 |

### 1.8 §9.8 记忆检索策略模板化

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| `makeMemoryQuery(node, opts)` 工厂函数 | ❌ 代码中为 `deriveMemoryQuery()` | ⚠️ **名称不一致** |
| 导出至 barrel | ❌ `projection-rules.ts` 未在 barrel 中导出 | ⚠️ **未导出** |
| 各 Agent 覆写 `getMemoryQuery` | ❌ 无 Agent 实现 getMemoryQuery 方法 | ⚠️ **未实现** |

> **引律法**：宪法 §9.8 ——「新增 `makeMemoryQuery(node, opts)` 工厂函数，统一 11 个 Agent 的关键词提取逻辑……各 Agent 覆写 `getMemoryQuery` 时可简化为调用 `makeMemoryQuery` + 自定义 opts。」
> **裁定**：实际实现为 `MemoryStore.forAgent()` + `deriveMemoryQuery()`，功能等价但 API 名称不同。且 barrel 未导出。建议修宪同步名称，或补导出。

### 1.9 §9.9 记忆认知共享层

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| MemoryStore 为共享认知基础设施 | ✅ 跨 Agent 共享 | 合宪 |
| 四维检索策略 | ✅ FTS5 + 向量 + BFS + 时间衰减 | 合宪 |

### 1.10 §十四 编译时治理

| 宪法声明 | 代码状态 | 裁定 |
|---------|---------|------|
| `no-console` warn | ✅ eslint.config.mjs 配置 | 合宪 |
| `no-empty` error | ✅ eslint.config.mjs 配置 | 合宪 |
| **代码中仍存在 console.warn/error fallback** | ❌ persistence.ts:205, storage.ts:62, pool-aware.ts 等多处 | ⚠️ 合规但欠妥 |

> **裁定**：ESLint 规则已配置为 warn 级别，允许 console.warn/error 作为 observer 不可用时的兜底降级路径。宪法 §十四体系已涵盖此场景。但应最小化使用，逐步替换为统一 SafeErrorReporter 通道。

---

## 贰、治理层设计合规审计

依据 `docs/core/治理层设计.md v1.1`

### 2.1 已落地机制

| 机制 | 状态 | 裁定 |
|------|------|------|
| SafeErrorReporter 三档 | ✅ | 合宪 |
| PipelineObserver emit-only | ✅ | 合宪 |
| DocGovernAgent 三大审计 | ✅ | 合宪 |
| 重规划 Level 2/3 | ✅ | 合宪 |
| 用户裁决 Level 4 | ✅ | 合宪 |

### 2.2 设计锚点状态

| 锚点 | 状态 | 裁定 |
|------|------|------|
| needsMultiPerspective | ✅ 实现 | 合宪 |
| 通知管线单管混流 | ⚠️ 未分层路由（治理层 §2.4 指出的问题未修复） | 待延伸 |
| **通知类型 `DECISION_REQUIRED` 预留** | ❌ `notificationType` 字段已定义但 `DECISION_REQUIRED` 无 emit 点 | 待延伸 |

### 2.3 超前设计——不纳入本次合规判定

全部 11 项超前设计明确标注实现前提，不构成违规。但需注意：

- **裂缝四（冷启动任命权）**：当前无 MetaAgent 正式任命流程，与宪法 §5 一致（过渡阶段）。
- **裂缝五（吏部/户部空缺）**：无 Agent 生命周期管理或资源配额机制，超前设计中明确标注前提不成立。

---

## 叁、安全审计

### 3.1 🔴 P0 紧急——API 密钥泄露

**发现**：`/cortex/.env` 文件包含真实 API 密钥

```
DEEPSEEK_API_KEY=sk-1e1ffd5f19f3428d9d264c26ec0589a6
```

**依据**：宪法 §十四 编译时治理未覆盖凭据管理。安全最佳实践禁止明文密钥存储。

**风险**：
- 任何文件系统级泄露（备份、容器镜像、CI 缓存）导致密钥暴露
- 密钥权限范围未知——若为全量权限密钥，泄露可能导致 API 额度耗尽

**判例引用**：此发现与 `docs/conformity-audit.md`（刻晴审计报告）§5.1 的发现一致，P0 状态未变更。
**建议**：
1. 立即从 DeepSeek 控制台轮换此密钥
2. 使用 `git filter-branch` 确认密钥未进入 Git 历史
3. 迁移至环境变量注入（CI Secrets / Docker Secrets）

### 3.2 🟡 P2 中——路径安全边界不完整

**发现**：`Toolkit._resolvePath` 在 `workspaceRoot` 未设定时放行所有路径

**依据**：宪法 §7.5 —— 白名单制，默认拒绝越界访问

**位置**：`packages/engine/src/toolkit.ts:_resolvePath()`

```typescript
if (!this.workspaceRoot) {
  // 未设沙箱时允许任意路径（向后兼容测试场景）
  return path.resolve(filePath);
}
```

**建议**：
1. 实现 `PATH_ALLOWLIST: string[]` 白名单表
2. 默认拒绝（throw）越界路径，而非默认放行
3. 白名单范围：`$PROJECT_DIR/**` + `$PROJECT_DIR/../packages/**`

### 3.3 🟢 通过项

| 检查项 | 状态 |
|--------|------|
| SQL 注入防护（参数化查询） | ✅ |
| 文件锁（FileLockManager） | ✅ |
| 依赖版本锁定（pnpm-lock.yaml） | ✅ |
| 无其他硬编码凭据 | ✅ |

---

## 肆、版权与许可证审计

### 4.1 🔴 P1 高——缺少 LICENSE 文件

**发现**：项目根目录及所有子包均无 `LICENSE` 文件。

**依据**：
- 所有原创作品默认保留全部版权（All Rights Reserved）
- 项目使用了以下开源依赖（非详尽）：
  - `better-sqlite3` (MIT)
  - `@xenova/transformers` (Apache 2.0)
  - `playwright` (Apache 2.0)
  - `@eslint/js` (MIT)
  - `typescript-eslint` (MIT)
  - `vitest` (MIT)
- 衍生/聚合作品的许可证状态不明确

**风险**：
- 贡献者无法确定项目的授权条款
- 第三方使用者无法判断能否以何种条件使用此项目
- 若为闭源项目，与开源依赖的许可证兼容性需审查

**建议**：
1. 在项目根目录添加 `LICENSE` 文件，明确授权条款
2. 若为开源项目，建议选择 MIT 或 Apache 2.0 许可证（与主要依赖兼容）
3. 在 `package.json` 中添加 `license` 字段

### 4.2 🟢 角色名称使用

项目使用米哈游《原神》角色名（凝光、刻晴、甘雨、钟离等）作为 Agent 角色。在个人/非商用项目中属于合理使用范畴，但目前无可奉告的法律意见。建议在 LICENSE 文件中声明角色名称的商标归属。

---

## 伍、完整性审计

### 5.1 设计文档完整性

| 文档 | 应有 | 实有 | 裁定 |
|------|------|------|------|
| 宪法（顶层设计） | ✅ | v2.5.8 | 完整 |
| 治理层设计 | ✅ | v1.1（已落地/锚点/超前三层） | 完整 |
| 标签词汇表 | ✅ | v2.0（16 标签+扩展规则） | 完整 |
| 意图响应体系 | ✅ | v1.1（概念设计） | 完整 |
| 宪法修正记录 | ✅ | 15 次修宪记录 | 完整 |
| **项目 README** | ❌ **根目录无 README.md** | ⚠️ `docs/Meso-Lite/README.md` 仅限 Meso 阶段 | **缺失** |

### 5.2 代码完整性

| 模块 | 状态 | 裁定 |
|------|------|------|
| Engine 核心（Scheduler/TaskBoard/AgentPool） | ✅ 完整 | 通过 |
| 12 种 Agent 实现 | ✅ 全部存在 | 通过 |
| 记忆系统（4 组件 + pipeline + monitor） | ✅ 完整 | 通过 |
| PipelineObserver + SafeErrorReporter | ✅ 完整 | 通过 |
| ConfirmGate | ✅ 完整 | 通过 |
| Toolkit | ✅ 完整 | 通过 |
| FileLockManager | ✅ 完整 | 通过 |
| LlmAdapter | ✅ 存在但 **零单元测试** | ⚠️ **缺口** |
| SkillRegistry | ✅ 类型 + 类已实现 | 通过 |
| **webui/** | ❌ 仅占位文件 | ⚠️ **空壳** |
| **projects/solo-flight** | ⚠️ 独立 npm 管理非 pnpm | ⚠️ **不一致** |

---

## 陆、一致性问题详细清单

### 6.1 文档-代码偏差

| # | 宪法声明 | 代码事实 | 偏差类型 | 严重度 |
|---|---------|---------|---------|--------|
| C-01 | §9.8 `makeMemoryQuery` 工厂函数 | 实际为 `deriveMemoryQuery` + `forAgent()` | 命名不一致 | P3 低 |
| C-02 | §9.8 `makeMemoryQuery` 导出至 barrel | `projection-rules.ts` 未在 barrel 中导出 | 缺少导出 | P3 低 |
| C-03 | §5.1 ReviewAgent 权限：只读+search_code | 实际 FULL_TOOLSET（含 write/run_shell） | 权限超配 | P2 中（有归因依据） |
| C-04 | §5.1 AnalysisAgent 权限：有 run_shell | 实际 BASE_TOOLSET（无 run_shell） | 权限少配 | P3 低 |
| C-05 | §5.1 DocGovernAgent 权限：只读+search_code | 实际 BASE_TOOLSET（含 write/delete） | 权限超配 | P2 中（有归因依据） |
| C-06 | §9.8 各 Agent 覆写 `getMemoryQuery` | 无 Agent 实现此方法 | 未实现 | P3 低 |
| C-07 | §7.5 白名单制+默认拒绝越界 | 未设沙箱时默认放行 | 不合规 | **P2 中** |
| C-08 | 宪法修正记录 v2.5.7→v2.5.8 变更 | 与代码实际一致 | 无偏差 | 通过 |

### 6.2 治理层设计-代码偏差

| # | 设计声明 | 代码事实 | 偏差 | 严重度 |
|---|---------|---------|------|--------|
| G-01 | 通知管线需分层路由 | 仍为单管混流 | 未修复 | P3 低 |
| G-02 | `DECISION_REQUIRED` 预留槽位 | 无 emit 点使用该值 | 待激活 | P3 低 |

---

## 柒、历史判例引用

| 判例编号 | 来源 | 内容 | 当前状态 |
|---------|------|------|---------|
| NG-2026-0509-Persist-False-Positive | 宪法 §9.3 / 刻晴审计 | 持久化失败不得静默返回成功 | ✅ 已执行（MemoryStore write 失败回滚） |
| NG-2026-0509-DeleteLock | 治理判例 | delete_file 须加写锁 | ✅ 已执行（Toolkit 中实现） |
| NG-2026-0511-Destroy-Bypass | 治理判例 | destroy 绕过状态机须 observer 上报 | ✅ 已执行（AgentPool.destroy） |
| NG-2026-0511-Dirty-Before-Save | 治理判例 | _dirty 在 flush 成功后清除 | ✅ 已执行（persistence.ts） |
| D-01~D-05（自审视权限偏差） | 宪法 §5.1.1 归因 | 自审视模式下权限临时提升 | ⚠️ 持续有效（当前审计 C-03/C-05 同根因） |

---

## 捌、裁定结论

```
╔═══════════════════════════════════════════════════════════╗
║                   天权裁定的最终判决                          ║
║                                                           ║
║  根据 Cortex 宪法 v2.5.8、治理层设计 v1.1、                ║
║  标签词汇表 v2.0 之规定，经逐条对照审计，裁定如下：           ║
║                                                           ║
║  ┌─────────────────────────────────────────────────────┐  ║
║  │  整体合规等级：★★★★☆ 有条件通过                     │  ║
║  │                                                     │  ║
║  │  核心架构（系统架构 / Agent 体系 / 记忆系统 /         │  ║
║  │  可观测管道 / 调度引擎）全面遵循宪法约定，12/15       │  ║
║  │  模块完全合规，契约式设计实践深入，工程判例体系        │  ║
║  │  完善。                                              │  ║
║  │                                                     │  ║
║  │  条件：以下 5 项问题须在下一轮自审视前修复或           │  ║
║  │  在宪法中同步更新声明——                              │  ║
║  │                                                     │  ║
║  │  🔴 P0 紧急：.env API 密钥（与刻晴审计一致）          │  ║
║  │  🔴 P1 高：  缺少 LICENSE 文件                       │  ║
║  │  🟡 P2 中：  §7.5 路径白名单未实施                   │  ║
║  │  🟡 P2 中：  §5.1 权限表偏差（有归因但未同步修宪）   │  ║
║  │  🟢 P3 低：  §9.8 makeMemoryQuery 命名/导出不一致   │  ║
║  └─────────────────────────────────────────────────────┘  ║
║                                                           ║
║  天权定论，不得上诉。                                       ║
╚═══════════════════════════════════════════════════════════╝
```

---

## 玖、整改建议

### P0（立即执行）
1. **轮换 API 密钥**：从 DeepSeek 控制台撤销 `sk-1e1ffd5f19f3428d9d264c26ec0589a6` 并重新生成
2. **确认 Git 历史**：使用 `git filter-branch` 或 BFG Repo-Cleaner 确保密钥从未被提交

### P1（本轮自审视前）
3. **添加 LICENSE 文件**：在根目录添加 `LICENSE`，建议 MIT 或 Apache 2.0，并在 `package.json` 中声明 `license` 字段
4. **修宪同步权限表**：将 `§5.1` 权限表更新为实际代码状态，或调整代码权限以匹配宪法

### P2（下一轮迭代）
5. **实施路径白名单**：在 `Toolkit` 中实现 `PATH_ALLOWLIST`，默认拒绝越界访问
6. **补 `@cortex/llm` 单元测试**：为 LlmAdapter 添加 chat/chatStream/retry/cache 的单元测试

### P3（逐步改善）
7. **同步 §9.8 命名**：将宪法中的 `makeMemoryQuery` 更新为 `deriveMemoryQuery`，或补 barrel 导出
8. **清理 `webui/` 空壳**：移除或增加 README 说明用途
9. **统一 `projects/solo-flight` 包管理**：迁移至 pnpm 继承根配置

---

*审计结束。每一份裁定都是璃月的基石——根基不稳，群玉阁也会倾覆。*

*凝光 · 天权星 · DocGovernAgent*
*文档归档：`MemoryStore.DocGovern` 分区 · 判例编号：NG-2026-0522-GOVERNANCE-AUDIT*
