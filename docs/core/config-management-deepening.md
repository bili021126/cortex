# 配置管理深化设计

> 定位：Core-2 config 声明式编排的基础设施。关联：`docs/core/retrieval-scheduler-design.md`、`docs/core/治理层设计-v3.0-全量整合版.md §8`。

---

## 段一：现状诊断

### 已存在的零件

| 零件 | 位置 | 状态 |
|------|------|------|
| `@cortex/config` 包 | `packages/config/` | ✅ 包骨架完整 |
| `config/data/` 目录 | `config/data/` | ✅ 14 个 JSON 配置 |
| `engine-defaults.ts` | `config/src/engine-defaults.ts` | ✅ 结构化默认值 |
| `env override` 机制 | `config/src/engine-defaults.ts` 内 | ⚠️ 仅 engine-defaults 支持 |

### 缺失的零件

| 缺口 | 影响 |
|------|------|
| 无统一注册表 | 各包 import 自己的 config，不知道全局有哪些配置 |
| 无 Schema 校验 | JSON 加载不会报错字段缺失/类型错误 |
| 无三级覆盖链 | 只有 env→defaults，无法覆盖"用户偏好"和"项目偏好" |
| 无热加载 | 改 cognition.json 必须重启引擎 |
| 无漂移检测 | 源码默认值和 config 文件默认值可能不一致 |

### 当前调用链

```
启动 → import engine-defaults.ts → _readEnvOverrides() → 合并
         ↑ 仅此一条路径有覆盖机制
       
其他 config:
  启动 → import json → 直接用（无校验、无覆盖、无热加载）
```

---

## 段二：设计

### 总览

```
┌──────────────────────────────────────────────────────────┐
│                    ConfigRegistry                        │
│  register(domain, schema) → 注册一个新配置域              │
│  get(domain) → 返回解析后的配置（含覆盖链）               │
│  onChange(domain, fn) → 订阅变更                         │
├──────────────────────────────────────────────────────────┤
│                   ConfigResolver                         │
│  resolve(domain) → env > user > project > defaults       │
├──────────────────────────────────────────────────────────┤
│                   ConfigWatcher                          │
│  watch(domains) → fs.watch → re-parse → emit change      │
├──────────────────────────────────────────────────────────┤
│                   ConfigSchema                           │
│  validate(domain, raw) → Zod.parse → 报错或返回          │
└──────────────────────────────────────────────────────────┘
```

### 覆盖链优先级

```
1. process.env.CORTEX_*             环境变量（最高优先）
2. ~/.cortex/config/                 用户级（跨项目）
3. d:\cortex\.cortex\config\         项目级
4. config/data/*.json                默认值（最低优先）
```

### 核心接口

```typescript
// packages/config/src/registry.ts

interface ConfigDomain {
  key: string;                    // 唯一标识，如 "cognition"
  schema: ZodSchema;              // Zod 校验 schema
  defaults: Record<string, unknown>; // 默认值
  envPrefix?: string;             // 环境变量前缀，如 "CORTEX_ENGINE_"
}

class ConfigRegistry {
  register(domain: ConfigDomain): void;
  get<T>(key: string): Promise<T>;      // 返回解析后的配置
  onChange(key: string, fn: (newValue: T) => void): void;
  reload(key: string): Promise<void>;   // 重新加载
  list(): string[];                     // 列出所有已注册域
}
```

### 使用路径

| 路径 | 调用方 | 时机 | 产出 |
|------|--------|------|------|
| P1 | bootstrap-engine.ts | 引擎启动 | 注册所有配置域 |
| P2 | 各包 get() 替代 import json | 运行时 | 配置读取统一入口 |
| P3 | CI gate | commit 前 | 漂移检测 |

### 边界条件

- 不替代 `engine-defaults.ts`——它作为 engine 域的 defaults 值
- 不强制所有包迁移——渐进式：新 config 走注册，旧 import 暂时共存
- 不实现分布式配置中心——单进程，单文件系统

---

## 段三：与现有代码的精确咬合

### 不改的

| 文件 | 原因 |
|------|------|
| `config/src/engine-defaults.ts` | 作为 engine 域 defaults 保留 |

### 要改的

| 文件 | 改动 | 行数 |
|------|------|------|
| 🆕 `packages/config/src/registry.ts` | ConfigRegistry 类 | ~60 |
| 🆕 `packages/config/src/resolver.ts` | ConfigResolver 三级覆盖 | ~40 |
| 🆕 `packages/config/src/watcher.ts` | ConfigWatcher | ~30 |
| 🆕 `packages/config/src/schemas/` | Zod schema 定义 | ~20/schema |
| ✏️ `packages/config/src/index.ts` | 导出新模块 | 3 |
| 🆕 `scripts/check-config-drift.ts` | CI 漂移检测脚本 | ~50 |

### 暂不改的

| 事项 | 延期原因 |
|------|---------|
| 现有 JSON 全量迁移到 registry | 需要逐域做，先建基础设施 |

---

## 段四：实施路径

