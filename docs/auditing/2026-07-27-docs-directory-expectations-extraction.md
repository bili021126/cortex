# docs/ 目录结构预期——从工程框架配置中提取

> **裁定编号**：DOCS-EXP-2026-0727  
> **裁定人**：凝光（DocGovernAgent）  
> **依据**：README.md / docs/README.md / cortex-docs.json / cortex.config.json（等同物）/  
>          宪法 v3.0 / 代码法典（coding-standards.md）/ 治理层设计 v3.0 /  
>          `@cortex/config` 常量与注册表 / `packages/config/src/data/docs.json`  
> **存档位置**：`docs/auditing/`  
> **判例状态**：生效——可作为后续审计引用的权威判例  

---

## 一、结论摘要

Cortex 工程框架对 `docs/` 目录结构的预期来自 **6 个独立的源头**，它们共同定义了一套分层、分区、版本化的文档治理体系。各源之间高度一致，不存在根本性矛盾。

**核心结构**：

```
docs/
├── README.md               # 导航地图（必读入口）
├── constitution/           # 宪法体系
├── amendments/             # 修正案（JSON 格式）
├── auditing/               # 审计报告（日期命名）
├── core/                   # 活跃设计文档
├── analysis/               # 分析文档
├── archive/                # 历史归档
│   ├── constitution/       #   旧版宪法
│   ├── core/               #   Core 阶段讨论
│   └── meso-lite/          #   Meso-Lite 阶段
├── assets/                 # 资源文件（图片等）
├── inspection/             # 检查报告
├── review/                 # 审查记录
└── reviews/                # 另一份审查记录（⚠️ 与 review/ 重复）
```

---

## 二、源头清单与条款索引

| # | 源头文件 | 相关条款 | 定义了 docs/ 的哪些部分 |
|---|---------|---------|----------------------|
| S1 | `cortex/README.md`（项目根 README） | 「项目结构」节 | constitution/、amendments/、auditing/ |
| S2 | `docs/README.md`（文档导航地图） | 全文 | constitution/、amendments/、auditing/、core/、analysis/、archive/ |
| S3 | `cortex-docs.json`（文档治理注册表） | docRegistry 数组 | constitution/、core/ 的 8 条注册记录 |
| S4 | `packages/config/src/constants/file-paths.ts` | DIR_CONSTITUTION、DIR_AMENDMENTS | constitution/、amendments/ |
| S5 | `packages/config/src/data/docs.json` | constitutionPath、docRegistry | 8 条文档注册记录 |
| S6 | `prompts/coding-standards.md`（代码法典） | §八（提示词管理） | prompts/ 结构（间接参考类比） |
| S7 | `docs/constitution/Cortex 概念顶层设计 v3.0.md` | §十六~§二十三 | 各节提及 docs/ 子目录的引用 |
| S8 | `docs/core/治理层设计-v3.0-全量整合版.md` | 附录 B | 治理层设计规格文档索引 |

---

## 三、各子目录的预期详述

### 3.1 `docs/constitution/` —— 宪法体系

| 属性 | 内容 |
|------|------|
| **路径常量** | `DIR_CONSTITUTION = "docs/constitution"`（S4） |
| **预期内容** | 宪法核心文档（.md 格式） |
| **来源** | S1「宪法体系」、S2「宪法」节、S4 |
| **文件名约定** | `Cortex 概念顶层设计 v<版本>.md`（如 `v2.5.35.md`、`v3.0.md`） |
| **子目录** | `archive/`（历史宪法备份）、`backup/`（修宪前备份） |
| **治理规则** | 宪法是「代码即真相」的最高权威。v3.0 替代 v2.5.35 等前代版本。每份宪法标注版本号和状态。 |
| **当前文件** | `Cortex 概念顶层设计 v3.0.md`（现行）、`Cortex 概念顶层设计 v2.5.35.md`（历史参考）等共 7 个文件 |

### 3.2 `docs/amendments/` —— 修正案

| 属性 | 内容 |
|------|------|
| **路径常量** | `DIR_AMENDMENTS = "docs/amendments"`（S4） |
| **预期内容** | 修宪提案的完整记录（.json 格式） |
| **来源** | S1「修正案」、S2「修正案」节、S4 |
| **编号约定** | `AM-YYYY-MMDD-NNN.json`（如 `AM-2026-0715-001.json`） |
| **治理规则** | 每份 .json 是一次修宪提案的完整记录。必须包含：提案内容、评审记录、状态。 |
| **当前文件** | 25 个 .json 文件 + 2 个 .md 评审文件 |

