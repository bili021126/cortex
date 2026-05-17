/**
 * commands/repl.ts — `cortex repl` REPL 交互模式
 *
 * 进入交互式 REPL 会话。支持持久化会话上下文、
 * 历史命令记录、Tab 补全、内部命令。
 *
 * @see CLI 设计文档 §4.14
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { CommandRegistry } from "./index.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import { getFormatter, detectDefaultFormat } from "../formatters/index.js";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export function createReplHandler(
  registry: CommandRegistry,
  bridge: EngineBridge,
): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    const dbPath = options["db"] as string | undefined;
    const agentType = options["agent"] as string | undefined;
    const promptStr = (options["prompt"] as string) ?? "cortex> ";
    const noHistory = options["no-history"] as boolean;
    const initFile = options["init"] as string | undefined;
    const historyFile = path.join(os.homedir(), ".cortex", "repl-history");

    let replFormat = detectDefaultFormat();
    let running = true;

    console.log(`🧠 Cortex REPL (v0.2.0, Core-1)`);
    console.log(`   输入 .help 查看内部命令，Ctrl+C 或 .exit 退出\n`);

    // 初始化引擎
    await bridge.ensureInitialized();

    // 加载初始化脚本
    if (initFile) {
      try {
        const initContent = fs.readFileSync(path.resolve(initFile), "utf-8");
        for (const line of initContent.split("\n").filter((l) => l.trim() && !l.startsWith("#"))) {
          console.log(`> ${line}`);
          const result = await registry.dispatch(line.trim().split(/\s+/), {
            ...context,
            format: replFormat,
          });
          const fmt = getFormatter(replFormat);
          console.log(result.success ? fmt.formatSuccess(result) : fmt.formatError(result));
        }
      } catch (err) {
        console.error(`初始化脚本加载失败: ${err}`);
      }
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: promptStr,
    });

    if (!noHistory && fs.existsSync(historyFile)) {
      try {
        const history = fs.readFileSync(historyFile, "utf-8").split("\n").filter(Boolean);
        (rl as any).history = history.slice(-100); // 最多 100 条
      } catch { /* 忽略 */ }
    }

    rl.on("line", async (line: string) => {
      const trimmed = line.trim();

      // ── 空行 ──
      if (!trimmed) {
        rl.prompt();
        return;
      }

      // ── 内部命令 ──
      if (trimmed.startsWith(".")) {
        const handled = handleInternalCommand(trimmed, {
          rl, promptStr, historyFile, noHistory,
          setFormat: (f) => { replFormat = f; },
          stop: () => { running = false; rl.close(); },
        });
        if (!running) return;
        rl.prompt();
        return;
      }

      // ── 执行 cortex 命令 ──
      try {
        const args = trimmed.split(/\s+/);
        const result = await registry.dispatch(args, {
          ...context,
          format: replFormat,
        });
        const fmt = getFormatter(replFormat);
        console.log(result.success ? fmt.formatSuccess(result) : fmt.formatError(result));
      } catch (err) {
        console.error(`执行错误: ${err}`);
      }

      rl.prompt();
    });

    rl.on("close", () => {
      if (running) {
        console.log("\n再见！");
        // 保存历史
        if (!noHistory) {
          try {
            const dir = path.dirname(historyFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const history = (rl as any).history?.slice(-100) ?? [];
            fs.writeFileSync(historyFile, history.join("\n"), "utf-8");
          } catch { /* 忽略 */ }
        }
      }
    });

    rl.prompt();

    // 保持进程运行直到用户退出
    return new Promise(() => {
      rl.on("close", () => {
        bridge.shutdown();
        process.exit(0);
      });
    });
  };
}

interface ReplContext {
  rl: readline.Interface;
  promptStr: string;
  historyFile: string;
  noHistory: boolean;
  setFormat: (f: "text" | "json" | "color") => void;
  stop: () => void;
}

function handleInternalCommand(input: string, ctx: ReplContext): boolean {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case ".help":
      console.log([
        "REPL 内部命令:",
        "  .help                  显示此帮助",
        "  .history               显示命令历史",
        "  .clear                 清屏",
        "  .exit / .quit          退出 REPL",
        "  .output <fmt>          切换输出格式 (text/json/color)",
        "  .save <file>           保存会话记录",
        "",
        "所有不以 '.' 开头的输入将被当作 cortex 命令执行。",
        "示例: run README.md -o output.html",
      ].join("\n"));
      return true;

    case ".history": {
      const history = (ctx.rl as any).history ?? [];
      console.log(history.map((h: string, i: number) => `  ${i + 1}  ${h}`).join("\n") || "  (空)");
      return true;
    }

    case ".clear":
      console.clear();
      return true;

    case ".exit":
    case ".quit":
      console.log("再见！");
      ctx.stop();
      return true;

    case ".output": {
      const fmt = parts[1] as string;
      if (fmt === "text" || fmt === "json" || fmt === "color") {
        ctx.setFormat(fmt);
        console.log(`输出格式已切换为: ${fmt}`);
      } else {
        console.log(`未知格式: "${fmt}"。可用: text, json, color`);
      }
      return true;
    }

    case ".save": {
      const filePath = parts[1];
      if (!filePath) {
        console.log("请指定文件路径。用法: .save <file>");
        return true;
      }
      try {
        const history = (ctx.rl as any).history ?? [];
        const content = history.join("\n");
        fs.writeFileSync(path.resolve(filePath), content, "utf-8");
        console.log(`会话已保存: ${filePath}`);
      } catch (err) {
        console.error(`保存失败: ${err}`);
      }
      return true;
    }

    default:
      console.log(`未知内部命令: "${cmd}"。输入 .help 查看可用命令。`);
      return true;
  }
}
