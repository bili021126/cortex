// @ci: contract
/**
 * F7 守护：ChatView 设计令牌单源化——tokens.css 的 --rb-* 必须与
 * @cortex/design-tokens 的 CHAT_PALETTE 完全一致（防双份漂移复发）。
 *
 * 规则：值变更必须先改 design-tokens/src/tokens.ts 的 CHAT_PALETTE，
 * 再同步 tokens.css（或由生成脚本产出）；本测试保证二者永不脱节。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CHAT_PALETTE } from "@cortex/design-tokens";

const cssSrc = readFileSync(new URL("../src/renderer/ui/tokens.css", import.meta.url), "utf8");

/** 解析 tokens.css 的 --rb-* 变量为扁平映射 */
const cssTokens: Record<string, string> = {};
for (const m of cssSrc.matchAll(/--rb-([\w-]+):\s*([^;]+);/g)) {
  cssTokens[m[1]!] = m[2]!.trim();
}

/** 引号归一化（CSS 的 "Segoe UI" 与 TS 的 'Segoe UI' 语义等价） */
const normalize = (v: string): string => v.replace(/["']/g, "").replace(/\s+/g, " ").trim();

describe("F7：tokens.css ↔ CHAT_PALETTE 一致性", () => {
  it("CSS 变量集合与 CHAT_PALETTE 键集合一致", () => {
    const cssKeys = Object.keys(cssTokens).sort();
    const tsKeys = Object.keys(CHAT_PALETTE).sort();
    expect(cssKeys).toEqual(tsKeys);
  });

  it("所有值一致（引号归一化后）", () => {
    for (const [key, cssValue] of Object.entries(cssTokens)) {
      expect(normalize(cssValue), `--rb-${key} 与 CHAT_PALETTE 不一致——先改 design-tokens 再同步 CSS`).toBe(
        normalize(CHAT_PALETTE[key] ?? ""),
      );
    }
  });
});
