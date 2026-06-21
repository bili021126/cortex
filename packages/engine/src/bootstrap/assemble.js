// ============================================================
// @cortex/engine/bootstrap/assemble —— 最终组装 BootstrapResult
// ============================================================
import { ButlerAgent } from "../agents/butler-agent.js";
export function assemble(input) {
    const butler = new ButlerAgent(input.observer);
    const shutdown = async () => {
        // 逆序释放资源——各组件以 best-effort 关闭，未实现的方法静默跳过
        try {
            input.scheduler.stop?.();
        }
        catch { /* best-effort */ }
        try {
            input.pool.destroyAll?.();
        }
        catch { /* best-effort */ }
        try {
            input.observer.clear?.();
        }
        catch { /* best-effort */ }
        try {
            await input.memory?.close();
        }
        catch { /* best-effort */ }
        try {
            input.gate.dispose?.();
        }
        catch { /* best-effort */ }
        try {
            input.cliAdapter.close?.();
        }
        catch { /* best-effort */ }
    };
    return {
        scheduler: input.scheduler,
        pool: input.pool,
        observer: input.observer,
        board: input.board,
        gate: input.gate,
        cliAdapter: input.cliAdapter,
        memory: input.memory,
        metaAgent: input.metaAgent,
        butler,
        strategists: input.strategists,
        skillRegistry: input.skillRegistry,
        config: input.config,
        agents: input.agents,
        consistencyLayer: input.consistencyLayer,
        shutdown,
    };
}
//# sourceMappingURL=assemble.js.map