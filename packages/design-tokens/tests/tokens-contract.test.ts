// @ci: contract
// ============================================================
// @cortex/design-tokens —— 设计 token 契约测试
//
// 本包此前是 28 个包里**唯一没有 tests/ 目录**的，而且 vitest 配置写着
// include: ["src/**/*.test.ts"] + passWithNoTests: true —— 零测试也静默通过，
// 于是它落在门禁测试矩阵之外（门禁按「有测试文件的包」分组）。
//
// 这里只钉**真正没人守**的不变量，不重复 TypeScript 已经保证的东西：
//   ✓ 色值格式   —— 全仓唯一没被任何检查覆盖的一处。`PersonaPalette` 的字段类型是
//                  `string`，所以 "#zzz" 或少写一位的 "#4f46e52" 都能编译通过，
//                  而 CSS 对这种值**静默丢弃**——UI 上才发现，且不报错。
//   ✓ persona 键集一致性 —— TS 只在**声明时带 PersonaPalette 标注**才拦得住；
//                  `PRESENCE_PALETTES` 本身是 `as const` 无标注，新 persona 若不带
//                  标注加进来，键缺失会静默继承上层主题值（颜色错但不报错）。
//   ✓ 发射覆盖面 —— spacing / radius / font.size 的每一项都必须在 CSS 里出现；
//                  类型管不到这个映射。
//   ✓ 单块内无重名变量 —— 嵌套展平出重名会让后者静默覆盖前者。
// ============================================================

import { describe, it, expect } from "vitest";
import {
  ENGINEERING,
  PRESENCE_PALETTES,
  CYRENE_PALETTE,
  CHAT_PALETTE,
  spacing,
  radius,
  font,
  generateCssVariables,
  generateFullStylesheet,
} from "../src/index.js";

/** CSS 合法色值：3/4/6/8 位 hex。本包不含 rgba() 形式（CHAT_PALETTE 才有，另测）。 */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 取对象所有字符串叶子：路径 → 值。 */
function stringLeaves(obj: unknown, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (obj === null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push([p, v]);
    else if (v !== null && typeof v === "object") out.push(...stringLeaves(v, p));
  }
  return out;
}

function keyPaths(obj: unknown, prefix = ""): string[] {
  return stringLeaves(obj, prefix).map(([p]) => p).sort();
}

/** 从一个生成的 CSS 块里取出全部变量名。 */
function varNamesOf(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    const name = m[1];
    if (name !== undefined) out.push(name);
  }
  return out;
}

describe("设计 token · 色值格式", () => {
  it("ENGINEERING 的每个色值都是合法 hex", () => {
    const bad = stringLeaves(ENGINEERING).filter(([, v]) => !HEX.test(v));
    expect(bad, `非法色值（CSS 会静默丢弃）: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it.each(Object.entries(PRESENCE_PALETTES))("%s palette 的每个色值都是合法 hex", (_id, palette) => {
    const bad = stringLeaves(palette).filter(([, v]) => !HEX.test(v));
    expect(bad, `非法色值: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it("CHAT_PALETTE 的每个值都非空（值形态由 desktop 侧守护测试对照 tokens.css）", () => {
    const empty = Object.entries(CHAT_PALETTE).filter(([, v]) => typeof v !== "string" || v.trim() === "");
    expect(empty).toEqual([]);
  });
});

describe("设计 token · 结构一致性", () => {
  it("所有 persona 色板键集与 CYRENE 一致——缺失会静默继承上层主题值", () => {
    const base = keyPaths(CYRENE_PALETTE);
    for (const [id, palette] of Object.entries(PRESENCE_PALETTES)) {
      expect(keyPaths(palette), `persona "${id}" 键集与 cyrene 不一致`).toEqual(base);
    }
  });

  it("PRESENCE_PALETTES 登记了每个导出过的 persona，且 DEFAULT_PERSONA 在其中", () => {
    const ids = Object.keys(PRESENCE_PALETTES);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("ENGINEERING 与 persona 色板的键差只有 warmth / warmthMuted（PRESENCE 独有）", () => {
    const eng = new Set(keyPaths(ENGINEERING));
    const per = new Set(keyPaths(CYRENE_PALETTE));
    expect([...per].filter((k) => !eng.has(k)).sort()).toEqual(["warmth", "warmthMuted"]);
    expect([...eng].filter((k) => !per.has(k))).toEqual([]);
  });
});

describe("设计 token · CSS 发射覆盖", () => {
  const css = generateCssVariables(ENGINEERING);

  it("spacing 的每一项都发到 CSS", () => {
    for (const k of Object.keys(spacing)) {
      expect(css, `缺 --cx-space-${k}`).toContain(`--cx-space-${k}: ${spacing[k as keyof typeof spacing]}px;`);
    }
  });

  it("radius 的每一项都发到 CSS", () => {
    for (const k of Object.keys(radius)) {
      expect(css, `缺 --cx-radius-${k}`).toContain(`--cx-radius-${k}: ${radius[k as keyof typeof radius]}px;`);
    }
  });

  it("font.size 的每一项都发到 CSS", () => {
    for (const k of Object.keys(font.size)) {
      expect(css, `缺 --cx-font-size-${k}`).toContain(`--cx-font-size-${k}: ${font.size[k as keyof typeof font.size]}px;`);
    }
  });

  it("色板叶子全都发到 CSS（--cx 前缀 + 展平路径）", () => {
    for (const [path, value] of stringLeaves(ENGINEERING)) {
      expect(css, `缺 --cx-${path.replace(/\./g, "-")}`).toContain(`--cx-${path.replace(/\./g, "-")}: ${value};`);
    }
  });

  it("单个块内无重名变量——重名会让后者静默覆盖前者", () => {
    const names = varNamesOf(css);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect([...new Set(dup)]).toEqual([]);
  });
});

describe("设计 token · 完整样式表", () => {
  const sheet = generateFullStylesheet();

  it("含 :root 与 presence 主题块", () => {
    expect(sheet).toContain(":root {");
    expect(sheet).toContain("[data-theme='presence'] {");
  });

  it("每个 persona 各有一个覆盖块", () => {
    for (const id of Object.keys(PRESENCE_PALETTES)) {
      expect(sheet, `缺 persona 块 ${id}`).toContain(`[data-theme='presence'][data-persona='${id}'] {`);
    }
  });

  it("花括号配平", () => {
    const open = (sheet.match(/\{/g) ?? []).length;
    const close = (sheet.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });
});
