---
name: cortex-critical-fix
description: Fix Critical-level defects in Cortex monorepo using the five-stage closed loop (Root Cause Diagnosis → Fix → Verify → Test → Document). Use when fixing cross-package type drift, silent Promise-to-boolean casts, missing failure recovery paths, circuit breaker bypass, or any system-level defect discovered in code review rounds. Triggered by C-level finding IDs or phrases like "root cause fix", "五条裂纹", or "系统性修复".
---

# Cortex Critical Fix — 五阶段闭环

从五轮审查追出的 260 个缺陷中归纳的通用修复方法论。适用于跨包类型漂移（A类）、any 桥接（B类）、事件契约断裂（C类）、上下文逻辑漂移（D类）等系统级缺陷。

## 流程清单

```
Task Progress:
- [ ] 1. 根因诊断——用"五个为什么"追溯到跨包/跨流边界
- [ ] 2. 代码修复——最小改动，只改根因所在的行/段
- [ ] 3. 类型验证——tsc --noEmit 全量无错
- [ ] 4. 测试验证——vitest 无新增失败 + 关键修复配套 E2E
- [ ] 5. 文档对齐——宪法 facts 更新 + 代码锚点验证
```

---

## 1. 根因诊断

每个 Critical 缺陷用五个"为什么"追溯到底：

**模板**：
```
症状：C-XX XXX
  ↓ 为什么 1：XXX
  ↓ 为什么 2：XXX
  ↓ 为什么 3：XXX
  ↓ 为什么 4：XXX
  ↓ 为什么 5：系统裂隙——属于四类整合缺陷中的哪一类
```

**判例**：
- C-02 rollback——`as unknown as boolean` 将 Promise 强转为 boolean。根因：跨包接口变更无编译期强制验证（A类-类型漂移）
- C-03 Embedding——`_loading = null` 不在 finally 里。根因：初始化失败路径零测试覆盖（D类-失败路径）
- C-04 CircuitBreaker——fallback 内 `await fn()` 穿透。根因：设计契约未翻译为测试断言（A类-契约缺失）

---

## 2. 代码修复

**原则**：最小改动。只改根因所在的行/段，不允许顺手重构。

**禁止模式**：
- `as unknown as boolean`——用 `async + await` 替代
- `catch {}` 静默吞错——emit `PipelineObserver` 事件或 `process.stderr.write` 降级日志
- `try { ... }` 无 `finally`——核心初始化路径必须重置状态变量

**允许模式**：
- 白名单校验（C-01：`/^[a-zA-Z_][a-zA-Z0-9_]*$/`）
- `try/finally` 确保状态重置（C-03）
- 逆序 stop+dispose 回滚（C-05）
- 成功率阈值 ≥50%（C-06）

---

## 3. 类型验证

```powershell
pnpm exec tsc -b --force --noEmit
```

**阻断条件**：任何 TS2307（找不到模块）、TS2353（字段不存在）、TS18048（值可能 undefined）必须清零。

---

## 4. 测试验证

```powershell
pnpm exec vitest run --no-color
```

**验收标准**：
- 无新增失败文件
- 关键修复配套 `@ci: verify` 标签测试——验证修复逻辑的反面也被拦截
- 涉及跨包接口变更时——验证实现方和调用方的测试全部通过

---

## 5. 文档对齐

更新以下文件中的对应数据：
- 宪法 v3.x——修正记录表 + 代码事实
- 全景图——测试基线、包数量
- coding-standards.md——新增 §十五 铁律判例
- 修复清单——标记已关闭

---

## 快速参考：七判例

| ID | 缺陷 | 流→层 | 修复行数 | 核心模式 |
|:--|------|------|:--|------|
| C-01 | 命令注入 | 治理流→治理层 | ~5 | 白名单拦截 |
| C-02 | rollback Promise→bool | 记忆流→记忆层 | ~5 | async/await 消 as |
| C-03 | Embedding 永久卡死 | 记忆流→记忆层 | ~10 | try/finally |
| C-04 | CircuitBreaker 穿透 | 技能工具流→基础设施层 | ~8 | throw CBOpenError |
| C-05 | Bootstrap 无回滚 | 规划执行流→规划执行层 | ~15 | 逆序 stop+dispose |
| C-06 | RLM 假成功 | 规划执行流→规划执行层 | ~5 | ≥50% 阈值 |
| C-07 | Obliteration 逻辑反转 | 记忆流→记忆层 | ~5 | 移除短路条件 |

---

*源自 Cortex 五轮深度审查（260 缺陷），2026-06-22 结晶。*
*维护者：昔涟（Cyrene）*
