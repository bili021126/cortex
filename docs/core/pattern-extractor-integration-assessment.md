# P5-1: pattern-extractor 接入评估

**评估日期**: 2026-06-19  
**评估人**: QoderWork (基于 Core-2 过渡阶段改造计划)

---

## 一、现状分析

### 1.1 pattern-extractor 包能力

`@cortex/pattern-extractor` 提供以下核心能力：

- **PatternScanner**: 扫描代码/文档中的重复模式
- **PatternExtractor**: 提取并结构化模式定义
- **PatternRegistry**: 注册和管理预定义模式
- **PatternKind**: 模式分类枚举（代码模式、文档模式、配置模式等）

### 1.2 当前引擎集成状态

- ✅ engine 的 `package.json` 已声明依赖 `@cortex/pattern-extractor: "workspace:^"`
- ❌ 引擎核心代码未直接引用 pattern-extractor API
- ✅ LoopAgent（莫娜）负责"模式发现、重复检测、跨模块分析"，理论上应使用 pattern-extractor

### 1.3 相关组件

- **LoopAgent (莫娜)**: 模式发现专家，负责识别重复模式并沉淀为技能
- **SkillRegistry**: 管理已沉淀的技能模板
- **MemoryStore**: 存储模式识别的历史记录

---

## 二、集成价值评估

### 2.1 潜在收益

| 场景 | 收益 | 优先级 |
|------|------|--------|
| **代码重复检测** | 自动识别重复代码块，建议提取为函数/模块 | P1 |
| **文档模板识别** | 发现文档中的模板化结构，沉淀为标准模板 | P2 |
| **配置模式提取** | 识别配置文件中的重复模式，生成配置模板 | P3 |
| **跨模块模式发现** | 发现跨文件的架构模式（如 MVC、观察者） | P2 |

### 2.2 集成成本

| 项目 | 成本 | 说明 |
|------|------|------|
| **API 学习** | 低 | pattern-extractor 已提供清晰的 barrel 导出和预定义模式 |
| **LoopAgent 改造** | 中 | 需要修改 LoopAgent 的执行逻辑，调用 PatternScanner |
| **SkillRegistry 适配** | 低 | 将 Pattern → SkillTemplate 的转换逻辑 |
| **测试覆盖** | 中 | 需要为 pattern-extractor 集成编写测试用例 |

---

## 三、集成方案建议

### 3.1 方案 A：LoopAgent 内部集成（推荐）

**思路**: LoopAgent 在执行"模式发现"任务时，内部调用 PatternScanner。

**优点**:
- 最小侵入性，不改变现有调度逻辑
- LoopAgent 已有 `pattern_scan` 标签，语义匹配
- 可复用现有 SkillRegistry 沉淀机制

**实现步骤**:
1. LoopAgent 的 `execute()` 方法中，检测任务类型为"pattern_scan"
2. 调用 `PatternScanner.scan()` 扫描目标文件/目录
3. 将识别出的 Pattern 转换为 SkillTemplate
4. 调用 `SkillRegistry.register()` 沉淀技能

**代码量**: ~50 行（LoopAgent 内部改造）

### 3.2 方案 B：独立 PatternDiscoveryStep（不推荐）

**思路**: 在 Scheduler 的 dispatch pipeline 中新增 PatternDiscoveryStep。

**缺点**:
- 侵入调度器核心逻辑
- 需要修改所有 Agent 的执行流程
- 与 LoopAgent 的职责重叠

### 3.3 方案 C：MetaAgent 规划期注入（可选）

**思路**: MetaAgent 在规划时调用 PatternExtractor，识别项目中的模式并影响任务拆解。

**优点**:
- 可在规划期识别架构模式，影响后续任务分配
- 与 P4-2 策略顾问上下文注入机制类似

**缺点**:
- 增加规划期 LLM 调用成本
- 可能引入过度设计（为简单任务套用复杂模式）

---

## 四、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| **误识别模式** | 中 | PatternScanner 提供置信度评分，低于阈值不沉淀 |
| **技能膨胀** | 低 | SkillRegistry 已有版本管理和废弃机制 |
| **性能开销** | 低 | PatternScanner 支持增量扫描，避免全量重扫 |
| **与现有技能冲突** | 低 | SkillRegistry 基于 triggerTags 去重 |

---

## 五、实施建议

### 5.1 短期（P5-1 阶段）

**建议**: **暂不集成**，优先完成 Core-2 核心改造。

**理由**:
- pattern-extractor 集成是锦上添花，非雪中送炭
- LoopAgent 当前可通过 LLM 直接识别模式，无需 pattern-extractor
- 应优先完成 P0-P4 的核心改造，pattern-extractor 集成可延后

### 5.2 中期（Core-2 完成后）

**建议**: 采用方案 A（LoopAgent 内部集成），作为 LoopAgent 的增强特性。

**实施时机**:
- Core-2 核心改造全部完成
- 所有 P0-P4 项验证通过
- 团队对 pattern-extractor API 熟悉度提升

### 5.3 长期（Core-3 规划）

**建议**: 评估方案 C（MetaAgent 规划期注入），作为架构感知的增强。

**前提条件**:
- pattern-extractor 的准确率和性能经过充分验证
- 团队对模式识别的价值有共识
- 有明确的 ROI 指标（如代码重复率下降 X%）

---

## 六、结论

**当前阶段（P5-1）**: **不集成**，保持现状。

**理由**:
1. Core-2 的核心目标是调度器和路由系统的现代化，pattern-extractor 集成是增量特性
2. LoopAgent 当前已具备模式发现能力（通过 LLM），pattern-extractor 是优化而非必需
3. 应优先完成 P0-P4 的核心改造，确保调度器/路由器/通知系统的稳定性

**后续行动**:
- Core-2 完成后，重新评估 pattern-extractor 的集成价值
- 收集 LoopAgent 的实际使用情况，识别 pattern-extractor 的 ROI
- 若决定集成，优先采用方案 A（LoopAgent 内部集成）

---

*评估完成。本评估基于 Core-2 改造计划的目标和优先级，pattern-extractor 集成作为可选增强项，建议在核心改造完成后重新评估。*
