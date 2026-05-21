import type { ToolInvocation, ToolResult, ToolDefinition, ToolHandler, ReversibilityLevel, AgentType, IFileSystemAdapter, DirectoryEntry } from "@cortex/shared";
import { ToolCategory, ReversibilityLevel as RL, getAgentToolPermissions, LockType } from "@cortex/shared";
import type { ConfirmGate } from "../core/confirm-gate.js";
import type { FileLockManager } from "./file-lock-manager.js";
import { NodeFileSystemAdapter } from "./node-fs-adapter.js";
import { type EngineConfig, resolveConfig } from "../engine-config.js";
import { SearchAggregator } from "./search-aggregator.js";
import { DdgSearchBackend } from "./search-backend.js";
import * as path from "node:path";
import * as ts from "typescript";

// ─── 工具元数据（统一存放，一处改全局生效） ──────────────────

interface ToolMeta {
  category: ToolCategory;
  description: string;
  level: ReversibilityLevel;
  parameters: Record<string, unknown>;
  required: string[];
}

const TOOL_META: Record<string, ToolMeta> = {
  read_file: {
    category: ToolCategory.Read,
    description: "Read the contents of a file at the given path.",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to file" },
      },
      required: ["file_path"],
    },
    required: ["file_path"],
  },
  write_file: {
    category: ToolCategory.Write,
    description: "Write content to a file at the given path.",
    level: RL.L2,
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["file_path", "content"],
    },
    required: ["file_path", "content"],
  },
  search_code: {
    category: ToolCategory.Search,
    description: "Search for code patterns in the project.",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Code pattern to search" },
      },
      required: ["query"],
    },
    required: ["query"],
  },
  run_shell: {
    category: ToolCategory.Shell,
    description: "Run a shell command and return its output.",
    level: RL.L3,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
      },
      required: ["command"],
    },
    required: ["command"],
  },
  list_files: {
    category: ToolCategory.Read,
    description: "List files and directories at the given path.",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        dir_path: { type: "string", description: "Absolute path to directory (default: current workspace)" },
        pattern: { type: "string", description: "Glob filter pattern (optional, e.g. '*.ts')" },
      },
      required: [],
    },
    required: [],
  },
  delete_file: {
    category: ToolCategory.Write,
    description: "Delete a file at the given path. Irreversible — use with caution.",
    level: RL.L3,
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to file to delete" },
      },
      required: ["file_path"],
    },
    required: ["file_path"],
  },
  parse_ast: {
    category: ToolCategory.Read,
    description: "Parse a source file and return its AST (Abstract Syntax Tree). Uses TypeScript Compiler API for .ts/.tsx/.js/.jsx files; tree-sitter for other languages (pending).",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the source file to parse" },
        max_depth: { type: "number", description: "Maximum AST depth to return (default: 6, max: 12)" },
        include_text: { type: "boolean", description: "Include source text snippets in AST nodes (default: true)" },
      },
      required: ["file_path"],
    },
    required: ["file_path"],
  },
  web_search: {
    category: ToolCategory.Search,
    description: "Search the web via DuckDuckGo and return structured results (title, URL, snippet). Infrastructure-level read-only tool — no API key required.",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Maximum number of results to return (default: 5, max: 10)" },
      },
      required: ["query"],
    },
    required: ["query"],
  },
};

