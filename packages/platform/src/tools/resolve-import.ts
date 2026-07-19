// ============================================================
// @cortex/engine/platform/tools/resolve-import —— resolve_import 工具
//
// 给定源文件路径和 import 说明符，解析为绝对文件路径。
// 支持相对路径 (./, ../)、TS 路径别名 (需 tsconfig paths)、
// 以及裸模块说明符的 node_modules 查找。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";
import * as nodePath from "node:path";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "resolve_import",
    ToolCategory.Read,
    "Resolve an import specifier to an absolute file path. Given a source file and its import statement (e.g. './foo', '@/utils/bar'), returns the resolved target file path with candidate extensions tried.",
    {
      type: "object",
      properties: {
        source_file: { type: "string", description: "Absolute path to the source file containing the import" },
        import_specifier: { type: "string", description: "The import specifier string (e.g. './foo', '../bar', '@/utils/baz', 'typescript')" },
      },
      required: ["source_file", "import_specifier"],
    },
    RL.L0,
    async (params) => {
      const sourceFile = ctx.resolvePath(params.source_file as string);
      const specifier = (params.import_specifier as string).trim();

      if (!specifier) {
        return { success: false, error: "resolve_import 缺少 import_specifier 参数" };
      }

      try {
        const sourceExists = await ctx.fs.exists(sourceFile);
        if (!sourceExists) {
          return { success: false, error: `源文件不存在: ${sourceFile}` };
        }

        const sourceDir = nodePath.dirname(sourceFile);
        const result: ResolveResult | null = await tryResolve(ctx, sourceDir, specifier);

        return {
          success: true,
          output: JSON.stringify({
            source: sourceFile,
            specifier,
            resolved: result?.path ?? null,
            tried: result?.tried ?? [],
            ...(result ? {} : { note: "无法解析该导入路径" }),
          }, null, 2),
        };
      } catch (e) {
        return { success: false, error: `解析导入失败: ${String(e)}` };
      }
    },
  );
}

// ── 解析逻辑 ─────────────────────────────────

interface ResolveResult {
  path: string;
  tried: string[];
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", "/index.ts", "/index.js", "/index.tsx", "/index.jsx"];

async function tryResolve(ctx: ToolContext, sourceDir: string, specifier: string): Promise<ResolveResult | null> {
  const tried: string[] = [];

  // 1. 相对路径 / 绝对路径
  if (specifier.startsWith(".") || specifier.startsWith("/") || /^[A-Za-z]:/.test(specifier)) {
    const basePath = specifier.startsWith(".")
      ? ctx.fs.resolve(sourceDir, specifier)
      : specifier;

    for (const ext of EXTENSIONS) {
      const candidate = ext.startsWith("/index")
        ? ctx.fs.resolve(basePath, ext.slice(1))
        : basePath + ext;
      tried.push(candidate);
      if (await ctx.fs.exists(candidate)) {
        return { path: candidate, tried };
      }
    }

    // 无扩展名：尝试目录下的 package.json → main / index
    const pkgPath = ctx.fs.resolve(basePath, "package.json");
    tried.push(pkgPath);
    if (await ctx.fs.exists(pkgPath)) {
      try {
        const pkg = JSON.parse(await ctx.fs.readFile(pkgPath));
        const main = pkg.main ?? "index.js";
        const mainPath = ctx.fs.resolve(basePath, main);
        tried.push(mainPath);
        if (await ctx.fs.exists(mainPath)) {
          return { path: mainPath, tried };
        }
      } catch { /* package.json 解析失败, 继续 */ }
    }
    return null;
  }

  // 2. 裸模块: 查找 node_modules
  const parts = specifier.split("/");
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const pkgName = specifier.startsWith("@") ? `${parts[0]!}/${parts[1]!}` : parts[0]!;
  const subPath = specifier.startsWith("@")
    ? parts.slice(2).join("/")
    : parts.slice(1).join("/");

  // 从 sourceDir 向上查找 node_modules
  let searchDir = sourceDir;
  const workspaceRoot = ctx.workspaceRoot;
  const stopAt = workspaceRoot ? nodePath.dirname(workspaceRoot) : nodePath.parse(searchDir).root;

  while (searchDir.length >= stopAt.length) {
    const nmDir = ctx.fs.resolve(searchDir, "node_modules");
    const pkgDir = ctx.fs.resolve(nmDir, pkgName);

    if (await ctx.fs.exists(pkgDir)) {
      if (subPath) {
        // @scope/pkg/sub/path → node_modules/@scope/pkg/sub/path
        const subFull = ctx.fs.resolve(pkgDir, subPath);
        for (const ext of EXTENSIONS) {
          const candidate = ext.startsWith("/index")
            ? ctx.fs.resolve(subFull, ext.slice(1))
            : subFull + ext;
          tried.push(candidate);
          if (await ctx.fs.exists(candidate)) {
            return { path: candidate, tried };
          }
        }
      }

      // 读 package.json main
      const pkgJsonPath = ctx.fs.resolve(pkgDir, "package.json");
      tried.push(pkgJsonPath);
      if (await ctx.fs.exists(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(await ctx.fs.readFile(pkgJsonPath));
          const main = subPath || (pkg.main ?? "index.js");
          const mainPath = ctx.fs.resolve(pkgDir, main);
          for (const ext of EXTENSIONS) {
            const candidate = ext.startsWith("/index")
              ? ctx.fs.resolve(mainPath, ext.slice(1))
              : mainPath + ext;
            tried.push(candidate);
            if (await ctx.fs.exists(candidate)) {
              return { path: candidate, tried };
            }
          }
        } catch { /* 继续 */ }
      }

      // 回退：如果有子路径但没找到，尝试 index 文件
      if (!subPath) {
        for (const ext of [".ts", ".js", "/index.ts", "/index.js"]) {
          const candidate = ext.startsWith("/index")
            ? ctx.fs.resolve(pkgDir, ext.slice(1))
            : ctx.fs.resolve(pkgDir, "index" + ext);
          tried.push(candidate);
          if (await ctx.fs.exists(candidate)) {
            return { path: candidate, tried };
          }
        }
      }
      break;
    }

    const parent = nodePath.dirname(searchDir);
    if (parent === searchDir) break; // 到达文件系统根
    searchDir = parent;
  }

  return null;
}
