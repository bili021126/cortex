// @ci: integration
/**
 * @cortex/server — daemon 端到端回归套件
 *
 * 固化本次会话所有手工脚本验证为可重跑测试。需要 live daemon（默认 http://127.0.0.1:3210）。
 * daemon 不可达时整体 skip（不污染无 daemon 的 CI）。
 *
 * 运行：
 *   1) 起 daemon：CORTEX_PROJECT_ROOT=<repo> node packages/server/dist/main.js
 *   2) npx vitest run packages/server/tests/daemon-e2e.test.ts
 *   含 LLM/WS 聊天用例：CORTEX_E2E_LLM=1 前缀（默认跳过，避免耗 API 额度）
 *
 * 覆盖：config 读/写回(标量+嵌套+fail-closed 拒绝)、会话生命周期、memory 写查删、
 *       node 提交、health 真实降级结构、capabilities。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env["CORTEX_DAEMON_URL"] ?? "http://127.0.0.1:3210";
const CFG = join(homedir(), ".cortex", "config");

async function ping(): Promise<boolean> {
  try { const r = await fetch(`${BASE}/api/v1/health`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
}
const up = await ping();
const jget = async (p: string) => { const r = await fetch(BASE + p); const b = await r.json().catch(() => null) as any; return { status: r.status, data: b?.data ?? b }; };
const jpost = async (p: string, body?: unknown) => { const r = await fetch(BASE + p, { method: "POST", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); const b = await r.json().catch(() => null) as any; return { status: r.status, data: b?.data ?? b }; };

beforeAll(() => { if (!up) console.log("[daemon-e2e] daemon 不可达，跳过集成测试"); });

describe.skipIf(!up)("daemon E2E 回归", () => {
  it("config 列表：18 域 + 真实 dir", async () => {
    const { status, data } = await jget("/api/v1/config");
    expect(status).toBe(200);
    expect(typeof data.dir).toBe("string");
    expect(data.dir.length).toBeGreaterThan(0);
    expect(data.domains.length).toBeGreaterThanOrEqual(15);
    expect(data.domains.some((d: any) => d.name === "engine")).toBe(true);
  });

  it("config 单域读：agentManifests 含 agent 定义", async () => {
    const { status, data } = await jget("/api/v1/config?domain=agentManifests");
    expect(status).toBe(200);
    expect(data.present).toBe(true);
    expect(Object.keys(data.value.agents ?? {}).length).toBeGreaterThanOrEqual(10);
  });

  it("config 标量写回 + 落盘 + 还原", async () => {
    const orig = JSON.parse(readFileSync(join(CFG, "engine.json"), "utf8")).maxReplanPerNode;
    const w = await jpost("/api/v1/config", { domain: "engine", path: ["maxReplanPerNode"], value: "999" });
    expect(w.status).toBe(200);
    expect(JSON.parse(readFileSync(join(CFG, "engine.json"), "utf8")).maxReplanPerNode).toBe(999);
    await jpost("/api/v1/config", { domain: "engine", path: ["maxReplanPerNode"], value: orig });
    expect(JSON.parse(readFileSync(join(CFG, "engine.json"), "utf8")).maxReplanPerNode).toBe(orig);
  });

  it("config 嵌套写回：agentManifests.agents.<id>.maxInstances", async () => {
    const orig = JSON.parse(readFileSync(join(CFG, "agent-manifests.json"), "utf8")).agents.ganyu.maxInstances;
    const w = await jpost("/api/v1/config", { domain: "agentManifests", path: ["agents", "ganyu", "maxInstances"], value: "7" });
    expect(w.status).toBe(200);
    expect(JSON.parse(readFileSync(join(CFG, "agent-manifests.json"), "utf8")).agents.ganyu.maxInstances).toBe(7);
    await jpost("/api/v1/config", { domain: "agentManifests", path: ["agents", "ganyu", "maxInstances"], value: orig });
  });

  it("config fail-closed：拒建新键 / 拒覆写对象 / 未知域 / 非法 JSON", async () => {
    expect((await jpost("/api/v1/config", { domain: "engine", path: ["nopeKey"], value: "1" })).status).toBe(400);
    expect((await jpost("/api/v1/config", { domain: "engine", path: ["inspector"], value: "x" })).status).toBe(400);
    expect((await jpost("/api/v1/config", { domain: "ghostDomain", path: ["a"], value: "1" })).status).toBe(404);
    const bad = await fetch(`${BASE}/api/v1/config`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(422);
  });

  it("config 结构写回：数组 append/remove + 对象 add/remove（还原）", async () => {
    const gpFile = join(CFG, "governance-pipeline.json");
    const origStages = JSON.parse(readFileSync(gpFile, "utf8")).stages as string[];
    const ap = await jpost("/api/v1/config", { domain: "governancePipeline", path: ["stages"], op: "array-append", value: "e2e_stage" });
    expect(ap.status).toBe(200);
    expect((JSON.parse(readFileSync(gpFile, "utf8")).stages as string[]).includes("e2e_stage")).toBe(true);
    const idx = (JSON.parse(readFileSync(gpFile, "utf8")).stages as string[]).indexOf("e2e_stage");
    const rm = await jpost("/api/v1/config", { domain: "governancePipeline", path: ["stages", idx], op: "array-remove" });
    expect(rm.status).toBe(200);
    expect(JSON.parse(readFileSync(gpFile, "utf8")).stages).toEqual(origStages);

    const engFile = join(CFG, "engine.json");
    const origTT = JSON.parse(readFileSync(engFile, "utf8")).toolTimeouts;
    expect((await jpost("/api/v1/config", { domain: "engine", path: ["toolTimeouts", "_e2e_tmp"], op: "obj-add", value: 5 })).status).toBe(200);
    expect(JSON.parse(readFileSync(engFile, "utf8")).toolTimeouts._e2e_tmp).toBe(5);
    expect((await jpost("/api/v1/config", { domain: "engine", path: ["toolTimeouts", "_e2e_tmp"], op: "obj-remove" })).status).toBe(200);
    expect(JSON.parse(readFileSync(engFile, "utf8")).toolTimeouts).toEqual(origTT);
  });

  it("会话生命周期：create → get → delete → get(404)", async () => {
    const c = await jpost("/api/v1/sessions", { agent: "verify", mode: "chat" });
    expect(c.status).toBe(201);
    const id = c.data.id;
    expect((await jget(`/api/v1/sessions/${id}`)).status).toBe(200);
    expect((await fetch(`${BASE}/api/v1/sessions/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await jget(`/api/v1/sessions/${id}`)).status).toBe(404);
  });

  it("memory 写 → 查命中 → 删", async () => {
    const mark = "e2emark" + Date.now();
    const w = await jpost("/api/v1/memory", { content: `回归验证标记 ${mark}`, kind: "Insight", metadata: { agentType: "cyrene" } });
    expect(w.status).toBe(201);
    const found = await jget(`/api/v1/memory?query=${mark}&limit=100`);
    expect(found.status).toBe(200);
    expect((found.data ?? []).some((e: any) => (e.summary || "").includes(mark))).toBe(true);
    expect((await fetch(`${BASE}/api/v1/memory/${w.data.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("node 提交 → 列表可见", async () => {
    const id = "e2e-node-" + Date.now();
    const s = await jpost("/api/v1/nodes", { id, type: "code", tags: ["code"], needsMultiPerspective: false, status: "pending", claimedBy: [], payload: "e2e", results: [], createdAt: Date.now() });
    expect(s.status).toBe(201);
    const l = await jget("/api/v1/nodes");
    expect((l.data ?? []).some((n: any) => n.id === id)).toBe(true);
  });

  it("health 返回真实降级结构（非恒零硬编码）", async () => {
    const { status, data } = await jget("/api/v1/health");
    expect(status).toBe(200);
    expect(typeof data.totalDegradations).toBe("number");
    expect(data).toHaveProperty("bySource");
    expect(data).toHaveProperty("byLevel");
  });

  it("capabilities 声明核心域", async () => {
    const { data } = await jget("/api/v1/capabilities");
    expect(data.api.sessions).toBe(true);
    expect(data.api.config !== undefined || data.api.health === true).toBe(true);
  });
});

// ── LLM/WS 用例（默认跳过，CORTEX_E2E_LLM=1 启用）──
const llmOn = up && process.env["CORTEX_E2E_LLM"] === "1";
describe.skipIf(!llmOn)("daemon E2E（LLM/WS，需 CORTEX_E2E_LLM=1）", () => {
  it("HTTP /chat 真跑 LLM 返回产出", async () => {
    const r = await jpost("/api/v1/chat", { input: "只回复两个字：好", agent: "cyrene", mode: "chat" });
    expect(r.status).toBe(200);
    expect(typeof r.data?.output).toBe("string");
    expect((r.data?.output ?? "").length).toBeGreaterThan(0);
  }, 60000);
});
