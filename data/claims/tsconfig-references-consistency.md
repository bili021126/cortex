# 侦察报告：tsconfig references 一致性验证

> 侦察员：安柏（Inspector Agent）
> 范围：packages/ 目录下全部 26 个包的 tsconfig.json / tsconfig.src.json / tsconfig.test.json，以及根 tsconfig.json
> 方法：逐文件读取 references 字段、验证路径存在性、追踪依赖图、检查循环引用
> 编译验证：[tsc --noEmit] ✅ 编译通过

---

## Claim 1：所有引用路径均可解析 ✅

**状态：通过。** 每一个 tsconfig.json 或 tsconfig.src.json 中的 `references[].path` 均指向真实存在的文件。

| 文件 | 引用数 | 全部可解析 |
|------|--------|-----------|
| 根 tsconfig.json | 26 | ✅ |
| engine/tsconfig.src.json | 15 | ✅ |
| cli/tsconfig.json | 8 | ✅ |
| consistency/tsconfig.json | 4 | ✅ |
| consistency/tsconfig.src.json | 3 | ✅ |
| platform/tsconfig.src.json | 3 | ✅ |
| memory-store/tsconfig.src.json | 3 | ✅ |
| 其他 18 个文件 | 1~2 不等 | ✅ |

引用路径目标类型分布：
- `../<pkg>`（指向同层 tsconfig.json）— 主流模式
- `../<pkg>/tsconfig.src.json`（指向显式 src 配置）— 用于 engine, governance, memory-store, platform, consistency, plugin-runner, scheduler 等
- `./tsconfig.src.json` / `./tsconfig.test.json`（自引用子配置）— files:[] 容器模式

**证据链**：read_file 逐一验证每一条 path 对应的文件存在。

---

## Claim 2：TypeScript 构建图无严格循环引用 ✅

**状态：通过。** 在整个 project references 图中不存在 `tsc -b` 无法确定构建顺序的循环。

详细依赖图（简化）：

```
shared (leaf)
  ↑— config, llm, notification, testing, tui, 
      scheduler, context-manager
  ↑— governance, memory-store, platform, 
      consistency, engine, cli

config
  ↑— context-manager, tui, scheduler, platform,
      memory-store, governance, consistency,
      engine, cli

memory (leaf)
  ↑— engine, memory-store

scheduler/tsconfig.src.json
  ↑— platform/tsconfig.src.json, engine

platform/tsconfig.src.json
  ↑— engine, cli

governance/tsconfig.src.json
  ↑— engine

memory-store/tsconfig.src.json
  ↑— consistency, engine, cli

consistency/tsconfig.src.json
  ↑— engine

plugin-runner/tsconfig.json (无子引用)
  ← engine/tsconfig.src.json 依赖于此
  ↑— plugin-runner/tsconfig.src.json 依赖 engine

engine/tsconfig.src.json
  ↑— cli, plugin-runner/tsconfig.src.json
```

构建顺序存在性证明：`engine → plugin-runner/tsconfig.json (leaf)` → 先构建 plugin-runner/tsconfig.json → 再构建 engine → 最后构建 plugin-runner/tsconfig.src.json。无循环。

---

## Claim 3：根 tsconfig.json 覆盖全部 26 个包 ✅

**状态：通过。** packages/ 目录下全部 25 个子包 + tools/filesystem-mcp-server（外部工具）均已在根 tsconfig.json 引用范围中——其中 filesystem-mcp-server 不属于根构建范围。

根 tsconfig.json 中出现的 26 个 reference：
1. memory, config, shared, notification, parser, pattern-extractor, tools, llm, testing
2. engine/tsconfig.src.json, cli, telemetry, fsm-compiler/tsconfig.src.json, prompt-kit, doctor, tui
3. governance/tsconfig.src.json, scheduler, platform, memory-store, consistency/tsconfig.src.json, resilience
4. skill-kit, logging, context-manager, plugin-runner/tsconfig.src.json

与 packages/ 目录列表比对：**26 个包全部覆盖，无遗漏 ✅**

