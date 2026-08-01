// @ci: unit
// ============================================================
// 守护测试：工具枚举单源约束（S1-1 双源清零的回归防线）
//
// 约束：ToolCategory/ReversibilityLevel/TrustLevel 及
// toReversibilityClass/toolNameToRiskDomain/RiskDomain 的值定义
// 唯一源在 @cortex/config（vocabularies/tool-enums.ts），
// @cortex/shared 不得再定义或导出同名枚举值。
// ============================================================

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// 基于本文件位置解析仓库根（ci-gate 按包串行运行时 cwd 为包目录，
// 不能依赖 process.cwd()——否则路径会拼成 packages/shared/packages/...）
const pkgRoot = path.join(fileURLToPath(new URL("../../../", import.meta.url)), "packages");
const read = (rel: string): string =>
  fs.readFileSync(path.join(pkgRoot, rel), "utf8");

const toolkitSrc = () => read("shared/src/toolkit.ts");
const sharedBarrel = () => read("shared/src/index.ts");
const configEnums = () => read("config/src/vocabularies/tool-enums.ts");

describe("工具枚举单源约束（S1-1 双源清零守护）", () => {
  it("shared/src/toolkit.ts 不得定义三 enum / toReversibilityClass / toolNameToRiskDomain", () => {
    const src = toolkitSrc();
    expect(src).not.toMatch(/export (enum|const) (ToolCategory|ReversibilityLevel|TrustLevel)\b/);
    expect(src).not.toMatch(/export function (toReversibilityClass|toolNameToRiskDomain)\b/);
    expect(src).not.toMatch(/export type RiskDomain\b/);
  });

  it("shared/src/index.ts barrel 不得再导出工具枚举值", () => {
    const barrel = sharedBarrel();
    // 只约束导出语句本身（注释中的说明文字不受限）
    expect(barrel).not.toMatch(
      /export\s+(type\s+)?\{[^}]*\b(ToolCategory|ReversibilityLevel|TrustLevel|toReversibilityClass|toolNameToRiskDomain|RiskDomain)\b[^}]*\} from "\.\/toolkit\.js"/s
    );
  });

  it("shared/src 不得出现'已迁至 @cortex/config'的迁移残留注释", () => {
    const src = toolkitSrc();
    expect(src).not.toMatch(/已迁至\s*@cortex\/config/);
  });

  it("config 仍是枚举值唯一源（定义完整）", () => {
    const enums = configEnums();
    expect(enums).toMatch(/export enum ToolCategory\b/);
    expect(enums).toMatch(/export enum ReversibilityLevel\b/);
    expect(enums).toMatch(/export enum TrustLevel\b/);
    expect(enums).toMatch(/export function toReversibilityClass\b/);
    expect(enums).toMatch(/export function toolNameToRiskDomain\b/);
    expect(enums).toMatch(/export type RiskDomain\b/);
  });

  it("全仓 import 中不得出现'枚举符号来自 @cortex/shared'", () => {
    // 扫描 packages 下所有 .ts，三 enum 相关符号只能从 @cortex/config 导入
    const walk = (d: string): string[] => {
      let out: string[] = [];
      try {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) out.push(...walk(p));
          else if (/\.tsx?$/.test(e.name)) out.push(p);
        }
      } catch {}
      return out;
    };
    const re =
      /import[^;]*?(ToolCategory|ReversibilityLevel|TrustLevel|RiskDomain|toolNameToRiskDomain|toReversibilityClass)[^;]*?from ["']@cortex\/shared["']/g;
    const offenders: string[] = [];
    for (const f of walk(pkgRoot)) {
      const t = fs.readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = re.exec(t)) !== null) {
        offenders.push(`${f.replace(pkgRoot + path.sep, "")}: ${m[0].replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