| 优先级 | 事项 | 代码量 | 前置依赖 |
|--------|------|--------|---------|
| P0 | registry.ts + resolver.ts 骨架 | ~100行 | 无 |
| P1 | schemas/ 目录 + 首批 schema | ~60行 | P0 |
| P2 | cognition.json 接入 registry(作为试点) | ~20行 | P1 |
| P3 | watcher.ts | ~30行 | P0 |
| P4 | check-config-drift.ts | ~50行 | P1 |

**P1 验收标准**：
- `ConfigRegistry.register({ key: "cognition", schema, defaults })` 不报错
- `ConfigRegistry.get("cognition")` 返回 `{ _source: "env", ... }` 标注覆盖来源
- 环境变量 `CORTEX_COGNITION_WEIGHT_HYBRID=0.6` 覆盖 defaults 中的 `weightHybrid`
- 缺失字段时 Zod 报错，错误信息包含字段名和期望类型
- `tsc --noEmit` 全局零报错

---

## 段五：实施现状（2026-09-26 实测回填）

> 本段是**回填**，不是新设计。段二～段四写于提案期，落地时形状有出入；此处记录实际建成的东西，
> 以免下次有人按提案去找不存在的文件。

### 实际落地与提案的差异

| 提案 | 实际 |
|------|------|
| `ConfigRegistry`（Zod schema + `register/get/onChange/reload/list`） | **未按此形状建**。实际是 `CONFIG_DOMAINS` 数组 + `loadConfigDomain(name, readFile, dataDir)` 门面，schema 用**自研 JSON Schema 校验器**（`validateDomainWithSchema`），不是 Zod |
| `ConfigResolver` 三级覆盖（env > user > project > defaults） | **只有两级**：`CORTEX_CONFIG_DIR` env > 用户数据目录 > 包 `dist/data` 兜底。**没有项目级 `.cortex/config` 层**，也没有逐域 `envPrefix` |
| `ConfigWatcher` 热加载 | **未建**（改配置仍需重启） |
| `scripts/check-config-drift.ts` | 未建；相关守护落在 `domains-data-consistency.test.ts`（src/data 每个 .json 必须注册域） |
| `config/data/` 14 个 JSON | 18 个配置域（`CONFIG_DOMAINS` 长度即权威，勿抄散文里的数字） |

### 新增：用户数据目录的补种语义（本节对应 2026-09-26 修复）

`resolveConfigDataDir()` 的解析链里，用户数据目录（默认 `~/.cortex/config`，可被 `CORTEX_CONFIG_DIR` 覆盖）
是一个**长期存在的安装态目录**——它一旦建成，上游改配置不会自动生效。

原实现 `seedIfMissing` 是 `if (fs.existsSync(userDataDir)) return`，**只在首次创建目录时播种**。
后果实测（2026-09-26 对照 src / dist / 用户目录三处）：

- `architecture-flows.json` **整文件缺失** → 新配置域 `architectureFlows`（`required: false`）静默返回 `undefined`
- `event-routing.json` 缺 `mergeRules` → `bootstrap-engine` 执行 `setMergeRules(config.eventRouting.mergeRules ?? [])`，
  **NotificationPipe 的事件归并子系统从未生效**（窗口/批次/指纹那套全被 `?? []` 吞掉）

改为 `seedMissingFiles`：**每次解析都补缺，且 add-only，绝不覆盖已存在文件。**
不覆盖是刻意的——用户目录里可能有用户自己的编辑（`models.json` 的模型清单、`tuning.json` 的调参），
覆盖不可逆。另外只处理 `.json`：`dist/data` 里混着 `context-policies.ts` 编译出的 `.js/.d.ts/.map`，
那些是代码产物不是配置数据。

残留的已知不一致（**需要人决定，不由代码自行处置**）：
`~/.cortex/config/models.json` 是 `deepseek-v4-flash` / `deepseek-v4-pro` 且无 `_pricing`，
而 `src/data/models.json` 是 `deepseek-v4-1-flash` / `-pro` / `-flash-vision-exp`。
可能是用户定制，也可能只是旧版——语义变更不自动迁移。

### 新增：`dist/data` 的同步（`packages/config/scripts/copy-data.mjs`）

`src/data` 里混着两类东西：配置域数据（`*.json`）与编译型 TS 模块（`context-policies.ts` → `dist/data/*.js`）。
tsc 只负责后者，前者靠 `copy-data.mjs` 镜像（**含孤儿清理**——`dist` 里 src 已没有的 `.json` 会被删掉）。

为什么门禁必须跑它：loader 在 `VITEST` 下把数据目录解析到 `packages/config/dist/data`
（`isTestEnv()` 短路），而 `dist/` 被 gitignore——**`tsc -b` 不复制 JSON**（复制只发生在包自己的 `build` 脚本里，
而门禁从不跑包 build）。所以干净检出上门禁没有配置数据，本地则可能拿**陈旧**配置做验证。
2026-09-26 实测该路径下 `mergeRules` 与 `architecture-flows.json` 双双缺失，而测试全绿。
现在门禁第 1 步（类型检查）之后增加同步步骤，失败以 `failedStage: "configDataSync"` 阻断。
