# 文档配置审计报告

**日期**：2026-07-25  
**审计人**：凝光 · 天权 DocGovern Agent  
**依据**：《Cortex 代码法典》§零（交付铁律）、§七（配置驱动开发铁律）、§七.6（已拆分配置文件的清理义务）

---

## 一、审计范围

对项目中所有文档框架配置文件进行字段完整性、语法正确性、路径有效性审查。

### 受审文件（共 3 个）

| 序号 | 文件路径 | 角色 |
|------|---------|------|
| 1 | `cortex-docs.json`（项目根目录） | 根级文档配置，由 `FILE_CORTEX_DOCS_JSON` 常量引用 |
| 2 | `packages/config/data/docs.json` | config 包运行时真相源（`build` 时复制到 `dist/data/`） |
| 3 | `packages/config/src/data/docs.json` | config 包 src 目录冗余副本（与 2 内容一致） |

---

## 二、字段结构完整性

### 2.1 顶层字段

| 字段 | 类型 | 根目录 cortex-docs.json | config 包 data/docs.json | config 包 src/data/docs.json |
|------|------|----------------------|------------------------|---------------------------|
| `description` | string | ❌ 缺失 | ✅ 存在 | ✅ 存在 |
| `constitutionPath` | string | ✅ 存在 | ✅ 存在 | ✅ 存在 |
| `docRegistry` | array | ✅ 存在（8 项） | ✅ 存在（8 项） | ✅ 存在（8 项） |

**判定**：根目录 `cortex-docs.json` 缺少 `description` 字段，虽未破坏解析，但不符合 config 包同类配置的完整性标准。

### 2.2 docRegistry 子字段

每项均包含 `path`、`type`、`version`、`canonical` 四个字段 ✅

- `type` 取值：`constitution`、`design`、`audit` — 均在 `DocType` 有效域内 ✅
- `version` 均为字符串 ✅
- `canonical` 均为布尔值 ✅

**判定**：结构完整，通过。

---

## 三、路径有效性——严重发现（7 处失效）

### 3.1 失效清单

| 配置中路径 | 声明 type | 所属文件 | 磁盘状态 | 实际位置 |
|-----------|----------|---------|---------|---------|
| `docs/constitution/Cortex 概念顶层设计 v2.5.21.md` | constitution | config 包两文件 | ❌ 文件不存在 | 磁盘上为 v2.5.35 |
| `docs/core/Core-2治理层架构推演全记录.md` | design | 全部三文件 | ❌ 文件不存在 | `docs/archive/Core-2治理层架构推演全记录.md` |
| `docs/core/治理层设计.md` | design | 全部三文件 | ❌ 文件不存在 | `docs/archive/治理层设计.md` |
| `docs/core/Agent标签词汇表-v2.0.md` | design | 全部三文件 | ❌ 文件不存在 | `docs/archive/Agent标签词汇表-v2.0.md` |
| `docs/core/事件总线宪法定位审查报告-v1.1历史.md` | audit | 全部三文件 | ❌ 文件不存在 | 磁盘上任何位置均未找到 |
| `docs/conformity-audit.md` | audit | 全部三文件 | ❌ 文件不存在 | 磁盘上任何位置均未找到 |
| `docs/consistency-design.md` | design | 全部三文件 | ❌ 文件不存在 | `docs/core/consistency-design.md`（路径前缀缺失 `core/`） |

### 3.2 有效路径（2 处）

| 配置中路径 | 磁盘状态 | 说明 |
|-----------|---------|------|
| `docs/constitution/Cortex 概念顶层设计 v2.5.35.md` | ✅ 存在 | 仅根目录 cortex-docs.json 引用正确 |
| `docs/core/意图响应体系设计.md` | ✅ 存在 | 三文件均正确引用 |

**总结：9 条路径中，仅 2 条有效，7 条无效。有效率为 22.2%。**

---

## 四、版本字段与文件实际版本匹配

### 4.1 宪法文件版本

| 配置文件 | 声明的 constitutionPath | 声明的 version | 文件名版本 | 状态 |
|---------|----------------------|--------------|-----------|------|
| 根目录 cortex-docs.json | `...v2.5.35.md` | `2.5.40` | v2.5.35 | ⚠️ 版本号 2.5.40 ≠ 文件名 2.5.35 |
| config 包 data/docs.json | `...v2.5.21.md` | `2.5.21` | —（文件不存在） | ❌ 引用不存在文件 |
| config 包 src/data/docs.json | 同上 | `2.5.21` | — | ❌ 同上 |

