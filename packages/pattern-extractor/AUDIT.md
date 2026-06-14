# @cortex/pattern-extractor — 审计合规性报告

> **审计日期**: 2025-07-18
> **审计范围**: 测试文件首行标注、package.json 命名空间、workspace 依赖、PACKAGE_POSITIONING.md
> **审计标准**: Cortex 包发布合规性检查清单

---

## 审计项总览

| # | 检查项 | 状态 | 说明 |
|---|--------|------|------|
| 1 | 测试文件首行 `// @ci: unit` 标注 | ✅ 通过 | 4/4 测试文件首行正确标注 |
| 2 | package.json 命名空间 `@cortex/` | ✅ 通过 | `name: "@cortex/pattern-extractor"` |
| 3 | 内部依赖使用 `workspace:*` | ✅ 通过 | `@cortex/shared` 使用 `workspace:*` |
| 4 | PACKAGE_POSITIONING.md 存在 | ❌ **未通过** | 文件缺失 |
| 5 | PACKAGE_POSITIONING.md 回答 Q1 | ❌ **未通过** | 文件不存在 |
| 6 | PACKAGE_POSITIONING.md 回答 Q2 | ❌ **未通过** | 文件不存在 |
| 7 | PACKAGE_POSITIONING.md 回答 Q3 | ❌ **未通过** | 文件不存在 |

**综合结果**: ⚠️ **有条件通过** — 4/7 项通过，3/7 项因 PACKAGE_POSITIONING.md 缺失未通过

---

## 1️⃣ 测试文件首行 `// @ci: unit` 标注

### 检查标准

每个 `.spec.ts` 测试文件的第一行必须是 `// @ci: unit` 标注，用于 CI 识别测试类型。

### 逐文件检查结果

| 文件路径 | 首行内容 | 合规 |
|---------|---------|:----:|
| `tests/extractor.spec.ts` | `// @ci: unit` | ✅ |
| `tests/pattern.spec.ts` | `// @ci: unit` | ✅ |
| `tests/registry.spec.ts` | `// @ci: unit` | ✅ |
| `tests/scanner.spec.ts` | `// @ci: unit` | ✅ |

**结论**: ✅ **全部通过** — 4 个测试文件全部在首行正确标注 `// @ci: unit`。

---

## 2️⃣ package.json 命名空间 `@cortex/`

### 检查标准

包的 `name` 字段必须以 `@cortex/` 为命名空间前缀，确保在 Cortex 生态中的唯一标识。

### 检查结果

```json
{
  "name": "@cortex/pattern-extractor",
  "version": "0.1.0",
  "private": true,
  ...
}
```

**结论**: ✅ **通过** — 包名 `@cortex/pattern-extractor` 符合 `@cortex/` 命名空间规范。

---

## 3️⃣ 内部依赖使用 `workspace:*`

### 检查标准

所有指向同一 monorepo 内部包的依赖（`@cortex/*`）必须使用 `workspace:*` 协议，确保 monorepo 中始终引用本地源码而非 npm 已发布版本。

### 检查结果

```json
"dependencies": {
    "@cortex/shared": "workspace:*"
}
```

| 依赖名 | 声明位置 | 版本协议 | 合规 |
|--------|---------|---------|:----:|
| `@cortex/shared` | dependencies | `workspace:*` | ✅ |
| `@types/node` | devDependencies | `^22.0.0` | ✅ (非 workspace 包) |
| `eslint` | devDependencies | `^10.4.1` | ✅ (非 workspace 包) |
| `typescript` | devDependencies | `^5.7.0` | ✅ (非 workspace 包) |
| `vitest` | devDependencies | `^2.1.0` | ✅ (非 workspace 包) |

**结论**: ✅ **通过** — 唯一的内部包依赖 `@cortex/shared` 使用了 `workspace:*` 协议。其余 devDependencies 均为外部 npm 包，使用常规 semver 范围是正确的。

---

