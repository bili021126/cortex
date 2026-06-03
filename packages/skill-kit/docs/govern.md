# 凝光审计报告：@cortex/skill-kit 包治理合规

**审计日期**：2026-07-30  
**审计人**：凝光（DocGovernAgent）  
**审计版本**：@cortex/skill-kit@0.1.0  
**审计范围**：package.json 字段与 exports 映射、目录结构合规性、公共 API 完整性、tsconfig.json 编译配置  
**参考基准**：`@cortex/shared`（monorepo 约定参考实现）、`tsconfig.base.json`、`docs/design.md`（设计契约）

---

## 审计摘要

| 审计维度 | 裁定 | 严重等级 |
|---------|:----:|:-------:|
| package.json 字段完整性 | ⚠️ 有条件通过 | 🟡 中 |
| exports 导出映射 | ⚠️ 有条件通过 | 🟡 中 |
| 目录结构合规性 | ✅ 通过 | 🟢 低 |
| 公共 API 完整性（vs 设计契约） | ❌ **未通过** | 🔴 **高** |
| tsconfig.json 编译配置 | ⚠️ 有条件通过 | 🟢 低 |

**综合裁定：⚠️ 有条件通过** — 目录结构达标，但公共 API 与设计契约存在严重偏离，需优先对齐。

---

## 1. package.json 字段审计

### 1.1 元信息字段

| 字段 | 当前值 | 合规 | 说明 |
|------|:------:|:----:|------|
| `name` | `@cortex/skill-kit` | ✅ | 符合 `@cortex/<pkg>` 命名约定 |
| `version` | `0.1.0` | ✅ | 语义化版本号 |
| `private` | `true` | ✅ | monorepo 内部包应设为 private，防止误发布 |
| `type` | `module` | ✅ | 统一 ESM 模块格式 |

### 1.2 入口字段

| 字段 | 当前值 | 合规 | 说明 |
|------|:------:|:----:|------|
| `main` | `./dist/index.js` | ✅ | 符合约定，指向构建后的入口 |
| `types` | `./dist/index.d.ts` | ✅ | 类型声明入口，与 main 对应 |
| `exports` | `{ ".": { types, import } }` | ⚠️ | 缺少 `require` 和 `default` 条件（见 §1.2.1） |

#### 1.2.1 exports 映射缺陷

当前 exports 仅定义了 `types` 和 `import` 两个条件。对比 `@cortex/shared` 的 exports：

```json
// @cortex/shared（参考实现）
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "require": "./dist/index.js",
    "default": "./dist/index.js"
  }
}

// @cortex/skill-kit（当前）
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
}
```

**影响**：缺少 `require` 条件意味着 CommonJS 消费者（如 Node.js 使用 `require()`）可能无法正确解析入口；缺少 `default` 条件可能在某些 bundler 或环境（如 Jest、Webpack 回退模式）中引发歧义。

**建议**：补充 `require` 和 `default` 条件，与 monorepo 其他包保持一致。

### 1.3 脚本字段

| 脚本 | 当前值 | 合规 | 说明 |
|:----:|:-------:|:----:|------|
| `build` | `tsc` | ✅ | TypeScript 编译构建 |
| `typecheck` | `tsc --noEmit` | ✅ | 类型检查（无输出） |
| `test` | `vitest run` | ✅ | 单元测试 |
| `test:watch` | `vitest` | ✅ | 监听模式测试 |

**与参考包对比发现的缺口**：

| 脚本/依赖 | `@cortex/shared` | `@cortex/cli` | `@cortex/skill-kit` | 建议 |
|:----------:|:----------------:|:-------------:|:-------------------:|:----:|
| `lint` | `eslint src/` | `eslint src/` | ❌ 缺失 | 添加 `"lint": "eslint src/"` |
| `eslint` devDep | `^10.3.0` | `^10.3.0` | ❌ 缺失 | 添加 `eslint` 到 devDependencies |

### 1.4 依赖声明

| 依赖 | 类型 | 合规 | 说明 |
|:----:|:----:|:----:|------|
| `@cortex/shared` | dependencies | ✅ | workspace 协议引用共享类型包，合理 |
| `@types/node` | devDependencies | ✅ | Node.js 类型定义 |
| `typescript` | devDependencies | ✅ | TypeScript 编译器 |
| `vitest` | devDependencies | ✅ | 测试框架 |

