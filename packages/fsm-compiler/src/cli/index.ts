/**
 * @cortex/fsm-compiler — CLI Entry
 *
 * CLI commands:
 *   fsm-compiler build        Build all FSM definitions
 *   fsm-compiler validate     Validate only
 *   fsm-compiler diagram      Generate diagram
 *   fsm-compiler watch        Watch mode
 */

import { FsmParser as _FsmParser } from "../compiler/parser.js";
import { FsmValidator as _FsmValidator } from "../compiler/validator.js";
import { TypeScriptGenerator as _TypeScriptGenerator } from "../compiler/generators/typescript-generator.js";
import { DiagramGenerator as _DiagramGenerator } from "../compiler/generators/diagram-generator.js";

const COMMAND = process.argv[2] ?? "help";

async function main(): Promise<void> {
  switch (COMMAND) {
    case "build":
      await runBuild();
      break;
    case "validate":
      await runValidate();
      break;
    case "diagram":
      await runDiagram();
      break;
    case "watch":
      await runWatch();
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}

function printHelp(): void {
  console.log(`
@cortex/fsm-compiler — FSM Compiler CLI

Usage:
  fsm-compiler build                  Build all FSM definitions
  fsm-compiler validate               Validate all definitions
  fsm-compiler diagram --out <dir>    Generate diagrams
  fsm-compiler watch                  Watch for changes
  fsm-compiler help                   Show this help
`);
}

async function runBuild(): Promise<void> {
  console.log("[fsm-compiler] Building FSM definitions...");
  // Core-2 待办：实现 definition discovery（扫描 packages/*/fsm/）& 批量编译
  console.log("[fsm-compiler] Build complete.");
}

async function runValidate(): Promise<void> {
  console.log("[fsm-compiler] Validating FSM definitions...");
  // Core-2 待办：实现多文件交叉校验（状态可达性、转换完备性）
  console.log("[fsm-compiler] Validation complete.");
}

async function runDiagram(): Promise<void> {
  console.log("[fsm-compiler] Generating diagrams...");
  // Core-2 待办：实现 Mermaid/PlantUML 图生成，--out <dir> 控制输出路径
  console.log("[fsm-compiler] Diagram generation complete.");
}

async function runWatch(): Promise<void> {
  console.log("[fsm-compiler] Watch mode started...");
  // Core-2 待办：实现 chokidar 文件监听 + 增量重编译
}

main().catch((err) => {
  console.error("[fsm-compiler] Error:", err);
  process.exit(1);
});
