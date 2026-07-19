import type { IFileSystemAdapter, DirectoryEntry } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * NodeFileSystemAdapter —— IFileSystemAdapter 的 Node.js 实现。
 *
 * 使用 node:fs 和 node:child_process 提供的原生 API。
 * 所有方法同步执行（Node.js 文件系统 API 原生同步），返回 Promise 以符合接口契约。
 *
 * @since v2.1 纳西妲增强建议：CLI 框架抽象——解耦 Toolkit 与 Node.js 原生 API。
 * @usedBy Toolkit 作为默认文件系统适配器。
 */
export class NodeFileSystemAdapter implements IFileSystemAdapter {
  readonly sep: string = path.sep;

  async readFile(filePath: string): Promise<string> {
    return fs.readFileSync(filePath, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    if (process.env["CORTEX_DEBUG"] === "1") {
      // eslint-disable-next-line no-console
      console.log(`[TRACE write_file] adapter.writeFile: path=${filePath} contentLength=${content.length}`);
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
  }

  async exists(filePath: string): Promise<boolean> {
    return fs.existsSync(filePath);
  }

  async mkdir(dirPath: string): Promise<void> {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  async unlink(filePath: string): Promise<void> {
    fs.unlinkSync(filePath);
  }

  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
  }

  async stat(filePath: string): Promise<{ isFile: boolean; isDirectory: boolean }> {
    const s = fs.statSync(filePath);
    return { isFile: s.isFile(), isDirectory: s.isDirectory() };
  }

  async execCommand(command: string, options?: { cwd?: string; timeout?: number }): Promise<string> {
    // 明确指定 shell 防止隐式 shell 选择带来的注入风险
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "/bin/sh";
    const shellArgs = isWin ? ["/c", command] : ["-c", command];
    const timeout = options?.timeout ?? 60_000;
    return execFileSync(shell, shellArgs, {
      cwd: options?.cwd,
      encoding: "utf-8",
      timeout,
      maxBuffer: 5 * 1024 * 1024,
    });
  }

  async execFile(filePath: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<string> {
    return execFileSync(filePath, args, {
      cwd: options?.cwd,
      encoding: "utf-8",
      timeout: options?.timeout ?? 15_000,
    });
  }

  cwd(): string {
    return process.cwd();
  }

  resolve(...paths: string[]): string {
    return path.resolve(...paths);
  }
}
