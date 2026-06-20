/**
 * @cortex/plugin-runner — 插件注册表模块
 *
 * 管理二级插件的注册、发现、依赖解析。
 * 使用 Registry 模式：按名称/标签/glob 路径发现和注册插件。
 *
 * 依赖倒置：PluginRegistry 依赖 Plugin 接口（types.ts），
 * 不依赖具体插件实现。调用方负责提供符合 Plugin 接口的实例。
 *
 * # 核心职责
 *
 * 1. **注册/注销** — 按 name 管理插件实例的生命周期
 * 2. **查询检索** — 按名称、标签、自定义过滤函数查找
 * 3. **文件发现** — 通过 glob 模式扫描文件系统，动态导入并识别插件
 * 4. **依赖排序** — Kahn 算法拓扑排序，返回无依赖冲突的执行批次
 *
 * # 使用示例
 *
 * ```ts
 * const registry = new PluginRegistry();
 *
 * // 手动注册
 * registry.register(myPlugin);
 *
 * // 从文件发现并注册
 * await registry.registerFromGlob("./plugins/**\/*.plugin.{js,ts}");
 *
 * // 查询
 * const meta = registry.getMeta("my-plugin");
 * const tagged = registry.findByTag("transformer");
 *
 * // 拓扑排序（按依赖关系分批次）
 * const batches = registry.resolveDependencies();
 * ```
 */

import { readdir, stat as fsStat } from "node:fs/promises";
import {
  join,
  dirname,
  basename,
  relative,
  isAbsolute,
  resolve,
  normalize,
} from "node:path";
import { pathToFileURL } from "node:url";

import type { Plugin, PluginMeta } from "./types.js";
import { isPlugin } from "./plugin.js";

// ── 内部类型 ──

/** glob 匹配结果项 */
interface GlobMatch {
  /** 匹配文件的绝对路径 */
  filePath: string;
  /** 相对于 glob 基路径的路径 */
  relativePath: string;
}

// ── Glob 模式匹配引擎（零外部依赖） ──

/**
 * 将 glob 模式编译为正则表达式。
 *
 * 支持的通配符：
 * - 双星号 (**)  — 匹配零或多层目录（必须独占一个路径段，即 ** 后接 /，或 /* 后接 *）
 * - 单星号 (*)   — 匹配单段内零或多个字符（不跨目录）
 * - 问号 (?)   — 匹配单段内单个字符（不跨目录）
 * - 花括号 ({a,b}) — 匹配多个备选项（仅顶层，不支持嵌套）
 */
function globToRegex(pattern: string): RegExp {
  // 规范化路径分隔符为 /
  const normalized = pattern.replace(/\\/g, "/");

  // 处理 {a,b} 展开 — 简单版本（不支持嵌套）
  const braceMatch = normalized.match(/{([^}]+)}/);
  if (braceMatch) {
    const alternatives = braceMatch[1].split(",").map((s) => s.trim());
    const prefix = normalized.slice(0, braceMatch.index);
    if (braceMatch.index === undefined) {
      throw new Error("globToRegex: brace match has no index");
    }
    const suffix = normalized.slice(braceMatch.index + braceMatch[0].length);
    const altPatterns = alternatives.map(
      (alt) => `${prefix}${alt}${suffix}`,
    );
    return new RegExp(
      `^(?:${altPatterns.map((p) => globToRegexSource(p)).join("|")})$`,
      "i",
    );
  }

  return new RegExp(`^${globToRegexSource(normalized)}$`, "i");
}

/**
 * 将单个 glob 模式转换为正则表达式源字符串（不含 ^$ 边界）。
 */
