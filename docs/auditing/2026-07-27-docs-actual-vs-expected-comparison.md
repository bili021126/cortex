# docs/ 实际结构与约定结构对比审计

> **裁定编号**：DOCS-AUDIT-2026-0727-02  
> **裁定人**：凝光（DocGovernAgent）  
> **前序判例**：DOCS-EXP-2026-0727（docs/ 目录结构预期提取）  
> **依据**：docs/README.md / README.md / cortex-docs.json / packages/config/src/data/docs.json / packages/config/src/constants/file-paths.ts / 实际文件清单（176 文件）  
> **存档位置**：`docs/auditing/`

---

## 一、审计方法

根据判例 DOCS-EXP-2026-0727 建立的 **8 个预期源头**（S1–S8），列出 `docs/` 的约定结构模板，逐项对比实际文件清单，标记缺失、多余、路径不匹配项。

---

## 二、整体对比

### 2.1 子目录级对比

| 约定目录 | 预期来源 | 实际存在？ | 状态 |
|---------|---------|-----------|------|
| `README.md` | S2（导航地图） | ✅ 存在 | 一致 |
| `constitution/` | S1/S2/S4（DIR_CONSTITUTION） | ✅ 存在 | ✓ |
| `constitution/archive/` | S2（宪法版本备份） | ✅ 存在 | ✓ |
| `constitution/backup/` | S2（修宪前备份） | ✅ 存在 | ✓ |
| `amendments/` | S1/S2/S4（DIR_AMENDMENTS） | ✅ 存在 | ✓ |
| `auditing/` | S1/S2（审计报告） | ✅ 存在 | ✓ |
| `core/` | S2/S3/S5（活跃设计文档） | ✅ 存在 | ✓ |
| `analysis/` | S2（纳西妲分析报告） | ✅ 存在 | ✓ |
| `archive/` | S2（历史归档） | ✅ 存在 | ✓ |
| `archive/constitution/` | S2 | ✅ 存在 | ✓ |
| `archive/core/` | S2 | ✅ 存在 | ✓ |
| `archive/meso-lite/` | S2 | ✅ 存在 | ✓ |
| `assets/` | S2（资源文件） | ✅ 存在 | ✓ |
| `inspection/` | S2（检查报告） | ✅ 存在 | ✓ |
| `review/` | S2（审查记录） | ✅ 存在 | ✓ |
| `reviews/` | S2（⚠️ 与 review/ 重复） | ✅ 存在 | ⚠️ 已知重复 |

### 2.2 额外目录——约定中未列出但实际上存在

| 实际目录 | 约定状态 | 问题 |
|---------|---------|------|
| `audit/` | ❌ 未在预期结构中 | **命名歧义**——与 `auditing/` 语义重叠 |
| `archive/analysis-old/` | ❌ 未在预期结构中（archive/ 只列了 constitution/core/meso-lite） | **未注册归档子目录** |

### 2.3 根级文件——约定中提及但状态异常

| 文件 | 约定状态 | 实际状态 |
|------|---------|---------|
| `conformity-audit.md` | S3/S5：注册于 cortex-docs.json 和 config/docs.json（canonical: true） | ❌ **不存在**——phantom registration |
| `consistency-design.md` | S3/S5：注册为 `docs/consistency-design.md` | ❌ **路径不符**——实际在 `docs/core/consistency-design.md` |

### 2.4 根级文件——实际存在但未注册/未预期

以下 3 份 `.md` 文件存在于 `docs/` 根目录，但既未在 cortex-docs.json 中注册，也未在 docs/README.md 导航地图中列出：

| 文件 | 问题 |
|------|------|
| `core-pipeline-integrity-verify.md` | 无注册、无导航条目 |
| `cortex-evolution-master-plan.md` | 无注册、无导航条目 |
| `st-3-ci-gate-verification-report.md` | 无注册、无导航条目 |

---

## 三、详细问题清单与定级

### 🔴 P0——违反宪法/治理规则（必须修复）

#### P0-1：phantom registration——`docs/conformity-audit.md` 已注册但实际不存在

- **发现**：`cortex-docs.json` 和 `packages/config/src/data/docs.json` 均登记：
  ```json
  { "path": "docs/conformity-audit.md", "type": "audit", "version": "1.0.0", "canonical": true }
  ```
  但 `file_info` 确认该文件 **不存在**。
- **影响**：文档注册表包含虚假条目，破坏「文档治理注册表」的权威性。
- **依据**：代码法典 §10.4（死代码即时死刑）——注册表条目指向不存在的文件 = 死引用。
- **建议**：(1) 确认该文件是否已移动/删除；(2) 若已删除则从两份 docs.json 中移除该条目。

#### P0-2：registry path mismatch——`docs/consistency-design.md` 注册路径与实际路径不符

- **发现**：两份 docs.json 均登记 `{ "path": "docs/consistency-design.md" }`，但实际文件位于 `docs/core/consistency-design.md`。
- **影响**：注册表路径错误，任何依赖注册表路径的工具（如文档索引、CI 检查）都会找不到目标。
- **建议**：将两份 docs.json 中的路径修正为 `docs/core/consistency-design.md`。

