/**
 * 精准修复 memory-store.test.ts 中的 v3 write() 调用
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = join(import.meta.dirname!, "..", "packages", "engine", "tests", "memory-store.test.ts");
let content = readFileSync(filePath, "utf-8");

// ── 修复 1: memoryTypes → kind (line 48) ──
content = content.replace(
  `store.read({ memoryTypes: ["Insight"] })`,
  `store.read({ kind: "Insight" })`
);

// ── 修复 2: 为 write() 中每个对象添加 semantic_gist + content_hash ──
// 模式: summary: "XXX",\n      source: { ... } → 中间插入 semantic_gist + content_hash
// 注意: 需要处理 summary 后在同行有 }) 的情况

// 修复：summary: "XXX",\n<空格>source: → 在 source 前插入 semantic_gist + content_hash
content = content.replace(
  /summary: "([^"]*)",\n(\s+)source:/g,
  (match, summaryText, indent) => {
    return `summary: "${summaryText}",\n${indent}semantic_gist: "${summaryText}",\n${indent}content_hash: "",\n${indent}source:`;
  }
);

// 修复：summary: "XXX" \n<空格>weight: → 在 weight 或 source 前插入
content = content.replace(
  /summary: "([^"]*)",\n(\s+)weight:/g,
  (match, summaryText, indent) => {
    return `summary: "${summaryText}",\n${indent}semantic_gist: "${summaryText}",\n${indent}content_hash: "",\n${indent}weight:`;
  }
);

// 修复：summary: "XXX",\n<空格>createdAt: →
content = content.replace(
  /summary: "([^"]*)",\n(\s+)createdAt:/g,
  (match, summaryText, indent) => {
    return `summary: "${summaryText}",\n${indent}semantic_gist: "${summaryText}",\n${indent}content_hash: "",\n${indent}createdAt:`;
  }
);

// ── 修复 3: 私密记忆测试块 (includePrivate 在 v3 中已移除) ──
const oldPrivateTest = `  it("私密记忆默认不可见", async () => {
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "公开",
      source: { agentType: AgentType.Code, taskId: "" },
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "私密",
      source: { agentType: AgentType.Code, taskId: "" },

    const pub = await store.read({ includePrivate: false });
    expect(pub).toHaveLength(1);
    expect(pub[0].summary).toBe("公开");

    const all = await store.read({ includePrivate: true });
    expect(all).toHaveLength(2);
  });`;

const newPrivateTest = `  it("写入两条记忆均可检索", async () => {
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "第一",
      semantic_gist: "第一",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "第二",
      semantic_gist: "第二",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    const results = await store.read({});
    expect(results).toHaveLength(2);
  });`;

content = content.replace(oldPrivateTest, newPrivateTest);

// ── 修复 4: states: ["Archived"] → 改为用 peek 验证 ──
const oldArchiveTest = `    expect(store.archive(id)).toBe(true);
    expect(await store.read({})).toHaveLength(0);
    expect(await store.read({ states: ["Archived"] })).toHaveLength(1);`;

const newArchiveTest = `    expect(store.archive(id)).toBe(true);
    expect(await store.read({})).toHaveLength(0);
    expect(store.peek(id)!.semantic_state).toBe("Archived");`;

content = content.replace(oldArchiveTest, newArchiveTest);

// ── 修复 5: read({}) → 不需要改，但有些可能需要默认 mode ──

writeFileSync(filePath, content, "utf-8");
console.log("Fixed memory-store.test.ts");
