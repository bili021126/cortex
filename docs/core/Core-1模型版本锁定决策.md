# Core-1 模型版本锁定决策

> **定位**：Core 阶段准入条件 #6。模型已锁定——DeepSeek 族，MetaAgent 独享 Pro，其余全 Flash。

---

## 一、锁定策略

| 角色 | 锁定模型 | 原因 |
|------|---------|------|
| **MetaAgent**（规划） | `DeepSeek V4 Pro` | 规划是全局质量第一关。Pro 的强推理保障任务拆解和标签准确性 |
| **管家**（摘要/转译/冷启动） | `DeepSeek V4 Flash` | 轻量任务，用量大。Flash 成本可控 |
| **CodeAgent**（写代码） | `DeepSeek V4 Flash` | 代码生成。若 Core-1 测试中代码质量不足，可单项升至 Pro |
| **ReviewAgent**（代码审查） | `DeepSeek V4 Flash` | 只读审查。Flash 对审查任务足够 |
| **AnalysisAgent**（调研/分析） | `DeepSeek V4 Flash` | 搜索+分析。Flash 覆盖 |
| **OpsAgent**（部署/运维） | `DeepSeek V4 Flash` | Shell 操作+状态检查。Flash 覆盖 |
| **LoopAgent**（模式扫描/技能沉淀） | `DeepSeek V4 Flash` | 模式识别。Flash 覆盖 |
| **DocGovernAgent**（审计/合规） | `DeepSeek V4 Flash` | 文档审计。Flash 覆盖 |

**分层逻辑**：MetaAgent 的规划质量边际收益最高——规划偏差 1 步，执行偏差 10 步。因此 MetaAgent 独享 Pro。其余 Agent 先全量 Flash，Core-1 测试中按实际表现单项升级。

## 二、模型族选定

Core-1 启动时根据以下优先级选定：

1. **代码生成能力**：Core-1 主要是写代码、审查代码、跑测试——代码质量是第一指标
2. **成本可控**：个人工具链，测试轮次多（18 个最简测试），token 成本需跟踪
3. **API 稳定性**：Core-1 验证期间模型不升级，避免行为漂移
4. **中文支持**：用户交互和文档审计需要中文能力

**模型族**：DeepSeek V4。同族保证 token 语义一致、行为可预测。

**决策时间点**：已锁定。Core-1 直接使用，不再延迟。

## 三、为什么不一刀切

| 一刀切（同模型） | 分层（同族不同版） |
|-----------------|-------------------|
| 简单 | 成本可降 40-60%（mini 处理摘要/分析） |
| 行为一致 | 行为一致（同族同训练目标） |
| 成本固定 | 用户可感知成本差异 |

**结论**：同族异速——MetaAgent 独享 V4 Pro（规划质量边际收益最高），其余全量 V4 Flash（成本优先）。Core-1 测试中 CodeAgent 是唯一可能需升 Pro 的变量——代码生成是 Flash 的上限考验。

## 四、锁定后的变更流程

| 场景 | 流程 |
|------|------|
| 模型族升级（如 4→4.1） | 用现有测试套件全量回归，通过后切换 |
| 换模型族（如 GPT→Claude） | 视为中等修宪——需全体测试通过+用户批准 |
| 调整分层（如 mini 升 full） | 成本评估+用户确认 |

---

**文档状态**：已锁定。DeepSeek 族，MetaAgent V4 Pro + 其余 V4 Flash。
