# @cortex/tools — RollbackRegistry 架构说明

## 概述

`ToolRollbackRegistry` 是 Tool 层的回滚注册表，用于追踪 write_file 等副作用操作，
在任务执行失败时自动清理已创建的文件。

## 架构

```
┌─────────────────────────────────────────────────────┐
│                 ToolRollbackRegistry                  │
├─────────────────────────────────────────────────────┤
│  _createdFiles: Map<taskId, string[]>   ← 文件追踪   │
│  _sideEffects:  Map<taskId, string[]>   ← 副作用记录  │
├─────────────────────────────────────────────────────┤
│  trackCreate(taskId, filePath)   → 记录文件创建       │
│  trackShell(taskId, desc)        → 记录 shell 副作用  │
│  rollback(taskId)                → FILO 删除 + 清理   │
│  clear(taskId)                   → 仅清理记录，不删文件│
│  reset()                         → 清空全部记录       │
└─────────────────────────────────────────────────────┘
```

## 核心设计原则

### 1. 以 taskId 为键

每个任务节点 (TaskNode) 持有唯一 id，作为 registry 的跟踪键。
同一 task 内创建的多个文件归入同一条目。

### 2. FILO 删除顺序

后创建的文件先删除（模拟栈回溯），因为后创建的文件可能依赖先创建的文件。

### 3. 删除失败不阻塞

单文件删除失败时写 stderr 日志后继续清理剩余文件，不阻断整体回滚流程。

### 4. clear ≠ rollback

| 方法 | 删除文件 | 清理记录 | 适用场景 |
|------|---------|---------|---------|
| `rollback(taskId)` | ✅ FILO 删除 | ✅ | 任务节点执行失败 |
| `clear(taskId)` | ❌ 保留文件 | ✅ | 全链路执行成功 |

## 使用方式

```typescript
import { toolRollbackRegistry } from "@cortex/tools";

// 记录文件创建
toolRollbackRegistry.trackCreate("node-1", "/tmp/output.ts");

// 记录 shell 副作用（仅遥测）
toolRollbackRegistry.trackShell("node-1", "npm install");

// 回滚（删除文件 + 清理记录）
const deleted = toolRollbackRegistry.rollback("node-1");

// 全链路成功（仅清理记录，不删文件）
toolRollbackRegistry.clear("node-1");

// 引擎 shutdown 时清空全部
toolRollbackRegistry.reset();
```

## 全局单例

引擎内所有组件共用 `toolRollbackRegistry` 单例，确保跨组件回滚一致性。
单例在 `rollback-registry.ts` 末尾导出。