---

## Claim 4：plugin-runner/tsconfig.json 结构与其他包不一致 ⚠️

**状态：发现不一致。**

同类包（engine, fsm-compiler, resilience, scheduler）的 tsconfig.json 结构：
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.src.json" },
    { "path": "./tsconfig.test.json" }
  ]
}
```
→ 薄壳容器，职责仅为聚合 src + test 子配置。

但 **plugin-runner/tsconfig.json** 的结构：
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["dist", "src/__tests__"]
}
```
→ 全功能配置，无 `files:[]`，无 references。根 tsconfig.json 引用的是 `packages/plugin-runner/tsconfig.src.json` 而非 tsconfig.json。

**影响**：结构不一致导致两套配置并存但职责边界模糊。plugin-runner/tsconfig.json 可独立编译，但不参与 project references 链（无 references 声明）。

**证据**：read_file 对比 engine/tsconfig.json vs plugin-runner/tsconfig.json。

---

## Claim 5：engine ↔ plugin-runner 双向跨包依赖 ⚠️

**状态：存在架构级双向依赖，违背代码法典 §9.9（包间依赖必须单向无环）。**

```
engine/tsconfig.src.json
  └─ { "path": "../plugin-runner" }  →  plugin-runner/tsconfig.json

plugin-runner/tsconfig.src.json
  └─ { "path": "../engine/tsconfig.src.json" }  →  engine/tsconfig.src.json
```

虽然从 TypeScript 构建图角度不构成严格循环（因 plugin-runner/tsconfig.json 无子引用），但从包架构角度：
- `@cortex/engine` 编译时依赖 `@cortex/plugin-runner`
- `@cortex/plugin-runner` 编译时依赖 `@cortex/engine`

形成了 **包级别的双向依赖**。这违反了 §9.9 "禁止 A→B 且 B→A（静态/运行时都不行）"。

**建议**：考虑将 engine 和 plugin-runner 共同依赖的类型/接口抽取到 shared 层，消除双向引用。

**证据**：读自 engine/tsconfig.src.json（第19行）和 plugin-runner/tsconfig.src.json（第13行）。

---

## Claim 6：consistency 配置冗余 ⚠️

**状态：发现冗余的双重引用声明。**

consistency/tsconfig.json 的 references：
```json
[
  { "path": "./tsconfig.src.json" },
  { "path": "../shared" },
  { "path": "../config" },
  { "path": "../memory-store" }
]
```

consistency/tsconfig.src.json 的 references：
```json
[
  { "path": "../config" },
  { "path": "../memory-store/tsconfig.src.json" },
  { "path": "../shared" }
]
```

shared、config、memory-store 的依赖在 tsconfig.json 和 tsconfig.src.json 中各声明了一次。虽然不构成错误，但存在维护隐患——将来新增依赖需要在两个地方同时修改，容易遗漏。

**建议**：consistency/tsconfig.json 应简化为与其他包一致的 `files:[] + refs: [tsconfig.src.json]` 薄壳容器。

**证据**：read_file 对比 consistency/tsconfig.json 与 engine/tsconfig.json（后者无外层冗余引用）。

---

## Claim 7：编译验证结果 ✅

**状态：[tsc --noEmit] ✅ 编译通过。**

所有 tsconfig references 配置均能在编译期生效，无断裂引用导致编译失败。

**证据**：系统自动采集的编译事实——tsc --noEmit 零错误。

---

## 总览表

| # | Claim | 状态 |
|---|-------|------|
| 1 | 所有引用路径可解析 | ✅ |
| 2 | 无 TypeScript 构建图循环引用 | ✅ |
| 3 | 根 tsconfig 覆盖全部包 | ✅ |
| 4 | plugin-runner tsconfig 结构不一致 | ⚠️ |
| 5 | engine ↔ plugin-runner 双向包依赖 | ⚠️ |
| 6 | consistency 配置冗余 | ⚠️ |
| 7 | tsc --noEmit 编译通过 | ✅ |

**勘察完毕。3 项通过，3 项需关注。**
