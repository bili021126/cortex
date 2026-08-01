// ============================================================
// @cortex/engine/platform/tools/search-symbol —— search_symbol 工具
//
// 扫描 TS/JS 文件，返回结构化符号表（函数/类/接口/枚举/类型别名/导出）。
// 复用 TypeScript Compiler API，是 parse_ast 的平级工具——
// parse_ast 输出完整递归 AST，search_symbol 输出扁平符号列表。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import type { Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";
import * as path from "node:path";
import * as ts from "typescript";
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/config";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "search_symbol",
    ToolCategory.Search,
    "Scan a TS/JS source file and return a structured symbol table (functions, classes, interfaces, enums, type aliases, exports) with names, positions, and signatures.",
    {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the source file to scan" },
        kind_filter: {
          type: "string",
          description: "Comma-separated kind filter: function, class, interface, enum, typeAlias, variable, export, all (default: all)",
        },
      },
      required: ["file_path"],
    },
    RL.L0,
    async (params) => {
      const filePath = ctx.resolvePath(params.file_path as string);
      const kindFilter = (params.kind_filter as string)?.toLowerCase() ?? "all";
      try {
        const exists = await ctx.fs.exists(filePath);
        if (!exists) {
          return { success: false, error: `文件不存在: ${filePath}` };
        }
        const ext = path.extname(filePath).toLowerCase();
        const tsExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
        if (!tsExtensions.includes(ext)) {
          return {
            success: false,
            error: `search_symbol 仅支持 TS/JS 文件: ${ext}。其他语言请使用 parse_ast 或 search_code。`,
          };
        }
        const content = await ctx.fs.readFile(filePath);
        const symbols = extractSymbols(filePath, content, kindFilter);
        if (symbols.length === 0) {
          return { success: true, output: JSON.stringify({ file: filePath, symbols: [], note: "未找到匹配的符号" }) };
        }
        return { success: true, output: JSON.stringify({ file: filePath, count: symbols.length, symbols }, null, 2) };
      } catch (e) {
        return { success: false, error: `符号扫描失败: ${String(e)}` };
      }
    },
  );
}

// ── 符号提取核心 ──────────────────────────────

interface SymbolEntry {
  name: string;
  kind: string;
  line: number;
  col: number;
  modifiers?: string[];
  signature?: string;     // 前 200 字符的函数签名或类型文本
  exported: boolean;
}

function extractSymbols(filePath: string, content: string, kindFilter: string): SymbolEntry[] {
  const scriptKind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: SymbolEntry[] = [];
  const filterAll = kindFilter === "all";
  const filterSet = filterAll ? new Set<string>() : new Set(kindFilter.split(",").map((s) => s.trim()));

  const push = (entry: SymbolEntry) => {
    if (filterAll || filterSet.has(entry.kind)) {
      symbols.push(entry);
    }
  };

  const getPos = (node: ts.Node) => {
    const pos = ts.getLineAndCharacterOfPosition(sf, node.getStart());
    return { line: pos.line + 1, col: pos.character + 1 };
  };

  const getModifiers = (node: ts.Node): string[] | undefined => {
    if (!ts.canHaveModifiers(node)) return undefined;
    const mods = ts.getModifiers(node);
    return mods?.length ? mods.map((m) => ts.SyntaxKind[m.kind]) : undefined;
  };

  const isExported = (node: ts.Node): boolean => {
    if (!ts.canHaveModifiers(node)) return false;
    const mods = ts.getModifiers(node);
    return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  };

  const getSignature = (node: ts.Node): string | undefined => {
    const text = node.getText(sf);
    // 截取到第一个 { 或 200 字符
    const braceIdx = text.indexOf("{");
    const limit = braceIdx > 0 ? Math.min(braceIdx, 200) : 200;
    return text.slice(0, limit).replace(/\s+/g, " ").trim();
  };

  const visitor = (node: ts.Node): void => {
    // 函数声明
    if (ts.isFunctionDeclaration(node)) {
      const pos = getPos(node);
      const exported = isExported(node);
      push({
        name: node.name?.text ?? "(anonymous)",
        kind: "function",
        line: pos.line,
        col: pos.col,
        modifiers: getModifiers(node),
        signature: getSignature(node),
        exported,
      });
    }
    // 方法声明 (类/接口成员)
    else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
      const pos = getPos(node);
      const exported = isExported(node);
      push({
        name: node.name?.getText(sf) ?? "(anonymous)",
        kind: "method",
        line: pos.line,
        col: pos.col,
        modifiers: getModifiers(node),
        signature: getSignature(node),
        exported,
      });
    }
    // 箭头函数变量
    else if (ts.isVariableStatement(node)) {
      const pos = getPos(node);
      const exported = isExported(node);
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          push({
            name: decl.name.getText(sf),
            kind: "function",
            line: pos.line,
            col: pos.col,
            modifiers: getModifiers(node),
            signature: getSignature(node),
            exported,
          });
        } else if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
          push({
            name: decl.name.getText(sf),
            kind: "variable",
            line: pos.line,
            col: pos.col,
            modifiers: getModifiers(node),
            exported,
          });
        } else {
          push({
            name: decl.name.getText(sf),
            kind: "variable",
            line: pos.line,
            col: pos.col,
            modifiers: getModifiers(node),
            exported,
          });
        }
      }
    }
    // 类声明
    else if (ts.isClassDeclaration(node) && node.name) {
      const pos = getPos(node);
      push({
        name: node.name.text,
        kind: "class",
        line: pos.line,
        col: pos.col,
        modifiers: getModifiers(node),
        signature: getSignature(node),
        exported: isExported(node),
      });
    }
    // 接口声明
    else if (ts.isInterfaceDeclaration(node)) {
      const pos = getPos(node);
      push({
        name: node.name.text,
        kind: "interface",
        line: pos.line,
        col: pos.col,
        modifiers: getModifiers(node),
        signature: getSignature(node),
        exported: isExported(node),
      });
    }
    // 枚举声明
    else if (ts.isEnumDeclaration(node)) {
      const pos = getPos(node);
      push({
        name: node.name.text,
        kind: "enum",
        line: pos.line,
        col: pos.col,
        modifiers: getModifiers(node),
        exported: isExported(node),
      });
    }
    // 类型别名
    else if (ts.isTypeAliasDeclaration(node)) {
      const pos = getPos(node);
      push({
        name: node.name.text,
        kind: "typeAlias",
        line: pos.line,
        col: pos.col,
        modifiers: getModifiers(node),
        signature: getSignature(node),
        exported: isExported(node),
      });
    }
    // export 声明 (re-exports)
    else if (ts.isExportDeclaration(node)) {
      const pos = getPos(node);
      const clause = node.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          push({
            name: el.name.text,
            kind: "export",
            line: pos.line,
            col: pos.col,
            exported: true,
          });
        }
      } else {
        push({
          name: node.moduleSpecifier ? `from "${(node.moduleSpecifier as ts.StringLiteral).text}"` : "(bare re-export)",
          kind: "export",
          line: pos.line,
          col: pos.col,
          exported: true,
        });
      }
    }

    ts.forEachChild(node, visitor);
  };

  ts.forEachChild(sf, visitor);
  return symbols;
}
