# Agent 标签词汇表 v2.0

> **定位**：Core 阶段准入条件 #5。定义 TaskBoard 节点标签的固定封闭词汇，Agent 自描述匹配的唯一依据。
> **原则**：封闭词汇——MetaAgent 只能使用此表中的标签，Agent 只能声明此表中的标签。匹配为纯集合交集，不依赖 LLM。

---

## 一、词汇表——17 标签 × 6 Agent

| # | 标签 | 归属 Agent | 含义 | MetaAgent 何时用 |
|---|------|-----------|------|-----------------|
| 1 | `implementation` | CodeAgent | 写新代码/新功能 | 用户要求实现新功能 |
| 2 | `bugfix` | CodeAgent | 修复已知 bug | 用户报告 bug 或测试失败 |
| 3 | `refactor` | CodeAgent | 重构现有代码（不改行为） | 用户要求改善代码结构 |
| 4 | `test` | CodeAgent | 写新测试或修改现有测试 | 用户要求补充/修正测试 |
| 5 | `config` | CodeAgent | 配置文件修改（依赖/构建/环境） | 用户要求改配置 |
| 6 | `review` | ReviewAgent | 通用代码审查 | 产出需要审查 |
| 7 | `audit` | ReviewAgent | 安全/性能/合规审计 | 安全或性能风险节点 |
| 8 | `research` | AnalysisAgent | 调研代码库/领域/技术 | 需要查代码库才能回答 |
| 9 | `analysis` | AnalysisAgent | 分析数据/日志/性能/模式 | 需要分析而非查找 |
| 10 | `deploy` | OpsAgent | 部署到目标环境 | 产出达到可部署状态 |
| 11 | `ops` | OpsAgent | 运维操作（重启/检查/监控/备份） | 运维类任务 |
| 12 | `pattern_scan` | LoopAgent | 扫描代码库找模式/反模式 | 阶段性全量扫描 |
| 13 | `skill_precipitate` | LoopAgent | 从模式中提取可复用技能 | 模式确认后沉淀 |
| 14 | `plan_review` | DocGovernAgent | 审查 MetaAgent 的规划 | 每次规划产出后 |
| 15 | `doc_audit` | DocGovernAgent | 审计项目文档一致性 | 阶段门禁/定期 |
| 16 | `constitution_check` | DocGovernAgent | 检查宪法合规性 | 修宪后/阶段终审 |
| 17 | （保留位） | — | 未来扩展需修宪 | — |

---

## 二、从宪法 v2.0 草案标签的变更

| 宪法草案标签 | 处置 | 原因 |
|------------|------|------|
| `inspect` | **删除，归入 `audit`** | 与 `audit` 含义重叠。`audit` 涵盖安全检查+代码质量检查 |
| `search` | **删除，归入 `research`** | `search` 是工具（ToolRegistry），不是任务类型。`research` 包括查+研 |
| `ci` | **删除，归入 `ops`** | CI 是 `ops` 的子集。OpsAgent 统一处理 CI+部署+监控 |

---

## 三、匹配规则

### 3.1 基本匹配

```
Agent 声明: self_tags = {t1, t2, ...}  // Agent 类型固定的标签集
MetaAgent 标注: node.tags = {t_a, t_b, ...}  // 从本词汇表选取
匹配判定: node.tags ∩ agent.self_tags ≠ ∅  →  Agent 可认领
```

### 3.2 约束

| 规则 | 内容 |
|------|------|
| **封闭性** | MetaAgent 只能使用上表 16 个标签，不得自创 |
| **至少一标签** | 每个 TaskBoard 节点打至少 1 个标签 |
| **无代理匹配** | 不用 LLM 判断"Agent 适不适合这个节点"——纯集合运算 |
| **匹配失败** | 无 Agent 匹配 → MetaAgent 告警 → 重新打标签或拆节点 |
| **认领唯一** | TaskBoard.claim(nodeId) 原子——先到先得 |

### 3.3 needsMultiPerspective 节点的标签规则

当 MetaAgent 判定某节点需要多视角并行审查（`needsMultiPerspective = true`）：

| 规则 | 内容 |
|------|------|
| **多标签** | 至少打 2 个标签，**且必须来自不同 Agent 类型** |
| **异源** | 每个标签的归属 Agent 不同——保证多 Agent 能同时匹配 |
| **等齐** | TaskBoard 等所有匹配的 Agent 产出 → MetaAgent 聚合 → 交用户裁决 |
| **示例** | 审查关键安全代码：`tags: [review, audit]` → ReviewAgent + ReviewAgent（同一Agent不能重复认领同一节点） |

修正：同一 Agent 类型不能重复认领同一节点。因此 needsMultiPerspective 必须打不同 Agent 类型的标签。例如：

| 节点 | 标签 | 认领 Agent | 
|------|------|-----------|
| 安全关键代码审查 | `[review, research]` | ReviewAgent + AnalysisAgent |
| 重大重构审查 | `[review, plan_review]` | ReviewAgent + DocGovernAgent |
| 阶段交付终审 | `[audit, doc_audit, constitution_check]` | ReviewAgent + DocGovernAgent |

---

## 四、MetaAgent 标签选取指南

MetaAgent 按以下优先级顺序决定标签：

1. **用户意图解析**：从用户输入直接提取任务类型（"写个功能"→`implementation`，"修个bug"→`bugfix`）
2. **任务树父子继承**：子节点默认继承父节点标签，除非子节点属于不同 Agent 类型
3. **风险升级**：涉及安全/密钥/数据迁移 → 额外追加 `audit` 或 `review` 标签
4. **多视角判定**：涉及 >3 文件修改 或 核心路径 或 安全敏感 → `needsMultiPerspective = true` + 多标签

---

## 五、标签与 Agent 权限的映射

标签本身不承载权限信息。权限边界在 Agent 的 `allowedTools`：

```
标签回答：谁来做？（CodeAgent / ReviewAgent / ...）
allowedTools 回答：能做什么？（read / write / run_shell / search / ...）
```

一个 CodeAgent 无论认领的是 `implementation` 还是 `test` 还是 `bugfix`，它拥有的权限相同。标签区分的是任务性质，不是权限粒度。

---

## 六、扩展规则

| 条件 | 流程 |
|------|------|
| 需要新标签 | 修改此文档 → 更新 Agent 类型定义 → 更新 MetaAgent 标签选取指南 |
| 新标签归属现有 Agent | 无需新 Agent 类型，仅扩充标签 |
| 新标签无法归属 | 考虑新 Agent 类型（需对应新权限组合） |

**边界**：标签数 ≤ 24。超过后强制审计——标签过多意味着分类过细，MetaAgent 选取准确度下降。

---

**文档状态**：Core 准入交付。与宪法 v2.0 §5.1 配套，替代草案中的示意性标签列表。