### 3.3 `docs/auditing/` —— 审计报告

| 属性 | 内容 |
|------|------|
| **路径常量** | 无显式常量（未在 file-paths.ts 中注册） |
| **预期内容** | Agent（凝光/刻晴）的治理审计产出（.md 格式） |
| **来源** | S1「审计报告」、S2「审计报告」节 |
| **命名约定** | `YYYY-MM-DD-<标题>.md`（日期前缀） |
| **治理规则** | 审计报告由 doc-govern Agent 产出，归档后供后续审计引用判例。 |
| **当前文件** | 12 个 .md 文件 |

### 3.4 `docs/core/` —— 活跃设计文档

| 属性 | 内容 |
|------|------|
| **路径常量** | 无显式常量 |
| **预期内容** | 当前活跃的设计文档、架构推演、路线图 |
| **来源** | S2「当前活跃设计文档」节、S3（cortex-docs.json 中 5 条 core/ 记录） |
| **文档类型** | design（设计文档）、audit（审计记录，非 canonical） |
| **治理规则** | 文档在 cortex-docs.json 中注册，标注 type/version/canonical。已收敛文档保留为历史参考。 |
| **当前文件** | ~38 个文件（含核心设计文档、路线图、架构映射等） |

### 3.5 `docs/analysis/` —— 分析文档

| 属性 | 内容 |
|------|------|
| **路径常量** | 无显式常量 |
| **预期内容** | 纳西妲（知识库 Agent）的系统分析报告 |
| **来源** | S2「分析文档」节 |
| **文件数量** | 15 份分析报告（S2 标注） |
| **治理规则** | 分析文档是纳西妲的产出，归档在 analysis/ 目录。 |

### 3.6 `docs/archive/` —— 历史归档

| 属性 | 内容 |
|------|------|
| **路径常量** | 无显式常量 |
| **预期内容** | 非现行的历史文档，按子目录分类 |
| **来源** | S2「历史归档」节 |
| **子目录** | `archive/constitution/`（历史宪法）、`archive/core/`（Core 阶段讨论）、`archive/meso-lite/`（Meso-Lite 阶段） |
| **治理规则** | "参考价值，非现行"——标注废弃/历史状态。内容已整合到现行文档的标注收敛关系。 |

### 3.7 其他子目录

| 目录 | 来源 | 预期内容 |
|------|------|---------|
| `docs/assets/` | S2（目录列表可见） | 资源文件（图片等） |
| `docs/inspection/` | S2（目录列表可见） | 检查报告 |
| `docs/review/` | S2（目录列表可见） | 审查记录 |
| `docs/reviews/` | S2（目录列表可见） | 另一份审查记录（⚠️ 与 review/ 重复——建议合并） |
| `docs/conformity-audit.md` | S3（根目录文件） | 根目录下的单篇文档 |
| `docs/consistency-design.md` | S3（根目录文件） | 根目录下的单篇设计文档 |

---

## 四、文档元数据模型（从 S3/S5 中提取）

从 `cortex-docs.json`（S3）和 `packages/config/src/data/docs.json`（S5）提取的文档注册表结构：

```typescript
interface DocRegistryEntry {
  /** 文档相对路径 */
  path: string;

  /** 文档类型 */
  type: "constitution" | "design" | "audit";

  /** 语义版本号 */
  version: string;

  /** 是否为权威版本（非 canonical 表示历史/参考副本） */
  canonical: boolean;
}
```

**约定规则**：
1. 宪法文档类型为 `"constitution"`，设计文档为 `"design"`，审计报告为 `"audit"`
2. `canonical: true` 表示当前权威版本，`canonical: false` 表示历史参考
3. 文档路径以 `docs/` 为相对根

---

## 五、与代码法典的映射关系

代码法典（S6）§八规定了 `prompts/` 的结构管理，其「双源同步规则」对 `docs/` 同样适用：

