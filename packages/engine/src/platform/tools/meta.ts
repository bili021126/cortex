// ============================================================
// @cortex/engine/platform/tools/meta —— 工具元数据常量
//
// 单源原则：cortex-agents.json "tools" 字段是唯一真相源。
// 此处编译期常量作为 fallback——值必须与 JSON 精确一致。
// ============================================================

import { ToolCategory } from "@cortex/shared";
import { ReversibilityLevel as RL } from "@cortex/shared";
import type { ToolMeta } from "../toolkit.js";

/** 编译期回退工具元数据——值与 cortex-agents.json "tools" 域精确一致 */
export const DEFAULT_TOOL_META: Record<string, ToolMeta> = {
  read_file: {
    category: ToolCategory.Read,
    description: "Read the contents of a file at the given path.",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to file" },
      },
      required: ["file_path"],
    },
    required: ["file_path"],
  },
  write_file: {
    category: ToolCategory.Write,
    description: "Write content to a file at the given path.",
    level: RL.L2,
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["file_path", "content"],
    },
    required: ["file_path", "content"],
  },
  search_code: {
    category: ToolCategory.Search,
    description: "Search for code patterns in the project.",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Code pattern to search" },
      },
      required: ["query"],
    },
    required: ["query"],
  },
  run_shell: {
    category: ToolCategory.Shell,
    description: "Run a shell command and return its output.",
    level: RL.L3,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
      },
      required: ["command"],
    },
    required: ["command"],
  },
  list_files: {
    category: ToolCategory.Read,
    description: "List files and directories at the given path.",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        dir_path: { type: "string", description: "Absolute path to directory (default: current workspace)" },
        pattern: { type: "string", description: "Glob filter pattern (optional, e.g. '*.ts')" },
      },
      required: [],
    },
    required: [],
  },
  delete_file: {
    category: ToolCategory.Write,
    description: "Delete a file at the given path. Irreversible — use with caution.",
    level: RL.L3,
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to file to delete" },
      },
      required: ["file_path"],
    },
    required: ["file_path"],
  },
  parse_ast: {
    category: ToolCategory.Read,
    description: "Parse a source file and return its AST (Abstract Syntax Tree). Uses TypeScript Compiler API for .ts/.tsx/.js/.jsx files; tree-sitter for other languages (pending).",
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
  },
  web_search: {
    category: ToolCategory.Search,
    description: "Search the web and return structured results.",
    level: RL.L0,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Maximum number of results (default: 5, max: 10)" },
      },
      required: ["query"],
    },
    required: ["query"],
  },
};
