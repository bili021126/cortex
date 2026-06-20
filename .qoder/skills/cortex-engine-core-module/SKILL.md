---
name: cortex-engine-core-module
description: Standard workflow for adding new modules to Cortex engine src/core/. Covers file creation, barrel export to index.ts Core-2 section, typecheck, and common API signature pitfalls (resilience durationMs vs timeoutMs, notification push vs send, telemetry string tag types). Use when creating new engine core modules, integrating resilience/notification/telemetry into engine components, or when the user asks to add a new core module.
---

# Cortex Engine Core Module — 新增模块标准流程

## 流程清单

```
Task Progress:
- [ ] 1. 创建模块文件（src/core/<module-name>.ts）
- [ ] 2. 编写文件头注释（遵循模板）
- [ ] 3. 实现模块代码
- [ ] 4. 在 src/index.ts 的 Core-2 section 追加 barrel 导出
- [ ] 5. 运行 typecheck：pnpm --filter @cortex/engine exec tsc -b tsconfig.src.json
- [ ] 6. 检查 API 签名陷阱（见下方速查表）
- [ ] 7. 验证编译产物存在：dist/core/<module-name>.js + .d.ts
```

## 1. 创建模块文件

路径：`packages/engine/src/core/<kebab-case-name>.ts`

命名规范：kebab-case，语义明确（如 `sentinel-signal-filter.ts`，非 `filter.ts`）。

## 2. 文件头模板

```typescript
// ============================================================
// @cortex/engine/core/<module-name> —— <一句话中文职责>
//
// @since v<X.Y.Z>
// @layer 引擎层 — <层级描述>
//
// 职责：
//   1. <职责 1>
//   2. <职责 2>
//
// 设计原则：
//   1. <原则 1>
//   2. <原则 2>
// ============================================================
```

## 3. Barrel 导出（src/index.ts）

在 `packages/engine/src/index.ts` 的 **Core-2 section**（约 L35–L78 之间）追加：

```typescript
// ── Core-2: <模块中文名> ─────────────────────
// @experimental <一句话说明>
export { <ClassName> } from "./core/<module-name>.js";
export type { <InterfaceName> } from "./core/<module-name>.js";
```

**注意**：
- 导入路径必须以 `.js` 结尾（ESM 规范）
- `export type` 和 `export` 分开写
- 注释使用 `@experimental` 标记（Core-2 预留语义可能调整）

## 4. Typecheck

```powershell
pnpm --filter @cortex/engine exec tsc -b tsconfig.src.json
```

如果因 tsbuildinfo 缓存静默跳过编译，先清理：

```powershell
Remove-Item packages/engine/dist -Recurse -Force -ErrorAction SilentlyContinue
pnpm --filter @cortex/engine exec tsc -b tsconfig.src.json --force
```

## 5. tsconfig 引用检查

如果新模块引入了新的 `@cortex/*` 包依赖，必须在 `packages/engine/tsconfig.src.json` 的 `references` 数组中添加对应路径：

```json
{ "path": "../<new-package>" }
```

同时确认 `packages/engine/package.json` 的 `dependencies` 中已声明该包。

---

## API 签名速查表（常见陷阱）

详细的 API 签名和踩坑记录见 [api-reference.md](api-reference.md)。

### @cortex/resilience

| 正确 | 错误 | 说明 |
|------|------|------|
| `new FixedTimeout({ durationMs: 30000 })` | `new FixedTimeout({ timeoutMs: 30000 })` | 构造参数是 `durationMs`，非 `timeoutMs` |
| `new ExponentialBackoff({ maxAttempts, baseDelayMs, maxDelayMs })` | — | 三个必填字段 |
| `new SimpleCircuitBreaker({ name, threshold, halfOpenAfterMs })` | — | `name` 必填 |
| `registry.register(key, { retry, circuitBreaker, timeout })` | — | 三件套一起注册 |
| `registry.execute(componentName, fn)` | — | fn 签名 `() => Promise<T>` |

### @cortex/notification

| 正确 | 错误 | 说明 |
|------|------|------|
| `notificationPipe.push(event)` | `notificationPipe.send(event)` | 方法名是 `push`，非 `send` |
| `push({ type, channel, ackRequired, summary, ... })` | — | `type` 必填，其余可选 |
| `NotificationChannel.Urgent / Important / Routine / Info` | — | 枚举值，非字符串 |
| `withSemantics(event, "DECISION_REQUIRED")` | — | 语义标注函数 |

### @cortex/telemetry

| 正确 | 错误 | 说明 |
|------|------|------|
| `recordTelemetry(name, value, tags)` | — | `name: string`, `value: number` |
| `tags: [{ key: "x", value: "y" }]` | `tags: { x: "y" }` | tags 是 `{key, value}[]`，非 Record |
| `value` 必须是 `number` | `value: "some string"` | **严禁传字符串**，需 `Number(x)` 或 `0` |
| tags 的 `value` 必须是 `string` | `value: 123` | 数字需 `String(123)` 转换 |

### @cortex/shared（PipelineObserver）

| 正确 | 错误 | 说明 |
|------|------|------|
| `observer.on(priority, handler)` | `observer.subscribe(...)` | 方法名是 `on`/`off` |
| `PipelinePriority.CRITICAL / HIGH / NORMAL` | — | 三级优先级枚举 |
| `PipelineEventType.XXX` | — | 事件类型枚举，不可复用自定义字符串 |
