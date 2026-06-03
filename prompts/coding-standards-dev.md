# ⚖️ Cortex 开发规范 —— 人类与 AI 协作者守则

> **定位**：这是所有在 Cortex 仓库中写代码的人（包括 AI 协作者）必须遵守的开发契约。
>
> 不属于 `prompts/coding-standards.md`（注入 Agent 的代码法典），
> 也不属于 `prompts/coding-standards-governance.md`（注入 Scheduler/MetaAgent 的治理篇）。
>
> 版本：v1.0
> 从宪法 v2.5.28、代码法典、治理篇及十一次大型重构中提炼。

---

## 总原则 —— 易掌控

**所有规范以"更易掌控"为唯一目标。不为仪式感增加负担。**

判断标准：一条规则加进来，是让项目的修改更容易预测、更不容易踩坑——而不是"看起来更规范"。

---

## 次原则一 —— 配置唯一真相源

`@cortex/config` 是所有项目级常量、枚举、默认值的唯一定义处。

| 规则 | 说明 |
|------|------|
| ✅ 必须 | 环境变量名、文件路径、默认值、模型名称——四类值必须从 `@cortex/config` 导入 |
| ✅ 允许 | 功能开发初期新增临时硬编码——原型跑通为先 |
| 🚫 禁止 | 对已存在于 `@cortex/config` 的常量重复硬编码 |

> **核心：只能新增，不能退化。** 凡是已被纳入 config 的值，任何模块不得再次写死。

---

## 次原则二 —— 五阶段演进

一个功能的完整生命周期：

```
简单耦合 ──→ 复杂耦合 ──→ 解耦重聚耦 ──→ 组件式/可插拔 ──→ 接口化/稳定核心
  (原型)     (功能膨胀)    (拆接口)       (可替换)          (不可变)
```

| 阶段 | 允许 | 要求 |
|------|------|------|
| 简单耦合 | 硬编码、一个文件搞定 | 功能可运行 |
| 复杂耦合 | 耦合增加、测试烂掉 | 知道自己在哪个阶段 |
| 解耦重聚耦 | 追加重构 | 拆开的部件按清晰边界重新组装 |
| 组件式/可插拔 | 策略可换、后端可换 | 不换架构只换零件 |
| 接口化/稳定核心 | 核心接口不再变 | 扩展点通过实现接口接入 |

> **允许中间态的混乱，但必须往下一阶段推进。测试同步演进。**

---

## 次原则三 —— 依赖不可逆

```
职责层（零依赖）                  功能层（单向依赖职责层）
─────────────                    ───────────────────────
@cortex/config                   @cortex/engine
@cortex/shared                   @cortex/cli
                                 @cortex/factory
                                 @cortex/llm
                                 @cortex/tools
```

箭头方向永远从左到右。🚫 禁止倒置——如果 `config` 为了取某个类型而去依赖 `engine`，必须重构。

新增包的判定规则：**如果别的包需要用它定义的类型/配置 → 它是职责层，必须零依赖。**

---

## 次原则四 —— 代码风格收敛

三条硬底线：

| 底线 | 说明 |
|------|------|
| 可维护性 | 改了不改炸、炸了能找到 |
| 可读性 | 三个月后回来看一眼就懂 |
| 可拓展性 | 加新东西不改造旧代码 |

具体约束：

- 🚫 接口签名参数不能重复定义（两个 interface 都定义了同名但不同类型的字段）
- 🚫 同一语义的参数命名不能不一致（这个文件叫 `projectRoot`，那个文件叫 `rootDir`）
- 🚫 功能函数不能凭空捏造——函数签名必须对应实际的调用方需求，不能"预留"
- ✅ 代码风格必须收敛——模块内部、同类模块之间的写法保持一致

---

## 次原则五 —— 重复即债务

同一模式在三个以上地方出现 → 必须抽取。

| 阶段 | 容忍度 |
|------|--------|
| 简单耦合 | 容忍重复 |
| 复杂耦合 | 强制执行抽取 |
| 接口化 | 零重复 |

> 示范：Agent 从 9 个独立文件 → `AGENT_REGISTRY` 声明式数组。新增 Agent 一行注册项。

---

## 次原则六 —— 测试锚定不变量

测试不追求覆盖率百分比，追求两件事：

1. **调度五元组契约不破**：Scheduler / TaskBoard / AgentPool / ReplanManager / PipelineObserver
2. **最小爆炸半径**：哪个模块改了只炸对应测试，不连锁

---

## 次原则七 —— 测试深度梯度

按模块重要性分层深入：

| 层级 | 范围 | 深度 |
|------|------|------|
| 核心模块 | 调度、记忆、Agent 池、确认门 | 全场景全深度全边界——探明边界条件、错误触发、冷僻 bug |
| 非核心模块 | 命令处理器、格式化器 | 至少保证对应的功能测试正常覆盖 |
| 集成测试 | 端到端完整链路 | 全场景全任务全链路的压力测试 |

---

## 次原则八 —— 零向后兼容

触发条件：**重大架构变动**（跨包常量/导出结构迁移、中间层删除）。

- 🚫 禁止保留 `deprecated` 标注
- 🚫 禁止保留重导出 shim
- ✅ 宁可重写全部测试，一刀切干净

> 公共 API 签名变更不在此列。适用范围：中间层/常量/导出结构的底层重构。

---

## 次原则九 —— 模块化铁律

