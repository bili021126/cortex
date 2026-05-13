# 配置漂移探测器（Drift Detector）设计概要

> **作者**：纳西妲（Analysis Agent）
> **分析日期**：2026-01-20
> **分析范围**：`packages/*/package.json`（4 包）+ `package.json`（根）
> **设计目标**：扫描 → 检测 → 报告版本漂移
> **状态**：设计提案，待凝光审计 + 圆桌审议

---

## 一、问题定义

### 1.1 什么是"配置漂移"

在 monorepo 中，同一个依赖（dependency）在多个包的 `package.json` 中出现时，版本号声明不一致。例如：

```
packages/engine/package.json:   "typescript": "^5.7.0"
packages/shared/package.json:   "typescript": "^5.6.0"   ← 漂移！
```

### 1.2 为什么需要探测

| 维度 | 说明 |
|------|------|
| **构建一致性** | 同一依赖不同版本 → 运行时行为不一致 → "在我机器上能跑" |
| **锁文件膨胀** | 版本偏移 → pnpm-lock.yaml 中多份 resol 记录 → install 变慢 |
| **安全盲区** | 某个包悄悄用了旧版依赖，漏洞扫描扫不到（只扫了新版所在包） |
| **治理合规** | 本项目宪法确立了"编译时治理"模式（ESLint 门禁：`no-console`/`no-empty`），版本漂移也应是治理层可审计的问题 |

### 1.3 本项目的当前状态

**现状：干净。** 当前 4 包（`shared`/`llm`/`engine`/`testing`）+ root 的所有同名依赖版本声明一致，未见漂移。

**但**：干净不等于不需要探测器。它像雨林的菌丝网——在你看不到的地方悄悄扩散。工具存在的意义不是解决已存在的问题，而是让问题不会无声地发生。

---

## 二、探测范围

### 2.1 扫描目标

| 路径 | 包含 | 排除 |
|------|------|------|
| `packages/*/package.json` | ✅ 全部 4 包 | — |
| `package.json`（根） | ✅ 根 devDependencies | — |
| `pnpm-workspace.yaml` | ❌ 不扫描（仅定义包路径模式） | — |

### 2.2 扫描的依赖段

| 段 | 扫描 | 说明 |
|----|------|------|
| `dependencies` | ✅ | 运行时依赖 |
| `devDependencies` | ✅ | 开发依赖 |
| `peerDependencies` | ❌ | 本项目无，预留 |
| `optionalDependencies` | ❌ | 本项目无，预留 |

### 2.3 特殊处理规则

| 版本声明模式 | 处理方式 |
|-------------|---------|
| `"workspace:*"` | **不视为漂移**。pnpm workspace 协议指向本地包，版本由源码决定。不同包对同一 workspace 依赖使用 `workspace:*` 是一致的 |
| `"workspace:^x.y.z"` | **视为普通版本**。显式指定了版本范围，与 `workspace:*` 不同即漂移 |
| `"*"` / `"latest"` | **标记为"开放版本"**。建议锁定，但不算漂移（因为"开放"本身是一致的） |
| Semver 范围（`^x.y.z`, `~x.y.z`, `x.y.z`） | **精确比较字符串**。`^5.7.0` ≠ `^5.6.0` → 漂移 |

---

## 三、输出格式设计

### 3.1 终端输出（人类可读）

```
═══ 配置漂移报告 ═══
扫描范围: 5 个文件（根 + 4 包）
检查依赖: 28 项（去重）

✅ 未发现版本漂移（所有同名依赖版本一致）

─── 快照摘要 ───
依赖名               出现次数    版本              涉及包
───────────────────────────────────────────────────
eslint                3          ^10.3.0           root, engine, testing
typescript            4          ^5.7.0            engine, llm, shared, testing
vitest                5          ^2.1.0            root, engine, llm, shared, testing
@types/node           2          ^22.0.0           engine, llm
@cortex/shared        3          workspace:*       engine, llm, testing
@cortex/llm           1          workspace:*       engine
@cortex/testing       1          workspace:*       engine
@xenova/transformers  1          ^2.17.2           engine
better-sqlite3        1          ^11.0.0           engine
@types/better-sqlite3 1          ^7.6.0            engine
playwright            1          ^1.59.1           engine
uuid                  1          ^10.0.0           testing
@types/uuid           1          ^10.0.0           testing
@eslint/js            1          ^10.0.1           root
tsx                   1          ^4.19.0           root
typescript-eslint     1          ^8.59.2           root
```

当存在漂移时：