| 代码法典规则 | 对 docs/ 的适用 |
|-------------|----------------|
| §8.1 存放位置（目录结构约定） | ✅ 适用——docs/ 的子目录结构在 README 和配置中定义 |
| §8.2 双源同步规则 | ✅ 适用——docs.json 是 machine-readable 源，README.md 是 human-readable 源 |
| §8.3 占位符约定 | ⚠️ 部分适用——文档中不常见 {{PLACEHOLDER}}，但文档导航地图中的链接即隐含的引用关系 |

---

## 六、与宪法 v3.0 的映射关系

宪法 v3.0（S7）中多次引用 docs/ 子目录：

| 宪法章节 | 引用路径 | 含义 |
|---------|---------|------|
| §三·3.2 | `core/Cortex-架构映射-五流六层七原则.md` | 核心文档引用 |
| §二十二 | `test-output/self-examination-soft/` | 自审视输出路径 |
| §十·11.6 | `packages/config/data/` | 配置数据路径 |
| §十七 | `docs/core/Cortex-演进方法论-九阶段闭环.md` | 演进方法论文档引用 |

宪法本身不定义 docs/ 结构，而是消费它。

---

## 七、发现的问题

### ⚠️ P2：review/ 与 reviews/ 目录重复

`docs/` 下同时存在 `review/` 和 `reviews/` 两个目录，命名冗余。根据代码法典 §10.4（死代码即时死刑）和 §7.6（已拆分配置文件的清理义务）的精神，应合并为单一目录。

### ⚠️ P3：auditing/ 未在 file-paths.ts 中注册

`DIR_CONSTITUTION` 和 `DIR_AMENDMENTS` 已在 `@cortex/config` 的 `file-paths.ts` 中注册常量，但 `DIR_AUDITING` 缺失。虽然当前无运行时代码依赖此常量，但根据硬编码禁令（§七），应补全。

### ℹ️ P4：cortex-docs.json 与 config/data/docs.json 的版本不一致

| 文件 | constitutionPath | 记录数 |
|------|----------------|--------|
| `cortex-docs.json`（S3） | `v2.5.35.md` | 8 条 |
| `config/src/data/docs.json`（S5） | `v2.5.21.md` | 8 条 |

两条源存在宪法版本分歧（v2.5.35 vs v2.5.21），虽不影响运行时（均不再是最新 v3.0），但反映了文档注册表的同步滞后。

---

## 八、规范化的 docs/ 目录结构（建议模板）

```
docs/
├── README.md                      # 导航地图（所有人从这里开始）
├── constitution/                  # 宪法体系（DIR_CONSTITUTION）
│   ├── Cortex 概念顶层设计 v3.0.md   # 现行宪法
│   └── ...                         # 前代宪法（标注替代关系）
├── amendments/                    # 修正案（DIR_AMENDMENTS，JSON 格式）
│   ├── AM-2026-0715-001.json
│   └── ...
├── auditing/                      # 审计报告（建议注册 DIR_AUDITING）
│   ├── 2026-07-25-*.md
│   └── ...
├── core/                          # 活跃设计文档（cortex-docs.json 注册）
│   ├── 概念设计全面整合-*.md
│   ├── 治理层设计.md
│   ├── consistency-design.md
│   ├── Cortex-*（架构映射）
│   └── ...
├── analysis/                      # 分析文档（纳西妲产出）
│   ├── 思考执行体系总纲.md
│   └── ...
├── archive/                       # 历史归档（非现行，参考价值）
│   ├── constitution/
│   ├── core/
│   └── meso-lite/
├── assets/                        # 资源文件
├── inspection/                    # 检查报告
├── review/                        # 审查记录
└── reviews/                       # ⚠️ 建议合并至 review/
```

---

## 九、判例引用说明

本次裁定建立了以下可作为后续审计引用的判例：

| 判例编号 | 内容 |
|---------|------|
| DOCS-EXP-2026-0727-01 | docs/ 子目录的 6 个预期源头清单 |
| DOCS-EXP-2026-0727-02 | 文档注册表的元数据模型（path/type/version/canonical） |
| DOCS-EXP-2026-0727-03 | 修正案编号约定 `AM-YYYY-MMDD-NNN` |
| DOCS-EXP-2026-0727-04 | 审计报告命名约定 `YYYY-MM-DD-<标题>.md` |
| DOCS-EXP-2026-0727-05 | review/ 与 reviews/ 目录重复——建议合并 |

---

*天权定论，不得上诉。归档入 docs/auditing/，作为判例库的新条目。*
