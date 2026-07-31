// @ci: contract
/**
 * 文档注册表（docs 配置域 docRegistry）引用完整性契约。
 *
 * 背景（task-e18 收纳清场）：docRegistry 曾含 5 条幽灵注册——
 *   path 指向已删除/不存在的文档（含审计报告早已标记的 phantom registration:
 *   docs/conformity-audit.md），以及 1 条路径前缀错误（consistency-design.md 实际在 docs/core/ 下）。
 *
 * 本契约固化三条铁律：
 *   1. 注册的 path 必须真实存在（禁止幽灵注册）
 *   2. canonical constitution 项必须指向 constitutionPath（禁止宪法漂移）
 *   3. constitution 项 version 必须匹配宪法文件版本头（禁止版本漂移）
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DOMAINS, resolveConfigDataDir } from "@cortex/config";

// ─── 数据定位 ──────────────────────────────────────────

interface DocEntry {
  path: string;
  type: "constitution" | "design" | "audit" | "review" | "governance";
  version: string;
  canonical: boolean;
}

interface DocsConfig {
  constitutionPath: string;
  docRegistry: DocEntry[];
}

const SRC_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/data");
// 仓库根：resolveConfigDataDir() 在 src/dist 模式下均上溯 4 级
const REPO_ROOT = resolve(resolveConfigDataDir(), "../../../..");

const docsDomain = CONFIG_DOMAINS.find((d) => d.name === "docs");
const docs = JSON.parse(readFileSync(join(SRC_DATA_DIR, "docs.json"), "utf-8")) as DocsConfig;

// ─── 宪法版本头提取 ────────────────────────────────────

/** 从宪法文件首行提取版本号（如 "# Cortex 概念顶层设计 v3.7" → "3.7"） */
function extractConstitutionVersion(filePath: string): string | undefined {
  const head = readFileSync(filePath, "utf-8").split("\n").slice(0, 5).join("\n");
  const m = head.match(/v(\d+\.\d+(?:\.\d+)?)/);
  return m?.[1];
}

describe("docRegistry 引用完整性契约", () => {
  // ═══════════════════════════════════════════════
  // 0. docs 配置域已注册且文件可读
  // ═══════════════════════════════════════════════
  it("docs 配置域已注册到 CONFIG_DOMAINS", () => {
    expect(docsDomain).toBeDefined();
  });

  // ═══════════════════════════════════════════════
  // 1. constitutionPath 与注册表每一项 path 必须真实存在
  // ═══════════════════════════════════════════════
  it("constitutionPath 指向真实存在的文件", () => {
    expect(docs.constitutionPath, "constitutionPath 缺失").toBeTruthy();
    expect(existsSync(join(REPO_ROOT, docs.constitutionPath)), `宪法文件不存在: ${docs.constitutionPath}`).toBe(true);
  });

  it("docRegistry 每一项 path 真实存在（禁止幽灵注册）", () => {
    const missing = docs.docRegistry.filter((e) => !existsSync(join(REPO_ROOT, e.path))).map((e) => e.path);
    expect(missing, `幽灵注册（文件不存在）: ${missing.join(", ")}`).toEqual([]);
  });

  // ═══════════════════════════════════════════════
  // 2. docRegistry 无重复 path
  // ═══════════════════════════════════════════════
  it("docRegistry 无重复 path", () => {
    const seen = new Set<string>();
    for (const e of docs.docRegistry) {
      expect(seen.has(e.path), `重复注册: ${e.path}`).toBe(false);
      seen.add(e.path);
    }
  });

  // ═══════════════════════════════════════════════
  // 3. canonical constitution 项必须指向 constitutionPath
  // ═══════════════════════════════════════════════
  it("有且仅有一个 canonical constitution 项，且 path === constitutionPath", () => {
    const constitutions = docs.docRegistry.filter((e) => e.type === "constitution");
    expect(constitutions.length, `constitution 项数量应为 1，实际 ${constitutions.length}`).toBe(1);

    const c = constitutions[0]!;
    expect(c.canonical, "宪法项必须 canonical: true").toBe(true);
    expect(c.path, "canonical constitution path 必须等于 constitutionPath").toBe(docs.constitutionPath);
  });

  // ═══════════════════════════════════════════════
  // 4. constitution 项 version 匹配宪法文件版本头
  // ═══════════════════════════════════════════════
  it("constitution 项 version 匹配宪法文件版本头", () => {
    const c = docs.docRegistry.find((e) => e.type === "constitution");
    expect(c).toBeDefined();
    if (!c) return;

    const headVersion = extractConstitutionVersion(join(REPO_ROOT, c.path));
    expect(headVersion, `宪法文件头未找到版本号: ${c.path}`).toBeDefined();
    expect(c.version, `宪法注册 version 与文件头不符（文件头: v${headVersion}）`).toBe(headVersion);
  });
});
