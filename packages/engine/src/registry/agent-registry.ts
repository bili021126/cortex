// ============================================================
// @cortex/engine/registry/agent-registry — Agent 类型安全注册表
//
// Core-2 #8: 替代 cortex-agents.json 作为 Agent 定义的唯一源。
//   Agent 不再从 JSON 读取，而是通过 TS 类注册。
//
// 用法:
//   const registry = new AgentRegistry();
//   registry.register({
//     type: "code",
//     persona: "你是阿贝多...",
//     model: "deepseek-v4-flash",
//     tags: ["code", "implementation"],
//     active: true,
//     toolPermissions: ["read_file", "write_file", ...],
//     create: async () => createAgent(config, llm, toolkit),
//   });
//
// @since Core-2 Batch1
// ============================================================

/**
 * Agent 注册条目——用于替代 JSON 中的 Agent 定义。
 * 注册后自动注入 scheduler、model、persona 到对应的 Agent 实例。
 */
export interface AgentRegistration {
  /** Agent 类型（如 "code", "review", "analysis"） */
  type: string;
  /** Persona 提示词（系统提示词内容） */
  persona: string;
  /** 默认模型名 */
  model: string;
  /** 认领标签（用于 Scheduler 匹配分发） */
  tags: string[];
  /** 是否默认激活 */
  active: boolean;
  /** 最大实例数（默认 1） */
  maxInstances?: number;
  /** 工具权限列表 */
  toolPermissions: string[];
  /** 工厂函数——创建 Agent 实例 */
  create: () => Promise<unknown>;
}

/**
 * AgentRegistry —— 统一 Agent 注册表。
 *
 * 替代 JSON 配置作为 Agent 定义的唯一源。
 * bootstrap 阶段遍历此注册表创建并注入 Agent。
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentRegistration>();

  /** 注册一个 Agent 类型 */
  register(reg: AgentRegistration): void {
    this.agents.set(reg.type, reg);
  }

  /** 获取所有已注册的 Agent 定义 */
  getAll(): AgentRegistration[] {
    return [...this.agents.values()];
  }

  /** 按类型获取 Agent 定义 */
  get(type: string): AgentRegistration | undefined {
    return this.agents.get(type);
  }

  /** 检查某类型是否已注册 */
  has(type: string): boolean {
    return this.agents.has(type);
  }

  /** 获取已注册的类型列表 */
  getTypes(): string[] {
    return [...this.agents.keys()];
  }

  /** 获取激活的 Agent 注册条目 */
  getActive(): AgentRegistration[] {
    return this.getAll().filter((a) => a.active);
  }
}

/** 全局单例 */
export const agentRegistry = new AgentRegistry();
