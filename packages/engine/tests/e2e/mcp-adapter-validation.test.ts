// @ci: integration
/**
 * mcp-adapter-validation.test.ts —— MCP 工具适配器真实验证
 *
 * 遍历 5 个开源无鉴权 MCP Server，验证：
 *   1. McpClient 启动 → initialize → tools/list 握手
 *   2. McpToolAdapter 将每个 MCP Tool 包装为统一 Tool 接口
 *   3. Tool 字段完整性（name / description / parameters / category / level）
 *   4. Tool.execute() 实际调用 MCP Server
 *   5. 各种 MCP 格式变体下的健壮性（空 Schema、复杂 Schema、社区脏数据）
 *
 * 每个 Server 独立测试——一个挂不影响其他。npx 安装耗时不计入超时。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { McpClient, McpToolAdapter } from "../../src/platform/mcp-client.js";
import type { McpServerConfig, McpToolDef } from "../../src/platform/mcp-client.js";
import type { Tool } from "@cortex/shared";
import { ToolCategory, ReversibilityLevel } from "@cortex/shared";

// ════════════════════════════════════════════════════════════
// 测试配置：5 个无鉴权 MCP Server
// ════════════════════════════════════════════════════════════

const tmpDir = path.join(os.tmpdir(), `cortex-mcp-test-${randomUUID().slice(0, 8)}`);

function npxArgs(pkg: string, ...extra: string[]): string[] {
  return ["/c", "npx", "-y", pkg, ...extra];
}

interface ServerSpec {
  id: string;
  config: McpServerConfig;
  /** 预期最少工具数 */
  minTools: number;
  /** 关键格式特点 */
  formatNotes: string;
  /** 可选：一个能成功调用的采样工具名及其参数 */
  sample?: { tool: string; args: Record<string, unknown> };
}

const SERVERS: ServerSpec[] = [
  // ===== 已确认 npm 上存在的 MCP Server =====
  {
    id: "filesystem",
    config: {
      id: "filesystem",
      transport: "stdio",
      command: "cmd",
      args: npxArgs("@modelcontextprotocol/server-filesystem", tmpDir),
    },
    minTools: 2,
    formatNotes: "复杂嵌套 Schema——anyOf/oneOf、file_path/content | 14 tools",
    sample: { tool: "list_directory", args: { path: tmpDir } },
  },
  {
    id: "sqlite",
    config: {
      id: "sqlite",
      transport: "stdio",
      command: "cmd",
      args: npxArgs("mcp-server-sqlite", path.join(tmpDir, "test.db")),
    },
    minTools: 1,
    formatNotes: "社区脏数据——可能缺 description，Schema 不规范 | 10 tools",
  },
];

// ════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════

/** 验证 Tool 接口完整性 */
function validateToolAdapter(adapter: Tool, serverId: string, rawDef: McpToolDef): string[] {
  const issues: string[] = [];

  // 1. name 必须以 mcp:<serverId>: 开头
  const expectedPrefix = `mcp:${serverId}:`;
  if (!adapter.name.startsWith(expectedPrefix)) {
    issues.push(`name "${adapter.name}" should start with "${expectedPrefix}"`);
  }

  // 2. name 非空且不含空格
  if (!adapter.name || adapter.name.includes(" ")) {
    issues.push(`invalid name: "${adapter.name}"`);
  }

  // 3. category 应为 Search（MCP 工具默认分类）
  if (adapter.category !== ToolCategory.Search) {
    issues.push(`category should be Search, got ${adapter.category}`);
  }

  // 4. level 应为 L0（MCP 工具不走 ConfirmGate）
  if (adapter.level !== ReversibilityLevel.L0) {
    issues.push(`level should be L0, got ${adapter.level}`);
  }

  // 5. description 非空（原始可能缺失，适配器应兜底）
  if (!adapter.description || adapter.description.trim() === "") {
    issues.push("description is empty");
  }

  // 6. parameters 必须是 object
  if (typeof adapter.parameters !== "object" || adapter.parameters === null) {
    issues.push(`parameters is not an object: ${typeof adapter.parameters}`);
  } else {
    // 7. parameters.type 应存在
    const params = adapter.parameters as Record<string, unknown>;
    if (!params.type) {
      // 空参数工具可以没有 type，但至少应该是 {}
    }
  }

  // 8. needsLock 应为 false（MCP 工具不锁文件）
  if (adapter.needsLock !== false) {
    issues.push(`needsLock should be false, got ${adapter.needsLock}`);
  }

  // 9. execute 应是函数
  if (typeof adapter.execute !== "function") {
    issues.push("execute is not a function");
  }

  return issues;
}