function globToRegexSource(pattern: string): string {
  let source = "";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*" && pattern[i + 1] === "*") {
      // ** 匹配零或多个路径段
      source += "(?:.+[/\\\\])?.*";
      // 跳过后续的 /（如果有）
      if (pattern[i + 2] === "/" || pattern[i + 2] === "\\") {
        i += 3;
      } else {
        i += 2;
      }
    } else if (ch === "*") {
      // 单段通配（不跨目录）
      source += "[^/\\\\]*";
      i += 1;
    } else if (ch === "?") {
      source += "[^/\\\\]";
      i += 1;
    } else if (ch === ".") {
      source += "\\.";
      i += 1;
    } else if (ch === "/" || ch === "\\") {
      source += "[/\\\\]";
      i += 1;
    } else {
      // 转义正则特殊字符
      const specials = /[.+^${}()|[\]\\]/;
      if (specials.test(ch)) {
        source += `\\${ch}`;
      } else {
        source += ch;
      }
      i += 1;
    }
  }

  return source;
}

/**
 * 解析 glob 模式为基路径和相对模式部分。
 *
 * 例如: `"./plugins/**\/*.plugin.js"` →
 * `{ basePath: "/abs/project/plugins", pattern: "**\/*.plugin.js" }`
 *
 * 例如: `"./plugins/my-plugin.js"` →
 * `{ basePath: "/abs/project/plugins", pattern: "my-plugin.js" }`
 */
function parseGlobPattern(
  globPattern: string,
): { basePath: string; pattern: string } {
  const normalized = globPattern.replace(/\\/g, "/");

  // 找到第一个通配符位置
  const wildcardIndex = normalized.search(/[*?{]/);

  if (wildcardIndex === -1) {
    // 没有通配符 — 视为单个文件路径
    const absPath = isAbsolute(normalized)
      ? normalize(normalized)
      : resolve(normalized);
    return {
      basePath: dirname(absPath),
      pattern: basename(absPath),
    };
  }

  // 在通配符前最后一个 / 处分割
  const lastSepBeforeWildcard = normalized.lastIndexOf("/", wildcardIndex);

  if (lastSepBeforeWildcard === -1) {
    // 通配符在第一层（如 "*.js"）
    return {
      basePath: resolve("."),
      pattern: normalized,
    };
  }

  const basePart = normalized.slice(0, lastSepBeforeWildcard);
  const patternPart = normalized.slice(lastSepBeforeWildcard + 1);

  return {
    basePath: basePart.length === 0
      ? resolve(".")
      : isAbsolute(basePart)
      ? normalize(basePart)
      : resolve(basePart),
    pattern: patternPart,
  };
}

/**
 * 递归扫描目录，返回所有匹配 glob 模式的文件。
 *
 * @param dirPath   — 当前扫描的目录路径
 * @param regex     — 编译好的 glob 正则
 * @param basePath  — 基路径（用于计算 relativePath）
 * @param maxDepth  — 最大递归深度（默认 10，防止无限递归）
 */
async function scanDir(
  dirPath: string,
  regex: RegExp,
  basePath: string,
  maxDepth = 10,
): Promise<GlobMatch[]> {
  if (maxDepth <= 0) return [];

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    // 目录不可读（权限/不存在） — 静默跳过
    return [];
  }

  const results: GlobMatch[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);

    try {
      const entryStat = await fsStat(fullPath);

      if (entryStat.isDirectory()) {
        // 递归扫描子目录
        const subResults = await scanDir(
          fullPath,
          regex,
          basePath,
          maxDepth - 1,
        );
        results.push(...subResults);
      } else if (entryStat.isFile()) {
        const relativePath = relative(basePath, fullPath).replace(/\\/g, "/");
        if (regex.test(relativePath)) {
          results.push({ filePath: fullPath, relativePath });
        }
      }
    } catch {
      // 单个文件/目录不可读 — 跳过
      continue;
    }
  }

  return results;
}

// ── PluginRegistry 类 ──

/**
 * PluginRegistry —— 插件注册表。
 *
 * 管理二级插件的完整生命周期注册信息。
 * 支持按名称注册/注销、按标签查询、glob 文件发现和依赖拓扑排序。
 *
 * 依赖倒置：本类仅依赖 `Plugin` 接口，不依赖任何具体插件实现。
 */
export class PluginRegistry {
  /** 插件缓存映射（name → Plugin） */
  private _plugins: Map<string, Plugin> = new Map();

  // ── 注册与注销 ──

