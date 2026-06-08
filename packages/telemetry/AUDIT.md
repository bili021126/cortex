# @cortex/telemetry 包审计报告

> **审计日期**: 2026-05-31  
> **审计版本**: v0.1.0  
> **审计范围**: 包定位、依赖声明、宪法合规、文件结构、代码质量  

---

## 目录

1. [审计概要](#1-审计概要)
2. [PACKAGE_POSITIONING.md 检查](#2-package_positioningmd-检查)
3. [包名与依赖声明检查](#3-包名与依赖声明检查)
4. [宪法规则遵守情况](#4-宪法规则遵守情况)
5. [文件结构与组织](#5-文件结构与组织)
6. [测试与构建状态](#6-测试与构建状态)
7. [问题清单与修复建议](#7-问题清单与修复建议)

---

## 1. 审计概要

| 维度 | 评级 | 说明 |
|------|------|------|
| **定位文档** | ⚠️ 基本合格 | 回答了 "Why + What"，但 "Value" 可更直接 |
| **包名与依赖** | ⚠️ 需补充 | 无 `workspace:*` 依赖，缺少对 `@cortex/shared` 和 `@cortex/config` 的声明 |
| **宪法合规** | ⚠️ 2 项违规 | 导入顺序违规（batcher.ts）；JSDoc 花括号语法导致构建失败 |
| **文件结构** | ✅ 合格 | 结构清晰，命名规范，符合 barrel 铁律 |
| **测试覆盖** | ✅ 良好 | 单元测试全面，但构建失败导致测试无法运行 |
| **代码质量** | ⚠️ 需修复 | JSDoc 中的花括号导致 esbuild 解析失败 |

---

## 2. PACKAGE_POSITIONING.md 检查

### 2.1 三个经典问题回答情况

| 问题 | 是否回答 | 位置 | 评价 |
|------|---------|------|------|
| **为什么需要（Why）** | ✅ 是 | §一 "为什么需要 @cortex/telemetry？" | 通过六维缺口矩阵清晰展示了现有体系的可观测性缺口，数据充分 |
| **定位是什么（What）** | ✅ 是 | §二 "本包的定位" | 一句话定位明确，三层架构图清晰，与类似包的边界对比表有价值 |
| **价值在哪里（Value）** | ⚠️ 隐式回答 | §三 "本包补足的'缺失领域'" | 通过缺失领域描述间接说明价值，但缺少独立的"价值"章节直接阐述收益 |

### 2.2 评价

**优势**：
- 缺口矩阵数据详实，基于母项目 17+ 包的审查结果
- 定位图清晰展示了本包在 Cortex 可观测性三层架构中的位置
- 与 `@cortex/shared` / `@cortex/notification` / `@cortex/doctor` 的边界对比表准确且有区分度

**不足**：
- 缺少独立的"价值"章节（DESIGN.md 中有 Q3 "价值在哪里？"，但 PACKAGE_POSITIONING.md 没有对应的直接阐述）
- §三 的标题是"本包补足的'缺失领域'"，侧重"填补了什么"而非"带来了什么收益"
- "快速开始"示例代码引用了 `RateSampler`、`ThresholdSampler`、`SizeBatcher`、`TimeBatcher` 等未在 PACKAGE_POSITIONING.md 正文中详细说明的组件，存在断层

**结论**：基本回答了三个问题，但"价值"部分建议强化——直接从开发者体验和架构收益两个维度阐述本包带来的具体改善。

---

## 3. 包名与依赖声明检查

### 3.1 包名

```json
{
  "name": "@cortex/telemetry",
  "version": "0.1.0",
  "private": true
}
```

| 检查项 | 结果 | 说明 |
|-------|------|------|
| 命名空间 | ✅ 符合 | `@cortex/*` 命名空间正确 |
| 版本号 | ✅ 合理 | v0.1.0 为初始开发版本 |
| `private` | ✅ 正确 | monorepo 内部包应设为 private |

### 3.2 依赖声明

```json
{
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

| 检查项 | 结果 | 说明 |
|-------|------|------|
| **运行时依赖** | ⚠️ 空 | 当前实现仅使用 Node.js 内置 API，零外部运行时依赖合理。但 DESIGN.md 指出应依赖 `@cortex/shared`（ObservableEvent 等类型）和 `@cortex/config`（TelemetryConfig），当前实现未使用这些类型 |
| **`@cortex/shared` 声明** | ❌ 缺失 | DESIGN.md 明确列出依赖 `@cortex/shared`，但 package.json 未声明。虽然当前 Collector 层未直接使用，但这是设计文档和实际依赖的不一致 |
| **`@cortex/config` 声明** | ❌ 缺失 | 同上 |
| **`workspace:*` 协议** | ❌ 未使用 | 即使后期添加 `@cortex/*` 依赖，也需使用 `workspace:*` 协议确保 monorepo 本地链接。当前无 workspace 依赖，合规 |
| **TypeScript 版本** | ✅ 合理 | `^5.7.0` 与母项目对齐 |
| **Vitest 版本** | ✅ 合理 | `^2.1.0` 与母项目对齐 |

### 3.3 导出声明

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js",
      "default": "./dist/index.js"
    }
  }
}
```

| 检查项 | 结果 | 说明 |
|-------|------|------|
| main/types | ✅ 正确 | 指向 dist/index |
| exports 字段 | ✅ 完整 | 同时支持 import 和 require，types 条件导出正确 |
| 缺少 package.json exports | ⚠️ 无子路径导出 | 当前无需子路径导出，但未来若模块增多可考虑 |

---

## 4. 宪法规则遵守情况

### 4.1 §四 — Barrel 铁律

| 规则 | 状态 | 说明 |
|------|------|------|
| `src/index.ts` 统一导出 | ✅ 合规 | 所有公开符号在 `src/index.ts` 中通过 `export { ... } from "./xxx.js"` 统一导出 |
| 测试文件使用 barrel 导入 | ⚠️ 合规 | 测试文件从 `../src/index.js` 导入，而非 `../src/xxx` 直接导入文件。但更推荐的实践是使用包名 `import { X } from "@cortex/telemetry"` |
| 新增公开符号更新 barrel | ✅ 合规 | 所有实现文件已在 index.ts 中导出 |

### 4.2 §五 — 禁止裸 console.*

| 规则 | 状态 | 说明 |
|------|------|------|
| 禁止裸 console.warn/error | ✅ 合规 | 项目中无裸 console.warn/error。`ConsoleCollector` 使用 `console.log` 并添加了 `// eslint-disable-next-line no-console` 注释 |
| 集中管理控制台输出 | ✅ 合规 | 所有控制台输出通过 `ConsoleCollector` 统一管理 |

### 4.3 §七 — 硬编码禁令

| 规则 | 状态 | 说明 |
|------|------|------|
| 魔法数字 | ✅ 合规 | 无非阈值、超时等魔法数字硬编码 |
| 路径字面量 | ✅ 合规 | `FileCollector` 的文件路径通过构造函数参数传入，未硬编码 |
| 环境变量名 | ✅ 合规 | 无相关使用 |
| 默认值集中管理 | ⚠️ 可改进 | `ConsoleCollector` 的默认 name="console"、`FileCollector` 的默认 name="file" 直接写在参数默认值中。建议抽离到 `defaults.ts` 统一管理 |

### 4.4 §九 — 内部明细化 + 外部具体化

| 规则 | 状态 | 说明 |
|------|------|------|
| 数据流路径可追踪 | ✅ 合规 | Collector 数据流：`collect()` → `Buffer` → `flush()` → 文件/控制台，清晰可追踪 |
| 外部接口最小化 | ✅ 合规 | `ITelemetryCollector` 只有 3 个方法（collect/flush/shutdown），承诺极薄 |
| 接口语义明确 | ✅ 合规 | 接口命名反映"做什么"（ITelemetryCollector / Sampler / Batcher） |
| 禁止瑞士军刀接口 | ✅ 合规 | ITelemetryCollector / ICollectorRegistry / Sampler / Batcher 各司其职 |

### 4.5 §十 — 代码规范深度约束

| 规则 | 状态 | 说明 |
|------|------|------|
| 非空断言 `!` | ✅ 合规 | 源代码中未发现 `!` 非空断言 |
| any 类型泄漏 | ✅ 合规 | 公开 API 使用具体类型，`metadata` 使用 `Record<string, unknown>`（非 any） |
| 死代码保留 | ✅ 合规 | 无废弃代码 |
| 参数命名一致 | ✅ 合规 | 命名风格统一 |

### 4.6 §十一 — 方法与函数设计规范

| 规则 | 状态 | 说明 |
|------|------|------|
| 返回类型显式声明 | ✅ 合规 | 全部公开方法显式声明返回类型 |
| 必选参数在前 | ✅ 合规 | `FileCollector(filePath, name?, options?)` — filePath 必选在前 |
| 禁止 boolean trap | ✅ 合规 | 使用 options 对象（如 `ConsoleCollectorOptions`）而非布尔位置参数 |
| 方法体不超过 30 行 | ⚠️ 部分合规 | `_serializeBatch` 等方法体较短；`_formatPretty` 约 10 行，合理 |
| 参数数量限制 | ✅ 合规 | 最多 3 个位置参数 |

### 4.7 §十二 — 导入路径与模块组织

| 规则 | 状态 | 说明 |
|------|------|------|
| 导入排序 | ❌ **违规** | **`batcher.ts`** 中导入顺序错误：`./types.js`（同包相对导入）排在 `crypto`（Node 内置）之前。正确顺序应为 `crypto` → `./types.js` |
| 类型导入分离 | ✅ 合规 | 仅类型导入使用 `import type` |
| 副作用导入标注 | ✅ 合规 | 无副作用导入 |
| 文件名 kebab-case | ✅ 合规 | 所有文件使用 kebab-case 命名 |
| 类名/文件名一致 | ✅ 合规 | `ConsoleCollector` → `console-collector.ts` |

**违规详情** — `batcher.ts` 导入排序：
```typescript
// 当前（违规）：
import type { Batcher, TelemetryData, TelemetryBatch } from "./types.js";
import { randomUUID } from "crypto";

// 正确顺序：
import { randomUUID } from "crypto";
import type { Batcher, TelemetryData, TelemetryBatch } from "./types.js";
```

### 4.8 §十三 — 接口与类型设计

| 规则 | 状态 | 说明 |
|------|------|------|
| 接口隔离（ISP） | ✅ 合规 | ITelemetryCollector（3 方法）/ ICollectorRegistry（6 方法）/ Sampler（1 方法）/ Batcher（4 方法）均不超过 8 方法限制 |
| Discriminated Union | ✅ 合规 | `FileCollectorOptions.mode` 使用 `"append" | "overwrite"` 字面量联合 |
| readonly 优先 | ✅ 合规 | `TelemetryData`、`TelemetryBatch`、`CollectResult`、`SamplerDecision` 等共享数据结构字段均为 `readonly` |
| type vs interface | ✅ 合规 | 对象形状使用 `interface`，函数签名使用 `type` |

### 4.9 §十四 — 设计模式约定

| 模式 | 状态 | 说明 |
|------|------|------|
| **Adapter** | ✅ 合规 | `ConsoleCollector` / `FileCollector` 适配同一 `ITelemetryCollector` 接口 |
| **Factory** | ✅ 合规 | `CollectorRegistry.registerFactory()` 实现惰性初始化工厂模式 |
| **Strategy** | ✅ 合规 | `Sampler` 策略接口 + `RateSampler` / `ThresholdSampler` 实现；`Batcher` 策略接口 + `SizeBatcher` / `TimeBatcher` 实现 |
| **Observer** | ✅ 不适用 | 当前实现未涉及 Observer 模式 |

### 4.10 CI 标注

| 检查项 | 结果 | 说明 |
|-------|------|------|
| 测试文件 CI 标注 | ✅ 合规 | 所有测试文件头部包含 `// @ci: unit` 标注 |
| 源文件 CI 标注 | ⚠️ 缺失 | `src/index.ts` 和部分源文件头部有模块说明和宪法一致性注释，但缺少 `@ci: unit | integration` 标注。非强制但建议补充 |

---

## 5. 文件结构与组织

### 5.1 目录结构

```
packages/telemetry/
├── DESIGN.md                          ✅ 设计文档（完整但范围远超当前实现）
├── PACKAGE_POSITIONING.md             ✅ 定位文档
├── package.json                       ✅
├── tsconfig.json                      ✅ 继承 tsconfig.base.json
├── vitest.config.ts                   ✅
├── src/
│   ├── index.ts                       ✅ barrel 导出
│   ├── types.ts                       ✅ 核心类型定义
│   ├── console-collector.ts           ✅ ConsoleCollector
│   ├── file-collector.ts              ✅ FileCollector
│   ├── collector-registry.ts          ✅ CollectorRegistry
│   ├── sampler.ts                     ✅ RateSampler + ThresholdSampler
│   └── batcher.ts                     ✅ SizeBatcher + TimeBatcher
├── tests/
│   ├── console-collector.test.ts      ✅
│   ├── file-collector.test.ts         ✅
│   ├── collector-registry.test.ts     ✅
│   ├── sampler.test.ts                ✅
│   └── batcher.test.ts                ✅
├── err.txt                            ❌ 测试失败日志（应清理）
└── err2.txt                           ❌ 测试失败日志（应清理）
```

### 5.2 评价

| 维度 | 结果 | 说明 |
|------|------|------|
| 文件命名 | ✅ kebab-case | 全部文件符合 §十二 命名规范 |
| 每层文件数 | ✅ < 10 | src/ 层 7 个文件，tests/ 层 5 个文件 |
| 测试目录结构 | ✅ 扁平 | 当前规模下扁平结构合理 |
| 错误日志文件 | ❌ 应清理 | `err.txt` 和 `err2.txt` 是构建失败的日志转储，不应提交到版本控制 |

---

## 6. 测试与构建状态

### 6.1 测试情况

| 测试文件 | 状态 | 说明 |
|---------|------|------|
| `console-collector.test.ts` | ❌ 失败 | 非逻辑错误，esbuild 解析 JSDoc 花括号失败 |
| `file-collector.test.ts` | ❌ 失败 | 同上 |
| `collector-registry.test.ts` | ❌ 失败 | 同上 |
| `sampler.test.ts` | ❌ 失败 | 同上 |
| `batcher.test.ts` | ❌ 失败 | 同上 |

### 6.2 构建失败根因

**错误位置**：
- `src/sampler.ts:27` — JSDoc 注释中的 `if (decision.accept) { /* collect */ }` 花括号被 esbuild 错误解析
- `src/batcher.ts:24` — JSDoc 注释中的 `if (batch) { /* 发送/写入批次 */ }` 花括号被 esbuild 错误解析

**根因**：esbuild 在转换 JSDoc 注释时，注释块内的花括号 `{ }` 被解释为代码块。这通常发生在注释中存在未转义的花括号时。

**解决方案**：将 JSDoc 示例代码中的花括号用反引号包裹，或移除示例代码中的花括号。

### 6.3 测试逻辑质量

尽管构建失败，从测试代码本身来看：
- 测试覆盖全面：构造函数、collect、flush、shutdown、边缘情况均覆盖
- 测试隔离良好：每个测试独立创建 collector
- Mock 使用恰当：console-collector 使用 vi.spyOn mock console.log
- 文件操作测试自动清理：afterEach 删除临时目录

---

## 7. 问题清单与修复建议

### P0 — 构建阻断

| # | 问题 | 文件 | 严重度 | 修复建议 |
|---|------|------|--------|---------|
| 1 | JSDoc 花括号被 esbuild 误解析 | `src/sampler.ts:27` | 🔴 P0 | 将示例代码中的 `{ /* collect */ }` 改为反引号包裹：`` `if (decision.accept) { /* collect */ }` `` |
| 2 | JSDoc 花括号被 esbuild 误解析 | `src/batcher.ts:24` | 🔴 P0 | 同上，将 `{ /* 发送/写入批次 */ }` 用反引号包裹 |

### P1 — 重要但不阻断

| # | 问题 | 文件 | 严重度 | 修复建议 |
|---|------|------|--------|---------|
| 3 | 导入排序违规 | `src/batcher.ts` | 🟡 P1 | 将 `import { randomUUID } from "crypto"` 移到 `import type { ... } from "./types.js"` 之前 |
| 4 | 缺少对 `@cortex/shared` 的依赖声明 | `package.json` | 🟡 P1 | 添加 `"@cortex/shared": "workspace:*"` 到依赖（当前实现未使用，但 DESIGN.md 声明了依赖关系。如果当前实现确实不依赖 shared，则标记为"已知偏差"并记录到 DESIGN.md） |
| 5 | 缺少对 `@cortex/config` 的依赖声明 | `package.json` | 🟡 P1 | 同上 |
| 6 | 错误日志文件未清理 | `err.txt`, `err2.txt` | 🟡 P1 | 删除这两个文件，并添加到 `.gitignore` |

### P2 — 建议改进

| # | 问题 | 文件 | 严重度 | 修复建议 |
|---|------|------|--------|---------|
| 7 | PACKAGE_POSITIONING.md 缺少独立"价值"章节 | `PACKAGE_POSITIONING.md` | 🟢 P2 | 新增 §三 "价值在哪里"，从开发者体验和架构收益两个维度阐述 |
| 8 | 默认值未集中管理 | `console-collector.ts`, `file-collector.ts` | 🟢 P2 | 建议创建 `src/defaults.ts`，统一管理默认 name、默认格式等常量 |
| 9 | 测试文件使用相对导入而非包名 | 所有测试文件 | 🟢 P2 | 考虑改为 `import { X } from "@cortex/telemetry"`（需确保测试环境能解析包名） |
| 10 | 源文件缺少 CI 标注 | `src/` 下源文件 | 🟢 P2 | 建议在文件头部添加 `// @ci: unit` 标注，便于 CI 工具识别 |
| 11 | DESIGN.md 与实现范围不一致 | `DESIGN.md` | 🟢 P2 | 在 DESIGN.md 头部注明"本文档覆盖 Phase 1-4 完整设计，当前实现仅包含 Phase 1 采集层" |

---

## 总结

**总体评级：⚠️ 条件通过**

| 维度 | 评分 | 关键发现 |
|------|------|---------|
| 定位文档 | ⭐⭐⭐⭐ | 回答了 Why + What，Value 可更直接 |
| 包管理 | ⭐⭐⭐ | 包名正确，但缺少 workspace 依赖声明 |
| 宪法合规 | ⭐⭐⭐⭐⭐ | 仅 2 项违规（导入顺序 + JSDoc 语法），其余全部合规 |
| 代码质量 | ⭐⭐⭐⭐⭐ | 接口设计优秀，接口隔离、readonly、模式应用均到位 |
| 构建状态 | ❌ 不可用 | 2 个 P0 级 JSDoc 语法问题阻断构建 |

**优先修复 P0（JSDoc 花括号）以恢复构建**，然后解决 P1 问题（导入顺序、依赖声明、清理错误日志）。整体包的架构设计质量高，宪法合规意识强，修复后即可达到发布标准。

---

*审计结束。本报告基于 packages/telemetry/ 目录下全部文件内容、宪法 coding-standards.md 规则以及母项目 monorepo 结构分析得出。*
