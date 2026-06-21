import { MemoryStore } from "../src/memory/memory-store.js";
import { PipelineObserver } from "../src/core/pipeline-observer.js";
import { AgentType } from "../../shared/src/agent.js";
const s = new MemoryStore(new PipelineObserver());
console.log("isEnabled:", s._persistence.isEnabled);
console.log("lifecycle:", s._persistence.lifecycle);
const id1 = await s.write({
    kind: "TaskLog",
    content_blob: {},
    summary: "aging debug",
    semantic_gist: "aging debug",
    source: { agentType: AgentType.Code, taskId: "" },
    content_hash: "",
    weight: 1.0,
});
console.log("written id:", id1);
const internalEntry = s._storage.memories.get(id1);
console.log("in-mem weight before:", internalEntry.weight);
console.log("in-mem lastAccessedAt before:", internalEntry.lastAccessedAt);
internalEntry.lastAccessedAt = Date.now() - 14 * 86400000;
console.log("in-mem lastAccessedAt after:", internalEntry.lastAccessedAt);
console.log("days since:", (Date.now() - internalEntry.lastAccessedAt) / 86400000);
const r = await s.read({
    kind: "TaskLog",
    limit: 50,
});
console.log("read() results count:", r.length);
const e = r.find((m) => m.id === id1);
console.log("found in read results:", !!e);
console.log("weight from read:", e?.weight);
console.log("lastAccessedAt from read:", e?.lastAccessedAt);
await s.close();
//# sourceMappingURL=debug-aging.js.map