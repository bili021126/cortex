// ============================================================
// @cortex/engine/platform/tools/parse-ast —— parse_ast 工具 Handler
//
// 使用 TypeScript Compiler API 解析 .ts/.tsx/.js/.jsx。
// tree-sitter 拓展（.py/.rs/.go 等）预留插槽。
// ============================================================

import type { ToolMeta } from "../toolkit.js";
import type { ToolContext } from "./types.js";
import type { ToolHandler } from "@cortex/shared";
import { ToolCategory } from "@cortex/shared";
import { ReversibilityLevel as RL } from "@cortex/shared";
import * as path from "node:path";
import * as ts from "typescript";

export const meta: ToolMeta = {
  category: ToolCategory.Read,
  description:
    "Parse a source file and return its AST (Abstract Syntax Tree). Uses TypeScript Compiler API for .ts/.tsx/.js/.jsx files; tree-sitter for other languages (pending).",
  level: RL.L0,
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the source file to parse" },
      max_depth: { type: "number", description: "Maximum AST depth to return (default: 6, max: 12)" },
      include_text: { type: "boolean", description: "Include source text snippets in AST nodes (default: true)" },
    },
    required: ["file_path"],
  },
  required: ["file_path"],
};

export function createHandler(ctx: ToolContext): ToolHandler {
  return async (params) => {
    const filePath = ctx.resolvePath(params.file_path as string);
    const maxDepth = Math.min((params.max_depth as number) ?? 6, 12);
    const includeText = (params.include_text as boolean) ?? true;
    try {
      const exists = await ctx.fs.exists(filePath);
      if (!exists) {
        return { success: false, error: `文件不存在: ${filePath}` };
      }
      const content = await ctx.fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const parser = getParserByExtension(ext);
      if (!parser) {
        return {
          success: false,
          error: `不支持的文件类型: ${ext}。当前支持 .ts/.tsx/.js/.jsx（TypeScript Compiler API），其他语言（tree-sitter）待后续版本。`,
        };
      }
      const ast = parser(content, filePath);
      const output = serializeAST(ast, maxDepth, includeText, content);
      return { success: true, output };
    } catch (e) {
      return { success: false, error: `AST 解析失败: ${String(e)}` };
    }
  };
}

// ── AST 解析引擎（ParserSelector + 双引擎） ────────

/** 按文件扩展名选择解析器 */
function getParserByExtension(ext: string): ((content: string, filePath: string) => ts.SourceFile) | null {
  const tsExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
  if (tsExtensions.includes(ext)) {
    return parseAstWithTS;
  }
  // tree-sitter 预留插槽：后续版本扩展 .py/.rs/.go/.java 等
  return null;
}

/** TypeScript Compiler API 解析器 */
function parseAstWithTS(content: string, filePath: string): ts.SourceFile {
  const scriptKind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  return ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );
}

/** 将 ts.SourceFile 序列化为可读 JSON 字符串 */
function serializeAST(
  sourceFile: ts.SourceFile,
  maxDepth: number,
  includeText: boolean,
  sourceText: string,
): string {
  const lines = sourceText.split("\n");
  const root = nodeToJSON(sourceFile, 0, maxDepth, includeText, lines);
  const stats = collectASTStats(sourceFile);
  return JSON.stringify({ stats, root }, null, 2);
}

/** 递归 AST 节点 → 纯 JSON */
function nodeToJSON(
  node: ts.Node,
  depth: number,
  maxDepth: number,
  includeText: boolean,
  lines: string[],
): Record<string, unknown> {
  const kind = ts.SyntaxKind[node.kind] ?? `Unknown(${node.kind})`;
  const pos = node.getStart();
  const end = node.getEnd();
  const startLine = ts.getLineAndCharacterOfPosition(node.getSourceFile(), pos);
  const endLine = ts.getLineAndCharacterOfPosition(node.getSourceFile(), end);

  const result: Record<string, unknown> = {
    kind,
    pos: { line: startLine.line + 1, col: startLine.character + 1 },
    end: { line: endLine.line + 1, col: endLine.character + 1 },
  };

  if (includeText && depth <= 2) {
    const text = node.getText();
    if (text.length <= 200) {
      result.text = text;
    } else {
      result.text = text.slice(0, 200) + "…";
    }
  }

  // 关键语义信息
  if (ts.isIdentifier(node)) {
    result.name = node.text;
  } else if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    result.value = node.text;
  } else if (ts.isTypeNode(node)) {
    result.typeText = node.getText();
  }

  // 修饰符
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node);
    if (modifiers?.length) {
      result.modifiers = modifiers.map((m) => ts.SyntaxKind[m.kind]);
    }
  }

  // 递归子节点
  if (depth < maxDepth) {
    const children: Record<string, unknown>[] = [];
    node.forEachChild((child) => {
      children.push(nodeToJSON(child, depth + 1, maxDepth, includeText, lines));
    });
    if (children.length > 0) {
      result.children = children;
    }
  } else if (node.getChildCount() > 0) {
    result._truncated = node.getChildCount();
  }

  return result;
}

/** 收集 AST 顶层统计信息 */
function collectASTStats(sourceFile: ts.SourceFile): Record<string, number> {
  const stats: Record<string, number> = {
    totalNodes: 0,
    functions: 0,
    classes: 0,
    interfaces: 0,
    enums: 0,
    imports: 0,
    exports: 0,
    typeAliases: 0,
    variables: 0,
  };
  const walk = (node: ts.Node): void => {
    stats.totalNodes++;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) stats.functions++;
    if (ts.isClassDeclaration(node)) stats.classes++;
    if (ts.isInterfaceDeclaration(node)) stats.interfaces++;
    if (ts.isEnumDeclaration(node)) stats.enums++;
    if (ts.isImportDeclaration(node)) stats.imports++;
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) stats.exports++;
    if (ts.isTypeAliasDeclaration(node)) stats.typeAliases++;
    if (ts.isVariableStatement(node)) stats.variables++;
    node.forEachChild(walk);
  };
  walk(sourceFile);
  return stats;
}
