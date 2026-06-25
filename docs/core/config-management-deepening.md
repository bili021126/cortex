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
