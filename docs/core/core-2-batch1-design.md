# Core-2 第一批改造设计

> #1 Engine Bootstrap + #3 Toolkit + #8 多Agent角色体系 + Skill加载修复

## 改动范围

### Agent 唯一源
- 合并 cortex-agents.json + cortex-cognition.json
- 每个 Agent 改为 TS 类注册：`agentRegistry.register(new CodeAgent({...}))`
- 类注册后自动注入 scheduler、model、persona
- bootstrap-engine.ts → 遍历 agentRegistry 而非读 JSON

### Skill 加载修复  
- init-skills.ts：MemoryStore 为空时扫描 skills/ 目录加载 JSON
- SkillRegistry 在 bootstrap 后即有数据
- 删掉 "从 MemoryStore 恢复" 的依赖（作为辅助，不作为唯一来源）

### Toolkit 收敛
- TOOL_DISCIPLINE 从 react-loop.ts 移到 toolkit.ts 的工具定义里
- 每个工具声明 `constraint: { codeAgent?: string, inspectorAgent?: string }`

## 新增/修改文件
- packages/engine/src/registry/agent-registry.ts — 新建，Agent TS 类注册表
- packages/engine/src/core/agent-class-base.ts — 新建，Agent 基类
- packages/engine/src/bootstrap/bootstrap-engine.ts — 遍历 agentRegistry
- packages/engine/src/bootstrap/init-skills.ts — 加 skills/ 目录扫描
- packages/engine/src/components/react-loop.ts — 移除 TOOL_DISCIPLINE 硬编码
- packages/platform/src/toolkit.ts — 加 tool.constraint 声明
- packages/engine/src/plugin/scheduler.plugin.ts — 改为遍历 agentRegistry
- packages/cli/src/bootstrap/llm.ts — adapter 工厂收束
- cortex-agents.json — 缩减为薄配置（model/tags/active）
- cortex-cognition.json — 标记 deprecated

## 代码实施

### 1. 创建 AgentRegistry
`d:\cortex\packages\engine\src\registry\agent-registry.ts`

```typescript
// AgentRegistry — Agent 类型安全的统一注册表
// 替代 cortex-agents.json 作为 Agent 定义的唯一源

export interface AgentRegistration {
  type: string;
  persona: string;        // persona prompt
  model: string;          // 默认模型
  tags: string[];
  active: boolean;
  maxInstances?: number;
  toolPermissions: string[];
  create: () => Promise<any>;  // 工厂函数
}

export class AgentRegistry {
  private agents = new Map<string, AgentRegistration>();
  
  register(reg: AgentRegistration): void {
    this.agents.set(reg.type, reg);
  }
  
  getAll(): AgentRegistration[] {
    return [...this.agents.values()];
  }
  
  get(type: string): AgentRegistration | undefined {
    return this.agents.get(type);
  }
}
```

### 2. 修改 init-skills.ts
在 `loadSkillsFromMemory` 后加回退逻辑：
```typescript
if (loadedSkills.length === 0) {
  // 回退：从 skills/ 目录加载
  const skillDir = path.join(projectRoot, "skills");
  const files = fs.readdirSync(skillDir).filter(f => f.endsWith(".json"));
  for (const f of files) {
    const skill = JSON.parse(fs.readFileSync(path.join(skillDir, f), "utf-8"));
    if (skill.id && skill.triggerTags && skill.steps) {
      skillRegistry.register(skill);
    }
  }
}
```

### 3. 修改 react-loop.ts
删除 `TOOL_DISCIPLINE` 常量。改为从 toolkit 获取约束：
```typescript
const constraints = toolDefs
  .map(t => toolkit.getConstraint(t.name, agentType))
  .filter(Boolean)
  .join("\n");
```

### 4. 修改 toolkit.ts
加 `getConstraint()` 方法：
```typescript
getConstraint(toolName: string, agentType: string): string | undefined {
  return this._constraints.get(toolName)?.[agentType];
}
```

## 验证
- `npx tsc -b packages/engine/tsconfig.src.json --force` 零新增错误
- `npx tsc -b packages/cli/tsconfig.json --force` 零新增错误
- `npx vitest run --no-color` engine tests 失败数不增加
- `npx tsx packages/engine/tests/manual/e2e/core-smoke.ts` 通过

只读旧文件获取结构信息，新建文件 + 修改现有文件。不改业务逻辑，只改注册方式。零 `as any`，零 `!`。
