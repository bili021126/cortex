# Tool Registry 模式参考（from Cyrene-Agent）

> **来源**: `d:\cortex\_extraneous\Cyrene-Agent-master\src\main\orchestrator\tool-registry.ts` + `src\main\permission.ts`
> **目的**: 提取 Cyrene-Agent 的工具注册表接口设计、权限分级策略、安全分级标注模式。
> **不直接改代码**: 不修改现有 `@cortex/engine` 或 `@cortex/skill-kit` 代码。

---

## 1. 整体架构

```
ToolDefinition（工具定义）
  ↓ 注册到
ToolRegistry（Map 单例）
  ↓ 被
LLM Router / 权限系统  消费
```

- **注册时**：定义工具元数据 + 执行函数 + 权限风险等级
- **调用时**：权限系统先 `checkPermission()` → 通过后执行
- **无 MCP 桥接层**：内置工具和 MCP 工具统一在将来复用同一套 `ToolDefinition` 接口（`inputSchema` 已预埋 JSON Schema 兼容字段）

---

## 2. 工具定义接口

### ToolDefinition

```typescript
interface ToolDefinition {
  id: string;           // 工具唯一标识，如 "imported_docs"
  name: string;         // 展示名，如 "导入文档"
  description: string;  // 一句话描述，供 LLM Prompt 路由使用
  enabled: boolean;     // 用户是否启用
  risk?: ToolRiskLevel; // 危险等级（默认 "safe"）
  inputSchema: {        // JSON Schema 参数定义
    type: "object";
    properties: Record<string, JsonSchemaProp>;
    required?: string[];
  };
  needsContext?: boolean;  // 是否需要 ToolContext（对话上下文）
  execute: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<string>;
}
```

### JsonSchemaProp（参数 Schema 片段）

```typescript
type JsonSchemaProp =
  | { type: string; description?: string; enum?: string[] }
  | { type: "array"; description?: string; items: JsonSchemaProp }
  | { type: "object"; description?: string; properties: Record<string, JsonSchemaProp>; required?: string[] };
```

预埋 MCP 兼容：将来接 MCP transport 时，`inputSchema` 直接复用，无需额外转换。

---

## 3. 权限分级系统

### ToolRiskLevel（工具危险等级）

```typescript
type ToolRiskLevel = "safe" | "fs-read" | "fs-write" | "shell" | "network" | "input-control";
```

| 等级 | 含义 | 示例工具 |
|------|------|---------|
| `safe` | 纯计算、纯检索本地内置数据 | invoke_skill, read_skill_reference, 数学计算 |
| `fs-read` | 读取用户文件系统 | read_file, search_files |
| `fs-write` | 写入用户文件系统 | write_file, edit_file |
| `shell` | 执行任意命令 | run_shell, execute_command |
| `network` | 网络请求 | web_search, fetch_url |
| `input-control` | 人机交互控制（键鼠/截屏） | screenshot, mouse_click |

### AgentFileAccessLevel（Agent 权限档位）

```typescript
type AgentFileAccessLevel = "read-only" | "scoped" | "per-action" | "full";
```

| 档位 | 含义 | 适用场景 |
|------|------|---------|
| `read-only` | 只读，无写入 | 首次使用/不信任模式 |
| `scoped` | 指定目录内读写 | 项目目录开发的日常使用 |
| `per-action` | 每次操作需用户审批 | 需要精细控制时 |
| `full` | 完全信任，不拦截 | 高级用户/私有部署 |

### 策略矩阵（policyFor）

```
risk ↓ \ level →   read-only     scoped        per-action     full
────────────────────────────────────────────────────────────────────
safe                allow         allow         allow          allow
fs-read             allow         allow         ask            allow
fs-write            deny          allow         ask            allow
shell               deny          deny          ask            allow
network             allow         allow         ask            allow
input-control       deny          deny          ask            allow
```

关键设计点：
1. **safe 级工具永远通行**（无论什么档位都 allow），因为纯计算/纯检索不产生副作用
2. **per-action 档位**对所有非 safe 工具弹审批窗口，60 秒超时自动拒绝
3. **read-only 档位**允许 fs-read 和 network（可读不可写），shell 和 input-control 拒绝

---

## 4. 权限检查流程

