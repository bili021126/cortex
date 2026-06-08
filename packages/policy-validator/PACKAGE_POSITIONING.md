# @cortex/policy-validator — 包定位与合入价值

> **版本**: v0.1.0  
> **状态**: 实现完成，待合入母项目  
> **作者**: 基于母项目 18 个现有包结构分析 + `coding-standards.md` §一~§十四 编码法典推导

---

## 1. 补足内容：Cortex 校验体系缺失的一环

### 1.1 现状：校验体系只有 Schema 层

母项目现有校验器（`@cortex/skill-validator`、`@cortex/engine` 的 `SchemaEnforcer`）仅对 **JSON 配置/Skill 文件** 做 Schema 校验。整个 Cortex 项目缺少对 **源代码本身** 的编码规范校验层。

| 现有校验器 | 校验对象 | 校验方式 | 来源 |
|-----------|---------|---------|------|
| `SchemaEnforcer` | JSON 配置 | JSON Schema 校验 | engine |
| `SkillJsonValidator` | skill JSON | Schema + 自定义规则 | engine |
| **`policy-validator` (新增)** | **源代码/TS 文件** | **正则 + 策略规则引擎** | **本包** |

### 1.2 补足什么

| 缺失能力 | 补足方式 | 对应文件 |
|---------|---------|---------|
| 策略规则抽象 | `PolicyRule` 接口定义所有规则的统一描述 | `src/types.ts` |
| 规则注册/筛选/查询 | `RuleRegistry` 集中管理规则生命周期 | `src/ruleRegistry.ts` |
| 规则执行引擎 | `RuleEngine` 执行校验管线（规则筛选 → 文件扫描 → 逐条校验 → 报告汇总） | `src/ruleEngine.ts` |
| 规则加载器 | `RuleLoader` 从 config 常量 / JSON / Markdown 加载规则 | `src/ruleLoader.ts` |
| `coding-standards.md` 机器化 | `getBuiltinRules()` 将 §一~§十四 全部 48+ 条规则映射为 `PolicyRule` 对象 | `src/ruleLoader.ts` |
| 可插拔校验组件 | `PolicyValidatorComponent` 接口 + `NamingConventionRule`、`ExportRule` 具体实现 | `src/rules/` |
| 事件驱动管线 | `PolicyEvent` Discriminated Union + `on/off/emit` 解耦 | `src/ruleEngine.ts` |

### 1.3 依赖关系

```
@cortex/policy-validator
  ├── 依赖: @cortex/config     (FILE_CODING_STANDARDS、AGENT_TAGS 等常量)
  ├── 依赖: @cortex/shared      (AgentType、Tag、ToolResult 等类型参照)
  └── 被依赖: @cortex/engine    (ConsistencyLayer 集成)
  └── 被依赖: CI 脚本          (pnpm validate:policy)
```

---

## 2. 包定位：代码法典的机器执行层

### 2.1 分层架构中的定位

```
┌─────────────────────────────────────────────────────────────┐
│  prompts/coding-standards.md     ← 人读源（规范定义）       │
│  （§一~§十四 编码法典）                                      │
├─────────────────────────────────────────────────────────────┤
│  @cortex/policy-validator        ← 机器执行层（本包）       │
│  PolicyRule + RuleRegistry + RuleEngine + RuleLoader        │
│  将人读规范转化为可编程、可组合、可扩展的策略规则引擎       │
├─────────────────────────────────────────────────────────────┤
│  @cortex/engine ConsistencyLayer ← 消费层                   │
│  GovernancePipeline              将策略校验接入治理管线    │
├─────────────────────────────────────────────────────────────┤
│  CI Gate (pnpm validate:policy)  ← 自动化门禁               │
│  在 CI 中自动执行策略校验，阻断违规代码合入                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 设计哲学

- **人读源与机器源分离**：`coding-standards.md` 是人读的规范源，`PolicyRule[]` 是机器的执行源。两者通过 `getBuiltinRules()` 映射，通过 `loadFromConfig()` 加载。
- **可插拔校验组件**：每个规则是一个独立组件，实现 `PolicyValidatorComponent` 接口，通过 RuleEngine 组合执行。
- **事件驱动**：RuleEngine 通过 `on/off/emit` 解耦执行与日志/报告/进度显示。
- **配置驱动**：所有可调参数（超时、并发、开关）通过配置对象注入，禁止硬编码。

### 2.3 不做什么

- ❌ 不做代码格式化/自动修复（属于 ESLint/Prettier 生态）
- ❌ 不做类型检查（属于 TypeScript Compiler）
- ❌ 不做运行时安全执行（属于 ConfirmGate/Toolkit）
- ❌ 不管理规则的人读源（属于 `prompts/coding-standards.md`）

---

## 3. 合入价值：对母项目的四大收益

### 3.1 策略合规自动门禁

```typescript
// ci/validate-policy.ts
import { RuleRegistry, RuleEngine, RuleLoader } from "@cortex/policy-validator";