**依赖合理性评估**：当前依赖声明简洁且符合技能包的最小需求。`@cortex/shared` 作为唯一运行时依赖是合理的。

**建议**：暂无补充依赖的必要。未来若技能包需要运行时工具函数，应评估是否应放入 `@cortex/shared` 而非膨胀本包。

---

## 2. 目录结构审计

### 2.1 参考目录结构

依据 `docs/design.md` 附录 A 的设计约定，标准目录应为：

```
packages/skill-kit/
├── docs/
│   └── design.md
├── src/
│   ├── index.ts               ← 桶导出
│   ├── types.ts               ← 核心类型定义
│   ├── interfaces.ts          ← 接口定义
│   ├── loader/
│   ├── cache/
│   ├── validator/
│   ├── executor/
│   └── factory.ts
├── tests/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 2.2 实际目录结构

```
packages/skill-kit/
├── docs/
│   ├── design.md
│   └── test-report.md
├── src/
│   ├── index.ts
│   └── calculator.ts
├── tests/
│   └── calculator.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 2.3 结构审计结论

| 路径 | 当前状态 | 合规 | 说明 |
|:----:|:--------:|:----:|------|
| `src/` | 存在 | ✅ | 源文件目录 |
| `src/index.ts` | 存在 | ✅ | 桶导出入口 |
| `tests/` | 存在 | ✅ | 统一测试目录 |
| `vitest.config.ts` | 存在 | ✅ | Vitest 配置 |
| `docs/` | 存在 | ✅ | 文档目录 |

**目录结构通过审计**。当前结构满足 monorepo 基本约定。但对比设计契约，src 下的模块组织与设计预期存在较大差距（详见 §3）。

---

## 3. 公共 API 审计（核心发现）

### 3.1 设计契约定义的公共 API

根据 `docs/design.md`，`@cortex/skill-kit` 应导出一套完整的**技能开发工具包**，核心类型包括：

| 导出名称 | 类别 | 设计模块 | 预期职责 |
|:--------:|:----:|:---------|:---------|
| `SkillDefinition` | interface | `types.ts` | 技能定义核心契约（meta + execute + validateInput + onInit/onDestroy） |
| `SkillMeta` | interface | `types.ts` | 技能元信息（id, name, version, category, triggerTags, steps 等） |
| `SkillContext` | interface | `types.ts` | 技能执行上下文（input, env, signal, logger, store, traceId） |
| `SkillOutput` | type | `types.ts` | 技能执行结果（Result 模式：成功/失败联合类型） |
| `SkillCategory` | enum | `types.ts` | 技能分类枚举（DATA, NLP, TOOL, REASONING, MEMORY, COMMUNICATION, SYSTEM） |
| `SkillErrorCode` | enum | `types.ts` | 技能错误码枚举 |
| `SkillManifest` | interface | `types.ts` | JSON 技能清单格式 |
| `SkillLoader` | interface | `interfaces.ts` | 技能加载器（load, loadFromFile, register） |
| `SkillValidator` | interface | `interfaces.ts` | 技能校验器（validate, validateMeta, validateManifest） |
| `SkillExecutor` | interface | `interfaces.ts` | 技能执行器（execute — 执行管线） |
| `SkillCache` | interface | `interfaces.ts` | 技能缓存（get, set, evict, clear, stats） |
| `SkillFactory` | interface | `factory.ts` | 统一入口工厂（load, execute, validate, dispose） |

设计文档中的文件结构预期：
```
src/
├── index.ts               ← 桶导出
├── types.ts               ← 核心类型定义
├── interfaces.ts          ← 接口定义
├── loader/                ← 加载器实现
├── cache/                 ← 缓存实现
├── validator/             ← 校验器实现
├── executor/              ← 执行器实现
└── factory.ts             ← SkillFactory 实现
```

### 3.2 实际公共 API

`src/index.ts` 当前实际导出：

```typescript
export { Calculator, CalculatorOptions, RoundMode } from "./calculator.js";
```

实际模块结构：
```
src/
├── index.ts               ← 导出 Calculator
└── calculator.ts          ← Calculator 类 + CalculatorOptions + RoundMode
```

### 3.3 差距分析

