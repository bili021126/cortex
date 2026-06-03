import type { ToolInvocation, ToolResult, ToolDefinition, ToolHandler, ReversibilityLevel, AgentType, IFileSystemAdapter } from "@cortex/shared";
import { ToolCategory, ReversibilityLevel as RL, getAgentToolPermissions, resolveAgentPermissions, AgentContext, LockType } from "@cortex/shared";
import type { ConfirmGate } from "../core/confirm-gate.js";
import type { FileLockManager } from "./file-lock-manager.js";
import { NodeFileSystemAdapter } from "./node-fs-adapter.js";
import { type EngineConfig, resolveConfig } from "@cortex/config";
import { SearchAggregator } from "./search-aggregator.js";
import { DdgSearchBackend } from "./search-backend.js";

// ── 工具 Handler（从 tools/ 子目录导入） ──
import { createHandler as createReadFile } from "./tools/read-file.js";
import { createHandler as createWriteFile } from "./tools/write-file.js";
import { createHandler as createSearchCode } from "./tools/search-code.js";
import { createHandler as createRunShell } from "./tools/run-shell.js";
import { createHandler as createListFiles } from "./tools/list-files.js";
import { createHandler as createDeleteFile } from "./tools/delete-file.js";
import { createHandler as createParseAst } from "./tools/parse-ast.js";
import { createHandler as createWebSearch } from "./tools/web-search.js";
import { meta as readFileMeta } from "./tools/read-file.js";
import { meta as writeFileMeta } from "./tools/write-file.js";
import { meta as searchCodeMeta } from "./tools/search-code.js";
import { meta as runShellMeta } from "./tools/run-shell.js";
import { meta as listFilesMeta } from "./tools/list-files.js";
import { meta as deleteFileMeta } from "./tools/delete-file.js";
import { meta as parseAstMeta } from "./tools/parse-ast.js";
import { meta as webSearchMeta } from "./tools/web-search.js";
import type { ToolContext } from "./tools/types.js";

// ─── 工具元数据 —— cortex-agents.json 可全覆盖 ────

export interface ToolMeta {
  category: ToolCategory;
  description: string;
  level: ReversibilityLevel;
  parameters: Record<string, unknown>;
  required: string[];
}

/**
 * Toolkit —— 工具执行引擎。
 * Agent 通过此层调用工具（read_file / write_file / search_code / run_shell 等）。
 * 回执经 ConfirmGate 判定后才实际执行。
 *
 * @fix M6 — search_code rg 回退路径错误传播（已迁至 ./tools/search-code.ts grepFallback）。
 * @refactor v2.2 — 工具 Handler 拆至 ./tools/ 子目录，Toolkit 退化为编排层。
 * @enhancement 纳西妲增强建议：CLI 框架抽象——通过 IFileSystemAdapter 接口解耦
 *               Toolkit 与 Node.js 原生 API，支持 Electron/Web 平台适配。
 *               未注入自定义适配器时，默认使用 NodeFileSystemAdapter。
 */
export class Toolkit {
  private tools = new Map<string, ToolHandler>();
  private gate?: ConfirmGate;
  private lockManager?: FileLockManager;
  private workspaceRoot: string | null = null;
  private fs: IFileSystemAdapter;
  private readonly config: Required<EngineConfig>;
  /** 工具元数据——优先使用 JSON 注入值，回退到各 handler 的内置 meta */
  private _toolMeta: Record<string, ToolMeta> = {
    read_file: readFileMeta,
    write_file: writeFileMeta,
    search_code: searchCodeMeta,
    run_shell: runShellMeta,
    list_files: listFilesMeta,
    delete_file: deleteFileMeta,
    parse_ast: parseAstMeta,
    web_search: webSearchMeta,
  };
  /** 多源搜索聚合器 (默认仅 DDG) */
  private _aggregator: SearchAggregator;

  constructor(gate?: ConfirmGate, lockManager?: FileLockManager, fsAdapter?: IFileSystemAdapter, engineConfig?: EngineConfig) {
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

  /** 直接搜索（不经工具系统，供知识验证等基础设施使用） */
  async search(query: string, maxResults: number = 5): Promise<import("./search-backend.js").SearchResult[]> {
    return await this._aggregator.search(query, maxResults);
  }

  /** 注入工具元数据（从 cortex-agents.json "tools" 域加载，覆盖编译期默认值） */
  setToolMeta(meta: Record<string, ToolMeta>): void {
    this._toolMeta = meta;
  }

  /** 设置工作区根目录，所有文件操作路径将以此为沙箱根目录 */
  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = this.fs.resolve(root);
  }

  /** 自定义注册 */
  register(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }

  /** 注入 ConfirmGate（可选，无 gate 时跳过 L2/L3 拦截） */
  setGate(gate: ConfirmGate): void {
    this.gate = gate;
  }

