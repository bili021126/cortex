// ============================================================
// @cortex/config — 工具枚举域（从 @cortex/shared 迁入）
//
// ToolCategory / ReversibilityLevel / TrustLevel —— 工具定义与信任模型的基础枚举。
// ============================================================

// ─── 工具分类 ──────────────────────────────────────────────

export enum ToolCategory {
  Read = "Read",
  Write = "Write",
  Shell = "Shell",
  Search = "Search",
}

// ─── 可逆性等级 ────────────────────────────────────────────

export enum ReversibilityLevel {
  L0 = "L0", // 纯读取，永不确认
  L1 = "L1", // 可逆写入，信任够则放行
  L2 = "L2", // 不可逆写入，永远确认
  L3 = "L3", // 不可恢复，永远确认
}

/**
 * ReversibilityLevel → modification-record 中 ReversibilityClass 的显式映射。
 * @fix 艾尔海森 P0-1 — 两套枚举描述同一域但无映射，消费方需自己推断。
 */
export function toReversibilityClass(level: ReversibilityLevel): "reversible" | "irreversible" | "meta" {
  switch (level) {
    case ReversibilityLevel.L0: return "meta";
    case ReversibilityLevel.L1: return "reversible";
    case ReversibilityLevel.L2:
    case ReversibilityLevel.L3: return "irreversible";
  }
}

// ─── 信任模型 ──────────────────────────────────────────────

/** Agent 信任等级——决定 L1 操作是否免确认 */
export enum TrustLevel {
  L0 = 0, // 不可信——强制确认
  L1 = 1, // 冷启动——每次确认
  L2 = 2, // 可信——连续 5 次接受后晋升
  L3 = 3, // 高度可信——L1 操作免确认
}

export type RiskDomain =
  | "file_write"
  | "shell_exec"
  | "network"
  | "config_change";

/** 工具名 → RiskDomain 映射 */
export function toolNameToRiskDomain(toolName: string): RiskDomain | null {
  if (toolName === "write_file" || toolName === "delete_file") return "file_write";
  if (toolName === "run_shell") return "shell_exec";
  if (toolName === "web_search" || toolName.startsWith("mcp:")) return "network";
  return null;
}