```
❌ 发现 2 处版本漂移:

  1. typescript
     引擎: ^5.7.0      packages/engine/package.json
     shared: ^5.6.0    packages/shared/package.json   ← 偏移
     → 建议统一为 ^5.7.0（多数派 3/4，且为最高版本）

  2. vitest
     root: ^2.0.0      package.json
     engine: ^2.1.0    packages/engine/package.json   ← 偏移
     → 建议统一为 ^2.1.0（根版本为旧，引擎版本为新，项目应向前演进）
```

### 3.2 JSON 输出（机器可消费）

`--json` 标志启用。

```json
{
  "meta": {
    "scanned_at": "2026-01-20T10:30:00Z",
    "files_scanned": 5,
    "dependencies_checked": 28,
    "status": "clean"
  },
  "dependencies": {
    "eslint": {
      "versions": {
        "root": { "version": "^10.3.0", "section": "devDependencies" },
        "engine": { "version": "^10.3.0", "section": "devDependencies" },
        "testing": { "version": "^10.3.0", "section": "devDependencies" }
      },
      "drift": false
    }
  },
  "drifts": []
}
```

有漂移时 `drifts` 数组：

```json
{
  "drifts": [
    {
      "dependency": "typescript",
      "occurrences": 4,
      "versions": {
        "engine": "^5.7.0",
        "llm": "^5.7.0",
        "shared": "^5.6.0",
        "testing": "^5.7.0"
      },
      "recommended": "^5.7.0",
      "reason": "多数派版本（3/4）"
    }
  ]
}
```

### 3.3 退出码

| 状态 | 退出码 | 说明 |
|------|--------|------|
| 无漂移 | `0` | 干净通过 |
| 有漂移 | `1` | 检测到版本不一致 |
| 扫描异常 | `2` | 文件读取失败、JSON 解析错误等 |

---

## 四、实现策略

### 4.1 算法流程

```
Phase 0: 收集
  ├── 遍历 packages/*/package.json + root package.json
  └── 对每个文件:
        ├── 读取 dependencies
        └── 读取 devDependencies

Phase 1: 聚合
  ├── 按依赖名分组
  ├── 收集每个出现位置的版本和段信息
  └── 过滤 workspace:* 协议（标记但不判断漂移）

Phase 2: 检测
  ├── 对每个依赖名:
  │     └── 如果 version set 大小 > 1 → 漂移
  └── 收集所有漂移项

Phase 3: 建议
  ├── 对每个漂移项:
  │     └── 推荐多数派版本 / 最新版本 / 显式指定
  └── 计算建议理由

Phase 4: 输出
  ├── 终端人类可读报告
  ├── JSON 机器可读报告（可选 --json）
  └── 退出码
```

### 4.2 推荐策略

当检测到漂移时，推荐版本的选择优先级：

1. **多数派版本**：在多个出现中，出现次数最多的版本
2. **最高版本**：如果平票，选择 semver 最高的版本（假设项目整体在向前演进）
3. **根版本优先**：如果 root package.json 有该依赖，优先遵循根版本（根作为"事实源"）

### 4.3 与现有治理体系的衔接

| 治理机制 | 衔接方式 |
|---------|---------|
| **宪法 §十四 编译时治理** | 漂移探测器作为 CI 门禁的一环，纳入 `ci-gate.ts` 的检查流程 |
| **DocGovernAgent 审计** | 漂移报告应写入 DocGovern 分区，供审计追溯 |
| **圆桌会议材料清单** | 漂移报告可作为材料清单的备选项（optional），在涉及依赖变更的会议前提供 |
| **测试门禁自声明** | 探测器本身的测试标记为 `@ci: unit` |
| **NG-2026-0509-Persist-False-Positive 判例** | 探测器不可产生假阳性——`workspace:*` 不告警，单出现不告警 |

---

## 五、边界情况与风险

### 5.1 已知边界

| 边界 | 处理方式 |
|------|---------|
| `workspace:*` 与 `workspace:^1.0.0` | 视为不同——前者是"跟随源码"，后者是"锁定范围" |
| `^1.0.0` 与 `^01.0.0` | 精确字符串比较 → 视为漂移。虽然 semver 等价，但格式不一致也应告警 |
| 包自身 name 字段 | 不扫描。这不是依赖 |
| 依赖仅出现在一个包中 | 不构成漂移。在快照中列出但不发出告警 |
| `file:../path` / `link:../path` / `git:...` 协议 | 目前不存在。若出现则标记为"非常见协议"并提醒人工审查 |

### 5.2 误报与噪音控制

| 场景 | 策略 |
|------|------|
| 同一依赖在包 A 的 deps 和包 B 的 devDeps 中不同版本 | 仍标记漂移（可能导致锁文件膨胀和构建环境不一致） |
| `@cortex/*` 内部包使用 `workspace:*` | 不标记 |
| `@cortex/*` 内部包使用显式版本号（如 `^0.1.0`） | 标记（打破了 workspace 协议） |

