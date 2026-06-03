// ============================================================================
// @cortex/skill-kit — Loader
//
// Loads SkillDefinition from filesystem (TS/JS modules & JSON), in-memory
// objects, and JSON templates.  Composable pipeline:
//   SourceReader(s) → SkillParser(s) → SkillDefinition[]
// ============================================================================

import type { SkillDefinition, SourceReader, SkillParser, LoadResult, LoaderOptions } from './types.js';
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, resolve, relative } from 'node:path';

// ─── Default Readers ───────────────────────────────────────────────────────

class ModuleReader implements SourceReader {
  async read(path: string): Promise<string | Record<string, unknown>> {
    return readFileSync(path, 'utf-8');
  }
}

class JsonReader implements SourceReader {
  async read(path: string): Promise<string | Record<string, unknown>> {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  }
}

// ─── Default Parsers ───────────────────────────────────────────────────────

class JsonSkillParser implements SkillParser {
  parse(data: string | Record<string, unknown>): SkillDefinition | SkillDefinition[] {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    if (Array.isArray(obj)) {
      return obj.map((item) => this.parseSingle(item));
    }
    return this.parseSingle(obj);
  }

  private parseSingle(obj: Record<string, unknown>): SkillDefinition {
    const id = String(obj.id ?? obj.name ?? 'skill-unknown');
    return {
      id,
      name: String(obj.name ?? id),
      description: String(obj.description ?? ''),
      agentTypes: this.asStringArray(obj.agentTypes),
      triggerTags: this.asStringArray(obj.triggerTags),
      version: String(obj.version ?? '0.1.0'),
      author: obj.author ? String(obj.author) : undefined,
      inputSchema: obj.inputSchema as Record<string, unknown> | undefined,
      requiredContextFiles: this.asOptionalStringArray(obj.requiredContextFiles),
      execute: async () => ({
        success: true,
        output: obj,
        durationMs: 0,
        logs: [`[${id}] JSON skill executed (no-op)`],
      }),
    };
  }

  private asStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string') return [val];
    return [];
  }

  private asOptionalStringArray(val: unknown): string[] | undefined {
    if (val === undefined || val === null) return undefined;
    return this.asStringArray(val);
  }
}

// ─── Glob Matching (simple) ────────────────────────────────────────────────

/**
 * Simple glob-to-regex conversion.
 * Supports ** (match any number of dirs), * (match within a dir), ?.
 */
function globToRegex(pattern: string): RegExp {
  let src = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && i + 1 < pattern.length && pattern[i + 1] === '*') {
      // **  or  **/
      if (i + 2 < pattern.length && pattern[i + 2] === '/') {
        // **/ matches zero or more path segments followed by /
        // We make both the slash and everything before it optional
        src += '(?:.+/)?';
        i += 3;
      } else {
        // ** at end — match anything
        src += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      src += '[^/]*';
      i++;
    } else if (ch === '?') {
      src += '[^/]';
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      src += '\\' + ch;
      i++;
    } else {
      src += ch;
      i++;
    }
  }
  return new RegExp(`^${src}$`);
}

// ─── Loader ────────────────────────────────────────────────────────────────

/**
 * Loader —— 从文件系统、内存等来源加载技能定义。
 */
export class Loader {
  private readonly readers: Map<string, SourceReader> = new Map();
  private readonly parsers: Map<string, SkillParser> = new Map();
  private readonly options: Required<LoaderOptions>;
  /** Pre-compiled include regexes */
  private readonly includeRe: RegExp[];

  constructor(options: LoaderOptions = {}) {
    this.options = {
      recursive: true,
      includePatterns: ['**/*.skill.ts', '**/*.skill.js', '**/*.skill.json'],
      excludePatterns: [],
      extensions: {},
      ...options,
    };
    this.includeRe = this.options.includePatterns.map((p) => globToRegex(p));
    this.registerDefaultReaders();
    this.registerDefaultParsers();
  }

  // ─── 公开 API ───────────────────────────────────

