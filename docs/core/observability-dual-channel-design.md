# 可观测双通道 —— 设计与边界

**状态**：设计稿（未实施）
**日期**：2026-09-26
**来源题**：宪法 v3.8 §一「6 项设计决策排入 Core-3」之 **Logger 推广**
**前置**：[core-3-design-backlog.md](core-3-design-backlog.md) §一【1】——该题的核验结果

> **本文对该题的重新定义**：宪法把「Logger 推广」记为待办，隐含前提是
> 「裸 console 无人管，需要迁移到结构化日志」。核验后发现该前提**已不成立**：
> 仓库里已有一套运行时拦截把 console 兜进了结构化管道。
> 所以真实的问题不是「迁移」，而是**两条并存的通道没有边界定义**。
> 本文按后者立题。

---

## 一、现状（全部实测）

### 1.1 两条通道并存

**通道 A —— 运行时拦截**（覆盖全仓，无需改代码）

```
packages/telemetry/src/console-bridge.ts
  installConsoleBridge(observer)   ← bootstrap-engine.ts:285 启动时安装
  uninstallConsoleBridge()         ← bootstrap-engine.ts:640 退出时卸载
```
把 `console.warn` / `console.error` 替换为 `PipelineObserver.emit(ErrorReported)`
（warn → NORMAL，error → HIGH）。

**通道 B —— 编译期显式调用**（能力完整，几乎无人用）

```
packages/logging/  —— Logger / createLogger / getLogger / configureRootLogger
                      ConsoleTransport / FileTransport
                      DefaultFormatter / JsonFormatter
                      LoggingPipelineBridge   ← 同样是接 PipelineObserver 的桥
```
**引用它的 src 文件：2 个**（`engine/bootstrap/bootstrap-engine.ts`、`engine/core/meta-agent.ts`）。

**两条通道解决的是同一个问题**——把非结构化输出接进 `PipelineObserver`。
这就是本题的症结。

### 1.2 使用面

| 指标 | 实测 |
|---|---|
| 可执行裸 `console.*` 调用 | **296 处 / 83 文件** |
| ├ `console.error` | 155（非豁免 96） |
| ├ `console.warn` | 89（非豁免 62） |
| └ `console.log` | 52（非豁免 **39，全部带 `eslint-disable` 注释与理由**） |
| `@cortex/logging` 消费者 | **2 文件** |

> 口径：TypeScript 编译器 API 遍历 `CallExpression`，**注释与字符串不计**。
> 正则口径会多出 46 处（`@example` 注释块、用法文档里的示例代码）。

### 1.3 通道 A 的四个已知缺口

1. **`console.log` 不进管道。** bridge 的 log 分支只做 stderr 透传
   （`process.stderr.write(\`[console-bridge] …\`)`），不发事件。
   即 **52 处 log 级输出在管道里不可见**——虽然它们大多带 disable 且有理由。
2. **每次调用构造一次 `new Error().stack`。** `_isWhitelisted()` 的调用栈白名单
   在**每一次** console 调用上运行。296 个调用点里，凡在热路径上的都在付这个代价。
3. **截断在 500 字符**（`_flattenArgs`）。
4. **monkey-patch 的固有边界**：只在 bootstrap 之后生效；install 之前的输出、以及
   不经过 bootstrap 的进程（如独立的 CLI 调用路径）不在覆盖内。

---

## 二、问题陈述

> **同一个关切（把运行时输出接进可观测管道）有两套实现，没有边界定义；
> 覆盖面广的那套（运行时拦截）能力弱且有隐藏代价，能力完整的那套（`@cortex/logging`）
> 几乎无人使用。于是「用哪套」由写代码的人随机决定，而两边都不知道对方的边界。**

具体的三个后果：

1. **不可预测的可观测性**——一段代码的日志能不能被管道看见，取决于它写的是
   `console.log` 还是 `console.warn`，而不是取决于它是否重要。
2. **重复建设的维护面**——`LoggingPipelineBridge` 与 `console-bridge` 是同一个桥的两份实现。
3. **性能税无人在意**——`new Error().stack` 在热路径上是可观测的代价，但它是隐式的。

---

## 三、设计

### 3.1 定边界（本设计的第一性原则）

两条通道**不是二选一，是分工**。分界线是「**谁在写**」：

| | 通道 A（console-bridge） | 通道 B（@cortex/logging） |
|---|---|---|
| **定位** | **兜底**：接住没走结构化日志的旧代码与新代码 | **首选**：所有新代码、所有需要 level/transport/上下文的地方 |
| **目标覆盖率** | 现状不清零（僵尸 console 不可怕，可怕的是不知道它们在不在管道里） | 逐包提升 |
| **调用方式** | 自动（安装即生效） | 显式（`createLogger("pkg.module")`） |
| **交付物** | warn/error → `ErrorReported` | 结构化 `LogEntry` → `LoggingPipelineBridge` |
| **不做** | 不追求结构化（拿不到 level/字段/上下文） | 不追求覆盖旧代码 |