## 4️⃣ PACKAGE_POSITIONING.md 存在性

### 检查标准

每个包必须在包根目录包含 `PACKAGE_POSITIONING.md` 文件，回答三个关键问题，明确该包在 Cortex 生态系统中的位置。

### 检查结果

| 检查项 | 结果 |
|--------|:----:|
| 文件 `packages/pattern-extractor/PACKAGE_POSITIONING.md` 是否存在 | ❌ **不存在** |
| 参考: 同级其他包是否已创建 | ✅ 是（`packages/memory/`, `packages/doctor/`, `packages/fsm-compiler/`, `packages/prompt-kit/` 等 8 个包及根目录已存在） |

**结论**: ❌ **未通过** — `PACKAGE_POSITIONING.md` 文件缺失。

---

## 5️⃣–7️⃣ PACKAGE_POSITIONING.md 三个问题回答

### 检查标准

PACKAGE_POSITIONING.md 必须清晰回答以下三个问题：

- **Q1**: 这个包解决什么问题？
- **Q2**: 这个包的职责边界是什么？
- **Q3**: 这个包和其他包的关系是什么？

### 检查结果

由于文件缺失，三个问题**均未回答**：

| 问题 | 回答状态 | 依据 |
|------|:--------:|------|
| Q1: 这个包解决什么问题？ | ❌ 无 | PACKAGE_POSITIONING.md 不存在 |
| Q2: 这个包的职责边界是什么？ | ❌ 无 | PACKAGE_POSITIONING.md 不存在 |
| Q3: 这个包和其他包的关系是什么？ | ❌ 无 | PACKAGE_POSITIONING.md 不存在 |

### 补充说明

尽管 `DESIGN.md`（位于 `packages/pattern-extractor/DESIGN.md`）已经在第 1 节「包定位」中包含了对 Q1/Q2/Q3 的部分回答（1.3 解决的问题、1.4 不做的事、2.2 核心职责、3.1 依赖方向），但 `PACKAGE_POSITIONING.md` 作为一个**独立的必需文件**，**不能**被 DESIGN.md 替代。理由如下：

1. `PACKAGE_POSITIONING.md` 是 Cortex 包发布合规性检查清单的硬性要求项
2. 其他 8 个包已全部创建独立的 `PACKAGE_POSITIONING.md`，pattern-extractor 不应例外
3. `PACKAGE_POSITIONING.md` 的定位是**快速定位文档**（1–2 分钟阅读），而 `DESIGN.md` 是详细架构设计文档（30 分钟阅读），职责不同

---

## 整改建议

### 必须修复项（阻塞发布）

1. **创建 `packages/pattern-extractor/PACKAGE_POSITIONING.md`**
   - 参考 `packages/memory/PACKAGE_POSITIONING.md` 的格式
   - 使用 DESIGN.md 第 1–2 节已有内容回答 Q1/Q2/Q3
   - 确保包含以下三个章节：
     - `## Q1: 这个包解决什么问题？`
     - `## Q2: 这个包的职责边界是什么？`
     - `## Q3: 这个包和其他包的关系是什么？`

### 建议优化项

无其他优化建议。测试标注、命名空间、workspace 依赖均已达标。

---

## 附录: 引用文件清单

| 文件 | 用途 |
|------|------|
| `packages/pattern-extractor/package.json` | 命名空间 & workspace 依赖检查 |
| `packages/pattern-extractor/tests/extractor.spec.ts` | 首行标注检查 |
| `packages/pattern-extractor/tests/pattern.spec.ts` | 首行标注检查 |
| `packages/pattern-extractor/tests/registry.spec.ts` | 首行标注检查 |
| `packages/pattern-extractor/tests/scanner.spec.ts` | 首行标注检查 |
| `packages/memory/PACKAGE_POSITIONING.md` | 参考格式文件 |
| `packages/pattern-extractor/DESIGN.md` | 补充信息源 |

---

*报告由审计合规性工具自动生成 | 模板版本 v1.0*