  /**
   * 注册一个已实例化的二级插件。
   *
   * 注册前不会调用插件的 init() — init 由 PluginRunner 按需触发。
   * 重复注册同名插件将抛出明确错误。
   *
   * @param plugin — 实现了 Plugin 接口的插件实例
   * @throws 同名插件已注册时抛 Error
   */
  register(plugin: Plugin): void {
    if (!plugin || typeof plugin.name !== "string" || plugin.name.length === 0) {
      throw new Error(
        "[PluginRegistry] 注册失败: 插件必须具有非空的 name 属性",
      );
    }

    if (this._plugins.has(plugin.name)) {
      throw new Error(
        `[PluginRegistry] 重复注册: "${plugin.name}" 已存在`,
      );
    }

    this._plugins.set(plugin.name, plugin);
  }

  /**
   * 注销指定名称的插件。
   *
   * 注销前不会自动调用 destroy() — 调用方需自行确保资源清理。
   *
   * @param name — 要注销的插件名称
   * @returns 是否成功注销（false 表示该名称未注册）
   */
  unregister(name: string): boolean {
    return this._plugins.delete(name);
  }

  // ── 查询检索 ──

  /**
   * 获取指定名称的完整插件实例。
   */
  get(name: string): Plugin | undefined {
    return this._plugins.get(name);
  }

  /**
   * 获取指定名称的插件元信息（轻量视图）。
   *
   * 返回 PluginMeta（纯数据对象），不暴露插件实例的引用。
   * 适用于 registry list / discover 等无需加载完整实例的场景。
   */
  getMeta(name: string): PluginMeta | undefined {
    const plugin = this._plugins.get(name);
    if (!plugin) return undefined;

    return this._toMeta(plugin);
  }

  /**
   * 检查指定名称的插件是否已注册。
   */
  has(name: string): boolean {
    return this._plugins.has(name);
  }

  /**
   * 当前注册的插件总数。
   */
  get size(): number {
    return this._plugins.size;
  }

  /**
   * 获取所有已注册的插件实例数组。
   */
  getAll(): Plugin[] {
    return Array.from(this._plugins.values());
  }

  /**
   * 获取所有已注册插件的元信息数组。
   */
  getAllMeta(): PluginMeta[] {
    return this.getAll().map((p) => this._toMeta(p));
  }

  /**
   * 按标签查找所有匹配的插件。
   *
   * @param tag — 要查找的标签名（精确匹配）
   */
  findByTag(tag: string): Plugin[] {
    return this.getAll().filter((p) => p.tags.includes(tag));
  }

  /**
   * 按自定义过滤函数查找插件。
   *
   * @param filter — 过滤谓词，接收 Plugin 实例，返回 true 表示匹配
   */
  find(filter: (p: Plugin) => boolean): Plugin[] {
    return this.getAll().filter(filter);
  }

  /**
   * 按名称批量获取插件实例（用于依赖注入场景）。
   *
   * @param names — 要获取的插件名称列表
   * @returns 名称 → Plugin 实例的映射。不存在的名称不会出现在结果中。
   */
  getMultiple(names: string[]): Map<string, Plugin> {
    const result = new Map<string, Plugin>();
    for (const name of names) {
      const plugin = this._plugins.get(name);
      if (plugin) {
        result.set(name, plugin);
      }
    }
    return result;
  }

  // ── 文件发现 ──

