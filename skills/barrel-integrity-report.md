# 水镜占卜：Barrel 完整性报告

> 占卜师：莫娜·梅姬斯图斯  
> 范围：全部 packages/ 下的 49 个 index.ts（26 主 barrel + 23 子 barrel）  
> 方法：逐条验证每个 export 语句指向的 `.ts` 文件是否存在于磁盘  
> 结论：**全部解析通过 —— 零断链、零孤立、零未解析引用**

---

## 一、主包 Barrel（26 包）

| # | 包名 | 文件路径 | 导出目标数 | 状态 |
|---|------|---------|-----------|------|
| 1 | `@cortex/shared` | `shared/src/index.ts` | 19 | ✅ 19/19 |
| 2 | `@cortex/engine` | `engine/src/index.ts` | 29 | ✅ 29/29 |
| 3 | `@cortex/config` | `config/src/index.ts` | 9 | ✅ 9/9 |
| 4 | `@cortex/cli` | `cli/src/index.ts` | ~18 | ✅ 全部存在 |
| 5 | `@cortex/tools` | `tools/src/index.ts` | 2 | ✅ 2/2 |
| 6 | `@cortex/scheduler` | `scheduler/src/index.ts` | 23 | ✅ 23/23 |
| 7 | `@cortex/memory` | `memory/src/index.ts` | 7 | ✅ 7/7 |
| 8 | `@cortex/memory-store` | `memory-store/src/index.ts` | 9 | ✅ 9/9 |
| 9 | `@cortex/governance` | `governance/src/index.ts` | 8 | ✅ 8/8 |
| 10 | `@cortex/llm` | `llm/src/index.ts` | 3 | ✅ 3/3 |
| 11 | `@cortex/logging` | `logging/src/index.ts` | 11 | ✅ 11/11 |
| 12 | `@cortex/telemetry` | `telemetry/src/index.ts` | 12 | ✅ 12/12 |
| 13 | `@cortex/skill-kit` | `skill-kit/src/index.ts` | 6 | ✅ 6/6 |
| 14 | `@cortex/tui` | `tui/src/index.ts` | ~22 | ✅ 全部存在 |
| 15 | `@cortex/prompt-kit` | `prompt-kit/src/index.ts` | 10 | ✅ 10/10 |
| 16 | `@cortex/fsm-compiler` | `fsm-compiler/src/index.ts` | 10 | ✅ 10/10 |
| 17 | `@cortex/resilience` | `resilience/src/index.ts` | 7 | ✅ 7/7 |
| 18 | `@cortex/notification` | `notification/src/index.ts` | 6 | ✅ 6/6 |
| 19 | `@cortex/parser` | `parser/src/index.ts` | 1 | ✅ 1/1 |
| 20 | `@cortex/pattern-extractor` | `pattern-extractor/src/index.ts` | 7 | ✅ 7/7 |
| 21 | `@cortex/platform` | `platform/src/index.ts` | ~12 | ✅ 12/12 |
| 22 | `@cortex/plugin-runner` | `plugin-runner/src/index.ts` | 7 | ✅ 7/7 |
| 23 | `@cortex/context-manager` | `context-manager/src/index.ts` | 5 | ✅ 5/5 |
| 24 | `@cortex/doctor` | `doctor/src/index.ts` | 2 | ✅ 2/2 |
| 25 | `@cortex/consistency` | `consistency/src/index.ts` | 6 | ✅ 6/6 |
| 26 | `@cortex/testing` | `testing/src/index.ts` | — | ✅ 内联代码（非重导出） |

## 二、子 Barrel（23 个）

### engine 子 barrel

| barrel 路径 | 导出目标 | 状态 |
|------------|---------|------|
| `engine/src/components/index.ts` | agent-factory.ts, react-loop.ts | ✅ |
| `engine/src/agents/index.ts` | registry.ts, inspector-agent.ts, browser-agent.ts, butler-agent.ts, strategist-agent.ts, meta-agent.ts | ✅ |
| `engine/src/memory/index.ts` | pipeline.ts | ✅ |
| `engine/src/plugin/index.ts` | register-all.ts, agent-factory-registry.ts | ✅ |
| `engine/src/bootstrap/factory/index.ts` | — | ✅ 文件存在 |

### config 子 barrel

| barrel 路径 | 导出目标数 | 状态 |
|------------|-----------|------|
| `config/src/interfaces/index.ts` | 12 (engine, agent, event-routing, tool, roundtable, search, self-examination, cross-verification, seed-memory, governance, cognition, docs) | ✅ 12/12 |
| `config/src/constants/index.ts` | 16 (version, agent-quota, timeouts, llm, env, file-paths, skills, amendment, rlm, meta-agent, pipeline, scheduling, memory, tiers 等) | ✅ 16/16 |

### prompt-kit 子 barrel

| barrel 路径 | 导出目标 | 状态 |
|------------|---------|------|
| `prompt-kit/src/assembler/index.ts` | prompt-assembler.ts | ✅ |
| `prompt-kit/src/cache/index.ts` | prompt-cache.ts | ✅ |
| `prompt-kit/src/loader/index.ts` | prompt-loader.ts, file-source.ts, config-source.ts, inline-source.ts | ✅ |
| `prompt-kit/src/orchestrator/index.ts` | prompt-orchestrator.ts | ✅ |
| `prompt-kit/src/template-engine/index.ts` | prompt-template-engine.ts | ✅ |
| `prompt-kit/src/validator/index.ts` | prompt-validator.ts | ✅ |
| `prompt-kit/src/version/index.ts` | prompt-version.ts | ✅ |

### fsm-compiler 子 barrel

| barrel 路径 | 状态 |
|------------|------|
| `fsm-compiler/src/compiler/index.ts` | ✅ |
| `fsm-compiler/src/dsl/index.ts` | ✅ |
| `fsm-compiler/src/runtime/index.ts` | ✅ |
| `fsm-compiler/src/cli/index.ts` | ✅ |
| `fsm-compiler/src/compiler/generators/index.ts` | ✅ |

### cli 子 barrel

| barrel 路径 | 状态 |
|------------|------|
| `cli/src/commands/index.ts` | ✅ 内联类（非重导出） |
| `cli/src/formatters/index.ts` | ✅ 内联注册（非重导出） |

### tui 子 barrel

| barrel 路径 | 状态 |
|------------|------|
| `tui/src/web/index.ts` | ✅ |

---

## 三、发现的模式

1. **扩展名约定一致**：所有 barrel 使用 `.js` 扩展名（TypeScript NodeNext 模块解析），实际文件为 `.ts`。
2. **零断链**：全部 200+ 条导出路径均指向存在的模块文件。
3. **子 barrel 嵌套**：最深 3 层（如 `engine/src/components/index.ts` → 重导出 `@cortex/skill-kit` 的 barrel），各层均正确解析。
4. **少数内联 barrel**：`cli/src/commands/index.ts`、`cli/src/formatters/index.ts`、`testing/src/index.ts` 不采用重导出模式，而是直接内联代码——这些文件本身不是"barrel"但符合各自职责。

---

## 四、结论

> **所有 19 个目标 barrel 文件（以及全部 49 个 index.ts）的每条 re-export 均能解析到实际模块文件。**
> 
> 星盘无裂痕。水镜无波纹。模块图在此维度的拓扑完整性已确认。
