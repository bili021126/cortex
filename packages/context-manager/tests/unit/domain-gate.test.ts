// @ci: unit
/**
 * @cortex/context-manager — DomainGateController 单元测试
 *
 * C 层域门控核心行为验证：
 *   - 默认域为 engineering
 *   - 活跃域内允许通过 / 域外拦截
 *   - domain 为 undefined 时回退到 'general'
 *   - setActiveDomains / getActiveDomains 读写一致性
 *   - filterEntries 批量过滤 + AuditTrail 注入审计（spec S2-7）
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { DomainGateController } from "../../src/domain-gate.js";
import { AuditTrail } from "@cortex/telemetry";

const TEST_DIR = join(tmpdir(), "cortex-domain-gate-test", randomUUID());

describe("DomainGateController", () => {
  it("should default to engineering domain", () => {
    const gate = new DomainGateController();
    expect(gate.getActiveDomains()).toEqual(["engineering"]);
  });

  it("should allow entry in active domain", () => {
    const gate = new DomainGateController();
    expect(gate.isAllowed({ domain: "engineering" })).toBe(true);
  });

  it("should block entry not in active domain", () => {
    const gate = new DomainGateController();
    expect(gate.isAllowed({ domain: "medical" })).toBe(false);
  });

  it("should default unknown domain to general", () => {
    const gate = new DomainGateController();
    // engineering 是唯一活跃域，general 不在其中 → false
    expect(gate.isAllowed({})).toBe(false);
    expect(gate.isAllowed({ domain: undefined })).toBe(false);
  });

  it("should switch active domains via setActiveDomains", () => {
    const gate = new DomainGateController();
    gate.setActiveDomains(["medical", "engineering", "general"]);

    expect(gate.isAllowed({ domain: "medical" })).toBe(true);
    expect(gate.isAllowed({ domain: "engineering" })).toBe(true);
    expect(gate.isAllowed({ domain: "general" })).toBe(true);
    expect(gate.isAllowed({ domain: "finance" })).toBe(false);
  });

  it("should return active domains via getActiveDomains", () => {
    const gate = new DomainGateController();
    gate.setActiveDomains(["a", "b", "c"]);

    const domains = gate.getActiveDomains();
    expect(domains).toContain("a");
    expect(domains).toContain("b");
    expect(domains).toContain("c");
    expect(domains).toHaveLength(3);

    // 返回的是快照，外部修改不影响内部
    domains.push("d");
    expect(gate.getActiveDomains()).toHaveLength(3);
  });

  it("filterEntries 过滤正确：活跃域保留、域外拦截（spec S2-7）", () => {
    const gate = new DomainGateController();
    const entries = [
      { id: 1, domain: "engineering" },
      { id: 2, domain: "medical" },
      { id: 3 } as { id: number; domain?: string },
      { id: 4, domain: "engineering" },
    ];
    const allowed = gate.filterEntries(entries);
    expect(allowed).toEqual([{ id: 1, domain: "engineering" }, { id: 4, domain: "engineering" }]);
  });

  it("filterEntries 未注入审计时静默过滤，不抛错（骨架期不造假信号）", () => {
    const gate = new DomainGateController();
    expect(() => gate.filterEntries([{ id: 1, domain: "medical" }])).not.toThrow();
  });

  it("filterEntries 注入 AuditTrail 后落盘 domain_filter 条目", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const auditTrail = new AuditTrail(TEST_DIR);
    const gate = new DomainGateController();
    gate.setAuditTrail(auditTrail);

    gate.filterEntries([
      { id: 1, domain: "engineering" },
      { id: 2, domain: "medical" },
      { id: 3, domain: "finance" },
      { id: 4, domain: "engineering" },
    ]);

    const file = join(TEST_DIR, "audit.jsonl");
    expect(existsSync(file)).toBe(true);
    const content = await readFile(file, "utf-8");
    const entries = content.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "domain_filter",
      query: "*",
      allowed: ["engineering"],
      blocked: ["medical", "finance"],
      stats: { total: 4, allowedCount: 2, blockedCount: 2 },
    });
    auditTrail.close();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });
});