  /**
   * 通过文件路径通配符扫描文件系统，发现并返回插件元信息。
   *
   * 扫描流程：
   * 1. 解析 glob 模式为基路径 + 相对模式
   * 2. 递归扫描目录，收集所有匹配的文件
   * 3. 动态 import 每个文件
   * 4. 检查导出是否实现了 Plugin 接口（通过 isPlugin 守卫）
   * 5. 返回 PluginMeta 列表（不注册到 registry，仅发现）
   *
   * 注意：此方法会执行动态 import，但不会自动调用插件的 init()。
   * 被导入的插件模块不应有副作用。
   *
   * @param globPattern — 文件路径通配符（支持 **, *, ?, {a,b}）
   * @returns 发现的插件元信息列表（不会自动注册到 registry）
   */
  async discover(globPattern: string): Promise<PluginMeta[]> {
    if (!globPattern || globPattern.trim().length === 0) {
      return [];
    }

    // 拒绝包含非法路径字符的模式（\0 在所有文件系统上均无效）
    if (globPattern.includes("\0")) {
      return [];
    }

    const { basePath, pattern } = parseGlobPattern(globPattern.trim());
    const regex = globToRegex(pattern);

    // 扫描目录获取匹配的文件
    const matches = await scanDir(basePath, regex, basePath);

    if (matches.length === 0) {
      return [];
    }

    // 逐个动态 import 并检查是否为插件
    const discovered: PluginMeta[] = [];

    for (const match of matches) {
      try {
        const fileUrl = pathToFileURL(match.filePath).href;
        const mod = await import(fileUrl);

        // 检查模块的默认导出和命名导出
        const candidates: unknown[] = [];

        if (mod.default) {
          candidates.push(mod.default);
        }

        // 收集所有可能的插件导出
        for (const key of Object.keys(mod)) {
          if (key === "default") continue;
          candidates.push(mod[key]);
        }

        for (const candidate of candidates) {
          if (isPlugin(candidate)) {
            discovered.push({
              name: candidate.name,
              version: candidate.version,
              description: candidate.description,
              tags: [...candidate.tags],
              dependencies: [...candidate.dependencies],
              hooks: { ...candidate.hooks },
              filePath: match.filePath,
            });
          }
        }
      } catch {
        // 单个文件导入失败 — 跳过，不影响其他文件的发现
        continue;
      }
    }

    return discovered;
  }

