/**
 * @cortex/skill-kit — 动态技能加载器
 *
 * 基于 dynamic import() 实现 .ts / .js / .json 技能模块的加载。
 * 使用 tsx 运行时编译 .ts 文件，确保在 Node.js ESM 环境下可运行。
 *
 * @see docs/design.md §5 动态加载机制
 */

import { readFileSync, existsSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type SkillDefinition,
  type SkillLoader,
  type SkillMeta,
  type SkillManifest,
  SkillCategory,
} from "./types.js";

// ============================================================
// DynamicImportLoader — 基于 dynamic import() 的技能加载器
// ============================================================

export interface DynamicImportLoaderOptions {
  /** 基础目录（用于解析相对路径），默认 process.cwd() */
  baseDir?: string;
  /** 是否自动将 .json 技能标记为已初始化 */
  autoInitJsonSkills?: boolean;
}

/**
 * DynamicImportLoader —— 基于 dynamic import() 的技能加载器。
 *
 * 加载策略：
 * - .ts 文件：通过 tsx 注册的 loader 实现 dynamic import() 加载 TypeScript 模块
 * - .json 文件：import() 会自动解析为对象，或 fallback 到 fs.readFile + JSON.parse
 * - .js 文件：原生 dynamic import() 支持
 *
 * 路径解析：
 * - 相对路径：相对于 baseDir 目录
 * - 绝对路径：直接使用
 * - 模块名：通过注册表映射表查找
 */
export class DynamicImportLoader implements SkillLoader {
  /** skillId → filePath 映射表 */
  private registry: Map<string, string> = new Map();

  /** 基础目录 */
  private baseDir: string;

  constructor(options: DynamicImportLoaderOptions = {}) {
    this.baseDir = options.baseDir ?? process.cwd();
  }

  /**
   * 按技能 ID 加载。
   * 通过注册的映射表查找技能入口路径，然后调用 loadFromFile。
   */
  async load(skillId: string): Promise<SkillDefinition> {
    const filePath = this.registry.get(skillId);
    if (!filePath) {
      throw new Error(
        `[DynamicImportLoader] 技能 "${skillId}" 未注册。请先调用 register() 注册入口路径。`,
      );
    }
    return this.loadFromFile(filePath);
  }

  /**
   * 从文件路径加载技能。
   *
   * 根据文件后缀决定加载策略：
   * - .ts  → dynamic import()（通过 tsx 运行时编译）
   * - .js  → dynamic import()
   * - .json → fs.readFile + JSON.parse → 适配为 SkillDefinition
   */
  async loadFromFile(filePath: string): Promise<SkillDefinition> {
    const resolvedPath = this.resolvePath(filePath);
    const ext = extname(resolvedPath).toLowerCase();

    switch (ext) {
      case ".ts":
      case ".js":
        return this.loadTsModule(resolvedPath);
      case ".json":
        return this.loadJsonSkill(resolvedPath);
      default:
        throw new Error(
          `[DynamicImportLoader] 不支持的文件格式 "${ext}"：${filePath}`,
        );
    }
  }

  /**
   * 注册技能入口路径。
   */
  register(skillId: string, filePath: string): void {
    this.registry.set(skillId, filePath);
  }

  /**
   * 批量注册技能入口。
   */
  registerMany(entries: Array<{ id: string; path: string }>): void {
    for (const entry of entries) {
      this.register(entry.id, entry.path);
    }
  }

