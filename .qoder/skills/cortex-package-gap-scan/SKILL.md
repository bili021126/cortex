---
name: cortex-package-gap-scan
description: Audit all packages in the Cortex monorepo for integration gaps. Cross-references engine dependency declarations against actual imports, classifies packages into three tiers (connected/type-only/orphan), and outputs a prioritized gap report. Use when transitioning between phases, after adding new packages, or when user asks "what's not connected?"
---

# Cortex Package Gap Scan — 包接入缺口审计

## 流程清单

```
Task Progress:
- [ ] 1. 收集所有包名
- [ ] 2. 提取 engine 依赖声明
- [ ] 3. 统计 engine 实际 import
- [ ] 4. 三分类对照
- [ ] 5. 估算未接入包行数
- [ ] 6. 区分工具 vs 基础设施
- [ ] 7. 输出报告 + 更新锚点表
```

## 1. 收集所有包名

```bash
grep '"name": "@cortex/' packages/*/package.json
```
得到全部 ~25 个包名。

## 2. 提取 engine 依赖声明

读 `packages/engine/package.json` → `dependencies` 字段，提取所有 `@cortex/*` 条目。

## 3. 统计 engine 实际 import

```bash
grep 'from "@cortex/' packages/engine/src/**/*.ts
```

按包统计引用次数。注意区分：
- `import { X } from "@cortex/foo"` — 值级引用（真正在用）
- `import type { X } from "@cortex/foo"` — 仅类型引用（可能只是类型壳）

## 4. 三分类对照

| 分类 | 条件 | 标签 |
|------|------|------|
| **A. 已接入** | 声明了依赖 + 有值级 import | ✅ 正常 |
| **B. 类型壳** | 声明了依赖 + 仅有 type import / 零运行时调用 | ⚠️ 待接入（如 notification、pattern-extractor） |
| **C. 孤儿包** | 未声明依赖 + engine 零引用 | ❌ 完全未接（如 prompt-kit、resilience） |

## 5. 估算未接入包行数

对 B/C 类每个包：
```powershell
Get-ChildItem -Recurse -Filter *.ts | ForEach-Object { (Get-Content $_.FullName | Measure-Object -Line).Lines } | Measure-Object -Sum
```

## 6. 区分独立工具 vs 应接入的基础设施

**独立工具**（不打标红）：tui、cli、doctor、tools、testing、pm、fsm-compiler、parser  
**应接入的基础设施**（标红）：prompt-kit、resilience、cache、notification（B→A）

## 7. 输出格式

输出三分类表 + 未接入包行数降序排列，格式对齐 `docs/core/概念设计全面整合-项目实际阶段与路线图.md` §三 设计锚点表格。

同时标注哪些包在 `Core-2-过渡阶段-全面接入改造计划.md` 中已规划接入。