  /**
   * 通过 glob 模式发现插件并自动注册到 registry。
   *
   * 是 discover() + register() 的便捷组合。
   * 跳过已经被注册的同名插件（静默跳过，不抛异常）。
   *
   * @param globPattern — 文件路径通配符
   * @returns 成功注册的插件数量
   */
  async registerFromGlob(globPattern: string): Promise<number> {
    const discovered = await this.discover(globPattern);

    let registeredCount = 0;

    for (const meta of discovered) {
      if (this._plugins.has(meta.name)) {
        // 同名插件已存在 — 静默跳过
        continue;
      }

      // 重新导入并注册
      try {
        if (!meta.filePath) {
          throw new Error("PluginRegistry.refresh: missing filePath in metadata");
        }
        const fileUrl = pathToFileURL(meta.filePath).href;
        const mod = await import(fileUrl);

        // 找到对应的 Plugin 实例
        const candidates: unknown[] = [];
        if (mod.default) candidates.push(mod.default);
        for (const key of Object.keys(mod)) {
          if (key === "default") continue;
          candidates.push(mod[key]);
        }

        for (const candidate of candidates) {
          if (isPlugin(candidate) && candidate.name === meta.name) {
            this.register(candidate);
            registeredCount++;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    return registeredCount;
  }

  // ── 依赖解析 ──

  /**
   * 依赖拓扑排序。
   *
   * 使用 Kahn 算法对当前注册的所有插件进行拓扑排序，
   * 返回按依赖顺序排列的执行批次。
   *
   * 同批次内的插件无相互依赖，可以并行执行。
   * 批次间必须串行执行（前一批次全部完成后再执行下一批）。
   *
   * 算法流程：
   * 1. 构建有向图（依赖方向：dep → dependent）
   * 2. 计算每个节点的入度
   * 3. 从入度为 0 的节点开始，逐层剥离
   * 4. 每剥离一层即为一个批次
   *
   * @returns 拓扑排序后的二维数组
   * @throws 检测到依赖循环时抛 Error（含循环参与节点信息）
   */
  resolveDependencies(): Plugin[][] {
    const plugins = this.getAll();

    if (plugins.length === 0) {
      return [];
    }

    // 只考虑已注册插件间的依赖关系
    const registeredNames = new Set(plugins.map((p) => p.name));

    // 入度表: name → 入度数（未满足的依赖数）
    const inDegree = new Map<string, number>();
    // 邻接表: name → 依赖此插件的其他插件列表
    const adjacency = new Map<string, string[]>();

    // 初始化
    for (const p of plugins) {
      inDegree.set(p.name, 0);
      adjacency.set(p.name, []);
    }

    // 建图
    for (const p of plugins) {
      for (const dep of p.dependencies) {
        // 只统计已注册的依赖
        if (registeredNames.has(dep)) {
          const neighbors = adjacency.get(dep) ?? [];
          neighbors.push(p.name);
          adjacency.set(dep, neighbors);
          inDegree.set(p.name, (inDegree.get(p.name) ?? 0) + 1);
        }
        // 未注册的依赖：不影响排序，执行时由 PluginRunner 处理
      }
    }

    // Kahn 算法
    const queue: string[] = [];

    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name);
      }
    }

    const batches: Plugin[][] = [];
    let visitedCount = 0;

    while (queue.length > 0) {
      const batchSize = queue.length;
      const batch: Plugin[] = [];

      for (let i = 0; i < batchSize; i++) {
        const name = queue.shift();
        if (!name) continue;
        const plugin = this._plugins.get(name);
        if (plugin) {
          batch.push(plugin);
        }
        visitedCount++;

        const dependents = adjacency.get(name) ?? [];
        for (const dependent of dependents) {
          const newDegree = (inDegree.get(dependent) ?? 1) - 1;
          inDegree.set(dependent, newDegree);
          if (newDegree === 0) {
            queue.push(dependent);
          }
        }
      }

      batches.push(batch);
    }

    if (visitedCount !== plugins.length) {
      // 找出循环依赖中的节点
      const unvisited = plugins.filter(
        (p) => !queue.includes(p.name) && (inDegree.get(p.name) ?? 0) > 0,
      );
      const cycleNames = unvisited.map((p) => p.name).join(", ");
      throw new Error(
        `[PluginRegistry] 依赖循环检测到，无法解析依赖顺序。涉及插件: ${cycleNames}`,
      );
    }

    return batches;
  }

  /**
   * 检查是否存在依赖循环。
   *
   * 使用三色标记法（DFS）检测有向图中的环。
   *
   * @returns 如果存在循环则返回 true，否则返回 false
   */
  hasCycle(): boolean {
    const plugins = this.getAll();
    if (plugins.length === 0) return false;

    const registeredNames = new Set(plugins.map((p) => p.name));
    const adjacency = new Map<string, string[]>();

    for (const p of plugins) {
      const deps: string[] = [];
      for (const dep of p.dependencies) {
        if (registeredNames.has(dep)) {
          deps.push(dep);
        }
      }
      adjacency.set(p.name, deps);
    }

    // 三色标记: 0 = 未访问, 1 = 访问中, 2 = 已访问
    const color = new Map<string, number>();
    for (const p of plugins) {
      color.set(p.name, 0);
    }

    function dfs(node: string): boolean {
      color.set(node, 1); // 标记为访问中
      const neighbors = adjacency.get(node) ?? [];

      for (const neighbor of neighbors) {
        const neighborColor = color.get(neighbor);
        if (neighborColor === 1) {
          // 找到回边 → 有环
          return true;
        }
        if (neighborColor === 0) {
          if (dfs(neighbor)) {
            return true;
          }
        }
      }

      color.set(node, 2); // 标记为已访问
      return false;
    }

    for (const p of plugins) {
      if (color.get(p.name) === 0) {
        if (dfs(p.name)) {
          return true;
        }
      }
    }

    return false;
  }

  // ── 工具方法 ──

  /**
   * 清空注册表。
   *
   * 移除所有已注册的插件引用。
   * 注意：不会自动调用插件的 destroy() — 调用方需自行处理。
   */
  clear(): void {
    this._plugins.clear();
  }

  /**
   * 返回当前注册的所有插件名称列表。
   */
  listNames(): string[] {
    return Array.from(this._plugins.keys());
  }

  // ── 内部辅助 ──

  /**
   * 将 Plugin 实例转换为 PluginMeta 轻量对象。
   */
  private _toMeta(plugin: Plugin): PluginMeta {
    return {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      tags: [...plugin.tags],
      dependencies: [...plugin.dependencies],
      hooks: { ...plugin.hooks },
    };
  }
}
