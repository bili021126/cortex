/**
 * commands/command-list.ts — CLI 命令注册表定义
 *
 * 从 main.ts 抽离的命令列表与注册逻辑。
 * 所有命令的 name/alias/description 在此集中定义。
 *
 * @module commands/command-list
 */

import type { CommandRegistry } from "./index.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import type { ConfigManager } from "../services/config-manager.js";
import type { DocRegistry } from "@cortex/governance";
import { createRunHandler } from "./run.js";
import { createAgentHandler } from "./agent.js";
import { createTaskHandler } from "./task.js";
import { createMemoryHandler } from "./memory.js";
import { createConfigHandler } from "./config.js";
import { createDocHandler } from "./doc.js";
import { createVersionHandler } from "./version.js";
import { createHelpHandler } from "./help.js";
import { createScheduleHandler } from "./schedule.js";
import { createRoundtableHandler } from "./roundtable.js";
import { createSetupHandler } from "./setup.js";
import { createInspectHandler } from "./inspect.js";
import { createConfirmHandler } from "./confirm.js";
import { createSkillHandler } from "./skill.js";
import { createDoctorHandler } from "./doctor.js";

/** 命令定义（不含 handler——由工厂延迟创建避免循环依赖） */
interface CommandDef {
  name: string;
  alias: string;
  description: string;
}

/** 全部 CLI 命令的定义列表 */
export const COMMAND_DEFS: readonly CommandDef[] = [
  {
    name: "run",
    alias: "r",
    description: "单次执行 — 接受输入文件，调度 Agent 执行，输出结果",
  },
  {
    name: "agent",
    alias: "ag",
    description: "Agent 管理 — 查看 Agent 状态与任务分配",
  },
  {
    name: "task",
    alias: "t",
    description: "任务管理 — 查看/管理任务列表",
  },
  {
    name: "memory",
    alias: "m",
    description: "记忆查询 — 查询 Agent 记忆库",
  },
  {
    name: "config",
    alias: "c",
    description: "配置管理 — 查看/编辑运行配置",
  },
  {
    name: "schedule",
    alias: "sc",
    description: "体验优化 — 分析并优化任务调度策略",
  },
  {
    name: "roundtable",
    alias: "rb",
    description: "圆桌会议 — 多 Agent 协作审议",
  },
  {
    name: "confirm",
    alias: "co",
    description: "确认门检查 — 查看待确认任务列表",
  },
  {
    name: "skill",
    alias: "sk",
    description: "技能管理 — 查看/管理技能系统",
  },
  {
    name: "inspect",
    alias: "i",
    description: "代码审视 — 启动审视 Agent 检查项目",
  },
  {
    name: "doctor",
    alias: "do",
    description: "诊断修复 — 诊断并修复常见问题",
  },
  {
    name: "doc",
    alias: "d",
    description: "文档服务 — 启动文档浏览服务器",
  },
  {
    name: "setup",
    alias: "su",
    description: "交互式配置界面 — 管理 agents / cognition / docs 等配置域",
  },
  {
    name: "version",
    alias: "v",
    description: "版本信息",
  },
  {
    name: "help",
    alias: "h",
    description: "帮助信息",
  },
];

/** registerCommands 的聚合服务对象 */
interface RegisterCtx {
  engineBridge: EngineBridge;
  configManager: ConfigManager;
  docRegistry: DocRegistry;
}

/**
 * 注册所有命令到 CommandRegistry。
 *
 * 命令描述来自 COMMAND_DEFS，handler 通过工厂延迟创建。
 */
export function registerCommands(registry: CommandRegistry, ctx: RegisterCtx): void {
  const { engineBridge, configManager, docRegistry } = ctx;
  const handlers = {
    run: createRunHandler(engineBridge),
    agent: createAgentHandler(engineBridge),
    task: createTaskHandler(engineBridge),
    memory: createMemoryHandler(engineBridge),
    config: createConfigHandler(configManager),
    schedule: createScheduleHandler(engineBridge),
    roundtable: createRoundtableHandler({ bridge: engineBridge, docRegistry }),
    confirm: createConfirmHandler(engineBridge),
    skill: createSkillHandler(),
    inspect: createInspectHandler(),
    doctor: createDoctorHandler(),
    doc: createDocHandler(),
    setup: createSetupHandler(),
    version: createVersionHandler(),
    help: createHelpHandler(registry),
  };

  for (const def of COMMAND_DEFS) {
    registry.register({
      name: def.name,
      alias: def.alias,
      description: def.description,
      handler: handlers[def.name as keyof typeof handlers],
    });
  }
}
