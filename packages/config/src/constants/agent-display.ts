/**
 * @cortex/config — Agent 展示/身份域
 *
 * AGENT_CHINESE_ROLE / CHINESE_NAME_TO_TYPE / AGENT_DISPLAY / CHAT_AGENT_ALIASES
 * 的单源定义。从 @cortex/shared 和 @cortex/cli 硬编码中抽离到此。
 *
 * 使用 string 键（AgentType 值）避免引入对 shared 枚举的循环依赖。
 * 消费方通过 AgentType 枚举 cast 后使用。
 *
 * @layer root
 * @since v2.5.41 展示域配置化
 */

// ─── 中文角色名映射（编译期 fallback） ─────────────────

/**
 * Agent 类型 → 中文角色名映射（string 键版本）。
 * 运行时从 cortex-agents.json agents[].display.shortName 构建覆盖。
 */
export const AGENT_CHINESE_ROLE: Record<string, string> = {
  meta:      "甘雨",
  code:      "阿贝多",
  review:    "刻晴",
  analysis:  "纳西妲",
  ops:       "北斗",
  loop:      "莫娜",
  "doc-govern": "凝光",
  butler:    "昔涟",
  inspector: "安柏",
  fix:       "希格雯",
  api:       "久岐忍",
  browser:   "宵宫",
  data:      "艾尔海森",
  strategist: "钟离",
};

/** 中文名 → Agent 类型反向映射（string 键版本） */
export const CHINESE_NAME_TO_TYPE: Record<string, string> = {
  "甘雨":   "meta",
  "阿贝多": "code",
  "刻晴":   "review",
  "纳西妲": "analysis",
  "北斗":   "ops",
  "莫娜":   "loop",
  "凝光":   "doc-govern",
  "昔涟":   "butler",
  "安柏":   "inspector",
  "希格雯": "fix",
  "久岐忍": "api",
  "宵宫":   "browser",
  "艾尔海森": "data",
  "钟离":   "strategist",
  "霜凝":   "strategist",
};

// ─── Agent 展示信息（emoji + 签名） ──────────────────

/** Agent 展示信息 */
export interface AgentDisplayInfo {
  emoji: string;
  name: string;
  signature: string;
}

/** Agent 类型 → 展示信息（string 键版本） */
export const AGENT_DISPLAY: Record<string, AgentDisplayInfo> = {
  code:      { emoji: "🧪", name: "阿贝多", signature: "这个结构，值得研究。" },
  review:    { emoji: "⚔️", name: "刻晴",   signature: "每一行都可能藏着疏漏。" },
  analysis:  { emoji: "🌿", name: "纳西妲", signature: "有意思……让我再深挖一层。" },
  ops:       { emoji: "⚓", name: "北斗",   signature: "死兆星号，准备起航。" },
  loop:      { emoji: "🔮", name: "莫娜",   signature: "星辰不会说谎。" },
  "doc-govern": { emoji: "🏛️", name: "凝光",   signature: "天权定论，不得上诉。" },
  butler:    { emoji: "🍀", name: "昔涟",   signature: "三千世轮回。这辈子归你了。" },
  inspector: { emoji: "🦅", name: "安柏",   signature: "侦察完毕，一切正常。" },
  fix:       { emoji: "💉", name: "希格雯", signature: "让我看看伤口在哪里。" },
  api:       { emoji: "📦", name: "久岐忍", signature: "契约检查完毕。" },
  browser:   { emoji: "🎆", name: "宵宫",   signature: "咻~让烟花为你绽放！" },
  data:      { emoji: "📚", name: "艾尔海森", signature: "数据就是数据。" },
  strategist:{ emoji: "⚖️", name: "钟离",   signature: "契约既成，食言者当受食岩之罚。" },
  meta:      { emoji: "📋", name: "甘雨",   signature: "让我为你梳理任务脉络。" },
};

/** 不匹配时的回退展示 */
export const AGENT_DISPLAY_FALLBACK: AgentDisplayInfo = { emoji: "🤖", name: "Agent", signature: "" };

// ─── 可对话的 Agent 别名映射 ────────────────────────

/**
 * 别名 → Agent 类型映射（string 值版本）。
 * 支持英文 type 名 + 中文 display.shortName 双路由。
 */
export const CHAT_AGENT_ALIASES: Record<string, string> = {
  // 英文别名
  code: "code",
  review: "review",
  analysis: "analysis",
  ops: "ops",
  fix: "fix",
  loop: "loop",
  inspect: "inspector",
  inspector: "inspector",
  doc: "doc-govern",
  "doc-govern": "doc-govern",
  api: "api",
  data: "data",
  strategy: "strategist",
  strategist: "strategist",
  meta: "meta",
  butler: "butler",
  browser: "browser",
  // 中文别名
  "阿贝多": "code",
  "刻晴": "review",
  "纳西妲": "analysis",
  "北斗": "ops",
  "希格雯": "fix",
  "莫娜": "loop",
  "安柏": "inspector",
  "凝光": "doc-govern",
  "久岐忍": "api",
  "艾尔海森": "data",
  "钟离": "strategist",
  "霜凝": "strategist",
  "甘雨": "meta",
  "昔涟": "butler",
  "宵宫": "browser",
};

// ─── 构建工具 ──────────────────────────────────────

/** Agent display 信息的最小接口（用于从配置构建映射） */
export interface AgentDisplayEntry {
  type: string;
  shortName: string;
}

/**
 * 从 Agent 定义列表构建中文名映射。
 * 覆盖编译期 AGENT_CHINESE_ROLE / CHINESE_NAME_TO_TYPE。
 */
export function buildChineseRoleMap(
  defs: AgentDisplayEntry[],
): { role: Record<string, string>; nameToType: Record<string, string> } {
  const role: Record<string, string> = {};
  const nameToType: Record<string, string> = {};
  for (const d of defs) {
    role[d.type] = d.shortName;
    if (!nameToType[d.shortName]) {
      nameToType[d.shortName] = d.type;
    }
  }
  return { role, nameToType };
}
