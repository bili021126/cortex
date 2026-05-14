// ============================================================
// @cortex/shared — 文件系统适配器抽象层
//
// @file-overview
// 定义 IFileSystemAdapter 接口，抽象文件系统操作。
// Toolkit 通过此接口执行文件读写、目录遍历、Shell 命令，而非直接调用 Node.js API。
//
// 设计动机（纳西妲架构分析 SPV-5）：
// Toolkit 直接调用 execSync/execFileSync/readFileSync/writeFileSync 等 Node.js API，
// 在 Electron/Web 环境下不可用。引入适配器接口后：
// - Node 平台：NodeFileSystemAdapter（当前默认实现，使用 node:fs/node:child_process）
// - Electron 平台：ElectronFileSystemAdapter（通过 IPC 委托到主进程）
// - Web 平台：WebFileSystemAdapter（通过 OPFS/HTTP 后端）
//
// @contract 接口稳定性承诺
// - 此接口所有方法均为 async（Node.js 同步 API 由适配器内部 Promise.resolve 包装）
// - 路径参数均为绝对路径字符串（平台路径格式由适配器处理）
// - 错误通过 Error 对象传播，适配器不应吞没异常
// ============================================================

// ─── 目录条目 ──────────────────────────────────────────────

/** 目录条目——listDirectory 的返回元素 */
export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

// ─── 文件系统适配器接口 ────────────────────────────────────

/**
 * IFileSystemAdapter —— 文件系统操作抽象接口。
 *
 * @since v2.1 引入，用于解耦 Toolkit 与 Node.js 原生 API。
 * @usedBy Toolkit (engine/src/toolkit.ts)
 */
export interface IFileSystemAdapter {
  /** 读取文件内容（UTF-8） */
  readFile(filePath: string): Promise<string>;

  /** 写入文件内容（UTF-8） */
  writeFile(filePath: string, content: string): Promise<void>;

  /** 检查文件/目录是否存在 */
  exists(filePath: string): Promise<boolean>;

  /** 创建目录（含父目录） */
  mkdir(dirPath: string): Promise<void>;

  /** 删除文件 */
  unlink(filePath: string): Promise<void>;

  /** 列出目录内容 */
  listDirectory(dirPath: string): Promise<DirectoryEntry[]>;

  /** 获取文件状态信息（主要用于判断是文件还是目录） */
  stat(filePath: string): Promise<{ isFile: boolean; isDirectory: boolean }>;

  /** 执行 Shell 命令，返回 stdout */
  execCommand(command: string, options?: { cwd?: string; timeout?: number }): Promise<string>;

  /** 执行可执行文件，返回 stdout */
  execFile(filePath: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<string>;

  /** 获取当前工作目录 */
  cwd(): string;

  /** 解析路径为绝对路径 */
  resolve(...paths: string[]): string;

  /** 获取路径分隔符 */
  sep: string;
}
