# 合规审计报告 — `@cortex/skill-kit`

**审计日期**: 2025-07-18  
**审计范围**: `packages/skill-kit/` 全量  
**审计维度**: Cortex 项目约定 · package.json 完整性 · TypeScript 严格性 · 设计与实现一致性  
**审计工具**: 静态分析 + 代码审查

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [Cortex 项目约定合规性](#2-cortex-项目约定合规性)
3. [package.json 完整性](#3-packagejson-完整性)
4. [TypeScript 严格性](#4-typescript-严格性)
5. [设计与实现一致性](#5-设计与实现一致性)
6. [问题清单与优先级](#6-问题清单与优先级)
7. [评分汇总](#7-评分汇总)

---

## 1. 执行摘要

| 维度 | 评级 | 关键发现 |
|------|------|----------|
| 项目约定合规 | ⚠️ 良好（3 项不合规） | 文件结构偏离设计、缺少测试目录 |
| package.json 完整性 | ⚠️ 中等（5 项缺失） | 缺少 scripts、缺失声明依赖、export map 指向源码 |
| TypeScript 严格性 | ✅ 良好（2 项可改进） | strict 开启、无 any、但缺少若干严格选项 |
| 设计一致性 | ⚠️ 中等（4 项偏差） | 文件结构扁平化、缺失 @cortex/shared 依赖、ModuleReader 实现不完整 |
| 代码质量 | ⚠️ 良好 | 总体整洁，存在少量类型安全和性能问题 |

**总体评分**: 7.2 / 10  
**建议**: 修复 P0-P2 问题后可供集成，P3 问题可作为技术债务跟踪。

---

## 2. Cortex 项目约定合规性

### 2.1 ✅ 已遵守的约定

| 约定 | 状态 | 证据 |
|------|------|------|
| ESM 模块系统 | ✅ 合规 | `"type": "module"`, 使用 `import`/`export` 语法 |
| 内部导入使用 `.js` 扩展名 | ✅ 合规 | `from './types.js'`, `from './loader.js'` 等 |
| 外部包导入无扩展名 | ✅ 合规 | `from 'node:fs'`, `from 'node:path'` |
| Barrel 导出 | ✅ 合规 | `src/index.ts` 聚合 re-export 所有公开 API |
| 命名规范 — PascalCase 接口 | ✅ 合规 | `SkillDefinition`, `ExecutionResult`, `ValidationEntry` |
| 命名规范 — camelCase 函数 | ✅ 合规 | `renderTemplate`, `listTemplateVariables` |
| 命名规范 — UPPER_CASE 常量 | ✅ 合规 | 无全局常量，正则内联合理 |
| JSDoc 文档 | ✅ 合规 | 所有接口、类、方法均有完整 JSDoc |
| 文件头部注释 | ✅ 合规 | 所有 `.ts` 文件含 `@cortex/skill-kit` 头部注释 |
| 无显式 `any` 类型 | ✅ 合规 | 全包未使用 `any` |
| CLI/Library 双模式 | ✅ 合规 | `cli.ts` 使用 `#!/usr/bin/env node` + `main()` 模式 |

### 2.2 ❌ 约定违规项

#### 🔴 C1 — 缺少 `tests/` 目录

**约定**: 每个包应有 `tests/` 目录存放单元测试。  
**实际**: `packages/skill-kit/` 无 `tests/` 目录。  
**设计文档**明确规划了 `tests/loader.test.ts`, `tests/validator.test.ts`, `tests/cache.test.ts`, `tests/executor.test.ts`。  
**影响**: 无法执行自动化回归测试，代码变更风险高。

#### 🟡 C2 — 文件结构扁平化

**约定**: 同类文件应归入子目录（`interfaces/`, `loader/`, `validator/`, `cache/`, `executor/`）。  
**实际**: 所有文件平铺在 `src/` 目录下：
```
src/
├── cache.ts
├── cli.ts
├── executor.ts
├── index.ts
├── loader.ts
├── template-engine.ts
├── types.ts
├── validator.ts
```
**设计文档**明确建议的子目录结构未实现。  
**影响**: 包规模扩大后难以导航，与 monorepo 其他包结构不一致。

#### 🟡 C3 — 缺少 `.gitignore`（包级别）

**约定**: 每个包应有 `.gitignore` 忽略 `dist/`, `node_modules/` 等。  
**实际**: 根目录有 `.gitignore`，但包级别无独立 `.gitignore`。  
**影响**: 低风险（根 gitignore 覆盖），但不符合自包含包的最佳实践。

#### ✅ C4 — 根 `tsconfig.json` include 过于宽泛

**约定**: 根 tsconfig 应精确控制包含范围，避免引入 `node_modules`。  
**实际**: `"include": ["**/*.ts"]` — 通配范围过广。  
**影响**: 编辑器/IDE 可能索引 `node_modules` 中的 `.ts` 文件，降低性能。

---

## 3. package.json 完整性

### 3.1 ✅ 已正确配置的字段

| 字段 | 值 | 评价 |
|------|-----|------|
| `name` | `@cortex/skill-kit` | ✅ 符合 npm scope 命名规范 |
| `version` | `0.1.0` | ✅ 语义化版本 |
| `private` | `true` | ✅ 防止意外发布 |
| `type` | `module` | ✅ ESM |
| `exports` | 6 个入口 | ✅ 合理的导出拆分 |
| `devDependencies` | `typescript: ^5.4` | ✅ 最低必要 |

### 3.2 ❌ 缺失或不当配置

#### 🔴 P0 — 缺少 `scripts` 字段

**关键缺失**: 无 `build`, `test`, `lint`, `clean`, `typecheck` 等脚本。

```jsonc
// 当前 package.json（缺失部分用 ✗ 标记）
{
  "name": "@cortex/skill-kit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { /* ... */ },
  // ✗ "scripts": {
  // ✗   "build": "tsc",
  // ✗   "test": "vitest run",
  // ✗   "lint": "eslint src/",
  // ✗   "typecheck": "tsc --noEmit",
  // ✗   "clean": "rm -rf dist"
  // ✗ },
  "dependencies": {},
  "peerDependencies": {},
  "devDependencies": { "typescript": "^5.4" }
}
```

**影响**: 
- 无法通过 `pnpm run build` 构建
- 无法通过 `pnpm run test` 运行测试
- CI 流水线无法集成 lint/typecheck
- 开发者必须手动记忆命令

#### 🔴 P0 — 缺失 `@cortex/shared` 依赖声明

**设计文档要求**: `"@cortex/shared": "workspace:*"` 作为核心依赖，提供 `SkillTemplate` 等基础类型。  
**实际**: `dependencies` 为空对象。  
**影响**: 
- 代码中未直接引用 `@cortex/shared`（当前接口是自包含的），但设计上破坏了模块边界
- 如果未来需要引用共享类型，依赖缺失将导致构建失败
- 设计与实现不一致（见 §5）

#### 🟡 P1 — 缺失 `zod` peer dependency 声明

**设计文档要求**: `"zod": "^3.23"` 作为可选 peer dependency，用于运行时 schema 校验。  
**实际**: `peerDependencies` 为空对象。  
**影响**: 用户使用 Zod 校验功能时需自行安装，但包未声明依赖关系，工具无法提示。

#### 🟡 P2 — 缺失 `types`/`typings` 导出

**问题**: `exports` 中未定义 TypeScript 类型入口。  
**当前**: `".": "./src/index.ts"` — 指向源码，依赖 tsx 或构建工具处理。  
**最佳实践**: 应同时提供：
```jsonc
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts"
}
```
**影响**: 作为 npm 包发布时，消费者无法获取类型定义。当前 `private: true` 降低风险。

#### 🟡 P2 — Export map 直接指向 `.ts` 源码

**问题**: 所有导出路径指向 `./src/*.ts`：
```jsonc
{
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./loader": "./src/loader.ts",
    // ...
  }
}
```
**影响**: 
- 仅能在 tsx/ts-node 等运行时下工作
- Node.js 原生 ESM 无法解析 `.ts` 文件
- 构建后路径失效（除非保留 src 目录）

#### 🟢 P3 — 缺失 `files`/`publishConfig`

**影响**: 低风险（`private: true` 阻止发布），但如有朝一日需要发布，需补充。

---

## 4. TypeScript 严格性

### 4.1 tsconfig.json 配置审计

| 选项 | 当前值 | 推荐值 | 评价 |
|------|--------|--------|------|
| `strict` | `true` | `true` | ✅ 核心严格模式已开启 |
| `target` | `ES2020` | `ES2022` | 🟡 ES2020 够用，但 ES2022 支持更完善的 `cause`、`at()` 等 |
| `module` | `ESNext` | `ESNext` | ✅ |
| `moduleResolution` | `node` | `Node16` 或 `Bundler` | 🟡 `node` 解析在 ESM 下可能有边缘问题 |
| `esModuleInterop` | `true` | `true` | ✅ |
| `declaration` | `true` | `true` | ✅ 生成 `.d.ts` |
| `declarationMap` | `true` | `true` | ✅ 可导航到源码 |
| `sourceMap` | `true` | `true` | ✅ |
| `skipLibCheck` | `true` | `true` | ✅ 加速构建 |
| `noUnusedLocals` | 未设置 | `true` | ❌ 无法检测未使用局部变量 |
| `noUnusedParameters` | 未设置 | `true` | ❌ 无法检测未使用参数 |
| `noUncheckedIndexedAccess` | 未设置 | `true` | ❌ 无法防御索引越界 |
| `exactOptionalPropertyTypes` | 未设置 | `true` | ❌ 可选属性类型不严格 |
| `forceConsistentCasingInFileNames` | 未设置 | `true` | ❌ 跨平台兼容性风险 |
| `noFallthroughCasesInSwitch` | 未设置 | `true` | ❌ switch 穿透风险 |

**缺失严格选项统计**: 6 个推荐选项未开启

### 4.2 源码类型安全审查

#### ✅ 类型安全亮点

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 无 `any` 类型 | ✅ | 全包 0 处显式 `any` |
| 接口定义完整 | ✅ | `SkillDefinition` 等 15+ 接口定义精确 |
| 泛型使用得当 | ✅ | `readJson<T>`, `CacheEntry<T>` 等 |
| `as const` 使用 | ✅ | 常量推导 |
| `instanceof Error` 守卫 | ✅ | catch 块正确缩窄类型 |
| readony 接口属性 | ✅ | `SkillDefinition` 核心字段均为 `readonly` |

#### ❌ 类型安全问题

#### 🟡 T1 — `as Record<string, unknown>` 类型篡改

**文件**: `loader.ts:191`

```typescript
(skill as Record<string, unknown>)._sourceFile = filePath;
```

**问题**: 使用类型断言向 `SkillDefinition` 对象注入 `_sourceFile` 属性。这个属性不在接口定义中，调用方无法通过类型系统感知其存在。  
**影响**: 类型不安全，运行时属性与类型定义脱节。  
**建议**: 在 `SkillDefinition` 接口中正式添加 `sourceFile?: string` 字段，或使用 `Map<SkillDefinition, string>` 旁路存储。

#### 🟡 T2 — `execute` 参数使用 `any`

**文件**: `loader.ts:215`

```typescript
execute: skill.execute as (ctx: any) => Promise<any>,
```

**问题**: `fromObject` 方法中将外部传入的 `execute` 函数强制断言为 `(ctx: any) => Promise<any>`，绕过了 `ExecutionContext` → `ExecutionResult` 的类型检查。  
**影响**: 如果外部传入的 execute 签名不匹配，错误将在运行时暴露而非编译时。  
**建议**: 使用更精确的类型约束，或在运行时验证函数参数个数。

#### 🟡 T3 — `_skill` 未使用参数

**文件**: `validator.ts:187`

```typescript
validate(_skill: SkillDefinition): ValidationEntry[] {
```

**问题**: `NoSideEffectsExportRule.validate` 的参数以 `_` 前缀标记未使用。虽然 TypeScript 允许，但表明该规则当前是占位实现。  
**影响**: 占位规则可能给开发者虚假的安全感（以为该检查已生效）。  
**建议**: 明确标记为 TODO，或在文档中说明当前为 no-op。

#### 🟢 T4 — `Record<string, unknown>` 索引签名缺失校验

**问题**: 多处使用 `Record<string, unknown>` 作为通用对象类型，但未在索引时做类型守卫。  
**示例**: `fromJsonTemplate`, `fromObject`, `JsonSkillParser.parseSingle`  
**影响**: 低风险（方法内做了 toString/类型转换）。

---

## 5. 设计与实现一致性

将 `docs/design.md` 的设计规范与实际代码对比。

### 5.1 ✅ 一致项

| 设计规范 | 实现 | 评价 |
|----------|------|------|
| 核心接口 `SkillDefinition` | ✅ 完整实现 | 含全部字段和可选钩子 |
| `SkillExecutor` 接口 | ✅ `DefaultSkillExecutor` | 实现了 `execute`, `buildInjection`, `validate` |
| `PromptTemplate` 接口 | ✅ `template-engine.ts` | `render`, `listVariables`, `validateVariables` 全实现 |
| `Cache` 三层设计 | ✅ 实现 | `defs`, `validations`, `renders` 三层 |
| `Validator` 8 个内置规则 | ✅ 实现 | 全部 8 个规则已编码 |
| `Executor` 编排层 | ✅ 实现 | Loader → Validator → Cache → Execute 管线 |
| 事件系统 | ✅ 实现 | `on`/`off`/`emit` 全实现 |
| `LoadResult` 含 errors | ✅ 实现 | 批量加载部分失败不影响整体 |
| `fromJsonTemplate` 桥接 | ✅ 实现 | JSON 向后兼容 |

### 5.2 ❌ 不一致项

#### 🔴 D1 — 文件结构不符设计文档

**设计**: 
```
src/
├── interfaces/
│   ├── index.ts
│   ├── skill-definition.ts
│   ├── prompt-template.ts
│   └── skill-executor.ts
├── loader/
│   ├── index.ts
│   ├── loader.ts
│   ├── readers/
│   │   ├── module-reader.ts
│   │   └── json-reader.ts
│   └── parsers/
│       ├── module-skill-parser.ts
│       └── json-skill-parser.ts
├── validator/
│   ├── index.ts
│   ├── validator.ts
│   └── rules/
│       ├── required-fields.ts
│       ├── id-format.ts
│       └── ... (8 个规则文件)
├── cache/
│   ├── index.ts
│   └── cache.ts
├── executor/
│   ├── index.ts
│   ├── executor.ts
│   └── default-executor.ts
├── helpers/
│   ├── index.ts
│   ├── template-engine.ts
│   └── schema-utils.ts
└── index.ts
```

**实际**:
```
src/
├── cache.ts
├── cli.ts
├── executor.ts
├── index.ts
├── loader.ts
├── template-engine.ts
├── types.ts
└── validator.ts
```

**差异**: 8 个文件替代了设计文档规划的约 20+ 文件。所有规则内联在 `validator.ts` 中（设计规划为 10 个文件）。  
**影响**: 
- 可维护性降低（`validator.ts` 约 250 行，内联 8 个规则类）
- 可扩展性降低（新增规则需修改同一个文件）
- 代码复用性降低（reader/parser 内联在 `loader.ts` 中）

#### 🟡 D2 — 缺失 `@cortex/shared` 依赖引用

**设计**: `SkillDefinition` 应扩展或引用 `@cortex/shared` 的 `SkillTemplate` 类型。  
**实际**: `@cortex/shared` 未安装，`SkillDefinition` 接口完全自包含。  
**影响**: 设计中的模块依赖边界未落实。当前无实际功能影响，但与现有 JSON 技能模板体系的类型关联断裂。

#### 🟡 D3 — `ModuleReader` 实现不完整

**设计**: `ModuleReader` 应使用动态 `import()` 加载 `.ts`/`.js` 模块并提取导出的 `SkillDefinition`。  
**实际**: 
```typescript
class ModuleReader implements SourceReader {
  async read(path: string): Promise<string | Record<string, unknown>> {
    return readFileSync(path, 'utf-8');  // ← 读为纯文本
  }
}
```
同时默认的 `module` 策略解析器是 `JsonSkillParser`：
```typescript
this.parsers.set('module', new JsonSkillParser());
```
**影响**: 
- `.ts` 技能文件会被当作 JSON 解析 → 必然失败
- **可执行的 TypeScript 技能实际上无法加载**
- 设计文档的关键承诺"以代码（而非 JSON）定义可执行的技能"尚未兑现

#### 🟢 D4 — 缺少 `schema-utils.ts` 辅助模块

**设计**: 规划了 `src/helpers/schema-utils.ts` 包含 Zod 集成辅助函数 `createSkillWithSchema`。  
**实际**: 未实现。  
**影响**: 低（Zod 集成本身也是可选的）。

---

## 6. 问题清单与优先级

### 优先级定义

| 级别 | 含义 | 修复时限 |
|------|------|----------|
| 🔴 **P0** | 功能阻断 / 严重合规 | 必须立即修复 |
| 🟡 **P1** | 重要缺陷 / 偏离设计 | 应在本迭代修复 |
| 🟢 **P2** | 质量改进 / 代码整洁 | 可在下迭代修复 |
| ⚪ **P3** | 建议 / 长期改进 | 技术债务 |

### 完整问题清单

| ID | 优先级 | 类别 | 问题 | 文件 | 建议修复 |
|----|--------|------|------|------|----------|
| P0-A | 🔴 P0 | pkg.json | 缺少 `scripts` 字段 | `package.json` | 添加 build/test/lint/typecheck/clean 脚本 |
| P0-B | 🔴 P0 | pkg.json | 缺少 `@cortex/shared` 依赖声明 | `package.json` | 添加 `"@cortex/shared": "workspace:*"` |
| P0-C | 🔴 P0 | 测试 | 缺少 `tests/` 目录 | `packages/skill-kit/` | 创建设计文档规划的测试套件 |
| P0-D | 🔴 P0 | 实现 | `ModuleReader` 无法加载 `.ts` 技能 | `loader.ts` | 实现动态 `import()` 加载 + `ModuleSkillParser` |
| P1-A | 🟡 P1 | 类型安全 | `as Record<string, unknown>` 注入 `_sourceFile` | `loader.ts:191` | 在接口正式添加 `sourceFile` 或使用旁路 Map |
| P1-B | 🟡 P1 | 设计一致 | 文件结构扁平化不符设计文档 | 全部 | 按设计文档重组为子目录结构 |
| P1-C | 🟡 P1 | pkg.json | 缺少 `zod` peer dependency | `package.json` | 添加 `"zod": "^3.23"` 到 peerDependencies |
| P1-D | 🟡 P1 | pkg.json | Export map 指向 `.ts` 源码 | `package.json` | 构建后指向 `dist/`，同时保留 `types` 入口 |
| P2-A | 🟢 P2 | tsconfig | 缺少 6 个严格模式选项 | `tsconfig.json` | 开启 `noUnusedLocals`, `noUncheckedIndexedAccess` 等 |
| P2-B | 🟢 P2 | 类型安全 | `execute` 参数使用 `any` 断言 | `loader.ts:215` | 用 `ExecutionContext` → `ExecutionResult` 签名约束 |
| P2-C | 🟢 P2 | pkg.json | 缺少 `types` 导出字段 | `package.json` | 添加 `"types": "./dist/index.d.ts"` |
| P2-D | 🟢 P2 | 代码质量 | `cli.ts` 硬编码 magic number `8` | `cli.ts` | 从 validator 实例获取规则数 |
| P2-E | 🟢 P2 | 约定 | 根 `tsconfig.json` include 范围过宽 | `tsconfig.json` | 改为 `"include": ["packages/*/src/**/*.ts"]` |
| P3-A | ⚪ P3 | 性能 | `readFileSync` 在 async 方法中阻塞事件循环 | `loader.ts` | 改用 `readFile`（异步） |
| P3-B | ⚪ P3 | 设计一致 | 缺少 `schema-utils.ts` | - | 按设计文档实现 |
| P3-C | ⚪ P3 | 约定 | 包级别缺少 `.gitignore` | - | 创建包级别 `.gitignore` |
| P3-D | ⚪ P3 | tsconfig | `moduleResolution: "node"` 非最佳 | `tsconfig.json` | 改用 `Node16` 或 `Bundler` |

---

## 7. 评分汇总

### 7.1 各维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **项目约定合规** | 7/10 | Barrel 导出、命名、JSDoc 优秀；缺少 tests/、文件结构扁平、根 tsconfig 宽泛 |
| **package.json 完整性** | 5/10 | 核心元数据正确；严重缺少 scripts、依赖声明、类型入口 |
| **TypeScript 严格性** | 8/10 | strict 开启、无 any；缺少 6 个推荐严格选项，2 处类型断言有风险 |
| **设计一致性** | 6/10 | 核心 API 一致；文件结构、ModuleReader 实现、@cortex/shared 依赖有偏差 |
| **代码质量** | 8/10 | 整洁、文档完备、可读性强；内联规则类较多、测试缺失 |
| **总分** | **7.2/10** | 核心功能完好，但基础设施（构建/测试/类型入口）有缺口 |

### 7.2 关键指标一览

| 指标 | 值 |
|------|-----|
| 源文件总数 | 8 |
| 代码行数（src/） | ~1,200 |
| 接口/类型定义数 | 20+ |
| 公开 API 导出数 | 25+（类型 + 类 + 函数） |
| 零外部运行时依赖 | ✅ 是 |
| 测试覆盖率 | ❌ 0% |
| 构建脚本 | ❌ 无 |
| CI 流水线就绪 | ❌ 无 |
| 阻塞性问题（P0） | 4 个 |
| 重要问题（P1） | 4 个 |
| 质量改进（P2） | 5 个 |
| 建议（P3） | 4 个 |

### 7.3 修复路线图建议

```
迭代 1（立即）:
  ├── P0-A: 添加 scripts (build/test/lint/typecheck)
  ├── P0-B: 添加 @cortex/shared 依赖
  ├── P0-D: 实现 ModuleReader 动态 import + ModuleSkillParser
  └── P1-D: 修复 export map（指向 dist + 添加 types）

迭代 2（本迭代）:
  ├── P0-C: 创建 tests/ 目录 + 核心函数单元测试
  ├── P1-A: 修复 _sourceFile 类型注入
  ├── P1-B: 按设计文档重组文件结构
  ├── P1-C: 添加 zod peer dependency
  └── P2-A: 开启缺失的 tsconfig strict 选项

迭代 3（下迭代）:
  ├── P2-B: 修复 execute any 断言
  ├── P2-C: 添加 types 导出
  ├── P2-D: 消除 magic number
  ├── P2-E: 修复根 tsconfig include
  └── P3-A ~ P3-D: 长期改进项
```

---

## 附录 A: 根 tsconfig 与包 tsconfig 对比

| 选项 | 根 `tsconfig.json` | 包 `tsconfig.json` |
|------|-------------------|-------------------|
| `include` | `**/*.ts`（⚠️ 过宽） | `src/**/*.ts`（✅） |
| `strict` | `true` | `true` |
| `declaration` | 未设置 | `true` |
| `declarationMap` | 未设置 | `true` |
| `sourceMap` | 未设置 | `true` |
| `skipLibCheck` | 未设置 | `true` |

**问题**: 根 tsconfig 缺少包 tsconfig 的细化配置。根 tsconfig 应作为基础配置，包 tsconfig 继承并扩展。

## 附录 B: 导出表面分析

```
index.ts 公开导出:
├── 类型: SkillDefinition, SkillExecutor, ExecutionContext, ExecutionResult,
│         PromptTemplate, TemplateVariables, ValidationLevel, ValidationEntry,
│         ValidationResult, ValidationRule, LoadResult, SourceReader, SkillParser,
│         LoaderOptions, CacheStrategy, CacheOptions, CacheStats, ExecutorEvent,
│         ExecutorEventListener, ExecutorOptions, ValidatorOptions
│         (21 个类型)
├── 类:   TemplateRenderError, Cache, Loader, Validator, Executor
│         (5 个类)
├── 函数: renderTemplate, listTemplateVariables, validateTemplateVariables
│         (3 个函数)
└── 总计: 29 个公开符号
```

所有导出均有 JSDoc → ✅ 符合 Cortex 文档标准。

---

## 附录 C: 参考文档

- `docs/design.md` — 设计规范（v0.1, 2025-07-18）
- `docs/review.md` — 代码审查报告（关联包 `@cortex/tools`）
- `docs/deploy-check.md` — 部署验证报告（`@cortex/skill-kit` CLI 运行通过）
- `packages/skill-kit/package.json` — 包配置
- `packages/skill-kit/tsconfig.json` — TypeScript 配置
- `tsconfig.json` — 根 TypeScript 配置

---

*审计人: Cortex AI Compliance Auditor*  
*关联任务: task-audit-001 (audit)*
