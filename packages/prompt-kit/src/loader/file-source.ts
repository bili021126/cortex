/**
 * @cortex/prompt-kit — 文件系统 Prompt 来源
 *
 * 从 prompts/ 目录按约定加载 PromptTemplate。
 * 文件 → PromptTemplate 映射规则：
 *   prompts/<agent>/system.md  → templateId: "<agent>-system"
 *   prompts/<agent>/identity.md → templateId: "<agent>-identity"
 *   prompts/shared/identity-anchor.md → templateId: "shared-identity-anchor"
 *
 * @see DESIGN.md §3.1 文件加载规则
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, basename, extname } from "node:path";
import { DIR_PROMPTS } from "@cortex/config";
import { PromptBlockType, type PromptTemplate, type PromptBlock, PromptErrorCode } from "../types.js";
import { PromptError } from "../errors.js";
import type { PromptSource } from "./prompt-loader.js";

/**
 * 文件来源选项。
 */
export interface FilePromptSourceOptions {
  /** 项目根目录（默认 process.cwd()） */
  baseDir?: string;
  /** prompts 目录名（默认 "prompts"） */
  promptsDir?: string;
}

/**
 * 文件名 → PromptBlockType 映射规则。
 * 用于从文件名自动推导块类型。
 */
const FILE_TYPE_MAP: Record<string, PromptBlockType> = {
  "system": PromptBlockType.Instruction,
  "identity": PromptBlockType.Identity,
  "persona": PromptBlockType.Persona,
  "roundtable": PromptBlockType.Persona,
  "context": PromptBlockType.Context,
  "format": PromptBlockType.OutputFormat,
  "example": PromptBlockType.Example,
  "private": PromptBlockType.Private,
};

/**
 * FilePromptSource —— 文件系统 Prompt 来源。
 *
 * 约定优于配置：
 * - prompts/<agent-type>/system.md → 模板 ID = "<agent-type>-system"
 * - prompts/<agent-type>/identity.md → 模板 ID = "<agent-type>-identity"
 * - prompts/shared/identity-anchor.md → 模板 ID = "shared-identity-anchor"
 *
 * 各文件作为独立模板，也自动聚合为 agent 级模板（合并所有块）。
 */
export class FilePromptSource implements PromptSource {
  private baseDir: string;
  private promptsDir: string;
  /** 内部索引：templateId → filePath */
  private index: Map<string, string> = new Map();
  /** 是否已扫描 */
  private scanned = false;

  constructor(options: FilePromptSourceOptions = {}) {
    this.baseDir = options.baseDir ?? process.cwd();
    this.promptsDir = options.promptsDir ?? DIR_PROMPTS;
  }

  /**
   * 按模板 ID 加载。
   * 支持两种 ID 格式：
   * - "nahida-system" → 加载 prompts/nahida/system.md
   * - "shared-identity-anchor" → 加载 prompts/shared/identity-anchor.md
   */
  async load(templateId: string): Promise<PromptTemplate | null> {
    await this.ensureIndex();

    const filePath = this.index.get(templateId);
    if (!filePath) {
      return null;
    }

    return this.parseFile(filePath, templateId);
  }

  /**
   * 列出所有可用模板 ID。
   */
  async list(): Promise<string[]> {
    await this.ensureIndex();
    return Array.from(this.index.keys());
  }

  /**
   * 刷新文件索引。
   */
  refreshIndex(): void {
    this.scanned = false;
    this.index.clear();
  }

  /**
   * 确保索引已构建。
   */
  private async ensureIndex(): Promise<void> {
    if (this.scanned) return;
    this.scanDirectory();
    this.scanned = true;
  }

  /**
   * 扫描 prompts 目录构建索引。
   */
  private scanDirectory(): void {
    const promptsPath = resolve(this.baseDir, this.promptsDir);
    if (!existsSync(promptsPath)) {
      return; // prompts 目录不存在，空索引
    }

    this.scanRecursive(promptsPath, promptsPath);
  }

  /**
   * 递归扫描目录。
   */
  private scanRecursive(currentPath: string, basePath: string): void {
    const entries = readdirSync(currentPath);

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        this.scanRecursive(fullPath, basePath);
      } else if (stats.isFile() && (entry.endsWith(".md") || entry.endsWith(".txt"))) {
        // 计算相对路径：prompts/<dir>/<file>.md
        const relPath = relative(basePath, fullPath);
        // 去掉扩展名，将路径分隔符替换为 "-"
        const templateId = relPath
          .replace(/\.(md|txt)$/, "")
          .replace(/[/\\]/g, "-")
          .toLowerCase();
        this.index.set(templateId, fullPath);
      }
    }
  }

  /**
   * 解析单个文件为 PromptTemplate。
   */
  private parseFile(filePath: string, templateId: string): PromptTemplate {
    if (!existsSync(filePath)) {
      throw new PromptError(
        `文件不存在: ${filePath}`,
        PromptErrorCode.LOAD_FAILED,
        { filePath, templateId },
      );
    }

    const content = readFileSync(filePath, "utf-8");
    const fileName = basename(filePath, extname(filePath));
    const blockType = FILE_TYPE_MAP[fileName] ?? PromptBlockType.Instruction;

    // 从路径推导 agent 名称
    const relativePath = relative(resolve(this.baseDir, this.promptsDir), filePath);
    const pathParts = relativePath.replace(/\\/g, "/").split("/");
    const agentName = pathParts.length > 1 ? pathParts[0] : "shared";

    const block: PromptBlock = {
      id: templateId,
      type: blockType,
      content,
      priority: this.getDefaultPriority(blockType),
      metadata: {
        filePath,
        agentName,
      },
    };

    return {
      id: templateId,
      name: templateId,
      version: "1.0.0",
      blocks: [block],
      tags: [agentName!],
      source: filePath,
    };
  }

  /**
   * 获取块类型的默认优先级。
   */
  private getDefaultPriority(type: PromptBlockType): number {
    switch (type) {
      case PromptBlockType.Identity: return 10;
      case PromptBlockType.Persona: return 20;
      case PromptBlockType.Context: return 30;
      case PromptBlockType.Instruction: return 40;
      case PromptBlockType.OutputFormat: return 50;
      case PromptBlockType.Example: return 60;
      case PromptBlockType.Private: return 100;
      default: return 50;
    }
  }
}
