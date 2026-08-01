import { getAgentToolPermissions, resolveAgentPermissions, LockType, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { ToolInvocation, ToolResult, ToolDefinition, Tool, AgentType, IFileSystemAdapter, AgentContext, IPipelineObserver } from "@cortex/shared";
import type { ConfirmGate } from "@cortex/scheduler";
import type { IFileLockManager } from "@cortex/shared";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { NodeFileSystemAdapter } from "./node-fs-adapter.js";
import { resolveConfig, ToolCategory, ReversibilityLevel as RL } from "@cortex/config";
import type { EngineConfig, ReversibilityLevel } from "@cortex/config";
import { SearchAggregator } from "./search-aggregator.js";
import { DdgSearchBackend } from "./search-backend.js";
import type { SearchResult } from "./search-backend.js";
import { McpToolAdapter } from "./mcp-client.js";
import type { McpClient } from "./mcp-client.js";
import { LocalTool } from "./local-tool.js";

// ── 工具工厂（从 tools/ 子目录导入） ──
import { createTool as createReadFile } from "./tools/read-file.js";
import { createTool as createWriteFile } from "./tools/write-file.js";
import { createTool as createSearchCode } from "./tools/search-code.js";
import { createTool as createRunShell } from "./tools/run-shell.js";
import { createTool as createListFiles } from "./tools/list-files.js";
import { createTool as createDeleteFile } from "./tools/delete-file.js";
import { createTool as createParseAst } from "./tools/parse-ast.js";
import { createTool as createWebSearch } from "./tools/web-search.js";
import { createTool as createSearchSymbol } from "./tools/search-symbol.js";
import { createTool as createReadManyFiles } from "./tools/read-many-files.js";
import { createTool as createGrepFiles } from "./tools/grep-files.js";
import { createTool as createFileInfo } from "./tools/file-info.js";
import { createTool as createGlobFind } from "./tools/glob-find.js";
import { createTool as createResolveImport } from "./tools/resolve-import.js";
import { createTool as createFormatCode } from "./tools/format-code.js";
import { createTool as createJsonQuery } from "./tools/json-query.js";
import { createTool as createEditFile } from "./tools/edit-file.js";
import { createTool as createRunTest } from "./tools/run-test.js";
import { createTool as createDiffFiles } from "./tools/diff-files.js";
import type { ToolContext } from "./tools/types.js";

// ─── 工具元数据 —— agents/tools 配置域可全覆盖 ────

export interface ToolMeta {
  category?: ToolCategory;
  description?: string;
  level?: ReversibilityLevel;
  parameters?: Record<string, unknown>;
  required?: string[];
  /** 工具使用约束——按 Agent 类型声明 */
  constraint?: Record<string, string>;
}

/**
 * Toolkit —— 工具执行引擎。
 *
 * @core v3 —— 统一 Tool 接口：本地工具与 MCP 工具不再区分执行路径。
 *   所有工具注册到单一 Map<string, Tool>，execute() 走同一条流水线：
 *   权限校验 → ConfirmGate → FileLock → tool.execute()。
 *
 *   本地工具通过 LocalTool 封装；MCP 工具通过 McpToolAdapter 封装——
 *   两者对 Toolkit 透明，未来新增 A2A/gRPC 插件只需实现 Tool 接口。
 *
 * @fix M6 — search_code rg 回退路径错误传播（已迁至 ./tools/search-code.ts grepFallback）。
 * @refactor v2.2 — 工具 Handler 拆至 ./tools/ 子目录，Toolkit 退化为编排层。
 * @enhancement 纳西妲增强建议：CLI 框架抽象——通过 IFileSystemAdapter 接口解耦
 *               Toolkit 与 Node.js 原生 API，支持 Electron/Web 平台适配。
 *               未注入自定义适配器时，默认使用 NodeFileSystemAdapter。
 */
export class Toolkit {
  /** 统一工具注册表——本地 + MCP，不再区分来源 */
  private tools = new Map<string, Tool>();
  private gate?: ConfirmGate;
  private lockManager?: IFileLockManager;
  private workspaceRoot: string | null = null;
  private fs: IFileSystemAdapter;
  private readonly config: Required<EngineConfig>;
  /** JSON 注入的元数据覆盖（tools.json 工具域等） */
  private _toolMeta: Record<string, ToolMeta> = {};
  /** 工具使用约束——按工具名 → Agent 类型 → 约束文本 */
  private _constraints = new Map<string, Record<string, string>>();
  /** 多源搜索聚合器 (默认仅 DDG) */
  private _aggregator: SearchAggregator;
  /** 可观测事件管道 */
  private _observer?: IPipelineObserver;

  constructor(gate?: ConfirmGate, lockManager?: IFileLockManager, fsAdapter?: IFileSystemAdapter, engineConfig?: EngineConfig) {
    this.gate = gate;
    this.lockManager = lockManager;
    this.fs = fsAdapter ?? new NodeFileSystemAdapter();
    this.config = resolveConfig(engineConfig);
    this._aggregator = new SearchAggregator({
      backends: [new DdgSearchBackend(
        this.config.toolTimeouts.webSearch ?? 15_000,
        this.config.toolTimeouts.webSearchRetries ?? 2,
      )],
      cacheTTL: this.config.toolTimeouts.webSearchCacheTTL ?? 300_000,
    });
    this._registerBuiltins();
  }

  /** 替换搜索聚合器 (bootstrap 阶段由 main.ts 注入 MCP 后端) */
  setSearchAggregator(aggregator: SearchAggregator): void {
    this._aggregator = aggregator;
  }

  /**
   * 直接搜索（不经工具系统，供知识验证等基础设施使用）。
   *
   * @internal — 仅限基础设施内部使用，不暴露给 Agent。不走 execute() 管线的
   *   权限校验 / ConfirmGate / FileLock，因此不被视为工具调用。如需从 Agent
   *   侧搜索，应通过 "web_search" 工具走 execute() 完整管线。
   */
  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    return await this._aggregator.search(query, maxResults);
  }

  /** 注入工具元数据覆盖（从 tools 配置域加载） */
  setToolMeta(meta: Record<string, ToolMeta>): void {
    this._toolMeta = meta;
    // 从元数据中提取约束
    for (const [toolName, tMeta] of Object.entries(meta)) {
      if (tMeta.constraint) {
        this._constraints.set(toolName, tMeta.constraint);
      }
    }
  }

  /** 设置工作区根目录，所有文件操作路径将以此为沙箱根目录 */
  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = this.fs.resolve(root);
  }

  /**
   * 注册自定义工具（向后兼容旧 ToolHandler API）。
   * 推荐使用 registerTool(tool: Tool) 以提供完整元数据。
   */
  register(name: string, handler: (params: Record<string, unknown>) => Promise<ToolResult>): void {
    this.tools.set(name, new LocalTool(
      name,
      ToolCategory.Search,
      `Registered tool: ${name}`,
      { type: "object", properties: {}, required: [] },
      RL.L2, // 保守：未知来源工具默认 L2
      handler,
    ));
  }

  /** 注册完整的 Tool 对象（推荐方式，本地/MCP 均可） */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** 注入 ConfirmGate（可选，无 gate 时跳过 L2/L3 拦截） */
  setGate(gate: ConfirmGate): void {
    this.gate = gate;
  }

  /** 注入可观测事件管道（可选，无 observer 时跳过事件上报） */
  setObserver(observer: IPipelineObserver): void {
    this._observer = observer;
  }

  /** 注入 FileLockManager（可选，无锁管理器时跳过文件锁） */
  setLockManager(lm: IFileLockManager): void {
    this.lockManager = lm;
  }

  /**
   * 注册 MCP 客户端——将该 MCP Server 的所有工具注册为 McpToolAdapter。
   * 每个 MCP 工具以 mcp:<serverId>:<toolName> 命名，通过统一的 Tool 接口执行。
   */
  registerMcpClient(client: McpClient): void {
    const trustLevel = client.getTrustLevel();
    for (const toolDef of client.listTools()) {
      const adapter = new McpToolAdapter(client, toolDef, client.id, trustLevel);
      this.tools.set(adapter.name, adapter);
    }
  }

  /** 获取已注册的 MCP 客户端（按 serverId 索引——兼容旧 API，实际 MCP 工具已作为 Tool 注册） */
  getMcpClient(_serverId: string): McpClient | undefined {
    // 适配器不持有 client 引用暴露——保持兼容需在外层缓存
    return undefined;
  }

  /** 列出已注册的 MCP tool 名称（兼容旧 API） */
  listMcpServerIds(): string[] {
    const ids = new Set<string>();
    for (const name of this.tools.keys()) {
      if (name.startsWith("mcp:")) {
        const parts = name.slice(4).split(":");
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (parts.length >= 2) ids.add(parts[0]!);
      }
    }
    return [...ids];
  }

  /** 释放资源——级联清理 lockManager 定时器、gate 监听器 */
  dispose(): void {
    if (this.lockManager) {
      this.lockManager.dispose?.();
      this.lockManager = undefined;
    }
    this.gate = undefined;
  }

  /**
   * 执行一次工具调用——统一流水线，不区分本地/MCP。
   *
   * 流水线：权限校验 → 查找 Tool → ConfirmGate → FileLock → tool.execute()
   *
   * @param context 执行场景——ReviewAgent 在 self_examination 场景可动态提升权限
   */
  async execute(inv: ToolInvocation, callerType: AgentType, context?: AgentContext): Promise<ToolResult> {
    // ── 权限校验（context-aware） ──
    const allowed = context !== undefined
      ? resolveAgentPermissions(callerType, context)
      : (getAgentToolPermissions()[callerType] ?? []);
    if (!allowed.includes(inv.toolName)) {
      // 发射权限拒绝事件
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.SkillToolPermissionDenied,
          priority: PipelinePriority.NORMAL,
          payload: {
            agentType: callerType,
            toolName: inv.toolName,
            reason: `Tool not permitted for agent type "${callerType}"`,
          },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
      }
      return { success: false, error: `Tool "${inv.toolName}" not permitted for agent type "${callerType}"` };
    }

    const tool = this.tools.get(inv.toolName);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${inv.toolName}` };
    }

    // ── ConfirmGate 拦截 ──
    const level = this.reversibilityOf(inv.toolName);
    // R5-S4 fix: gate 未注入时 L2/L3 操作 fail-closed（拒绝），防止安全门静默跳过
    if (!this.gate) {
      if (level === RL.L2 || level === RL.L3) {
        return { success: false, error: `ConfirmGate 未注入——拒绝 L${level} 操作: ${inv.toolName}` };
      }
      // L0/L1 无 gate 时直接执行
    }
    const gate = this.gate;
    if (gate) {
      // C1 fix: check() 内部已调用 needsConfirmation() 并记录信任，不需要外层再重复调用
      const trustResult = gate.check(level, { agentType: callerType, toolName: inv.toolName });
      if (trustResult && !trustResult.approved) {
        const reqId = gate.request({
          id: `confirm-${inv.toolName}-${Date.now()}`,
          level,
          toolName: inv.toolName,
          summary: `Tool "${inv.toolName}" requires confirmation (${level})`,
          detail: JSON.stringify(inv.params),
        });

        // L2/L3 阻塞等待用户确认（默认 5 分钟超时，防永久挂死）
        const approved = await gate.waitFor(reqId, this.config.toolTimeouts.confirmWait);
        if (typeof approved !== "boolean") {
          return { success: false, error: `ConfirmGate returned non-boolean for ${inv.toolName}: ${String(approved)}` };
        }

        // 将确认结果反馈给信任模型（含拒绝和批准）
        gate.recordDecision(callerType, inv.toolName, approved);

        if (!approved) {
          return { success: false, error: `Rejected by ConfirmGate: ${inv.toolName}` };
        }
      }
    }

    // ── FileLockManager 加锁（依赖 Tool.needsLock 标志，而非硬编码工具名） ──
    if (tool.needsLock && this.lockManager) {
      const filePath = inv.params.file_path as string;
      if (filePath && !this.lockManager.acquire(filePath, "toolkit", LockType.Write)) {
        return { success: false, error: `File locked: ${filePath}` };
      }
      try {
        const result = await tool.execute(inv.params);
        this.lockManager.release(filePath, "toolkit");
        return result;
      } catch (e) {
        this.lockManager.release(filePath, "toolkit");
        return { success: false, error: String(e) };
      }
    }

    try {
      return await tool.execute(inv.params);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * 列出 callerType 有权使用的工具定义（供 LLM function calling 用）。
   *
   * 所有工具（本地 + MCP）从统一的 Map<string, Tool> 遍历，
   * JSON 注入的 _toolMeta 覆盖优先于 Tool 内置元数据。
   */
  listDefinitions(callerType: AgentType): ToolDefinition[] {
    const allowed = getAgentToolPermissions()[callerType] ?? [];

    return Array.from(this.tools.values())
      .filter((tool) => allowed.includes(tool.name))
      .map((tool) => {
        const override = this._toolMeta[tool.name];
        return {
          name: tool.name,
          category: override?.category ?? tool.category,
          description: override?.description ?? tool.description,
          parameters: override?.parameters ?? tool.parameters,
        };
      });
  }

  /**
   * 获取工具对指定 Agent 类型的使用约束。
   * 约束文本将注入 system prompt 中指导 Agent 行为。
   */
  getConstraint(toolName: string, agentType: string): string | undefined {
    return this._constraints.get(toolName)?.[agentType];
  }

  /** 获取工具的可逆性等级（JSON 覆盖优先，其次 Tool 内置） */
  reversibilityOf(toolName: string): ReversibilityLevel {
    const metaLevel = this._toolMeta[toolName]?.level;
    if (metaLevel !== undefined) return metaLevel;
    const toolLevel = this.tools.get(toolName)?.level;
    if (toolLevel !== undefined) {
      // shared 契约字段为字面量联合类型，映射回 config 枚举值（S1-1 单源）
      return { L0: RL.L0, L1: RL.L1, L2: RL.L2, L3: RL.L3 }[toolLevel];
    }
    return RL.L2;
  }

  // ── 路径安全解析 ────────────────────────────

  /**
   * 将工具调用中的文件路径解析为绝对路径。
   * 若已设置 workspaceRoot，且传入路径为相对路径或以 workspaceRoot 开头，
   * 则约束在 workspaceRoot 下；否则拒绝访问（沙箱保护）。
   */
  private _resolvePath(filePath: string): string {
    if (!this.workspaceRoot) {
      // 未设沙箱时允许任意路径（向后兼容测试场景）
      return this.fs.resolve(filePath);
    }
    const resolved = this.fs.resolve(filePath);
    // 解析符号链接的真实路径（防符号链接沙箱绕过）
    let realResolved: string;
    try {
      realResolved = realpathSync.native(resolved);
    } catch {
      // R7-H6 fix: 新文件 realpath 失败时，对父目录做 realpath 验证
      // 防止 workspace 内 symlink→外部 绕过双通道检查
      const dir = path.dirname(resolved);
      try {
        const realDir = realpathSync.native(dir);
        realResolved = path.join(realDir, path.basename(resolved));
      } catch { realResolved = resolved; }
    }
    const root = this.workspaceRoot;
    // H2 fix: Windows NTFS 不区分大小写，startsWith 是大小写敏感的。
    // 统一小写比较，同时校验原始路径和真实路径双通道。
    const isWin = process.platform === "win32";
    const normReal = isWin ? realResolved.toLowerCase() : realResolved;
    const normRoot = isWin ? root.toLowerCase() : root;
    const normResolved = isWin ? resolved.toLowerCase() : resolved;
    const sep = this.fs.sep;
    if ((normReal === normRoot || normReal.startsWith(normRoot + sep)) &&
        (normResolved === normRoot || normResolved.startsWith(normRoot + sep))) {
      return resolved;
    }
    throw new Error(`路径越界: "${filePath}" 不在工作区 "${root}" 内`);
  }

  // ── 内置工具注册（从 tools/ 子目录加载 Tool 工厂） ──

  private _registerBuiltins(): void {
    const ctx: ToolContext = {
      resolvePath: (filePath: string) => this._resolvePath(filePath),
      fs: this.fs,
      workspaceRoot: null as string | null,
      toolTimeouts: { ...this.config.toolTimeouts },
      searchWeb: (query, maxResults) => this._aggregator.search(query, maxResults),
    };

    // 动态 getter：每次读取时实时获取 Toolkit 的 workspaceRoot
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    Object.defineProperty(ctx, 'workspaceRoot', {
      get: function() { return self.workspaceRoot; },
      enumerable: true,
      configurable: false,
    });

    this.tools.set("read_file", createReadFile(ctx));
    this.tools.set("write_file", createWriteFile(ctx));
    this.tools.set("search_code", createSearchCode(ctx));
    this.tools.set("run_shell", createRunShell(ctx));
    this.tools.set("list_files", createListFiles(ctx));
    this.tools.set("delete_file", createDeleteFile(ctx));
    this.tools.set("parse_ast", createParseAst(ctx));
    this.tools.set("web_search", createWebSearch(ctx));
    this.tools.set("search_symbol", createSearchSymbol(ctx));
    this.tools.set("read_many_files", createReadManyFiles(ctx));
    this.tools.set("grep_files", createGrepFiles(ctx));
    this.tools.set("file_info", createFileInfo(ctx));
    this.tools.set("glob_find", createGlobFind(ctx));
    this.tools.set("resolve_import", createResolveImport(ctx));
    this.tools.set("format_code", createFormatCode(ctx));
    this.tools.set("json_query", createJsonQuery(ctx));
    this.tools.set("edit_file", createEditFile(ctx));
    this.tools.set("run_test", createRunTest(ctx));
    this.tools.set("diff_files", createDiffFiles(ctx));
  }
}