| 规则 | 说明 |
|------|------|
| barrel export | 凡 `src/` 下新增公开符号，必须在包根 `src/index.ts` 追加 export |
| 测试导入 | 测试文件禁止 `../src/xxx` 相对导入，统一用 `@cortex/<package>` 包名 |
| 新子模块 | 新建目录/文件时同步更新 barrel |

> 收益：文件合并/拆分/重命名——barrel 出口不变则所有引用方无感。

---

## 次原则十 —— 无孤儿文件

所有源码文件必须被至少一个 barrel 引用。🚫 禁止"写了但没人 import 的模块"。

---

## 次原则十一 —— Agent 声明式注册

- ✅ 新 Agent：`AGENT_REGISTRY` 数组加一项——memory query 参数声明式配置
- 🚫 禁止：创建独立文件写 `*MemoryQuery()` + `*AgentConfig()` 两板斧
- ✅ 例外：需要自定义 `Agent` 子类（如 `ApiAgent`/`DataAgent`）时允许独立文件，但仅保留类定义

---

## 次原则十二 —— engine 模块联邦，不拆包

`@cortex/engine` 是高内聚的模块联邦——14 个子目录已形成清晰职责边界（core / memory / platform / agents / bootstrap / governance / consistency / components / registry / skills）。

- 🚫 禁止：将 engine 拆分为多个独立 npm 包（存在跨模块循环依赖风险、包管理负担加重、公共 API 僵化）
- ✅ 允许：`memory/` 子系统在解除对 `core/pipeline-runner.ts` 的依赖后，可独立为 `@cortex/memory`

> 判断标准：拆包前必须证明"拆了比不拆更容易掌控"。

---

## 次原则十三 —— factory 包是唯一配置读取入口

`@cortex/factory`（工部）是唯一的配置加载与组装层。

- 🚫 禁止：engine / cli / 其他包直接 `readFileSync` 读取 `cortex-agents.json` 或任何配置文件
- ✅ 要求：所有配置读取走 factory 包的 `loaders → schemas → assemblers → bootstrap` 管线

---

## 次原则十四 —— 工具权限集中管控

Agent 不自行定义工具白名单。

- 🚫 禁止：Agent 类中硬编码工具权限
- ✅ 要求：Agent 仅声明自身身份（`AgentType.Code`），由 `Toolkit.execute()` 根据身份查权限表动态授权/拦截

---

## 次原则十五 —— 事件配置三元组闭环

事件定义必须在 `cortex-agents.json` 中三段闭环：

```
Agent.produces → routeTable → channels
```

- 🚫 禁止：Agent 产出与 routeTable / channels 分离（必出漂移）
- ✅ 要求：Schema 校验在加载时发现"Agent 产了但 routeTable 没配"或"routeTable 指了但通道没定义"

---

## 实践细则

以下非原则层，但强烈建议：

### 跨模块接口必须有 @contract

任何被其他模块依赖的类/函数，必须在 JSDoc 中用 `@contract` 标注其对外契约：

```typescript
/**
 * @contract 模块边界契约
 * - 调用方：Scheduler
 * - 保证：写入原子性，四态单向流转
 * - 不保证：并发写入顺序
 */
```

### 重构后必须过测试

接口签名、类型定义、协议结构等重大变更后，不能仅满足编译通过——必须同步运行全部相关测试并确保通过。

### 包路径禁止嵌套

🚫 不得出现 `packages/foo/packages/foo/src/` 之类双层嵌套结构。新建包时检查。

### 文档可自主整理

若认为文档位置不合理，有权将其移至合理位置（`docs/` 或 `packages/<name>/README.md`）。

### 常见陷阱速查

| 陷阱 | 说明 |
|------|------|
| `bootstrapEngine` 遗漏 `toolkit.setGate()` | 创建 ConfirmGate 后必须显式注入 Toolkit，否则门控被完全绕过 |
| `cortex-agents.schema.json` 与 `loader` 不同步 | schema 字段变更时必须同步更新 loader 校验逻辑，否则 VS Code 持续报"缺少属性" |
| Windows 下 `mkdir -p` 不支持 | 用逐级 `mkdir` 或 `powershell` 替代 |
| Windows fetch `AbortController` 失效 | TCP 卡死连接无法被中断，需外层 `Promise.race(timeoutPromise)` 硬兜底 |
| E2E 测试需显式 bypass `ConfirmGate` | `write_file` 等 L2 工具在无交互界面测试中永久阻塞 |
| `subscribeAll` 缺少 `reason` 参数 | 通配符订阅必须带原因字符串，提升可审计性 |
| `InitVerifier` 未过滤归档路径 | 需过滤 `archive/` 等目录，避免假阳性 fatal |

### 控制台输出走 PipelineObserver

🚫 生产代码禁止裸 `console.error()` / `console.warn()`。走 `SafeErrorReporter` 管道（`fatal` / `degraded` / `silent` 三档）。

### 异常处理

- 🚫 禁止空 `catch {}` 块
- 🚫 禁止 `throw "字符串"`——只 `throw new Error()`
- ✅ `throw new Error("消息", { cause: e })` 保留原因链

### 变量声明

- 🚫 禁止 `var`
- ✅ 默认 `const`，确需重新赋值才用 `let`

---

> **此文件是 Cortex 的开发规范——适用于所有在 Cortex 仓库中写代码的人。**
>
> 宪法依据：Cortex 概念顶层设计——八条不可变原则
> 代码依据：`prompts/coding-standards.md`（Agent 端）、`prompts/coding-standards-governance.md`（治理端）
