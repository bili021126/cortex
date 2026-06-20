---
name: cortex-design-spec
description: Create standardized design specs for Cortex core subsystems. Follows a four-section template: Current State Diagnosis, Design, Code Integration Points, Implementation Path. Use when user asks to "write a design spec" for any cortex core module, or when designing new subsystems like skill registry, loop strategy registry, etc.
---

# Cortex Design Spec — 四段标准模板

## 流程清单

```
Task Progress:
- [ ] 段一：现状诊断（已存在零件 + 缺失零件 + 调用链图示）
- [ ] 段二：设计（总览 + 核心接口 + 使用路径 + 边界条件）
- [ ] 段三：与现有代码的精确咬合（不改/要改/暂不改）
- [ ] 段四：实施路径（Phase 拆分 + 验收标准）
```

## 段一：现状诊断

### 已存在的零件

用表格列出相关代码文件、接口、类型。每行标注状态和文件路径+行号：

| 零件 | 位置 | 状态 |
|------|------|------|
| `TaskNode.preferredStrategy` | `shared/src/task.ts:99` | ✅ 类型完整 |
| `resolvePipeline()` | `engine/src/memory/pipeline.ts:246` | ✅ switch/case 已预留槽位 |

### 缺失的零件

| 缺口 | 影响 |
|------|------|
| 无策略注册表 | 策略顾问（LLM 选策略）不知道有哪些策略可选 |

### 当前调用链

用文本图展示现状的数据流或调用链。

---

## 段二：设计

### 总览

一句话目标描述 + 一张架构简图（ASCII art）。

### 核心接口/类型

用 TypeScript 伪代码定义关键接口，标注字段语义：

```typescript
interface LoopStrategy {
  name: "react" | "direct" | "decompose" | "jury";
  description: string;       // 给策略顾问看的人类可读描述
  canHandle: (task: TaskNode) => boolean;  // 规则路由
  pipeline: IStep[];         // 对应的管道步骤
}
```

### 使用路径

列出每条调用路径，标注："谁来调 → 什么时候调 → 产出什么"

### 边界条件

列出"不做什么"的显式排除项——防止过度设计。

---

## 段三：与现有代码的精确咬合

### 不改的

| 文件 | 原因 |
|------|------|
| `resolvePipeline()` switch/case | 最简洁的策略→管道翻译器 |

### 要改的

| 文件 | 改动 | 行数 |
|------|------|------|
| 新建 `loop-strategy-registry.ts` | LoopStrategy 接口 + 注册表类 | ~60 |

### 暂不做的

| 事项 | 延期原因 |
|------|---------|
| JuryStep 实现 | 需要 Committee 机制配合 |

---

## 段四：实施路径

| 优先级 | 事项 | 代码量 | 前置依赖 |
|--------|------|--------|---------|
| P0 | 注册表骨架 | ~60行 | 无 |
| P1 | 策略顾问集成 | ~20行 | P0 |

每项带验收标准："`pnpm typecheck` 通过"、"日志中出现 X 标记" 等可验证条件。

---

## 文件命名与放置

- 路径：`docs/core/<主题>.md`
- 标题格式：`# <主题>`
- 定位声明（第一段）说明文档的定位和关联文档
- 每段之间用 `---` 分隔
