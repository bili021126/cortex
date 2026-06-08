# @cortex/doctor 包定位文档

> **作者**：阿贝多（ImplementAgent）
> **版本**：v0.1.0
> **状态**：implemented
> **关联设计文档**：`DESIGN.md`（纳西妲架构设计）

---

## 目录

1. [Q1: 本包补足了什么？](#q1-本包补足了什么)
2. [Q2: 本包的定位是什么？](#q2-本包的定位是什么)
3. [Q3: 为什么值得合入？](#q3-为什么值得合入)
4. [附录：当前实现范围](#附录当前实现范围)

---

## Q1: 本包补足了什么？

### 1.1 补足缺口一览

在 `@cortex/doctor` 实现之前，monorepo 的健康管理存在以下六个维度的空白：

| 维度 | 缺口 | 本包补足方式 |
|------|------|-------------|
| **统一健康诊断入口** | 没有一条命令能回答「这个 monorepo 现在健康吗？」 | `doctor()` 函数 / `HealthChecker.diagnose()` 聚合多检查器产出统一报告 |
| **package.json 字段合规** | 各包 `package.json` 的必检字段（name/version/type/scripts 等）缺乏自动化校验 | `PackageJsonChecker` 扫描所有子包，检查字段存在性和类型正确性 |
| **定位文档存在性** | 宪法要求每个包必须有 `PACKAGE_POSITIONING.md` 说明补足声明，但缺少自动化检查 | `PositioningDocChecker` 扫描各包，报告缺失定位文档的包 |
| **测试门禁自声明** | 宪法 §十四·一 要求测试文件首行标注 `// @ci:` 类型，但无自动化校验 | `TestHeaderChecker` 扫描各包测试文件，标注不合规即报告 |
| **健康评分量化** | 现有工具只做检出不做量化，无法设置健康基线 | 每个检查器产出 0-100 子评分，`HealthChecker` 聚合总分并判定健康状态 |
| **可扩展检查器管线** | 新增检查维度需要从零搭建 | `IChecker` 接口 + `registerChecker()` 注册机制，新检查器即插即用 |

### 1.2 与现有工具的互补关系

```
                    ┌──────────────────────────────────────────┐
                    │           Monorepo 健康观测站              │
                    ├──────────────────────────────────────────┤
                    │                                          │
┌──────────────────┐│  ┌──────────────────────────────────┐    │
│  @cortex/tools    ││  │  @cortex/doctor                   │    │
│                   ││  │                                   │    │
│ monorepo-analyzer ││  │  HealthChecker（统一入口）         │    │
│  依赖图/循环/分层 ││  │  ├─ PackageJsonChecker   ← 新增  │    │
│                   ││  │  ├─ PositioningDocChecker ← 新增  │    │
│ configuration-    ││  │  ├─ TestHeaderChecker    ← 新增  │    │
│ drift             ││  │  └─ ...可扩展                     │    │
│  版本一致性       ││  │                                   │    │
└──────────────────┘│  │  HealthScore（健康评分模型）       │    │
                    │  │  CheckerRegistry（检查器注册表）    │    │
                    │  └──────────────────────────────────┘    │
                    │                                          │
                    └──────────────────────────────────────────┘
```

| 工具 | 定位 | 与 doctor 的关系 |
|------|------|-----------------|
| `@cortex/tools` monorepo-analyzer | 依赖图构建与循环检测 | doctor 可复用其分析结果作为 DependencyChecker 的数据源 |
| `@cortex/tools` configuration-drift | 版本一致性检测 | doctor 可复用其漂移数据作为 DepHealthChecker 的输入 |
| **`@cortex/doctor`** | **统一健康诊断 + 评分 + 合规检查** | **在现有分析工具之上新增合规/文档/标注维度** |

**关键分界**：`@cortex/doctor` 不重新实现依赖图分析和版本漂移检测，而是填补它们所不覆盖的「合规检查」和「量化评分」空白。

---

## Q2: 本包的定位是什么？

### 2.1 一句话定位

> **`@cortex/doctor` 是 monorepo 的统一健康诊断套件——提供 package.json 字段合规检查、PACKAGE_POSITIONING.md 存在性检查、测试文件首行标注校验等核心健康检查，并基于 IChecker 管线架构支持任意维度扩展，填补现有分析工具从「检出」到「诊疗」的最后一公里。**

### 2.2 定位边界

```
┌─────────────────────────────────────────────────────────────┐
│                    @cortex/doctor 职责边界                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✅ 属于本包职责                                             │
│  ├── package.json 必须字段存在性与类型校验                    │
│  ├── PACKAGE_POSITIONING.md 存在性检查                       │
│  ├── 测试文件首行 // @ci: 标注合规检查                        │
│  ├── 健康评分（基于检查发现扣分模型）                          │
│  ├── 统一诊断入口 HealthChecker.diagnose()                    │
│  ├── 检查器注册表（registerChecker）可扩展                    │
│  ├── only/skip 过滤（精准控制检查范围）                       │
│  └── runOnly 快捷方法（仅运行指定检查器）                     │
│                                                             │
│  ❌ 不属于本包职责                                           │
│  ├── 依赖图构建与可视化（@cortex/tools monorepo-analyzer）    │
│  ├── 版本漂移检测（@cortex/tools configuration-drift）        │
│  ├── ESLint 代码风格检查（ESLint 自身）                       │
│  ├── 类型检查（tsc --noEmit）                                │
│  ├── 测试运行（vitest run）                                  │
│  ├── 自动修复代码（doctor 只生成指引，不自动修改）             │
│  └── 配置文件修改（开发者手动或 CI 脚本）                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 依赖关系

```
@cortex/doctor
  ├── 依赖: @cortex/shared（共享类型定义，当前为预留）
  ├── 依赖: @cortex/tools（预留——后续检查器可复用分析结果）
  ├── 依赖: node:fs / node:path（文件 I/O）
  └── 被依赖: @cortex/cli（future — doctor 子命令）
  └── 被依赖: CI 脚本（pnpm doctor 入口）
```

### 2.4 架构特性

| 特性 | 说明 |
|------|------|
| **管线化** | 多个检查器通过统一管线编排，可并行执行 |
| **可插拔** | 新增检查器只需实现 `IChecker` 接口 + `registerChecker()` |
| **零副作用** | 所有检查器只读不写，不修改任何文件 |
| **渐进式输出** | 每个检查器产出标准化的 `CheckResult`，聚合层只做汇总 |
| **防御性** | 非法 JSON、目录不存在、文件不可读等边界情况不崩溃 |
| **并行执行** | 检查器通过 `Promise.all` 并行执行，提升诊断速度 |

---

## Q3: 为什么值得合入？

### 3.1 直接价值（开发者体验）

| 价值点 | 场景 | 收益 |
|-------|------|------|
| **秒级合规体检** | `HealthChecker.diagnose()` 一条命令完成全量检查 | 从手动检查各包配置的 5 分钟缩短到 < 1 秒 |
| **定位文档门禁** | 新增包未创建 `PACKAGE_POSITIONING.md` 立即告警 | 杜绝「包做什么的」认知盲区，降低 onboarding 成本 |
| **测试标注自声明** | 测试文件首行缺少 `// @ci:` 标注被自动检出 | 与宪法 §十四·一 门禁机制对齐，确保 CI 分类准确 |
| **可量化基线** | 每个检查器产出评分，可设置 CI 门禁阈值 | 防止渐进式恶化不被感知 |

### 3.2 架构价值

| 价值点 | 说明 |
|-------|------|
| **填补合规检查空白** | 现有 `@cortex/tools` 聚焦依赖分析，不覆盖 package.json/PACKAGE_POSITIONING.md/测试标注等合规维度 |
| **可扩展管线架构** | `IChecker` 接口 + 注册表模式，后续可轻松添加 tsconfig 一致性检查、API surface 审计等高级检查器 |
| **与现有工具互补** | 不重复造轮——与 monorepo-analyzer、configuration-drift 形成「分析 + 合规」完整闭环 |
| **宪法条款自动化** | 将宪法 §五（补足声明）、§十四·一（测试门禁自声明）等手工审查条款转化为自动化检查 |

### 3.3 实施成本

| 维度 | 评估 |
|------|------|
| **代码量** | ~1800 行 TypeScript（src/ + tests/） |
| **新增依赖** | `@cortex/shared`（workspace:*）+ `@cortex/tools`（workspace:*，预留） |
| **测试覆盖** | 20+ 个测试用例覆盖正常路径、边界条件、异常场景 |
| **合入影响** | 零——纯新增包，不影响现有任何包的行为 |
| **维护成本** | 低——单文件检查器实现，IChecker 接口契约清晰 |

### 3.4 后续扩展路径

| 阶段 | 检查器 | 说明 |
|------|--------|------|
| **当前 (v0.1)** | PackageJsonChecker / PositioningDocChecker / TestHeaderChecker | 核心合规三件套 |
| **短期 (v0.2)** | TsconfigConsistencyChecker | 跨包 tsconfig target/module/strict 一致性 |
| **中期 (v0.3)** | ApiSurfaceChecker / TestCoverageChecker | API surface 审计 + 测试映射检查 |
| **长期 (v0.4+)** | DepHealthChecker / TrendTracker | 依赖健康 + 趋势追踪 |

---

## 附录：当前实现范围

### 已实现的检查器

| 检查器 | 检查项 | 发现等级 | 评分影响 |
|--------|--------|---------|---------|
| `package-json` | 字段存在性（name/version/private/type/scripts 等） | error | 每缺失一个 -15 |
| `package-json` | 类型正确性（name:string/version:string/private:boolean/type:"module"） | error | 同上 |
| `positioning-doc` | PACKAGE_POSITIONING.md 文件存在性 | warning | 每个缺失 -10 |
| `test-header` | 测试文件首行 `// @ci: unit\|llm\|integration\|e2e\|manual` | error | 每个不合格 -10 |

### 测试覆盖

| 测试域 | 用例数 | 关键覆盖 |
|--------|--------|---------|
| 基础功能 | 2 | 检查器注册、健康项目诊断 |
| package.json 检查 | 4 | 缺少 name、缺少 scripts、缺少 scripts.build、type 不为 module |
| positioning doc 检查 | 2 | 缺失告警、全存在通过 |
| test header 检查 | 4 | 缺少标注、合法标注通过、多种标注格式、无 tests 目录 |
| 工厂函数 | 1 | doctor() 一键诊断 |
| 检查器注册 | 2 | 新增检查器、同名覆盖 |
| only/skip 过滤 | 2 | only 精准运行、skip 跳过 |
| 边界条件 | 3 | 空项目、无 packages 目录、非法 JSON |
| Finding 完整性 | 1 | Finding 字段结构验证 |
| **合计** | **21** | 全部通过 |

---

*本文档由阿贝多（ImplementAgent）基于纳西妲（AnalysisAgent）的 `DESIGN.md` 架构设计实现。*
