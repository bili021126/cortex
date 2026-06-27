# 文档注册表构建验证报告

> **审计人**：凝光 · 天权星
> **日期**：2026-07-26
> **验证目标**：`cortex-docs.json` 注册表路径完整性 + 文件存活性验证
> **对应前序审计**：[2026-07-25-docs-configuration-audit.md](./2026-07-25-docs-configuration-audit.md)

---

## 一、验证范围

验证 `cortex-docs.json` 中注册的 **9 条文档路径**（constitutionPath × 1 + docRegistry × 8）是否存在于磁盘。

---

## 二、逐条验证结果

### 2.1 宪法路径

| 注册路径 | 实际状态 |
|---------|---------|
| `docs/constitution/Cortex 概念顶层设计 v2.5.35.md` | ✅ **存在**（1607 行, 108KB） |
| 注册的 version 字段：`"2.5.40"` | ⚠️ **版本号偏差**——文件实际为 v2.5.35，注册版本写 v2.5.40 |

### 2.2 文档注册表条目（8 条）

| # | 注册路径 | 类型 | 文件存在？ | 实际位置 | 判定 |
|---|---------|------|-----------|---------|------|
| 1 | `docs/core/Core-2治理层架构推演全记录.md` | design | ❌ | → `docs/archive/Core-2治理层架构推演全记录.md` ✅ | **路径未随归档更新** |
| 2 | `docs/core/治理层设计.md` | design | ❌ | → `docs/archive/治理层设计.md` ✅ | **路径未随归档更新** |
| 3 | `docs/core/Agent标签词汇表-v2.0.md` | design | ❌ | → `docs/archive/Agent标签词汇表-v2.0.md` ✅ | **路径未随归档更新** |
| 4 | `docs/core/意图响应体系设计.md` | design | ✅ | 原位存在（298行） | ✅ **正确** |
| 5 | `docs/core/事件总线宪法定位审查报告-v1.1历史.md` | audit | ❌ | **磁盘上彻底不存在** | 🔴 **死链** |
| 6 | `docs/conformity-audit.md` | audit | ❌ | **磁盘上彻底不存在** | 🔴 **死链** |
| 7 | `docs/consistency-design.md` | design | ❌ | → `docs/core/consistency-design.md` ✅ | **路径错误**（少了一级 core/） |
| 8 | `docs/constitution/Cortex 概念顶层设计 v2.5.35.md` | constitution | ✅ | 存在（与 constitutionPath 重复注册） | ⚠️ **重复注册** |

---

## 三、构建验证结论

### 🔴 阻断性问题（2 条）

| 路径 | 问题 |
|------|------|
| `docs/core/事件总线宪法定位审查报告-v1.1历史.md` | 文件已从磁盘彻底删除，无任何副本残留 |
| `docs/conformity-audit.md` | 文件已从磁盘彻底删除，无任何副本残留 |

这两条路径指向的文档已彻底消失。任何依赖 `cortex-docs.json` 的构建/导航工具将因这两条死链而失败。

### 🟡 非阻断性问题（5 条）

| 路径 | 问题 | 可自动修复？ |
|------|------|-------------|
| 4 条归档文档路径 | 文件已迁至 `docs/archive/`，注册表未同步更新 | ✅ 是——更新路径为 `docs/archive/...` |
| `docs/consistency-design.md` | 实际位置为 `docs/core/consistency-design.md` | ✅ 是——补全路径为 `docs/core/consistency-design.md` |

### ⚠️ 版本号偏差

宪法路径注册的 `"version": "2.5.40"` 与文件实际版本号（v2.5.35）不一致。

### 📊 量化汇总

| 指标 | 数值 |
|------|------|
| 注册条目总数 | 9（含 constitutionPath） |
| ✅ 路径完全正确 | 2（宪法 v2.5.35 + 意图响应体系设计） |
| ⚠️ 存在但路径偏差 | 5 |
| ❌ 死链（文件已删除） | 2 |
| **路径准确率** | **22%** |

---

## 四、建议

### 立即修复（P0）

1. 从 `cortex-docs.json` 中移除两条死链：
   - `docs/core/事件总线宪法定位审查报告-v1.1历史.md`
   - `docs/conformity-audit.md`

2. 或确认这两份文档是否需要重新撰写并补回。

### 需同步更新（P1）

3. 将 4 条归档路径更新为 `docs/archive/` 下的实际位置：
   - `docs/core/Core-2治理层架构推演全记录.md` → `docs/archive/Core-2治理层架构推演全记录.md`
   - `docs/core/治理层设计.md` → `docs/archive/治理层设计.md`
   - `docs/core/Agent标签词汇表-v2.0.md` → `docs/archive/Agent标签词汇表-v2.0.md`

4. 补全 `consistency-design.md` 路径为 `docs/core/consistency-design.md`

5. 宪法版本号统一：要么文件重命名为 v2.5.40，要么注册表 version 改回 2.5.35

---

## 五、判例引用

> 依据 [2026-07-25-docs-configuration-audit.md](./2026-07-25-docs-configuration-audit.md) §第一罪（路径大面积失效）：
> 7 条不存在的路径中，5 条文件实际存在于归档目录但注册表未同步，2 条已彻底消失。
> 本次验证进一步确认：**9 条路径中仅 2 条完全准确（22%）**，与上次审计结论一致。
> ——天权定论，可被引用。

---

*凝光 · 群玉阁*
*天权定论，不得上诉*