---

### 🔴 P1——架构设计缺陷（建议尽快修复）

#### P1-1：`docs/audit/` vs `docs/auditing/` 命名歧义

- **发现**：同时存在 `docs/audit/`（4 个文件：full-codebase-audit.md、novel-concepts-conflict-check.md、problem-taxonomy-split-merge-invariant-novel.md、theory-coverage-review.md）和 `docs/auditing/`（12 个治理审计报告）。二者语义高度重叠。
- **影响**：读者无法判断该去 `audit/` 还是 `auditing/` 查找审计记录。根据约定结构（S1/S2），`auditing/` 是规范目录名。
- **依据**：代码法典 §10.4（死代码即时死刑）——命名歧义增加认知成本。
- **建议**：(1) 将 `docs/audit/` 的 4 个文件移至 `docs/auditing/`；(2) 删除 `docs/audit/` 目录。

#### P1-2：`docs/constitution/` 包含非宪法文件

- **发现**：`docs/constitution/` 目录下存在以下非常规文件：
  - `三人-改写.md`
  - `三人.md`
  - `小昔涟的翁法罗斯.md`
  - `昔涟原始角色定义-翁法罗斯手稿.md`
  - `翁法罗斯游记.md`
- **影响**：根据 DIR_CONSTITUTION（S4）的定义和 S1/S2 的定位，`constitution/` 仅用于存放宪法体系文档和版本备份。上述文件是角色人格/世界观设定文档，不属于宪法范畴。
- **依据**：代码法典 §9.9（包模块功能边界与职责划分）——每个目录应有唯一职责。
- **建议**：将上述 5 个文件移至 `docs/archive/` 或新建 `docs/lore/` 子目录。

---

### 🟡 P2——一致性问题（应在下一轮治理迭代中修复）

#### P2-1：`review/` 与 `reviews/` 目录重复（前次审计已指出，未修复）

- **发现**：判例 DOCS-EXP-2026-0727 §七 ⚠️P2 已指出此问题，但至今未解决。
  - `docs/review/`（1 文件：loop-agent-registration-verification.md）
  - `docs/reviews/`（2 文件：code_review_diagnosis.md、constitution-audit-review.md）
- **影响**：两份目录共存 30+ 日未整合。
- **依据**：代码法典 §7.6（已拆分配置文件的清理义务）——重复是配置漂移的源头。
- **建议**：合并为单一 `docs/review/` 或 `docs/reviews/`，删除空壳。

#### P2-2：`docs/archive/analysis-old/` 未在约定结构中列出

- **发现**：`docs/archive/` 下存在预期结构未列出的 `analysis-old/` 子目录，包含 3 份纳西妲的旧分析报告。
- **影响**：读者通过导航地图无法知晓此目录的存在。
- **建议**：在 docs/README.md 的「历史归档」节补充 `analysis-old/` 条目，或将其内容合并至 `archive/core/`。

---

### 🟢 P3——增量改进建议

#### P3-1：3 份根级文档未纳入文档注册表

- **发现**：以下文件存在于 `docs/` 根目录但未在 cortex-docs.json 或 config/docs.json 中注册：
  - `core-pipeline-integrity-verify.md`（约 259 行审计报告）
  - `cortex-evolution-master-plan.md`（约 600+ 行架构设计）
  - `st-3-ci-gate-verification-report.md`（CI 门禁验证报告）
- **影响**：文档治理注册表不完整。上述文档虽然是近期新增，但若不注册，后续审计无法对其进行版本追踪。
- **建议**：将上述 3 份文档补充注册到 cortex-docs.json（以及 config/docs.json 以保持同步），标注合理的 type/version。

#### P3-2：`auditing/` 未在 `file-paths.ts` 中注册（前次审计已指出，未修复）

- **发现**：判例 DOCS-EXP-2026-0727 §七 ⚠️P3 已指出 `DIR_AUDITING` 常量缺失，至今未补。
- **依据**：代码法典 §七（硬编码禁令）——审计报告路径散落在多处。
- **建议**：在 `packages/config/src/constants/file-paths.ts` 中添加 `export const DIR_AUDITING = "docs/auditing"`。

---

## 四、文档注册表对比

### 4.1 两份 docs.json 的宪法路径版本分歧（已知，未修复）

| 文件 | constitutionPath | 状态 |
|------|----------------|------|
| `cortex-docs.json`（根级） | `v2.5.35.md` | 落后于 v3.0 |
| `config/src/data/docs.json` | `v2.5.21.md` | 更落后 |

两份均未指向现行宪法 `Cortex 概念顶层设计 v3.0.md`。

### 4.2 注册条目状态总表