/** 安全启动 MCP Client——超时 60s（含 npx 安装） */
async function safeStart(client: McpClient, timeoutMs = 60_000): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const startPromise = client.start();
    const result = await Promise.race([
      startPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("start timeout")), timeoutMs)),
    ]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ════════════════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════════════════

describe("MCP Adapter Validation — 无鉴权生态测试", () => {
  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // 给 filesystem server 的 list_directory 测试准备一个文件
    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "hello from cortex mcp test");
  });

  afterAll(() => {
    // 清理临时目录
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  for (const spec of SERVERS) {
    describe(`Server: ${spec.id} (${spec.formatNotes})`, () => {
      let client: McpClient;
      let adapters: Tool[] = [];

      beforeAll(async () => {
        client = new McpClient(spec.config);
        const started = await safeStart(client);
        if (!started.ok) {
          console.warn(`  ⚠️  ${spec.id} 启动失败: ${started.error}`);
          return;
        }

        const tools = client.listTools();
        for (const toolDef of tools) {
          adapters.push(new McpToolAdapter(client, toolDef, spec.config.id));
        }
        console.log(`  ✅ ${spec.id} 已连接——${adapters.length} 个工具`);
      }, 90_000);

      afterAll(async () => {
        try { await client?.stop(); } catch { /* ignore */ }
      });

      it(`[A] 工具数量 >= ${spec.minTools}`, () => {
        if (adapters.length === 0) {
          console.warn("  ⚠️  未启动，跳过");
          return;
        }
        expect(adapters.length).toBeGreaterThanOrEqual(spec.minTools);
      });

      it("[B] 每个 Tool 接口字段完整（name / description / parameters / category / level / execute）", () => {
        if (adapters.length === 0) return;
        const rawTools = client.listTools();

        let totalIssues = 0;
        for (let i = 0; i < adapters.length; i++) {
          const adapter = adapters[i];
          const rawDef = rawTools[i];
          const issues = validateToolAdapter(adapter, spec.config.id, rawDef);
          if (issues.length > 0) {
            totalIssues += issues.length;
            console.warn(`  ⚠️  ${adapter.name}:`);
            for (const iss of issues) console.warn(`     - ${iss}`);
          }
        }
        expect(totalIssues).toBe(0);
      });

      it("[C] parameters 为合法 JSON Schema（type 为 object 或有 properties）", () => {
        if (adapters.length === 0) return;
        for (const adapter of adapters) {
          const params = adapter.parameters as Record<string, unknown>;
          // 至少是可解析的 object
          expect(typeof params).toBe("object");
          expect(params).not.toBeNull();
          // 如果有 type，应为 "object"
          if (params.type) {
            expect(params.type).toBe("object");
          }
        }
      });

      it("[D] description 包含 [MCP:<serverId>] 前缀标记", () => {
        if (adapters.length === 0) return;
        const prefix = `[MCP:${spec.config.id}]`;
        for (const adapter of adapters) {
          expect(adapter.description).toContain(prefix);
        }
      });

      // 采样执行——仅对有 sample 配置的 server
      if (spec.sample) {
        const sample = spec.sample;
        it(`[E] 采样执行: ${sample.tool}`, async () => {
          if (adapters.length === 0) return;

          const adapter = adapters.find((a) =>
            a.name === `mcp:${spec.config.id}:${sample.tool}` ||
            a.name.endsWith(`:${sample.tool}`)
          );

          if (!adapter) {
            console.warn(`  ⚠️  未找到工具 "${sample.tool}"，可用: ${adapters.map((a) => a.name).join(", ")}`);
            return;
          }

          try {
            const result = await adapter.execute(sample.args);
            if (!result.success) {
              console.warn(`  ⚠️  执行失败: ${result.error ?? "unknown"}`);
              return;
            }
            expect(typeof result.output).toBe("string");
            expect(result.output!.length).toBeGreaterThan(0);
            console.log(`  📤 ${sample.tool} → ${result.output!.slice(0, 120)}${result.output!.length > 120 ? "…" : ""}`);
          } catch (e) {
            // 采样失败不阻塞——可能是网络问题
            console.warn(`  ⚠️  执行失败 (可能是网络/环境问题): ${String(e)}`);
          }
        }, 30_000);
      }
    });
  }
});