### 5.3 实施风险

| 风险 | 缓解措施 |
|------|---------|
| pnpm-lock.yaml 中已有旧版本 resol | 探测器仅告警，不修改锁文件。升级由开发者/OpsAgent 执行 `pnpm update` |
| 大项目扫描性能 | 算法 O(n*m)，对本项目 4 包无影响。预留 `--filter` 参数 |
| 探测器本身维护成本 | 探测器作为治理工具链的一部分。测试覆盖率 ≥ 80% |

---

## 六、与本项目架构的契合

### 6.1 依赖方向

本项目依赖方向严格单向：`shared ← llm ← engine ← testing`

探测器实现方案：**零内部依赖**——只使用 Node.js 内置模块（`fs`、`path`、`process`）。探测器是治理工具，不是 Engine 的一部分，不应引入任何 `@cortex/*` 依赖。

### 6.2 CI 位置

插入在 `build` 阶段之前：

```
drift-detect → build → typecheck → test → lint
```

理由：版本漂移可能在 build 阶段暴露为难以诊断的编译错误。提前发现可节省调试时间。

### 6.3 与钟离（StrategistAgent）的关系

钟离负责战略把关。版本漂移探测器为钟离提供"依赖一致性"维度的战略评估数据——当引入新依赖时，钟离可以引用探测器的历史报告来判断"这个依赖在其他包中是否已经在用、用的什么版本"。

---

## 七、实施路线

| 步骤 | 产出 | 预估工作量 |
|------|------|-----------|
| 1. 实现核心：扫描→聚合→检测 | `scripts/drift-detector.ts` | 1 天 |
| 2. 实现输出：终端 + JSON | `scripts/drift-detector.ts`（续） | 0.5 天 |
| 3. 单元测试 | `packages/testing/tests/drift-detector.test.ts` | 0.5 天 |
| 4. CI 集成 | 修改 `ci-gate.ts` | 0.25 天 |
| 5. DocGovern 适配 | 输出格式扩展 | 0.25 天 |
| 6. 圆桌审议 + 凝光审计 | 设计文档定稿 | 0.5 天 |

**总计**：约 3 天（含测试和审议）

---

## 八、附录：本次扫描的实际结果

### 扫描文件（5 个）

| 文件 | 包名 |
|------|------|
| `/cortex/package.json` | root |
| `/cortex/packages/engine/package.json` | `@cortex/engine` |
| `/cortex/packages/llm/package.json` | `@cortex/llm` |
| `/cortex/packages/shared/package.json` | `@cortex/shared` |
| `/cortex/packages/testing/package.json` | `@cortex/testing` |

### 同名依赖版本对照表

| 依赖名 | 段 | root | engine | llm | shared | testing | 漂移？ |
|--------|----|------|--------|-----|--------|---------|--------|
| eslint | dev | ^10.3.0 | ^10.3.0 | — | — | ^10.3.0 | ❌ 无 |
| typescript | dev | — | ^5.7.0 | ^5.7.0 | ^5.7.0 | ^5.7.0 | ❌ 无 |
| vitest | dev | ^2.1.0 | ^2.1.0 | ^2.1.0 | ^2.1.0 | ^2.1.0 | ❌ 无 |
| @types/node | dev | — | ^22.0.0 | ^22.0.0 | — | — | ❌ 无 |
| @cortex/shared | dep | — | workspace:* | workspace:* | — | workspace:* | ❌ 无 |
| @cortex/llm | dep | — | workspace:* | — | — | — | ✅ 单出现 |
| @cortex/testing | dev | — | workspace:* | — | — | — | ✅ 单出现 |
| @xenova/transformers | dep | — | ^2.17.2 | — | — | — | ✅ 单出现 |
| better-sqlite3 | dep | — | ^11.0.0 | — | — | — | ✅ 单出现 |
| @types/better-sqlite3 | dev | — | ^7.6.0 | — | — | — | ✅ 单出现 |
| playwright | dev | — | ^1.59.1 | — | — | — | ✅ 单出现 |
| uuid | dep | — | — | — | — | ^10.0.0 | ✅ 单出现 |
| @types/uuid | dev | — | — | — | — | ^10.0.0 | ✅ 单出现 |
| @eslint/js | dev | ^10.0.1 | — | — | — | — | ✅ 单出现 |
| tsx | dev | ^4.19.0 | — | — | — | — | ✅ 单出现 |
| typescript-eslint | dev | ^8.59.2 | — | — | — | — | ✅ 单出现 |

### 结论

**当前状态：干净，零漂移。**

> 探测器不是为修复过去而存在——是为守护未来。每一个新依赖的引入、每一次版本升级，都应经过治理层的视野，而不是在某个包的 `package.json` 里无声地漂移。
