/**
 * tui/intent-router.ts — 智能意图判定器（v4 群聊增强）
 *
 * 统一 chat/plan/command 三模式为单一「智能」模式。
 * 用户自然输入，系统自动判定路由。
 *
 * L1: @code @review @昔涟 → 提取 agent，返回 "chat" 附带 target agent
 * L2: 任务关键词 → "task"
 * L3: 命令名称 → "command"
 * L4: 短句/闲聊 → "chat"
 *
 * @module tui/intent-router
 * @since v4 — 智能模式合并 + 群聊 @ 提及
 */

import { CHINESE_NAME_TO_TYPE, CHAT_AGENT_ALIASES, type AgentType } from "@cortex/shared";

/** 用户意图枚举（简易版） */
export type UserIntent = "task" | "command" | "chat";

/**
 * 从输入中解析 @ 提及的 Agent。
 * 支持 @中文名（@昔涟 @阿贝多）和 @英文type（@butler @code）。
 */
function parseAgentMention(input: string): AgentType | null {
  const match = input.match(/@(\S+)/);
  if (!match) return null;
  const raw = match[1]!.trim();

  // 1. 直接匹配 AgentType 枚举值
  const allTypes: string[] = [
    "analysis", "code", "ops", "butler", "review", "loop",
    "doc-govern", "inspector", "browser", "fix", "meta",
    "api", "data", "strategist", "confirm-gate",
  ];
  if (allTypes.includes(raw)) return raw as unknown as AgentType;

  // 2. 中文名
  const byChinese = CHINESE_NAME_TO_TYPE[raw];
  if (byChinese) return byChinese;

  // 3. 别名表
  const byAlias = CHAT_AGENT_ALIASES[raw];
  if (byAlias) return byAlias;

  return null;
}

/**
 * 基于关键词+语义规则判定用户意图。
 * L1: @提及 → 提取 agent，返回 "chat" 附带 targetAgent
 * L2: 任务关键词（写/创建/修复...）→ "task"
 * L3: 命令名称（ls/git/npm...）→ "command"
 * L4: 短句/闲聊 → "chat"
 */
export function classifyIntent(input: string): UserIntent {
  // 内部命令保留——. / 开头
  if (input.startsWith(".") || input.startsWith("/")) return "command";

  // L1: @提及 → 群聊路由
  if (input.includes("@")) {
    const agent = parseAgentMention(input);
    if (agent) return "chat"; // @提及走 chat 路由，附带 target agent
  }

  // L3: 系统命令——以已知命令名开头（词边界防英语单词误判）
  const cmdFirst = /^(ls\b|dir\b|cat\b|find\b|grep\b|cd\b|pwd\b|mkdir\b|rm\b|cp\b|mv\b|git\b|npm\b|node\b|tsc\b|vitest\b|pnpm\b|yarn\b|npx\b|code\b|open\b|start\b|stop\b|clear\b|cls\b|echo\b|type\b|more\b|sort\b|where\b|which\b|chmod\b|chown\b|df\b|du\b|ps\b|kill\b|top\b|ping\b|curl\b|wget\b|ssh\b|scp\b|docker\b|kubectl\b|helm\b)/i;
  if (cmdFirst.test(input)) return "command";

  // 命令后缀（中文指令）
  const cmdSuffix = /^(打开|启动|停止|重启|关闭|清[除理屏]|列出|查看|搜索|查找|运行|执行|测试|构建|编译|部署|安装|卸载|更新|升级|回滚|切换|进入|退出|保存|删除|移动|复制|备份|恢复)(?:\s|$)/.test(input);
  if (cmdSuffix && input.length < 30) return "command";

  // L4: 闲聊——问句
  if (/[?？]/.test(input) || /什么是|如何|怎么|为什么|能不能|可以[吗么]|是否|有没有[可]|哪个|怎样|多少|何时|谁|哪里|介绍一下|解释一下|告诉我/.test(input)) return "chat";

  const chars = input.replace(/\s/g, "");

  // L2: task 关键词——明确的开发任务表达（优先于短句聊天）
  const taskKeywords = /(帮我|给我|请|麻烦|能不能).*(写|创建|生成|建|实现|重构|修复|改|添加|新建|删除|迁移|构建|编译|部署|优化|做|搞|改|加|开发|设计|配[置设]|调整|拆分|合并|整理|清理|添加|补充)/i;
  if (taskKeywords.test(input)) return "task";

  // 任务动词+足够长 → task
  const taskVerbsAnywhere = /(写|创建|生成|建|实现|重构|修复|改|添加|新建|删除|迁移|构建|编译|部署|优化|做|搞|改|加|开发|设计|配[置设]|调整|拆分|合并|整理|清理|测试|验证|实现|拆解)/;
  if (taskVerbsAnywhere.test(input) && chars.length >= 6) return "task";

  // plan 审批/确认——"好的""执行""确认" → task（优先于短句聊天）
  if (/^(好的|执行|确认|可以|行|开始|跑|go|yes|ok|approve|run|start)/i.test(input)) return "task";

  // 闲聊——短句（task 没命中才判聊天）
  if (chars.length < 10) return "chat";

  // 闲聊——疑问/感叹语气
  if (/[!！]$/.test(input) || /吧$/.test(input) || /呢$/.test(input) || /吗$/.test(input)) return "chat";

  // 聊天关键词
  const chatWords = /^(你好|您好|嗨|喂|在吗|谢谢|感谢|没事|算了|好的|ok|嗯|哦|啊|哈|哈哈|呵呵|嘻嘻)/i;
  if (chatWords.test(input)) return "chat";

  // 闲聊——包含"聊天""聊""说话""交流"等
  if (/聊[天聊]|说话|交流|谈心|解闷/.test(input) && input.length < 40) return "chat";

  // 动词开头的开发任务
  const taskVerb = /^(写|创建|生成|建|实现|重构|修复|改|添加|新建|删除|迁移|构建|编译|部署|优化|做|搞|改|加|开发|设计|配[置设]|调整|拆分|合并|整理|清理) /.test(input);
  if (taskVerb && chars.length > 8) return "task";

  // 默认——长文本假定为任务描述
  if (chars.length > 40) return "task";

  // 无法判断——交给 LLM 自行判定
  return "chat";
}

/**
 * 从输入中提取 @ 提及的目标 Agent（增强版，附带 IntentResult）。
 */
export function parseAgentFromInput(input: string): AgentType | null {
  return parseAgentMention(input);
}