| 维度 | 设计契约要求 | 实际状态 | 差距 |
|:----:|:-------------|:---------|:----:|
| **包定位** | 技能开发工具包（SkillDefinition / SkillLoader / SkillExecutor / SkillCache / SkillFactory） | 基础计算器工具（Calculator） | ❌ 核心定位偏离 |
| **导出类型数** | 12+ 个类型/接口/枚举/类 | 3 个 (Calculator, CalculatorOptions, RoundMode) | ❌ 严重不足 |
| **核心接口实现** | SkillDefinition, SkillExecutor, SkillLoader, SkillValidator, SkillCache, SkillFactory | 无 | ❌ 全部缺失 |
| **模块组织** | 分层模块（types / interfaces / loader / cache / validator / executor / factory） | 单文件（calculator.ts） | ❌ 未分层 |
| **桶导出覆盖** | 全部公开类型通过 index.ts 导出 | 仅导出 Calculator | ❌ 覆盖率低 |
| **可构建性** | tsc 可编译 | 当前可通过 `pnpm build` 构建 | ✅ |

### 3.4 风险等级

**严重等级：🔴 高**

当前实现与设计契约之间存在根本性偏离。`@cortex/skill-kit` 的命名（`skill-kit`）暗示其应提供技能开发相关的工具，但实际提供的是一个与技能系统无关的 `Calculator` 计算器。这会导致：

1. **消费者困惑**：引用 `@cortex/skill-kit` 的包（如 `@cortex/engine`）期望的是技能定义/加载/执行能力，但只能获得一个计算器
2. **设计债务**：`docs/design.md` 中详细设计了完整的技能工具包接口，但代码未按设计实现，设计与实现脱节
3. **集成阻塞**：依赖技能工具包能力的模块（如技能注册表、技能执行管线）无法接入

### 3.5 建议

**P0 — 立即修复**：
1. 按 `docs/design.md` 的设计实现完整的技能工具包：
   - 创建 `src/types.ts`, `src/interfaces.ts`, `src/factory.ts`
   - 创建 `src/loader/`, `src/cache/`, `src/validator/`, `src/executor/` 目录及实现
   - 在 `src/index.ts` 中导出所有公共类型
2. 将 `Calculator` 模块作为独立工具保留，但不应是包的主要导出。可考虑：
   - 将 Calculator 移至独立的 `@cortex/calculator` 包
   - 或在 `src/utils/calculator.ts` 中保留，通过 `@cortex/skill-kit/utils` 子路径导出

**P2 — 建议优化**：
3. 更新 `docs/design.md` 使其与实际实现保持同步（如果设计变更已通过决策）或修复实现使其符合设计

---

## 4. tsconfig.json 编译配置审计

### 4.1 继承链

| 配置 | 当前值 | 合规 | 说明 |
|:----:|:------:|:----:|------|
| `extends` | `../../tsconfig.base.json` | ✅ | 正确继承根 tsconfig.base.json，统一编译基线 |

### 4.2 compilerOptions

| 选项 | 当前值 | 合规 | 说明 |
|:----:|:------:|:----:|------|
| `outDir` | `./dist` | ✅ | 符合约定，与 package.json 的 main/types 路径一致 |
| `rootDir` | `./src` | ✅ | 符合约定，src 目录已存在 |

### 4.3 include / exclude

| 配置 | 当前值 | 合规 | 说明 |
|:----:|:------:|:----:|------|
| `include` | `["src"]` | ✅ | 正确指向源文件目录 |
| `exclude` | 未设置 | ⚠️ | 缺少排除配置 |

**问题**：未设置 `exclude`。参考 `@cortex/shared` 的 tsconfig：

```json
// @cortex/shared
"exclude": ["src/__tests__"]
```

Shared 包显式排除了 `src/__tests__`，以防止测试文件被编译至 `dist/`。虽然 skill-kit 当前测试放在 `tests/` 目录下（这是正确的做法），但添加此排除项可以：
- 与 monorepo 约定保持一致
- 防止未来误将测试文件放在 src 下时污染 dist
- 显式声明"测试不应存在于 src 下"的设计意图

### 4.4 配置可执行性

```bash
# 执行 tsc 编译：
> tsc
# 应能正常编译 src/index.ts 和 src/calculator.ts 至 dist/
```

**验证**：`src/` 目录存在且包含有效的 TypeScript 文件，`tsconfig.json` 配置正确，继承的 `tsconfig.base.json` 包含了必要的 strict 选项。配置可直接使用。

---

## 5. 综合风险评估

