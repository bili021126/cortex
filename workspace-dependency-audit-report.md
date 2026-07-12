# Workspace 依赖声明验证报告

> 审计日期：2025-07-19  
> 审计范围：26 packages，3 个配置文件（pnpm-workspace.yaml / tsconfig.json / vitest.workspace.ts）  
> 审计方法：逐包检查 package.json dependencies/devDependencies/scripts + 交叉验证 tsconfig references + vitest 配置覆盖

---

## ✅ 通过项

### 1. pnpm-workspace.yaml
- **通过**：`packages/*` 覆盖全部 26 个子包目录
- 额外目录 `node.js`、`tests`、`.cortex` 无 package.json，不会被错误包含

### 2. tsconfig.json（根）
- **通过**：全部 26 个包均有 `references` 条目
- 需要 `tsconfig.src.json` 的包（engine / fsm-compiler / governance / consistency / memory-store / plugin-runner）均正确引用子路径

### 3. vitest.workspace.ts
- **通过**：全部 26 个包均有独立的 `vitest.config.ts` 引用
- 配置覆盖完备，无遗漏

### 4. 包名规范
- **通过**：全部 package 的 `name` 字段格式均为 `@cortex/<name>`（小写 kebab-case）

### 5. exports 字段
- **通过**：全部包均有标准的 `exports` 字段（types + import 双入口）

### 6. 类型声明
- **通过**：全部包均有 `types` 字段指向 `./dist/index.d.ts`

---

## ❌ 发现的问题（5 项）

### 🔴 问题 1：workspace 协议不一致

| 位置 | 当前值 | 期望值 |
|------|--------|--------|
| `packages/engine/package.json` → `@cortex/pattern-extractor` | `workspace:^` | `workspace:*` |

其他 50+ 处 workspace 依赖全部使用 `workspace:*`，此处唯一使用 `workspace:^`，违反一致性。

**影响**：`workspace:^` 在 pnpm 中语义不同于 `workspace:*`，可能导致版本解析偏差。

---

### 🔴 问题 2：缺少 `test` 脚本（3 个包有测试文件但无法通过 `pnpm test` 触发）

| 包 | 测试文件数 | 是否在 vitest.workspace.ts 中 | 有无 `test` script |
|---|:--------:|:---------------------------:|:------------------:|
| `@cortex/config` | 4 个 | ✅ | ❌ 缺失 |
| `@cortex/context-manager` | 4 个 | ✅ | ❌ 缺失 |
| `@cortex/logging` | 1 个 | ✅ | ❌ 缺失 |

根 `package.json` 中 `"test": "pnpm -r test"` 依赖子包 `test` script 传播，缺失导致这 3 个包的测试在 `pnpm test` / `pnpm -r test` 时被静默跳过。但 vitest workspace 模式下会被执行——两种入口行为不一致。

---

### 🔴 问题 3：`@cortex/context-manager` 缺少 `lint` script

```json
// packages/context-manager/package.json — scripts 当前只有：
"build": "tsc",
"typecheck": "tsc --noEmit"
// ❌ 缺少 "lint": "eslint src/"
```

其他 25 个包除 `context-manager` 外均有 `lint` script。`pnpm -r lint` 会漏掉此包。

---

### 🔴 问题 4：格式化不一致——`@cortex/cli` package.json 缩进错乱

```json
// 第 25-26 行使用 8 空格缩进（应为 4 空格）：
        "@cortex/memory-store": "workspace:*",
        "@cortex/platform": "workspace:*",
```

对比周围字段（4 空格缩进），此两行多缩进 4 空格。不破坏功能，但影响可读性和 diff 整洁度。

---

### 🔴 问题 5：`@cortex/context-manager` devDependencies 缺少 eslint

```json
// packages/context-manager/package.json — devDependencies 当前：
"typescript": "^5.7.0"
// ❌ 缺少 @types/node、eslint、vitest
```

即使暂时不跑 lint，`eslint` 和 `vitest` 作为 devDependency 缺失会导致其他开发者环境不一致。

---

## 📋 跨包依赖声明 vs 源码导入验证

### engine → 源码导入匹配声明

```
src/base-agent.ts:         @cortex/shared, @cortex/llm, @cortex/platform, @cortex/memory-store, @cortex/scheduler, @cortex/config
src/bootstrap/engine.ts:   @cortex/notification, @cortex/scheduler, @cortex/plugin-runner, @cortex/platform, @cortex/memory-store,
                           @cortex/logging, @cortex/llm, @cortex/shared, @cortex/config, @cortex/telemetry
```
- ✅ `@cortex/pattern-extractor` 虽然在 `package.json` 中声明（`workspace:^`），但未在关键入口文件中导入——可能是历史遗留依赖，需确认是否真在 engine/src 其他位置使用。
- ✅ 其余所有导入均在 `dependencies` 中声明，无漂移。

### context-manager → 源码导入匹配声明

```
src/context-manager.ts:   @cortex/config, @cortex/shared
```
- ✅ 与 `dependencies` 一致（`@cortex/config`, `@cortex/shared`）

### logging → 源码导入检查

- ✅ 源码无 `@cortex/*` 导入，`dependencies: {}` 正确（纯 leaf 包）

---

## 📊 统计汇总

| 指标 | 值 |
|------|-----|
| 包总数 | 26 |
| 通过项 | 6 类 |
| 问题数 | 5 |
| 严重问题 | 2（问题 1 workspace 协议不一致 + 问题 2 缺失 test script） |
| 中等问题 | 2（问题 3 缺失 lint + 问题 5 缺失 devDeps） |
| 轻微问题 | 1（问题 4 格式化） |

---

## 🛠️ 快速修复建议

### 修复 1：统一 workspace 协议
```diff
// packages/engine/package.json
- "@cortex/pattern-extractor": "workspace:^"
+ "@cortex/pattern-extractor": "workspace:*"
```

### 修复 2：补充 test script（3 包）
```json
// packages/config/package.json — scripts
+ "test": "vitest run"

// packages/context-manager/package.json — scripts
+ "test": "vitest run"

// packages/logging/package.json — scripts
+ "test": "vitest run"
```

### 修复 3：context-manager 补全 script 和 devDeps
```json
// packages/context-manager/package.json — scripts
+ "lint": "eslint src/"

// packages/context-manager/package.json — devDependencies
+ "@types/node": "^22.0.0",
+ "eslint": "^10.4.1",
+ "vitest": "^2.1.0"
```

### 修复 4：修复 CLI 缩进
```json
// packages/cli/package.json — 第 25-26 行改为 4 空格
    "@cortex/memory-store": "workspace:*",
    "@cortex/platform": "workspace:*",
```

---

## 结论

**整体健康状况：良好。** 26 个包依赖拓扑完整、tsconfig references 全覆盖、vitest workspace 无遗漏。5 个问题中 2 个为配置补全性质（缺 script）、1 个为一致性（workspace:^）、1 个为格式化、1 个为缺失 devDep——无结构性断裂。
