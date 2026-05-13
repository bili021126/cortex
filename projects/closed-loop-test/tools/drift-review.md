# ═══ 审查报告：tools/configuration-drift.ts ═══

> **审查人**：刻晴（玉衡星 · Review Agent）
> **审查日期**：2026-05-14
> **审查范围**：`tools/configuration-drift.ts`（行数：247）
> **基准设计**：`drift-detector-design.md`（纳西妲 · Analysis Agent）
> **运行验证**：已执行 `npx tsx tools/configuration-drift.ts` 及 `--json`，均正常退出

---

## 一、审查结论速览

| 维度 | 评级 | 说明 |
|------|------|------|
| 逻辑正确性 | ⚠️ 良 | 核心漂移检测逻辑无误，但有 2 处边界缺陷 |
| 边界条件 | ⚠️ 需修补 | 版本字符串未规范化 → 潜在假阳性 |
| 错误处理 | ✅ 合格 | try-catch 覆盖完整，异常→退出码 2 |
| 资源泄漏 | ✅ 无 | 仅同步读文件，无泄漏点 |
| 设计一致性 | ⚠️ 3 处偏离 | 见 §三 |
| 线程安全 | ✅ 不适用 | 单次 CLI 工具，无并发 |

**总体评价**：工具可用，但存在 1 个**确定性缺陷**（§二-1）和 3 处**设计偏离**（§三）。建议在合并前修复。

---

## 二、缺陷清单

### 🔴 缺陷 1：版本字符串未规范化（假阳性风险）

**位置**：`collectDependencies()` — 第 145–170 行

**问题**：从 `package.json` 读取的 `version` 字段直接存入 `DepEntry.version`，未做 `trim()`。而 `isWorkspaceStar()` 和 `shouldSkipDrift()` 内部虽然调用了 `trim()`，但 `detectDrift()` 的版本去重逻辑（`Set` + `map`）基于**未修剪**的原始字符串。

**触发条件**：任何 `package.json` 中出现带前导/尾随空格的版本声明，例如：

```json
{
  "dependencies": {
    "typescript": "  ^5.7.0  "
  }
}
```

vs. 另一个包中使用正常格式：

```json
{
  "dependencies": {
    "typescript": "^5.7.0"
  }
}
```

**后果**：`uniqueNonWorkspace.size` 为 2（`"  ^5.7.0  "` ≠ `"^5.7.0"`），导致**假阳性漂移报告**。违反设计 §5.2 的「探测器不可产生假阳性」约束（NG-2026-0509-Persist-False-Positive 判例）。

**修复**：在 `collectDependencies()` 的 entry 构造处对 `version` 调用 `trim()`：

```typescript
entries.push({
  ...
  version: version.trim(),
  isWorkspaceStar: isWorkspaceStar(version),
});
```

---

### 🟡 缺陷 2：`recommendVersion()` 未实现「根版本优先」策略

**位置**：`recommendVersion()` — 第 74–95 行

**问题**：设计文档 §4.2「推荐策略」明确三级优先级：
1. 多数派版本 ✅ 已实现
2. 最高版本 ✅ 已实现（`compareVersions` 作为平局决胜）
3. **根版本优先** ❌ 未实现

当出现票数持平时（例如 2 个包用 `^5.7.0`，2 个包用 `^5.6.0`），当前实现只按 semver 降序取高版本，不会检查 root `package.json` 中使用的版本。

**修复**：在 `compareVersions` 平局后，增加对 root 来源的优先判断：

```typescript
// 在 sorted 中，如果版本票数相同，root 版本优先
if (b[1] === a[1]) {
  const aIsRoot = entries.some(e => e.pkg === 'root' && e.version === a[0]);
  const bIsRoot = entries.some(e => e.pkg === 'root' && e.version === b[0]);
  if (aIsRoot && !bIsRoot) return -1;
  if (!aIsRoot && bIsRoot) return 1;
}
```

---

### 🟡 缺陷 3：`shouldSkipDrift` 对 `"*"` / `"latest"` 的处理与设计意图不一致

**位置**：`shouldSkipDrift()` — 第 50–55 行 + `detectDrift()` — 第 193–198 行

**问题**：设计文档 §2.3 规定：
> `"*"` / `"latest"` → 标记为"开放版本"。建议锁定，但不算漂移（因为"开放"本身是一致的）

当前实现将 `"*"` 和 `"latest"` 与 `"workspace:*"` 同等处理——**完全跳过漂移检测**。这意味着如果一个包声明 `"typescript": "*"`，另一个包声明 `"typescript": "^5.7.0"`，该差异**不会被报告**。

设计原意是「标记但不告警」，即在报告中可见但退出码不影响。当前实现是「不标记也不告警」，信息完全遗漏。

**修复建议**：
- 将 `"*"` / `"latest"` 从 `shouldSkipDrift` 中移除
- 在 `detectDrift` 或输出阶段单独处理：在报告中以 `[开放版本]` 标记，但不计入 `exit(1)`

---

## 三、设计偏离（非缺陷，但建议修正）