**一条硬规则**：**新代码禁止新增裸 `console.*`。** 现状 296 处冻结为基线，
只减不增——用一条计数器门禁守住（见 §四）。

### 3.2 修通道 A 的三个缺口（低风险，先行）

1. **`console.log` 不再静默丢弃**：发给管道一条 `NORMAL` 优先级的
   `ErrorReported`（severity=`log`）或新增一个更贴切的既有事件类型。
   —— 此项**需要裁决**：把 log 全部灌进管道可能造成噪声放大（参考本轮修的
   `notification_queue` 无界增长：**任何"全部进管道"的设计都必须同时定义保留策略**）。
2. **调用栈白名单改为惰性**：只在**前缀白名单未命中且首次进入该调用点**时构造栈
   （按调用点缓存），而不是每次调用。
3. **截断长度可配**，并默认记录被截断的事实（而非静默截断）。

### 3.3 提通道 B 的接入（主体工作）

**接入路径（按性价比排序）**：

| 批 | 范围 | 理由 |
|---|---|---|
| 1 | `engine`（54 处 / 72 文件） | 编排中枢，日志最有分析价值；且它已经引了 logging 包，边际成本最低 |
| 2 | `scheduler`（43 / 29） | 与 engine 同属规划-执行流，一起做可复用测试手法 |
| 3 | `llm`（12 / 4） | 面小、价值高（LLM 调用审计），且它已有 4 处非豁免 `console.log` 带 disable——正好换成 Logger |
| 4 | `telemetry` / `logging` / `platform` / `skill-kit` / `memory-store` | 各自 ≤7 处 |
| — | `cli` / `desktop`（52+38，全在 eslint 豁免路径） | **不做**——终端/GUI 的 stdout 是产品行为，不是日志 |

**演进方式**：一批一提交，每批附「该包 console 计数从 N → M」的读数。
不追求一次做完——**追求单调下降**。

### 3.4 不做的事（明确划出）

- **不删 console-bridge**。它是兜底，删了会让旧代码的输出彻底不可观测。
- **不迁移 cli / desktop 的 console**（72 处）。它们是终端与 GUI 的**渲染**，
  走 Logger 反而错——正如 eslint 配置里那句豁免注释的意图。
- **不追求 console 归零**。目标是「新代码不增 + 重要路径显式接入」。

---

## 四、验收标准

| # | 标准 | 度量方式 |
|---|---|---|
| 1 | **裸 console 基线冻结** | 新增一条门禁：`console.*` 计数 **≤ 296**（分文件记录基线）。超出即红 |
| 2 | `@cortex/logging` 消费者 ≥ 8 个 src 文件非 engine/scheduler | 静态扫描 |
| 3 | `new Error().stack` 不再逐次调用 | 针对新增调用点的测试断言 |
| 4 | `console.log` 的去向有明确定义（进管道 或 显式声明不进） | 设计裁决记录 |
| 5 | 双通道边界写入 `PACKAGE_POSITIONING.md` 的两包定位 | 文档同步 |

> **标准 1 的形态直接抄本轮 `notification_queue` 的教训**：
> 任何"允许存在但要收敛"的东西，都必须有**可执行的基线**，否则它会自己长回去。

---

## 五、待裁决（写实现前需要回答）

1. **`console.log` 要不要进管道？** 进 → 需同时定义保留/去重策略（否则重演无界增长）；
   不进 → 需在文档里明确「log 级不可观测」是接受的取舍。
2. **基线门禁放哪一层？** 新脚本（`scripts/`——但该目录目前不在任何 lint 门禁内，见 backlog N-1）
   还是放进 `@cortex/tools` 的契约族（与 `layer-contract` / `flow-contract` 同源）？
   **倾向后者**：与已有契约同源，且天然进 CI。
3. **`LoggingPipelineBridge` 与 `console-bridge` 是否合并？** 两者是同一个桥的两份实现。
   合并的收益是消除重复，风险是两套触发时机不同（编译期显式 vs 运行时拦截）。
   **倾向暂不合并**，先定边界，观察一轮再决定。

---

## 六、与原则五的关系

原则五（统一可观测，唯一全流约束）原文要求：

> 关键状态变更必须通过 `PipelineObserver.emit()` 上报。**不得使用裸 `console.log` 替代结构化事件。**

核验结论：
- **`console.log` 这一条已经被守住了**——非豁免路径的 39 处**每一处都有显式
  `eslint-disable` 注释与理由**（`@justification` 惯例），规则没有漏网。
- **`console.warn/error` 不在原则五的禁止范围内**，eslint 也显式允许。
- 所以**本设计不是原则五的合规修复，而是它的深化**：原则五管住了"不许用 log 替代事件"，
  但没有回答"warn/error 之后该不该升级为显式 Logger"。

这一点必须在文档里说清楚——**免得后来者以为这里有个合规漏洞，其实没有**。

---

*设计：昔涟。核验数据见 [core-3-design-backlog.md](core-3-design-backlog.md)。
本文为设计稿，未实施。2026-09-26。*