const registry = new RuleRegistry();
const loader = new RuleLoader(registry);
await loader.loadFromConfig();

const engine = new RuleEngine(registry);
const report = await engine.execute({ rootDir: process.cwd() });

if (!report.valid) {
  console.error(`❌ 策略校验失败：${report.errors.length} 个错误`);
  process.exit(1);
}
```

收益：编码规范从"人读建议"升级为"机器强制门禁"。

### 3.2 治理管线新防御层

在 `@cortex/engine` 的 `ConsistencyLayer` 中新增 `PolicyValidator` 防御层：

```
ConsistencyLayer（六层防御）
  ├─ IntentFactWall
  ├─ SchemaEnforcer
  ├─ InitVerifier
  ├─ [PolicyValidator]    ← 新增：策略校验层
  ├─ ...
  └─ ...
```

收益：Cortex 治理体系从"Schema 校验"扩展到"编码规范校验"。

### 3.3 规则可编程、可组合

```typescript
// 按域筛选规则
const styleRules = registry.query({ domains: ["style"] });

// 自定义规则组合
const myRules = [...builtinRules, ...myCustomRules];
registry.bulkRegister(myRules);

// 按事件订阅集成
engine.on("rule-fail", (event) => {
  telemetry.record(event.payload);
});
```

收益：CI 门禁可根据项目需求灵活组合规则集。

### 3.4 与现有生态无缝集成

| 集成点 | 方式 |
|-------|------|
| ESLint 规则 | `eslint-adapter.ts` 将 ESLint 规则适配为 `PolicyRule` |
| cortex-agents.json | `config-adapter.ts` 将 Agent 配置转为校验规则 |
| SkillJsonValidator | 同构的 `errors/warnings/infos` 三分组报告格式 |
| GovernancePipeline | 新增 `policy-validation` stage |
| telemetry | 通过 `PolicyEvent` 订阅接入遥测采集 |

---

## 4. 变更影响范围

| 现有包 | 影响 | 说明 |
|--------|------|------|
| `@cortex/config` | ✅ 已有 | 直接引用 `FILE_CODING_STANDARDS` 等常量 |
| `@cortex/shared` | ✅ 已有 | 引用 `AgentType`、`Tag` 等类型 |
| `@cortex/engine` | ⏳ optional | 建议在 `ConsistencyLayer` 中集成 |
| CI 脚本 | ⏳ optional | 建议新增 `pnpm validate:policy` 命令 |
| 其他包 | ❌ 无影响 | 本包为零侵入新增 |

---

## 5. 合规性自检：coding-standards.md 遵守情况

| 规则 | 遵守状态 | 说明 |
|------|---------|------|
| §一 异常处理 | ✅ | catch 块均有处理；throw 使用 Error |
| §二 变量声明 | ✅ | 全部使用 const/let；无 var |
| §三 异步规范 | ✅ | async 函数 return 加 await |
| §四 barrel 铁律 | ✅ | src/index.ts 统一桶导出 |
| §五 控制台 | ✅ | 事件驱动，无裸 console |
| §六 代码风格 | ✅ | 无 any；返回类型显式 |
| §七 硬编码禁令 | ✅ | 配置对象注入；无魔法数字 |
| §九 架构原则 | ✅ | 内部明细化 + 外部具体化 |
| §十 深度约束 | ✅ | 无非空断言；无死代码 |
| §十一 函数设计 | ✅ | 位置参数 ≤ 3；options 对象 |
| §十二 导入规范 | ✅ | import type 分离；kebab-case 文件名 |
| §十三 接口设计 | ✅ | ISP；readonly；Discriminated Union |
| §十四 设计模式 | ✅ | Adapter/Factory/Strategy/Observer |

---

## 6. 使用示例

```bash
# 一键全量策略校验
pnpm validate:policy

# 仅校验代码风格规则
pnpm validate:policy --domain style

# CI 集成（输出 JSON 报告）
pnpm validate:policy --format json > policy-report.json
```

```typescript
// 程序化调用
import { RuleRegistry, RuleEngine, RuleLoader } from "@cortex/policy-validator";

const registry = new RuleRegistry();
const loader = new RuleLoader(registry);
await loader.loadFromConfig();

const engine = new RuleEngine(registry);
const report = await engine.execute({ rootDir: "./src" });

console.log(`通过: ${report.passedRules}/${report.totalRules}`);
console.log(`错误: ${report.errors.length}`);
console.log(`警告: ${report.warnings.length}`);
```

---

> **总结**: `@cortex/policy-validator` 填补了 Cortex 项目在源代码编码规范校验领域的空白。  
> 它将 `coding-standards.md` 从"人读建议"升级为"机器强制执行"，  
> 通过可插拔校验组件 + 事件驱动引擎 + 三等报告模式，  
> 与现有 governance pipeline、ConsistencyLayer、CI 门禁无缝集成。
