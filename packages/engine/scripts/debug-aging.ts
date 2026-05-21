import { MemoryStore } from "../src/memory/memory-store.js";
import { PipelineObserver } from "../src/core/pipeline-observer.js";

const s = new MemoryStore(new PipelineObserver());
console.log("isEnabled:", (s as any)._persistence.isEnabled);
console.log("lifecycle:", (s as any)._persistence.lifecycle);

const id1 = await s.write({
  memoryType: "Episodic" as any,
  content: {},
  summary: "aging debug",
  agentType: "Code" as any,
  creatorId: "test",
  weight: 1.0,
});

console.log("written id:", id1);

const internalEntry = (s as any)._storage.memories.get(id1);
console.log("in-mem weight before:", internalEntry.weight);
console.log("in-mem lastAccessedAt before:", internalEntry.lastAccessedAt);

internalEntry.lastAccessedAt = Date.now() - 14 * 86400000;
console.log("in-mem lastAccessedAt after:", internalEntry.lastAccessedAt);
console.log("days since:", (Date.now() - internalEntry.lastAccessedAt) / 86400000);

const r = await s.read({
  memoryTypes: ["Episodic" as any],
  limit: 50,
  trackAccess: false,
});

console.log("read() results count:", r.length);
const e = r.find((m: any) => m.id === id1);
console.log("found in read results:", !!e);
console.log("weight from read:", e?.weight);
console.log("lastAccessedAt from read:", e?.lastAccessedAt);

await s.close();
