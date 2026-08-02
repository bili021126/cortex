// @ci: unit
/**
 * mcp-tool-adapter.test.ts —— McpToolAdapter 契约测试（重写自迭代遗留 mcp-adapter-validation e2e）
 *
 * 原 e2e 启动真实 MCP Server（依赖网络，@ci: integration）——重写为纯单元：
 * 验证适配器的包装契约（MCP 前缀 / 字段透传 / 默认等级 / execute 路径），不依赖外部服务。
 */
import { describe, it, expect } from "vitest";
import { McpToolAdapter, MCP_PREFIX } from "@cortex/platform";
import { ReversibilityLevel } from "@cortex/config";

/** mock MCP client——callTool 可编程 */
function mockClient(impl?: (name: string, args: Record<string, unknown>) => Promise<string>) {
  return { callTool: impl ?? (async () => "ok") };
}

describe("McpToolAdapter 包装契约", () => {
  it("name 带 MCP_PREFIX:serverId:toolName 前缀格式", () => {
    const adapter = new McpToolAdapter(mockClient(), { name: "search", description: "搜索", inputSchema: {} }, "bing");
    expect(adapter.name).toBe(`${MCP_PREFIX}bing:search`);
  });

  it("description 含 [MCP:serverId] 前缀标记（供权限审计识别来源）", () => {
    const adapter = new McpToolAdapter(mockClient(), { name: "search", description: "搜索", inputSchema: {} }, "bing");
    expect(adapter.description).toContain("[MCP:bing]");
    expect(adapter.description).toContain("搜索");
  });

  it("parameters 透传 inputSchema；缺省时为空对象", () => {
    const schema = { type: "object", properties: { q: { type: "string" } } };
    const withSchema = new McpToolAdapter(mockClient(), { name: "t", description: "d", inputSchema: schema }, "srv");
    expect(withSchema.parameters).toEqual(schema);
    const noSchema = new McpToolAdapter(mockClient(), { name: "t", description: "d", inputSchema: {} }, "srv");
    expect(noSchema.parameters).toEqual({});
  });

  it("level 默认 L2（需确认），trustLevel 可覆盖", () => {
    const def = { name: "t", description: "d", inputSchema: {} };
    const defaulted = new McpToolAdapter(mockClient(), def, "srv");
    expect(defaulted.level).toBe(ReversibilityLevel.L2);
    const trusted = new McpToolAdapter(mockClient(), def, "srv", ReversibilityLevel.L0);
    expect(trusted.level).toBe(ReversibilityLevel.L0);
  });

  it("execute 成功路径返回 output，失败路径返回 error 不抛", async () => {
    const ok = new McpToolAdapter(mockClient(async () => "result"), { name: "t", description: "d", inputSchema: {} }, "srv");
    expect(await ok.execute({})).toEqual({ success: true, output: "result" });

    const fail = new McpToolAdapter(mockClient(async () => { throw new Error("boom"); }), { name: "t", description: "d", inputSchema: {} }, "srv");
    const result = await fail.execute({});
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("boom");
  });
});
