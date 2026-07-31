// @ci: contract
/**
 * 配置域注册表 ↔ data 目录一致性契约。
 *
 * 背景（task-e18 收纳清场）：packages/config/data/ 曾是僵尸旁路副本——
 * 与 src/data 权威源漂移 48 行、缺 4 个域、2 份"真相"并存。
 * 本契约将"一个域、一份源"固化为门禁：
 *
 *   1. CONFIG_DOMAINS 是唯一登记处：src/data 下每个 .json 必须被注册（防僵尸文件复发）
 *   2. required 域的 fileName 必须真实存在于 src/data（防注册了却没文件）
 *   3. 旁路目录 packages/config/data/ 不得存在（防副本目录复活）
 *
 * 单向上→下派生：契约层 → 配置域 → 域内常量项。任何旁路都是配置漂移。
 */

import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DOMAINS, resolveConfigDataDir } from "@cortex/config";

// ─── 定位 src/data（权威源）与仓库根 ─────────────────────

const SRC_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/data");
const PACKAGE_ROOT = resolve(SRC_DATA_DIR, "../..");
const BYPASS_DATA_DIR = join(PACKAGE_ROOT, "data");

describe("配置域注册表 ↔ data 目录一致性契约", () => {
  // ═══════════════════════════════════════════════
  // 1. 每个 src/data 下的 .json 必须被 CONFIG_DOMAINS 注册
  // ═══════════════════════════════════════════════
  it("src/data 下无未注册的 .json 文件（禁止僵尸文件）", () => {
    const files = readdirSync(SRC_DATA_DIR).filter((f) => f.endsWith(".json"));
    const registered = new Set(CONFIG_DOMAINS.map((d) => d.fileName));

    const unregistered = files.filter((f) => !registered.has(f));
    expect(unregistered, `未注册的配置域文件: ${unregistered.join(", ")}`).toEqual([]);
  });

  // ═══════════════════════════════════════════════
  // 2. required 域的 fileName 必须存在于 src/data
  // ═══════════════════════════════════════════════
  it("required 配置域的文件必须存在于 src/data", () => {
    const missing = CONFIG_DOMAINS.filter((d) => d.required && !existsSync(join(SRC_DATA_DIR, d.fileName))).map(
      (d) => d.name,
    );
    expect(missing, `required 域缺文件: ${missing.join(", ")}`).toEqual([]);
  });

  // ═══════════════════════════════════════════════
  // 3. 所有注册域的 fileName 指向 .json 且互不重复
  // ═══════════════════════════════════════════════
  it("CONFIG_DOMAINS 注册域 fileName 互不重复", () => {
    const seen = new Map<string, string>();
    for (const d of CONFIG_DOMAINS) {
      if (seen.has(d.fileName)) {
        expect.fail(`fileName "${d.fileName}" 被重复注册: ${seen.get(d.fileName)} 与 ${d.name}`);
      }
      seen.set(d.fileName, d.name);
    }
  });

  // ═══════════════════════════════════════════════
  // 4. 旁路目录 packages/config/data/ 不得存在（僵尸副本守护）
  // ═══════════════════════════════════════════════
  it("旁路目录 packages/config/data/ 不存在（副本目录禁止复活）", () => {
    expect(existsSync(BYPASS_DATA_DIR), `旁路副本目录存在: ${BYPASS_DATA_DIR}`).toBe(false);
  });

  // ═══════════════════════════════════════════════
  // 5. 权威源与运行时解析路径一致性（src 模式）
  // ═══════════════════════════════════════════════
  it("resolveConfigDataDir() 解析到的目录含 agents.json（权威源可达）", () => {
    const resolved = resolveConfigDataDir();
    expect(existsSync(join(resolved, "agents.json")), `解析目录缺少 agents.json: ${resolved}`).toBe(true);
  });
});