**问题**：根目录配置文件中的 `version: "2.5.40"` 与文件名 `v2.5.35` 不一致。版本号字段应反映文件实际内容的版本，而非独立标注。

---

## 五、冗余文件问题

### 5.1 src/data/docs.json — 完全冗余

`packages/config/src/data/docs.json` 与 `packages/config/data/docs.json` 内容完全一致。

**依据 §七.6**：`已拆分配置文件的清理义务——拆分完成 = 删除源文件`

虽然此处不是"拆分"而是重复，但风险相同：两份副本若不同步，必然导致配置漂移。

---

## 六、三个配置文件之间的不一致

| 维度 | 根目录 cortex-docs.json | config 包两文件 |
|------|-----------------------|---------------|
| `description` 字段 | 缺失 | 有 |
| constitutionPath 版本 | v2.5.35（✅ 存在） | v2.5.21（❌ 不存在） |
| constitution version 标注 | 2.5.40（与文件名不一致） | 2.5.21（与文件名一致但文件不存在） |
| 消费方 | 由 `FILE_CORTEX_DOCS_JSON` 常量引用 | 由 config loader 从 `dist/data/` 运行时加载 |

**结论**：存在两个独立的配置真相源，且引用的宪法版本不一致。根目录引用的是存在的 v2.5.35，config 包引用的是不存在的 v2.5.21。

---

## 七、综合判决

| 检项 | 结果 | 严重等级 |
|------|------|---------|
| JSON 语法正确性 | ✅ 通过 | — |
| 字段结构完整性 | ⚠️ 根目录缺 description | 低 |
| 路径有效性 | ❌ 7/9 路径失效 | **严重** |
| 版本号一致性 | ❌ 宪法 version 与文件名不一致 | 中 |
| 文件冗余 | ⚠️ src/data/docs.json 重复 | 中 |
| 多文件一致性 | ❌ 根目录与 config 包不一致 | **严重** |

### 裁定

1. **路径失效（7 处）** — 违反 §零 交付铁律。配置文件注册的文档路径与磁盘真实位置严重脱节，docRegistry 形同虚设。
2. **文件冗余（src/data/docs.json）** — 违反 §七.6。必须删除或建立单向引用。
3. **宪法版本分歧（v2.5.35 vs v2.5.21）** — 违反 §七（配置驱动开发铁律）。运行时真相源引用已不存在的文件。

---

## 八、建议修复方案

### 优先级 P0（阻断性）

1. 将 config 包 `data/docs.json` 的 `constitutionPath` 更新为 `"docs/constitution/Cortex 概念顶层设计 v2.5.35.md"`，version 同步为 `"2.5.35"`
2. 将 config 包 `data/docs.json` 和根目录 `cortex-docs.json` 的 docRegistry 中所有失效路径更新为磁盘上的实际位置：
   - `docs/core/Core-2治理层架构推演全记录.md` → `docs/archive/Core-2治理层架构推演全记录.md`
   - `docs/core/治理层设计.md` → `docs/archive/治理层设计.md`
   - `docs/core/Agent标签词汇表-v2.0.md` → `docs/archive/Agent标签词汇表-v2.0.md`
   - `docs/consistency-design.md` → `docs/core/consistency-design.md`
3. 移除已不存在于磁盘的文件条目：`事件总线宪法定位审查报告-v1.1历史.md`、`conformity-audit.md`

### 优先级 P1（清理）

4. 删除 `packages/config/src/data/docs.json`（冗余文件）
5. 统一根目录与 config 包的 version 字段为 `"2.5.35"`（与文件名一致）

### 优先级 P2（规范化）

6. 为根目录 `cortex-docs.json` 补充 `description` 字段
7. 建立单向源规则：config 包 `data/docs.json` 为唯一真相源，根目录 `cortex-docs.json` 改为引用或统一为同一文件

---

## 九、附：配置消费链路

```
根目录 cortex-docs.json               config 包 data/docs.json
  ↑ 由 FILE_CORTEX_DOCS_JSON 引用        ↑ 由 CONFIG_DOMAINS 注册
  ↑ 消费方：手动读入                        ↑ 由 loadConfigDomain("docs", ...) 加载
  ↑ 运行时读取                             ↑ 通过 CortexConfig.docs 访问
```

两条消费链路并存但数据不一致——这是最根本的架构问题。

---

*天权定论，不得上诉。*

*审计人：凝光 · 2026-07-25*
