/**
 * @cortex/fsm-compiler — CLI Entry
 *
 * CLI commands:
 *   fsm-compiler build        Build all FSM definitions
 *   fsm-compiler validate     Validate only
 *   fsm-compiler diagram      Generate diagram
 *   fsm-compiler watch        Watch mode
 */
const COMMAND = process.argv[2] ?? "help";
async function main() {
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
function printHelp() {
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
async function runBuild() {
    console.log("[fsm-compiler] Building FSM definitions...");
    // TODO: implement definition discovery & batch build
    console.log("[fsm-compiler] Build complete.");
}
async function runValidate() {
    console.log("[fsm-compiler] Validating FSM definitions...");
    // TODO: implement validation
    console.log("[fsm-compiler] Validation complete.");
}
async function runDiagram() {
    console.log("[fsm-compiler] Generating diagrams...");
    // TODO: implement diagram generation
    console.log("[fsm-compiler] Diagram generation complete.");
}
async function runWatch() {
    console.log("[fsm-compiler] Watch mode started...");
    // TODO: implement file watcher
}
main().catch((err) => {
    console.error("[fsm-compiler] Error:", err);
    process.exit(1);
});
export {};
//# sourceMappingURL=index.js.map