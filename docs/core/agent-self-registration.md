# Agent 自声明与自组装设计

> 定位：从静态 Agent 注册到运行时动态组装的架构演进。关联：`docs/core/治理层设计-v3.0-全量整合版.md`、`docs/core/场景感知调度层设计.md`。
> 数据源：DeepSeek 外部记忆库 #19「Agent 自声明与自组装」

---

## 段一：现状与目标

### 现状

当前 Cortex 的 Agent 是**静态注册制**：

- 每个 Agent 在 `cortex-agents.json` 中声明 role / systemPrompt / toolPermissions
- MetaAgent（甘雨）根据任务类型从注册表中**查找**匹配的 Agent
- 14 种 Agent 各有固定职责，彼此界限分明

### 问题

| 问题 | 影响 |
|------|------|
| 添加新 Agent 需要改注册表 + 改宪法 + 改代码 | 扩展成本高 |
| Agent 职责强耦合于类型 | 同一技能无法跨 Agent 复用 |
| 系统提示词（systemPrompt）硬编码 | 更新提示词需重新注册 |
| 无法按任务动态组合能力 | 简单任务也被分配全功能 Agent |

### 目标

**最终只存在一个 BaseAgent**。所有具体 Agent 通过标签组合和自声明在运行时动态生成。提示词从系统配置变为 Agent 可查询的认知资源。

```
现状                     目标
─────────               ─────────
AgentA (固定)           BaseAgent
AgentB (固定)              │
AgentC (固定)              ├─ CapabilityRegistry
  ...                      │     └─ 声明式标签
                           │
                           ├─ MetaAgent
                           │     └─ 按任务匹配 → 动态组装
                           │
                           └─ 提示词 → 认知资源池
```

---

## 段二：核心概念

### AgentCapability——能力声明

每个 Agent 实例在启动时声明其能力画像：

```typescript
interface AgentCapability {
  id: string;                    // 唯一标识
  name: string;                  // 人类可读名称
  tags: string[];                // 能力标签（如 ["code-review", "typescript", "security"]）
  persona: string;               // 人格标识（如 "cyrene", "keqing", "albedo"）
  priority: number;              // 匹配优先级（0-100）
  constraints?: {                // 可选约束
    maxConcurrency?: number;      // 最大并发
    requiredMemory?: string[];    // 所需记忆域
    excludedTags?: string[];      // 排除的标签
  };
}
```

### CapabilityRegistry——能力注册表

系统启动时自动收集所有 Agent 声明：

```typescript
class CapabilityRegistry {
  private capabilities: Map<string, AgentCapability> = new Map();

  register(cap: AgentCapability): void {
    // 启动时或运行时动态注册
  }

  unregister(id: string): void {
    // 优雅下线
  }

  match(task: TaskNode): AgentCapability[] {
    // 按标签匹配 + 优先级排序
  }
}
```

### MetaAgent——动态组装

MetaAgent 不再"查找"Agent，而是根据任务**动态组装**团队：

```typescript
class MetaAgent {
  registry: CapabilityRegistry;

  assemble(task: TaskNode): AgentTeam {
    // 1. 解析任务需求
    const requiredTags = this.parseTaskTags(task);
    
    // 2. 匹配能力
    const matches = this.registry.match(task);
    
    // 3. 组合团队
    return {
      lead: matches[0],           // 主执行 Agent
      reviewers: matches.slice(1), // 评审 Agent
      strategy: this.resolveStrategy(matches, task),
    };
  }
}
```

---

## 段三：架构

```
启动时
  │
  ├─ CapabilityRegistry.load()
  │     ├─ 读 config/data/agent-capabilities.json
  │     └─ 可选：Agent 运行时动态 register()
  │
  ▼
运行时
  │
  MetaAgent.onTask(task)
  │
  ├─ 1. CapabilityRegistry.match(task)
  │     ├─ tag 匹配 → 候选列表
  │     └─ 按 priority 排序
  │
  ├─ 2. 动态组装 AgentTeam
  │     ├─ 组合 tags 生成 persona
  │     ├─ 从认知资源池加载提示词
  │     └─ 注入 toolPermissions
  │
  └─ 3. 执行 → 结果 → 解散（可选持久化）
```

### 配置示例

```jsonc
// config/data/agent-capabilities.json
[
  {
    "id": "code-review-engine",
    "name": "代码审查引擎",
    "tags": ["code-review", "typescript", "architecture", "quality"],
    "persona": "keqing",
    "priority": 80,
    "constraints": {
      "maxConcurrency": 3,
      "requiredMemory": ["engineering"]
    }
  },
  {
    "id": "security-audit",
    "name": "安全审计",
    "tags": ["code-review", "security", "typescript", "rust"],
    "persona": "zhongli",
    "priority": 90,
    "constraints": {
      "excludedTags": ["frontend"]
    }
  }
]
```

### 运行时标签组合示例

```
任务: "审查 typescript 包的架构安全"
  │
  ├─ match 结果:
  │     ├─ security-audit (p90)   ← 主审查
  │     └─ code-review-engine (p80) ← 副审查
  │
  └─ 组装:
        ├─ lead: security-audit
        ├─ tags: ["code-review", "typescript", "security", "architecture"]
        ├─ persona: zhongli (主) + keqing (辅助)
        └─ prompt: 从认知资源池按 tag 组合
```

---

## 段四：提示词作为认知资源

当前提示词是 Agent 注册时的静态文本。在自声明模式下，提示词变为**可查询的认知资源**：

| 资源标识 | 内容 | 查询方式 |
|---------|------|---------|
| `prompt:code-review:security` | 安全审查提示词模板 | `promptLoader.load("code-review:security")` |
| `prompt:code-review:architecture` | 架构审查提示词模板 | `promptLoader.load("code-review:architecture")` |
| `prompt:persona:keqing` | 刻晴角色定义 | `promptLoader.load("persona:keqing")` |
| `prompt:persona:zhongli` | 钟离角色定义 | `promptLoader.load("persona:zhongli")` |

```typescript
class PromptResourcePool {
  private pool: Map<string, string>;

  load(query: string): string {
    // 从 config/data/prompt-resources/ 加载
    // 支持标签组合查询
  }

  compose(tags: string[]): string {
    // 按标签组合多个提示词模板
  }
}
```

---

## 段五：实施路径

| 阶段 | 事项 | 产出 | 前置 |
|------|------|------|------|
| P0 | CapabilityRegistry 接口 + 配置 | 声明式能力注册 | 无 |
| P1 | MetaAgent 匹配逻辑 | 按标签匹配候选 | P0 |
| P2 | 动态组装 AgentTeam | 运行时组合生成 | P1 |
| P3 | PromptResourcePool | 提示词认知资源化 | P0 |
| P4 | 现有 Agent 迁移 | 逐步将 14 种 Agent 迁移到自声明模式 | P2+P3 |
| P5 | 废弃静态注册 | 删除 cortex-agents.json 静态注册 | P4 验证通过 |

### P0 验收标准

- `CapabilityRegistry.match(task)` 按标签返回排序后的候选列表
- 配置驱动——新增能力只需加 JSON 条目
- `tsc --noEmit` 零报错

---

> 修订记录
> - 2026-07-03：初版，基于 DeepSeek 外部记忆库 #19 同步
