import type { ToolInvocation, ToolResult, ToolDefinition, ToolHandler, ReversibilityLevel, AgentType } from "@cortex/shared";
import { ToolCategory, ReversibilityLevel as RL, AGENT_TOOL_PERMISSIONS } from "@cortex/shared";
import type { ConfirmGate } from "./confirm-gate.js";
import type { FileLockManager } from "./file-lock-manager.js";
import { LockType } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, execFileSync } from "node:child_process";

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
};

/**
 * Toolkit —— 工具执行引擎。
 * Agent 通过此层调用工具（read_file / write_file / search_code / run_shell 等）。
 * 回执经 ConfirmGate 判定后才实际执行。
 */
export class Toolkit {
  private tools = new Map<string, ToolHandler>();
  private gate?: ConfirmGate;
  private lockManager?: FileLockManager;
  private workspaceRoot: string | null = null;

  constructor(gate?: ConfirmGate, lockManager?: FileLockManager) {
    this.gate = gate;
    this.lockManager = lockManager;
    this._registerBuiltins();
  }

  /** 设置工作区根目录，所有文件操作路径将以此为沙箱根目录 */
  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
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
    const allowed = AGENT_TOOL_PERMISSIONS[callerType] ?? [];
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
      const approved = await this.gate.waitFor(reqId, 5 * 60 * 1000);
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
    const allowed = AGENT_TOOL_PERMISSIONS[callerType] ?? [];
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
      return path.resolve(filePath);
    }
    const resolved = path.resolve(filePath);
    const root = this.workspaceRoot;
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      return resolved;
    }
    throw new Error(`路径越界: "${filePath}" 不在工作区 "${root}" 内`);
  }

  // ── 内置工具注册 ─────────────────────────────

  private _registerBuiltins(): void {
    this.tools.set("read_file", async (params) => {
      const filePath = this._resolvePath(params.file_path as string);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `文件不存在: ${filePath}` };
      }
      try {
        const content = fs.readFileSync(filePath, "utf-8");
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
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, "utf-8");
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
        const searchRoot = this.workspaceRoot ?? process.cwd();
        // 用 ripgrep 搜索，不可用时退回 Node.js 原生
        let output: string;
        try {
          output = execFileSync(
            "rg",
            ["--line-number", "--max-count", "30", "--no-heading", query],
            { cwd: searchRoot, encoding: "utf-8", timeout: 15_000 },
          );
        } catch (e) {
          // rg 非零退出码区分：
          //   exit 1 = 无匹配结果（正常，rg 语义如此）→ 返回空
          //   exit 2 = 真错误（rg 未安装/权限拒绝/正则非法）→ 退回 grep 降级
          //   其他 = 超时/spawn 失败 → 退回 grep 降级
          const err = e as { status?: number; stderr?: unknown };
          const stderr = err.stderr?.toString() ?? "";
          if (err.status === 1) {
            // 无匹配，rg 正常工作
            output = "";
          } else {
            console.warn(
              `[toolkit] search_code: rg failed (exit ${err.status ?? "?"}), falling back to grep. stderr: ${stderr.slice(0, 200)}`,
            );
            output = this._grepFallback(searchRoot, query);
          }
        }
        if (!output.trim()) {
          return { success: true, output: `未找到匹配 "${query}" 的结果` };
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
        const cwd = this.workspaceRoot ?? process.cwd();
        const output = execSync(command, {
          cwd,
          encoding: "utf-8",
          timeout: 60_000,
          maxBuffer: 5 * 1024 * 1024, // 5MB
        });
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
        : (this.workspaceRoot ?? process.cwd());
      if (!fs.existsSync(dirPath)) {
        return { success: false, error: `目录不存在: ${dirPath}` };
      }
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const pattern = params.pattern as string | undefined;
        let listing = entries
          .map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`)
          .join("\n");
        if (pattern) {
          // 简单 glob 过滤
          const regex = new RegExp(
            "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
          );
          listing = entries
            .filter((e) => regex.test(e.name))
            .map((e) => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`)
            .join("\n");
        }
        return { success: true, output: listing || "(空目录)" };
      } catch (e) {
        return { success: false, error: `列目录失败: ${String(e)}` };
      }
    });

    this.tools.set("delete_file", async (params) => {
      const filePath = this._resolvePath(params.file_path as string);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `文件不存在: ${filePath}` };
      }
      try {
        fs.unlinkSync(filePath);
        return { success: true, output: `已删除 ${filePath}` };
      } catch (e) {
        return { success: false, error: `删除失败: ${String(e)}` };
      }
    });
  }

  /** 简易 grep 回退（rg 不可用时的纯 Node.js 文本搜索） */
  private _grepFallback(rootDir: string, query: string): string {
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();
    const walk = (dir: string, depth: number) => {
      if (depth > 4 || results.length > 30) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { console.warn(`[toolkit] readdir failed for ${dir}: ${String(e)}`); return; }
      for (const entry of entries) {
        if (results.length >= 30) return;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
            walk(fullPath, depth + 1);
          }
        } else if (entry.isFile() && /\.(ts|js|json|md|html|css)$/.test(entry.name)) {
          try {
            const lines = fs.readFileSync(fullPath, "utf-8").split("\n");
            for (let i = 0; i < lines.length && results.length < 30; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                const relPath = path.relative(rootDir, fullPath);
                results.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              }
            }
          } catch (e) { console.warn(`[toolkit] skip unreadable file ${fullPath}: ${String(e)}`); }
        }
      }
    };
    walk(rootDir, 0);
    return results.join("\n");
  }
}
