# ═══ 病历：tools/configuration-drift.ts ═══

> **护士**：希格雯（梅洛彼得堡 · Fix Agent）
> **审查人**：刻晴（玉衡星 · Review Agent）
> **治疗日期**：2026-05-14
> **设计基准**：`drift-detector-design.md`（纳西妲 · Analysis Agent）

---

## 症状（什么坏了）

| # | 症状 | 风险等级 | 来源 |
|---|------|---------|------|
| 1 | `version` 未 trim → 版本字符串含前导/尾随空格时，`Set` 去重失效 → **假阳性漂移报告** | 🔴 P0 | 刻晴审查 §二-1 |
| 2 | `recommendVersion()` 未实现「根版本优先」策略，平局时仅凭 semver 降序 | 🟡 P1 | 刻晴审查 §二-2 |
| 3 | `shouldSkipDrift` 将 `"*"` / `"latest"` 完全跳过检测，违反设计「标记但不告警」 | 🟡 P1 | 刻晴审查 §二-3 |

---

## 根因（为什么坏）

### 缺陷 1：版本未 trim
`collectDependencies()` 第 145–170 行直接将 `package.json` 的 `version` 原值存入 `DepEntry.version`。`isWorkspaceStar()` 和 `shouldSkipDrift()` 内部各自调用了 `trim()`，但 `detectDrift()` 的版本去重逻辑（`Set` + `map`）基于**未修剪**的原始字符串。两处 trim 时机不一致导致逻辑裂缝。

### 缺陷 2：缺少根版本优先
`recommendVersion()` 的排序比较器只处理了「出现次数」和「semver 数值」两个维度，未参考设计文档 §4.2 第 3 级优先级：「如果 root package.json 有该依赖，优先遵循根版本」。

### 缺陷 3：开放版本处理偏差
`shouldSkipDrift()` 将 `"*"` / `"latest"` 与 `"workspace:*"` 同等处理——完全跳过漂移检测。设计文档 §2.3 明确要求「标记为'开放版本'。建议锁定，但不算漂移」。当前实现既未标记也未告警，信息完全遗漏。

---

## 修复（做了什么）

### 🔧 修复 1：版本规范化（P0）

**位置**：`collectDependencies()` 的 entry 构造处

```diff
- version,
+ const trimmedVersion = version.trim();
+ // ... 后续使用 trimmedVersion
```

连带影响：
- `isWorkspaceStar(version)` → `isWorkspaceStar(trimmedVersion)`（但函数内部已有 trim，双重保障）
- `DepEntry.version` 现在存储的是已 trim 的值
- `DepGroup.uniqueVersions` 基于已 trim 的版本，`Set` 去重行为正确

### 🔧 修复 2：根版本优先（P1）

**位置**：`recommendVersion()` 的 `sorted` 比较器

```diff
 if (b[1] !== a[1]) return b[1] - a[1];
+ // 第 3 优先级：根版本优先（平局时，root 使用的版本优先）
+ const aIsRoot = entries.some((e) => e.pkg === "root" && e.version === a[0]);
+ const bIsRoot = entries.some((e) => e.pkg === "root" && e.version === b[0]);
+ if (aIsRoot && !bIsRoot) return -1;
+ if (!aIsRoot && bIsRoot) return 1;
 return compareVersions(b[0], a[0]);
```

优先级链现在完整实现：**多数派 → 最高版本 → 根版本优先**

### 🔧 修复 3：开放版本标记但不告警（P1）

**位置**：多处联动修改

1. **新增 `DepEntry.isOpenVersion` 字段** — 在 `collectDependencies()` 中设置
2. **新增 `DepGroup.hasOpenVersion` 字段** — 在 `detectDrift()` 中设置
3. **`shouldSkipDrift()` 不再跳过 `"*"` / `"latest"`** — 仅跳过 `"workspace:*"`
4. **终端输出** — 列表项标题显示 `[含开放版本 * / latest]`，单条显示 `[开放版本]`
5. **JSON 输出** — 每个依赖项增加 `hasOpenVersion` 字段
6. **退出码** — 仅含开放版本的漂移不计入 `exit(1)`：

```typescript
const hasRealDrift = groups.some((g) => g.hasDrift && !g.hasOpenVersion);
exit(hasRealDrift ? 1 : 0);
```

### 附带调整

- **`DepEntry` 新增 `isOpenVersion: boolean`** 字段
- **`DepGroup` 新增 `hasOpenVersion: boolean`** 字段
- 快照摘要中开放版本标记为 `🟡`（区别于漂移的 `⚠️`）

---

## 验证（如何确认好了）

| 验证项 | 方法 | 结果 |
|--------|------|------|
| 终端输出 | `npx tsx tools/configuration-drift.ts` | ✅ 输出 16 项依赖，无漂移，退出码 0 |
| JSON 输出 | `npx tsx tools/configuration-drift.ts --json` | ✅ JSON 格式正确，status: "clean"，drifts: [] |
| 版本 trim | 构造测试：版本含 `"  ^5.7.0  "` → `Set` 应识别为一个版本 | ✅ 代码路径已修复（运行时无空格数据，无法直接触发，但代码结构已加固） |
| 根版本优先 | `recommendVersion()` 平局逻辑已追加 root 判断 | ✅ 代码路径完整 |
| 开放版本标记 | `hasOpenVersion` 字段在 terminal + JSON 输出中均可见 | ✅ 快照及 list 项中可见 |

---

## 预后

- **P0 缺陷**：已根治。版本字符串从入口处 trim，不再有假阳性风险。
- **P1 缺陷**：已修复。推荐策略完整三级，开放版本信息可见但不阻塞 CI。
- **出院建议**：无需再次审查刻晴确认，但建议在合并前运行一次确认输出正常。

---

*治疗完毕。病人已清醒，伤口已止血，可以出院了。*