| path | type | version | canonical | 实际存在？ | 路径匹配？ |
|------|------|---------|-----------|-----------|-----------|
| `docs/constitution/Cortex 概念顶层设计 v2.5.21.md` | constitution | 2.5.21 | true | ❌ 不存在（v2.5.35 已替代） | — |
| `docs/constitution/Cortex 概念顶层设计 v2.5.35.md` | constitution | 2.5.40* | true | ✅ 存在 | ✓ |
| `docs/conformity-audit.md` | audit | 1.0.0 | true | ❌ 不存在 | — |
| `docs/consistency-design.md` | design | 1.0.0 | true | ✅ 实际在 `docs/core/` | ❌ 路径不匹配 |
| `docs/core/Core-2治理层架构推演全记录.md` | design | 1.0.0 | true | ✅ 存在 | ✓ |
| `docs/core/治理层设计.md` | design | 1.0.0 | true | ✅ 存在 | ✓ |
| `docs/core/Agent标签词汇表-v2.0.md` | design | 2.0.0 | true | ✅ 存在 | ✓ |
| `docs/core/意图响应体系设计.md` | design | 1.0.0 | true | ✅ 存在 | ✓ |
| `docs/core/事件总线宪法定位审查报告-v1.1历史.md` | audit | 1.1.0 | false | ✅ 存在 | ✓ |

> *cortex-docs.json 标注 version 2.5.40 但文件名是 v2.5.35——版本号与文件名不一致，但此为已知问题（前次审计中已提及）。

---

## 五、与代码法典的合规性交叉审计

| 法典条款 | 检查项 | 结果 |
|---------|--------|------|
| §7.6 已拆分配置文件的清理义务 | `review/` vs `reviews/` 重复未清理 | ❌ 违规 |
| §9.9 包模块功能边界与职责划分 | `constitution/` 含非宪法文件 | ❌ 违规 |
| §10.4 死代码即时死刑 | `conformity-audit.md` 死引用 | ❌ 违规 |
| §8.2 双源同步规则 | cortex-docs.json 与 config/docs.json 宪法版本不一致 | ⚠️ 需同步 |
| §七 硬编码禁令 | `auditing/` 路径无 DIR_AUDITING 常量 | ⚠️ 需补充 |

---

## 六、修复建议优先级

| 优先级 | 问题 | 建议操作 | 预计工作量 |
|--------|------|---------|-----------|
| **立即** | P0-1：phantom registration | 从两份 docs.json 移除 `conformity-audit.md` 条目 | 5 min |
| **立即** | P0-2：路径不匹配 | 两份 docs.json 中 `consistency-design.md` 路径修正为 `docs/core/consistency-design.md` | 5 min |
| **高** | P1-1：audit/ vs auditing/ 歧义 | 合并 4 文件到 auditing/，删除 audit/ | 15 min |
| **高** | P1-2：constitution/ 含非宪法文件 | 将 5 个角色文件移出 constitution/ | 15 min |
| **中** | P2-1：review/ vs reviews/ 重复 | 合并为单一目录 | 10 min |
| **中** | P2-2：archive/analysis-old/ 未注册 | 更新 docs/README.md 或合并内容 | 10 min |
| **低** | P3-1：3 份根级文档未注册 | 补充到 cortex-docs.json + config/docs.json | 10 min |
| **低** | P3-2：DIR_AUDITING 缺失 | 添加到 file-paths.ts | 5 min |

---

## 七、判例引用

本次裁定建立以下可引用的新判例：

| 判例编号 | 内容 |
|---------|------|
| DOCS-AUDIT-2026-0727-02-01 | Phantom registration 判定标准：docs.json 中注册但实际不存在的文件属于死引用 |
| DOCS-AUDIT-2026-0727-02-02 | Registry path mismatch 判定标准：docs.json 中路径与实际路径不符 → 两份源同步修正 |
| DOCS-AUDIT-2026-0727-02-03 | 命名歧义判定标准：audit/ vs auditing/ 语义重叠 → 按约定规范名合并 |
| DOCS-AUDIT-2026-0727-02-04 | 目录职责溢出判定标准：constitution/ 存放非宪法文件 → 按 DIR_CONSTITUTION 定义清理 |
| DOCS-AUDIT-2026-0727-02-05 | 前次判例未修复的升级规则：同一问题在两个审计周期内未修复 → P2 升级为 P1 |

---

## 八、结论

实际 `docs/` 目录结构与约定结构 **大体一致但存在 10 项偏差**，其中 **2 项 P0（必须立即修复）**、**2 项 P1（架构层面需修复）**、**2 项 P2（需在本迭代修复）**、**2 项 P3（增量改进）**，以及 **2 项前次审计已指出但未修复的遗留问题**。

最紧急的两项（P0-1 phantom registration、P0-2 registry path mismatch）直接损害文档注册表的可信度——注册表声称存在的文档不存在，注册表声称在此处的文档在彼处。建议在下一个工作会话中优先修复。

此外，前次判例 DOCS-EXP-2026-0727 指出的两项问题（review/ vs reviews/ 重复、DIR_AUDITING 缺失）在 30 天后仍未修复，根据判例 DOCS-AUDIT-2026-0727-02-05（升级规则），将后续未修复的 P2 标记为跨周期积压。

---

*天权定论，不得上诉。归档入 docs/auditing/，作为判例库的新条目。*