  /** 注入 FileLockManager（可选，无锁管理器时跳过文件锁） */
  setLockManager(lm: FileLockManager): void {
    this.lockManager = lm;
  }

  /** 释放资源——级联清理 lockManager 定时器、gate 监听器 */
  dispose(): void {
    if (this.lockManager) {
      this.lockManager.dispose();
      this.lockManager = undefined;
    }
    this.gate = undefined;
  }

  /** 执行一次工具调用。先校验 callerType 权限，再经 ConfirmGate 确认后才执行。
   * @param context 执行场景——ReviewAgent 在 self_examination 场景可动态提升权限 */
  async execute(inv: ToolInvocation, callerType: AgentType, context?: AgentContext): Promise<ToolResult> {
    // ── 权限校验（context-aware） ──
    const allowed = context !== undefined
      ? resolveAgentPermissions(callerType, context)
      : (getAgentToolPermissions()[callerType] ?? []);
    if (!allowed.includes(inv.toolName)) {
      return { success: false, error: `Tool "${inv.toolName}" not permitted for agent type "${callerType}"` };
    }

    const handler = this.tools.get(inv.toolName);
    if (!handler) {
      return { success: false, error: `Unknown tool: ${inv.toolName}` };
    }

    // ── ConfirmGate 拦截 ──
    const level = this.reversibilityOf(inv.toolName);
    if (this.gate?.needsConfirmation(level)) {
      const reqId = this.gate.request({
        id: `confirm-${inv.toolName}-${Date.now()}`,
        level,
        toolName: inv.toolName,
        summary: `Tool "${inv.toolName}" requires confirmation (${level})`,
        detail: JSON.stringify(inv.params),
      });

      // L2/L3 阻塞等待用户确认（默认 5 分钟超时，防永久挂死）
      const approved = await this.gate.waitFor(reqId, this.config.toolTimeouts.confirmWait);
      if (!approved) {
        return { success: false, error: `Rejected by ConfirmGate: ${inv.toolName}` };
      }
    }

    // ── FileLockManager 加锁 ──
    // write_file 和 delete_file 共享同一文件资源，两者均需获取写锁。
    // 治理判例 NG-2026-0509-DeleteLock：delete_file 若不加锁，Agent A 正在写文件时 Agent B 可删除同一文件。
    if ((inv.toolName === "write_file" || inv.toolName === "delete_file") && this.lockManager) {
      const filePath = inv.params.file_path as string;
      if (filePath && !this.lockManager.acquire(filePath, LockType.Write, "toolkit")) {
        return { success: false, error: `File locked: ${filePath}` };
      }
      try {
        const result = await handler(inv.params);
        this.lockManager.release(filePath, "toolkit");
        return result;
      } catch (e) {
        this.lockManager.release(filePath, "toolkit");
        return { success: false, error: String(e) };
      }
    }

    try {
      return await handler(inv.params);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** 列�� callerType 有权使用的工具定义（供 LLM function calling 用） */
  listDefinitions(callerType: AgentType): ToolDefinition[] {
    const allowed = getAgentToolPermissions()[callerType] ?? [];
    const meta = this._toolMeta;
    return Array.from(this.tools.keys())
      .filter((name) => allowed.includes(name))
      .map((name) => {
        const info = meta[name];
        return {
          name,
          category: info?.category ?? ToolCategory.Search,
          description: info?.description ?? "",
          parameters: info?.parameters,
        };
      });
  }

  /** 获取工具的可逆性等级 */
  reversibilityOf(toolName: string): ReversibilityLevel {
    return this._toolMeta[toolName]?.level ?? RL.L2;
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
    const root = this.workspaceRoot;
    if (resolved === root || resolved.startsWith(root + this.fs.sep)) {
      return resolved;
    }
    throw new Error(`路径越界: "${filePath}" 不在工作区 "${root}" 内`);
  }

  // ── 内置工具注册（从 tools/ 子目录加载 handler） ──

  private _registerBuiltins(): void {
    const ctx: ToolContext = {
      resolvePath: (filePath: string) => this._resolvePath(filePath),
      fs: this.fs,
      workspaceRoot: this.workspaceRoot,
      toolTimeouts: { ...this.config.toolTimeouts },
      searchWeb: (query, maxResults) => this._aggregator.search(query, maxResults),
    };

    this.tools.set("read_file", createReadFile(ctx));
    this.tools.set("write_file", createWriteFile(ctx));
    this.tools.set("search_code", createSearchCode(ctx));
    this.tools.set("run_shell", createRunShell(ctx));
    this.tools.set("list_files", createListFiles(ctx));
    this.tools.set("delete_file", createDeleteFile(ctx));
    this.tools.set("parse_ast", createParseAst(ctx));
    this.tools.set("web_search", createWebSearch(ctx));
  }

}