/**
 * Toolkit —— 工具执行引擎。
 * Agent 通过此层调用工具（read_file / write_file / search_code / run_shell 等）。
 * 回执经 ConfirmGate 判定后才实际执行。
 *
 * @fix M6 — search_code rg 回退路径错误传播，_grepFallback 错误包含在返回信息中。
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

  /** 执行一次工具调用。先校验 callerType 权限，再经 ConfirmGate 确认后才执行。 */
  async execute(inv: ToolInvocation, callerType: AgentType): Promise<ToolResult> {
    // ── 权限校验 ──
    const allowed = getAgentToolPermissions()[callerType] ?? [];
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

  /** 列出 callerType 有权使用的工具定义（供 LLM function calling 用） */
  listDefinitions(callerType: AgentType): ToolDefinition[] {
    const allowed = getAgentToolPermissions()[callerType] ?? [];
    return Array.from(this.tools.keys())
      .filter((name) => allowed.includes(name))
      .map((name) => {
        const meta = TOOL_META[name];
        return {
          name,
          category: meta?.category ?? ToolCategory.Search,
          description: meta?.description ?? "",
          parameters: meta?.parameters,
        };
      });
  }

  /** 获取工具的可逆性等级 */
  reversibilityOf(toolName: string): ReversibilityLevel {
    return TOOL_META[toolName]?.level ?? RL.L2;
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

  // ── 内置工具注册 ─────────────────────────────

  private _registerBuiltins(): void {
    this.tools.set("read_file", async (params) => {
      const filePath = this._resolvePath(params.file_path as string);
      try {
        const exists = await this.fs.exists(filePath);
        if (!exists) {
          return { success: false, error: `文件不存在: ${filePath}` };
        }
        const content = await this.fs.readFile(filePath);
        return { success: true, output: content };
      } catch (e) {
        return { success: false, error: `读取失败: ${String(e)}` };
      }
    });

    this.tools.set("write_file", async (params) => {
      const filePath = this._resolvePath(params.file_path as string);
      const content = params.content as string;
      if (content === undefined) {
        return { success: false, error: "write_file 缺少 content 参数" };
      }
      try {
        // 使用 IFileSystemAdapter 的 writeFile（内部已处理 mkdir）
        await this.fs.writeFile(filePath, content);
        return { success: true, output: `已写入 ${filePath} (${content.length} 字符)` };
      } catch (e) {
        return { success: false, error: `写入失败: ${String(e)}` };
      }
    });

    this.tools.set("search_code", async (params) => {
      const query = params.query as string;
      if (!query) {
        return { success: false, error: "search_code 缺少 query 参数" };
      }
      try {
        const searchRoot = this.workspaceRoot ?? this.fs.cwd();
        // 用 ripgrep 搜索，不可用时退回 Node.js 原生
        let output: string;
        let fallbackError: string | null = null;
        try {
          output = await this.fs.execFile(
            "rg",
            ["--line-number", "--max-count", "30", "--no-heading", query],
            { cwd: searchRoot, timeout: this.config.toolTimeouts.searchCode },
          );
        } catch (e) {
          // rg 非零退出码区分：
          //   exit 1 = 无匹配结果（正常，rg 语义如此）→ 返回空
          //   exit 2 = 真错误（rg 未安装/权限拒绝/正则非法）→ 退回 grep 降级
          //   其他 = 超时/spawn 失败 → 退回 grep 降级
          const err = e as { status?: number; stderr?: unknown; message?: string };
          const stderr = err.stderr?.toString() ?? "";
          if (err.status === 1) {
            // 无匹配，rg 正常工作
            output = "";
          } else {
            if (!process.env.VITEST) {
              console.warn(
                `[toolkit] search_code: rg failed (exit ${err.status ?? "?"}), falling back to grep. stderr: ${stderr.slice(0, 200)}`,
              );
            }
            // M6: 捕获 _grepFallback 的错误，外层包含原始 rg 错误信息
            try {
              output = await this._grepFallback(searchRoot, query);
            } catch (fallbackErr) {
              fallbackError = `grep fallback failed: ${String(fallbackErr)}`;
              output = "";
            }
          }
        }
        if (!output.trim()) {
          const msg = fallbackError
            ? `搜索失败: rg 不可用且 grep 降级也失败 (${fallbackError})`
            : `未找到匹配 "${query}" 的结果`;
          return { success: true, output: msg };
        }
        return { success: true, output: output.slice(0, 10_000) };
      } catch (e) {
        return { success: false, error: `搜索失败: ${String(e)}` };
      }
    });

    this.tools.set("run_shell", async (params) => {
      const command = params.command as string;
      if (!command) {
        return { success: false, error: "run_shell 缺少 command 参数" };
      }
      try {
        const cwd = this.workspaceRoot ?? this.fs.cwd();
        const output = await this.fs.execCommand(command, { cwd, timeout: this.config.toolTimeouts.runShell });
        return { success: true, output: output.slice(0, 10_000) };
      } catch (e) {
        const err = e as { stderr?: unknown; message?: string };
        const stderr = err.stderr ?? "";
        const message = err.message?.slice(0, 500) ?? String(e);
        return { success: false, error: `命令执行失败: ${message}${stderr ? `\nstderr: ${String(stderr).slice(0, 500)}` : ""}` };
      }
    });

    this.tools.set("list_files", async (params) => {
      const dirPath = params.dir_path
        ? this._resolvePath(params.dir_path as string)
        : (this.workspaceRoot ?? this.fs.cwd());
      try {
        const exists = await this.fs.exists(dirPath);
        if (!exists) {
          return { success: false, error: `目录不存在: ${dirPath}` };
        }
        const entries = await this.fs.listDirectory(dirPath);
        const pattern = params.pattern as string | undefined;
        let listing = entries
          .map((e) => `${e.isDirectory ? "[D]" : "[F]"} ${e.name}`)
          .join("\n");
        if (pattern) {
          // 简单 glob 过滤
          const regex = new RegExp(
            "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
          );
          listing = entries
            .filter((e) => regex.test(e.name))
            .map((e) => `${e.isDirectory ? "[D]" : "[F]"} ${e.name}`)
            .join("\n");
        }
        return { success: true, output: listing || "(空目录)" };
      } catch (e) {
        return { success: false, error: `列目录失败: ${String(e)}` };
      }
    });

    this.tools.set("delete_file", async (params) => {
      const filePath = this._resolvePath(params.file_path as string);
      try {
        const exists = await this.fs.exists(filePath);
        if (!exists) {
          return { success: false, error: `文件不存在: ${filePath}` };
        }
        await this.fs.unlink(filePath);
        return { success: true, output: `已删除 ${filePath}` };
      } catch (e) {
        return { success: false, error: `删除失败: ${String(e)}` };
      }
    });

    this.tools.set("parse_ast", async (params) => {
      const filePath = this._resolvePath(params.file_path as string);
      const maxDepth = Math.min(params.max_depth as number ?? 6, 12);
      const includeText = (params.include_text as boolean) ?? true;
      try {
        const exists = await this.fs.exists(filePath);
        if (!exists) {
          return { success: false, error: `文件不存在: ${filePath}` };
        }
        const content = await this.fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const parser = this._getParserByExtension(ext);
        if (!parser) {
          return { success: false, error: `不支持的文件类型: ${ext}。当前支持 .ts/.tsx/.js/.jsx（TypeScript Compiler API），其他语言（tree-sitter）待后续版本。` };
        }
        const ast = parser(content, filePath);
        const output = this._serializeAST(ast, maxDepth, includeText, content);
        return { success: true, output };
      } catch (e) {
        return { success: false, error: `AST 解析失败: ${String(e)}` };
      }
    });

    // ── web_search: 联网搜索（基础设施级，零 API Key） ──
    // 加固策略：内存缓存 (TTL 5min) + 指数退避重试 + UA 轮换
    this.tools.set("web_search", async (params) => {
      const query = params.query as string;
      if (!query || !query.trim()) {
        return { success: false, error: "web_search 缺少 query 参数" };
      }
      const maxResults = Math.min(params.max_results as number ?? 5, 10);

      try {
        const results = await this._aggregator.search(query.trim(), maxResults);
        if (results.length === 0) {
          return { success: true, output: JSON.stringify({ query: query.trim(), results: [], note: "未找到搜索结果" }) };
        }
        return {
          success: true,
          output: JSON.stringify({ query: query.trim(), count: results.length, results }),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: `搜索失败: ${msg}` };
      }
    });
  }

  /** 简易 grep 回退（rg 不可用时的纯 Node.js 文本搜索） */
  private async _grepFallback(rootDir: string, query: string): Promise<string> {
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();
    const walk = async (dir: string, depth: number) => {
      if (depth > 4 || results.length > 30) return;
      let entries: DirectoryEntry[];
      try { entries = await this.fs.listDirectory(dir); } catch (e) { console.warn(`[toolkit] readdir failed for ${dir}: ${String(e)}`); return; }
      for (const entry of entries) {
        if (results.length >= 30) return;
        const fullPath = this.fs.resolve(dir, entry.name);
        if (entry.isDirectory) {
          if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
            await walk(fullPath, depth + 1);
          }
        } else if (/\.(ts|js|json|md|html|css)$/.test(entry.name)) {
          try {
            const content = await this.fs.readFile(fullPath);
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && results.length < 30; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                const relPath = this.fs.resolve(rootDir) === this.fs.resolve(dir)
                  ? entry.name
                  : entry.name;
                results.push(`${fullPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              }
            }
          } catch (e) { console.warn(`[toolkit] skip unreadable file ${fullPath}: ${String(e)}`); }
        }
      }
    };
    await walk(rootDir, 0);
    return results.join("\n");
  }

  // ── AST 解析引擎（ParserSelector + 双引擎） ────────

  /** 按文件扩展名选择解析器 */
  private _getParserByExtension(ext: string): ((content: string, filePath: string) => ts.SourceFile) | null {
    const tsExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
    if (tsExtensions.includes(ext)) {
      return this._parseAstWithTS.bind(this);
    }
    // tree-sitter 预留插槽：后续版本扩展 .py/.rs/.go/.java 等
    return null;
  }

  /** TypeScript Compiler API 解析器 */
  private _parseAstWithTS(content: string, filePath: string): ts.SourceFile {
    const scriptKind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
    return ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      scriptKind,
    );
  }

  /** 将 ts.SourceFile 序列化为可读 JSON 字符串 */
  private _serializeAST(
    sourceFile: ts.SourceFile,
    maxDepth: number,
    includeText: boolean,
    sourceText: string,
  ): string {
    const lines = sourceText.split("\n");
    const root = this._nodeToJSON(sourceFile, 0, maxDepth, includeText, lines);
    // 顶层统计信息
    const stats = this._collectASTStats(sourceFile);
    return JSON.stringify({ stats, root }, null, 2);
  }

  /** 递归 AST 节点 → 纯 JSON */
  private _nodeToJSON(
    node: ts.Node,
    depth: number,
    maxDepth: number,
    includeText: boolean,
    lines: string[],
  ): Record<string, unknown> {
    const kind = ts.SyntaxKind[node.kind] ?? `Unknown(${node.kind})`;
    const pos = node.getStart();
    const end = node.getEnd();
    const startLine = ts.getLineAndCharacterOfPosition(node.getSourceFile(), pos);
    const endLine = ts.getLineAndCharacterOfPosition(node.getSourceFile(), end);

    const result: Record<string, unknown> = {
      kind,
      pos: { line: startLine.line + 1, col: startLine.character + 1 },
      end: { line: endLine.line + 1, col: endLine.character + 1 },
    };

    if (includeText && depth <= 2) {
      // 浅层节点附带源码文本
      const text = node.getText();
      if (text.length <= 200) {
        result.text = text;
      } else {
        result.text = text.slice(0, 200) + "…";
      }
    }

    // 关键语义信息
    if (ts.isIdentifier(node)) {
      result.name = node.text;
    } else if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
      result.value = node.text;
    } else if (ts.isTypeNode(node)) {
      result.typeText = node.getText();
    }

    // 修饰符
    if (ts.canHaveModifiers(node)) {
      const modifiers = ts.getModifiers(node);
      if (modifiers?.length) {
        result.modifiers = modifiers.map((m) => ts.SyntaxKind[m.kind]);
      }
    }

    // 递归子节点
    if (depth < maxDepth) {
      const children: Record<string, unknown>[] = [];
      node.forEachChild((child) => {
        children.push(this._nodeToJSON(child, depth + 1, maxDepth, includeText, lines));
      });
      if (children.length > 0) {
        result.children = children;
      }
    } else if (node.getChildCount() > 0) {
      result._truncated = node.getChildCount();
    }

    return result;
  }

  /** 收集 AST 顶层统计信息 */
  private _collectASTStats(sourceFile: ts.SourceFile): Record<string, number> {
    const stats: Record<string, number> = {
      totalNodes: 0,
      functions: 0,
      classes: 0,
      interfaces: 0,
      enums: 0,
      imports: 0,
      exports: 0,
      typeAliases: 0,
      variables: 0,
    };
    const walk = (node: ts.Node): void => {
      stats.totalNodes++;
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) stats.functions++;
      if (ts.isClassDeclaration(node)) stats.classes++;
      if (ts.isInterfaceDeclaration(node)) stats.interfaces++;
      if (ts.isEnumDeclaration(node)) stats.enums++;
      if (ts.isImportDeclaration(node)) stats.imports++;
      if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) stats.exports++;
      if (ts.isTypeAliasDeclaration(node)) stats.typeAliases++;
      if (ts.isVariableStatement(node)) stats.variables++;
      node.forEachChild(walk);
    };
    walk(sourceFile);
    return stats;
  }
}