  /**
   * 从文件系统加载技能。
   */
  async fromDirectory(baseDir: string): Promise<LoadResult> {
    const start = performance.now();
    const errors: { file: string; error: string }[] = [];
    const skills: SkillDefinition[] = [];
    const absDir = resolve(baseDir);

    const files = this.scanFiles(absDir);

    for (const filePath of files) {
      try {
        const skill = await this.fromFile(filePath);
        if (skill) {
          skills.push(skill);
        }
      } catch (err) {
        errors.push({
          file: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const durationMs = Math.round(performance.now() - start);
    return { skills, errors, durationMs };
  }

  /**
   * 从单个文件加载技能。
   */
  async fromFile(filePath: string): Promise<SkillDefinition | null> {
    const ext = extname(filePath).toLowerCase();
    const strategy = this.options.extensions?.[ext] ?? this.inferStrategy(ext);

    const reader = this.readers.get(ext);
    if (!reader) {
      throw new Error(`No reader registered for extension "${ext}"`);
    }

    const parser = this.parsers.get(strategy);
    if (!parser) {
      throw new Error(`No parser registered for strategy "${strategy}"`);
    }

    const data = await reader.read(filePath);
    const parsed = parser.parse(data);

    const result = Array.isArray(parsed) ? parsed : [parsed];
    for (const skill of result) {
      (skill as Record<string, unknown>)._sourceFile = filePath;
    }

    return result[0] ?? null;
  }

  /**
   * 从内存中的 skill 对象加载（用于测试或内存恢复）。
   */
  fromObject(skill: Record<string, unknown>): SkillDefinition {
    if (typeof skill.execute !== 'function') {
      throw new Error(
        `Skill "${skill.id ?? skill.name ?? 'unknown'}" has no execute function. ` +
        'Use fromJsonTemplate() for JSON-only definitions.',
      );
    }
    return {
      id: String(skill.id ?? 'skill-unknown'),
      name: String(skill.name ?? ''),
      description: String(skill.description ?? ''),
      agentTypes: this.asStringArray(skill.agentTypes),
      triggerTags: this.asStringArray(skill.triggerTags),
      version: String(skill.version ?? '0.1.0'),
      author: skill.author ? String(skill.author) : undefined,
      inputSchema: skill.inputSchema as Record<string, unknown> | undefined,
      requiredContextFiles: this.asOptionalStringArray(skill.requiredContextFiles),
      onInit: typeof skill.onInit === 'function' ? skill.onInit : undefined,
      onDestroy: typeof skill.onDestroy === 'function' ? skill.onDestroy : undefined,
      validateInput: typeof skill.validateInput === 'function' ? skill.validateInput : undefined,
      buildContext: typeof skill.buildContext === 'function' ? skill.buildContext : undefined,
      execute: skill.execute as (ctx: any) => Promise<any>,
    };
  }

  /**
   * 从 JSON 模板（SkillTemplate 格式）加载。
   * 提供与现有 skills/*.json 系统的向后兼容。
   */
  fromJsonTemplate(template: Record<string, unknown>): SkillDefinition {
    const parser = new JsonSkillParser();
    const result = parser.parse(template);
    return Array.isArray(result) ? result[0] : result;
  }

  // ─── 扩展点 ─────────────────────────────────────

  registerReader(extension: string, reader: SourceReader): void {
    this.readers.set(extension.startsWith('.') ? extension : `.${extension}`, reader);
  }

  registerParser(format: string, parser: SkillParser): void {
    this.parsers.set(format, parser);
  }

  // ─── 内部方法 ───────────────────────────────────

  private inferStrategy(ext: string): string {
    if (ext === '.json') return 'json';
    if (ext === '.ts' || ext === '.js' || ext === '.mjs') return 'module';
    return 'json';
  }

  private scanFiles(baseDir: string): string[] {
    const results: string[] = [];
    this.collectFiles(baseDir, baseDir, results);
    return results;
  }

  private collectFiles(baseDir: string, dir: string, results: string[]): void {
    if (!existsSync(dir)) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (this.options.recursive && !entry.startsWith('.')) {
          this.collectFiles(baseDir, fullPath, results);
        }
        continue;
      }

      if (stats.isFile()) {
        // Relative path from scan root, using forward slashes
        const rel = relative(baseDir, fullPath).replace(/\\/g, '/');
        const matched = this.includeRe.some((re) => re.test(rel));
        if (matched) {
          results.push(fullPath);
        }
      }
    }
  }

  private registerDefaultReaders(): void {
    this.readers.set('.ts', new ModuleReader());
    this.readers.set('.js', new ModuleReader());
    this.readers.set('.json', new JsonReader());
  }

  private registerDefaultParsers(): void {
    this.parsers.set('json', new JsonSkillParser());
    this.parsers.set('module', new JsonSkillParser());
  }

  private asStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string') return [val];
    return [];
  }

  private asOptionalStringArray(val: unknown): string[] | undefined {
    if (val === undefined || val === null) return undefined;
    return this.asStringArray(val);
  }
}