| 风险 ID | 风险描述 | 等级 | 影响范围 | 修复优先级 |
|:-------:|:---------|:----:|:---------|:----------:|
| R1 | 公共 API 与设计契约严重偏离 — 包定位错误 | 🔴 高 | 消费者、架构一致性 | **P0** |
| R2 | exports 缺少 require/default 条件 — 兼容性风险 | 🟡 中等 | 部分消费者场景 | **P1** |
| R3 | 缺少 lint 脚本和 eslint 配置 — 代码质量门禁缺失 | 🟡 中等 | 开发质量、CI | **P1** |
| R4 | tsconfig 缺少 exclude — 潜在 dist 污染 | 🟢 低 | 构建产物 | **P2** |

---

## 6. 修复建议（按优先级排序）

### P0 — 架构对齐（必须修复）

1. **[🔴] 按设计契约实现技能工具包**
   - 根据 `docs/design.md` 实现 `SkillDefinition`, `SkillMeta`, `SkillContext`, `SkillOutput`, `SkillCategory`, `SkillErrorCode`, `SkillManifest` 等核心类型
   - 实现 `SkillLoader`, `SkillValidator`, `SkillExecutor`, `SkillCache` 接口
   - 实现 `SkillFactory` 统一入口
   - 更新 `src/index.ts` 桶导出所有公共 API

2. **[🔴] 解决 Calculator 定位**
   - Calculator 不应是 `@cortex/skill-kit` 的主要导出物
   - 方案A：将 Calculator 迁移至独立包 `@cortex/calculator`
   - 方案B：保留在 `src/utils/` 下，通过子路径导出（如 `@cortex/skill-kit/utils`）

### P1 — 质量基础设施

3. **[🟡] 补充 exports 映射**
   - 添加 `require` 和 `default` 条件，与 `@cortex/shared` 保持一致

4. **[🟡] 补充 lint 配置**
   - 添加 `"lint": "eslint src/"` 到 scripts
   - 添加 `"eslint": "^10.3.0"` 到 devDependencies

### P2 — 建议优化

5. **[🟢] 补充 tsconfig exclude**
   - 添加 `"exclude": ["src/__tests__"]` 与 monorepo 约定对齐

6. **[🟢] 考虑补充 `files` 字段**
   - 添加 `"files": ["dist"]` 以明确发布内容（private 包可选）

---

## 7. 裁定

| 审计维度 | 裁定 | 判据 |
|:---------|:----:|:-----|
| **package.json 字段完整性** | ⚠️ 有条件通过 | 基础字段完整；exports 需补充 require/default；缺少 lint 脚本 |
| **exports 导出映射** | ⚠️ 有条件通过 | 结构正确但条件不完整；修复后可通过 |
| **目录结构合规性** | ✅ **通过** | src/、tests/、vitest.config.ts、docs/ 均存在，符合 monorepo 约定 |
| **公共 API 完整性** | ❌ **未通过** | 实际导出 (Calculator) 与设计契约 (SkillDefinition/SkillExecutor/SkillFactory 等) 严重偏离 |
| **tsconfig.json 编译配置** | ⚠️ 有条件通过 | 配置语法正确且符合约定；缺少 exclude 配置 |

**综合裁定：⚠️ 有条件通过**（需完成 P0 修复后重新审计）

**强制修复条件**：
1. 实现技能工具包核心类型和接口，与 `docs/design.md` 设计契约对齐
2. 解决 Calculator 定位问题，确保包名 `@cortex/skill-kit` 与其实际功能一致

---

## 8. 判例登记

| 判例 ID | 发现日期 | 缺口类型 | 严重等级 | 说明 |
|:-------:|:--------:|:---------|:-------:|:-----|
| NG-2026-0730-API-Deviation | 2026-07-30 | 设计-实现偏离 | 🔴 高 | 实际导出 (Calculator) 与设计契约 (SkillDefinition 等) 不一致 |
| NG-2026-0730-Export-Incomplete | 2026-07-30 | 导出映射不完善 | 🟡 中 | exports 缺少 require/default 条件 |
| NG-2026-0730-Lint-Missing | 2026-07-30 | 质量门禁缺失 | 🟡 中 | 缺少 lint 脚本和 eslint 依赖 |
| NG-2026-0730-Exclude-Missing | 2026-07-30 | 编译配置不完整 | 🟢 低 | tsconfig 缺少 exclude 配置 |

---

*审计报告结束。判例已登记至 doc-govern/ 系统，供后续审计追溯。*