  /**
   * 获取已注册的技能 ID 列表。
   */
  getRegisteredIds(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * 获取注册表副本（用于序列化）。
   */
  getRegistrySnapshot(): Array<{ id: string; path: string }> {
    return Array.from(this.registry.entries()).map(([id, path]) => ({
      id,
      path,
    }));
  }

  // ── 内部方法 ──────────────────────────────────────────────

  /**
   * 解析文件路径：相对路径 → 绝对路径。
   */
  private resolvePath(filePath: string): string {
    if (isAbsolute(filePath)) {
      return filePath;
    }
    return resolve(this.baseDir, filePath);
  }

  /**
   * 通过 dynamic import() 加载 .ts / .js 模块。
   *
   * 使用 pathToFileURL 确保 Windows 路径正确转换为 file:// URL。
   * Node.js ESM 的 import() 要求使用 URL 或绝对路径。
   */
  private async loadTsModule(filePath: string): Promise<SkillDefinition> {
    const fileUrl = pathToFileURL(filePath).href;

    try {
      const mod = await import(fileUrl);

      // 提取 default export
      const skill: SkillDefinition | undefined = mod.default ?? mod.skill;

      if (!skill) {
        throw new Error(
          `模块 "${filePath}" 未导出 default 导出。请确保使用 "export default skill" 导出 SkillDefinition。`,
        );
      }

      // 运行时类型守卫：检查是否具备 SkillDefinition 的必要字段
      if (!skill.meta || typeof skill.execute !== "function") {
        throw new Error(
          `模块 "${filePath}" 导出的对象不是有效的 SkillDefinition：缺少 meta 或 execute 字段。`,
        );
      }

      return skill;
    } catch (cause) {
      throw new Error(
        `[DynamicImportLoader] 加载模块失败：${filePath}`,
        { cause },
      );
    }
  }

  /**
   * 加载 JSON 技能文件并适配为 SkillDefinition。
   *
   * JSON 技能没有自定义 execute 实现——执行时由包装器
   * 将 steps 作为 prompt 注入 LLM 上下文执行。
   * 此处返回的 execute 函数将 steps 格式化为 prompt 文本。
   */
  private loadJsonSkill(filePath: string): SkillDefinition {
    if (!existsSync(filePath)) {
      throw new Error(`[DynamicImportLoader] JSON 技能文件不存在：${filePath}`);
    }

    let manifest: SkillManifest;

    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;

      // 校验必要的 JSON 字段
      this.ensureJsonFields(parsed, filePath);

      manifest = parsed as unknown as SkillManifest;
    } catch (cause) {
      if (cause instanceof SyntaxError) {
        throw new Error(
          `[DynamicImportLoader] JSON 技能文件格式错误：${filePath}`,
          { cause },
        );
      }
      throw cause;
    }

    return this.adaptManifest(manifest);
  }

  /**
   * 校验 JSON 技能清单的必要字段。
   */
  private ensureJsonFields(
    parsed: Record<string, unknown>,
    filePath: string,
  ): void {
    const requiredFields = ["id", "name", "triggerTags", "trigger", "steps", "expectedOutput"] as const;
    const missing = requiredFields.filter((field) => !(field in parsed));

    if (missing.length > 0) {
      throw new Error(
        `[DynamicImportLoader] JSON 技能文件缺少必要字段 [${missing.join(", ")}]：${filePath}`,
      );
    }

    if (!Array.isArray(parsed.triggerTags)) {
      throw new Error(
        `[DynamicImportLoader] JSON 技能文件的 triggerTags 必须为数组：${filePath}`,
      );
    }

    if (!Array.isArray(parsed.steps)) {
      throw new Error(
        `[DynamicImportLoader] JSON 技能文件的 steps 必须为数组：${filePath}`,
      );
    }
  }

  /**
   * 将 JSON 技能清单适配为完整的 SkillDefinition。
   *
   * JSON 技能适配策略：
   * - meta: 从 JSON 字段映射
   * - execute: 注入式执行——将 steps 格式化为 prompt 文本
   * - validateInput: 基于 inputSchema 的 JSON Schema 校验（如果有）
   */
  private adaptManifest(manifest: SkillManifest): SkillDefinition {
    const meta = this.manifestToMeta(manifest);

    const skill: SkillDefinition = {
      meta,
      async execute(ctx) {
        // JSON 技能的执行是将 steps 以 prompt 形式注入
        // 实际由 LLM Agent 理解执行，此处返回 prompt 文本
        const prompt = [
          `## 技能：${meta.name}`,
          `**描述**：${meta.description}`,
          ``,
          `### 输入参数`,
          ctx.input ? JSON.stringify(ctx.input, null, 2) : "（无输入）",
          ``,
          `### 执行步骤`,
          ...meta.steps.map((step, i) => `${i + 1}. ${step}`),
          ``,
          `### 预期产出`,
          meta.expectedOutput,
        ].join("\n");

        return {
          success: true,
          data: { prompt } as never,
        };
      },
    };

    // 如果有 inputSchema，使用简单的类型守卫校验
    if (meta.inputSchema) {
      skill.validateInput = function (input: unknown): input is unknown {
        if (typeof input !== "object" || input === null) {
          return false;
        }
        return true;
      };
    }

    return skill;
  }

  /**
   * 将 SkillManifest 转换为 SkillMeta。
   */
  private manifestToMeta(manifest: SkillManifest): SkillMeta {
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version ?? "0.1.0",
      description: `${manifest.trigger} → ${manifest.expectedOutput}`,
      category: manifest.category ?? SkillCategory.TOOL,
      triggerTags: manifest.triggerTags,
      trigger: manifest.trigger,
      steps: manifest.steps,
      expectedOutput: manifest.expectedOutput,
      author: manifest.discoveredBy,
      createdAt: manifest.createdAt,
    };
  }
}