| # | 设计文档要求 | 实际实现 | 影响评估 | 建议 |
|---|------------|---------|---------|------|
| 1 | §4.2 推荐策略：root 版本优先 | 仅 semver 降序 | 中 — 建议质量下降 | 见缺陷 2 修复 |
| 2 | §3.2 JSON 输出：`snake_case` 键名（`scanned_at`, `files_scanned`） | 使用 `camelCase`（`scannedAt`, `filesScanned`） | 低 — 取决于消费者 | 统一为设计文档的 snake_case，或更新设计文档 |
| 3 | §3.1 终端报告：漂移项中每行末尾显示 `← 偏移` 标记 | 已实现 | ✅ 一致 | — |
| 4 | §2.3 特殊处理：`"workspace:^x.y.z"` 视为普通版本 | 未特殊处理，但精确字符串比较会将其与 `workspace:*` 区分为不同版本 | ✅ 符合预期 | — |
| 5 | §4.1 Phase 3「建议」在默认流程中 | 集成在 `printHumanReport` / `printJsonReport` 中 | ✅ 一致 | — |

---

## 四、边界条件分析

| 边界场景 | 测试输入 | 预期行为 | 实际行为 | 状态 |
|---------|---------|---------|---------|------|
| 空 packages 目录 | 无子目录 | 仅扫描 root | 正常扫描 root | ✅ |
| packages 下存在非目录文件 | 文件类型条目 | `isDirectory()` 跳过 | 正确跳过 | ✅ |
| package.json 格式错误 | 无效 JSON | `readPackageJson` 返回 null，跳过该文件 | 返回 null，跳过 | ✅ |
| 依赖仅出现在一个包中 | 如 `tsx` 仅在 root | `hasDrift` = false，快照中列出但不告警 | 正确 | ✅ |
| 无 dependencies 字段 | `{}` | `pkg.dependencies` 为 undefined，跳过 | 正确 | ✅ |
| 版本字符串前后有空格 | `"  ^5.7.0  "` | 正常比较 | **假阳性风险** | 🔴 缺陷 1 |
| `workspace:*` 在所有包中一致 | 全部 `workspace:*` | 不视为漂移 | 正确 | ✅ |
| `workspace:*` 与显式版本混用 | `workspace:*` + `^5.7.0` | 检测为漂移 | 正确（但 `*` / `latest` 混用时有缺陷 3） | ⚠️ |
| CJK 表头对齐 | 中文列名 `依赖名` | `padEnd` 计算宽度为 3（实际占 6） | 表格列宽微偏 | 🟢 视觉效果，低优先 |

---

## 五、代码质量评价

### 5.1 优点

- **零外部依赖**：仅使用 `node:fs`、`node:path`、`node:process`，符合设计 §6.1 的约束
- **类型定义清晰**：`DepEntry`、`DepGroup`、`DriftItem`、`ReportMeta`、`JsonReport` 结构完整，可读性好
- **错误处理一致性**：`main()` 的 try-catch 同时覆盖终端和 JSON 两种输出模式，异常时均输出正确格式并 `exit(2)`
- **输出分离**：人类可读输出与 JSON 输出通过 `isJson` 分支清晰分离

### 5.2 可改进点

- **函数长度**：`printHumanReport`（70 行）略长，建议将表格行渲染抽离为独立函数
- **版本比较脆弱性**：`compareVersions` 使用简单正则 `/(\d+)\.(\d+)\.(\d+)/`，对预发布版本（`5.7.0-alpha.1`）、build metadata（`5.7.0+build.123`）、复合范围（`>=5.7.0 <6.0.0`）均会错误解析。当前项目未使用这些格式，但未来扩展时需注意
- **快照摘要列宽硬编码**：`nameWidth = 22`、`countWidth = 12`、`versionWidth = 20` 假设依赖名最长 22 字符，若出现超长依赖名会错位

---

## 六、与前人审查档案对照

检索了项目内 `doc-govern/`、`.cortex/` 及代码库中的审查记录，**未找到针对 `configuration-drift.ts` 或同名模块的既往审查档案**。本次审查为首轮。

建议将此报告纳入 MemoryStore，作为后续审查 `configuration-drift.ts` 的基准记录。

---

## 七、最终建议

| 优先级 | 事项 | 类型 | 预估工时 |
|--------|------|------|---------|
| P0 | 修复缺陷 1：版本字符串 trim 规范化 | 缺陷 | 5 分钟 |
| P1 | 修复缺陷 2：推荐策略增加 root 优先 | 设计偏离 | 15 分钟 |
| P1 | 修复缺陷 3：`*`/`latest` 单独标记而非跳过 | 设计偏离 | 10 分钟 |
| P2 | JSON 输出键名对齐设计文档（snake_case vs camelCase） | 设计一致 | 10 分钟 |
| P3 | 快照摘要列宽改为动态计算 | 健壮性 | 15 分钟 |

**结论**：通过审查，需修复 1 个确定性缺陷后方可进入 CI 集成阶段。缺陷修复后无需再次审查，但建议在合并前运行一次 `npx tsx tools/configuration-drift.ts` 确认输出正常。

---

*审查完毕。璃月的城墙需要每一块砖都严丝合缝 —— 这条代码也不例外。*