```
checkPermission(toolId, toolName, toolDescription, args, risk)
  → policyFor(currentLevel, risk)
    → "allow" → 放行
    → "deny"  → 返回拒绝理由（含当前档位提示）
    → "ask"   → requestApproval() 弹审批窗口
                → 用户点"同意" → 放行
                → 用户点"拒绝" → 返回拒绝
                → 60 秒无响应 → 自动拒绝
```

### 审批窗口接口

```typescript
interface ApprovalRequest {
  id: string;
  toolId: string;
  toolName: string;
  toolDescription: string;
  args: Record<string, unknown>;
  risk: ToolRiskLevel;
}
```

Cyrene 通过 Electron IPC 将审批请求广播到所有 BrowserWindow。Cortex 如果不需要 Electron UI，可将 `requestApproval()` 替换为 EventBus 事件订阅模式。

---

## 5. 注册模式示例

### 5.1 内置工具注册（安全级）

```typescript
toolRegistry.register({
  id: 'user_memory',
  name: '用户记忆',
  description: '查询用户的历史记忆...（详细描述供 LLM 路由判断）',
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      topK:  { type: 'number', description: '返回条数，默认5' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const results = await searchMemory(String(args.query), 'user_memory', Number(args.topK) || 5);
    return results.map(formatMemoryResult).filter(Boolean).join('\n');
  },
});
```

### 5.2 只读工具（fs-read 级）

```typescript
toolRegistry.register({
  id: 'read_file',
  name: '读取文件',
  description: '读取本机文件内容...',
  enabled: true,
  risk: 'fs-read',  // ← 指定危险等级
  inputSchema: { ... },
  execute: async (args) => { ... },
});
```

### 5.3 Skill meta-tool 注册（safe 级，免权限打扰）

```typescript
toolRegistry.register({
  id: "invoke_skill",
  name: "调用 Skill",
  description: "加载某个 skill 的详细执行指令...",
  enabled: true,
  risk: "safe",  // 只读本地 skill 文件，safe 级免权限检查
  inputSchema: { ... },
  execute: async (args) => { ... },
});
```

---

## 6. 关键设计决策

### 6.1 为什么 safe 级工具不需要权限检查？

safe 级工具的特征：
- 只读本地固定路径（skill 目录、内置知识库）
- 纯计算（数学、格式化、转换）
- 不产生副作用（不写文件、不发网络、不执行命令）

因此任何档位下都可以直接 allow，省去不必要的审批弹窗。

### 6.2 description 为什么写那么多？

Cyrene 的 `description` 字段不只是简短标签——它包含：
- 一句话概括（供快速路由）
- **何时用**的场景列举（LLM 据此判断）
- **不要用于**的反面约束（降低误调用率）
- 参数说明示例

这种"工具使用手册"风格显著降低了 LLM 误调用的概率。

### 6.3 needsContext 的作用

某些工具需要访问当前对话上下文（如"当前文件列表"、"用户身份"等）。`needsContext` 标记后，调度层自动传入 `ToolContext`。

---

## 7. 与现有 Cortex 模式的对比

| 维度 | Cyrene-Agent | Cortex（推测/参考） |
|------|-------------|-------------------|
| 注册方式 | 类方法 `register(tool)` + 全局单例 | 待定 |
| 权限模型 | 4 档位 × 6 风险等级 = 策略矩阵 | 待定 |
| 参数 Schema | 内联 JSON Schema（预埋 MCP 兼容） | 待定 |
| 描述风格 | 详细"手册式"（含何时用/不要用于） | 待定 |
| 执行返回 | `Promise<string>` | 待定 |
| MCP 桥接 | 无（`inputSchema` 为 MCP 预埋兼容） | 待定 |

---

## 8. 文件索引

| 文件 | 用途 | 核心导出 |
|------|------|---------|
| `orchestrator/tool-registry.ts` | 工具注册表 + 内置工具注册 | `ToolRegistry`, `toolRegistry`, `ToolDefinition` |
| `permission.ts` | 权限档位 + 策略矩阵 + 审批 IPC | `checkPermission()`, `policyFor()`, `AgentFileAccessLevel`, `ToolRiskLevel` |
| `orchestrator/tool-context.ts` | 工具执行上下文（推测） | `ToolContext`（接口） |
