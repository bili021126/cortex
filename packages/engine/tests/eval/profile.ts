// profile：内存 memory 注入 vs SQLite
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootstrapEngine } from "../../src/bootstrap/bootstrap-engine.js";
import { Toolkit } from "@cortex/platform";
import { InMemoryMemoryStore } from "../../../memory/src/implementations/InMemoryMemoryStore.js";

const mkLlm = () => ({ chat: async () => ({ content: "ok", reasoning_content: "", tool_calls: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) } as never);

// A: SQLite（dbPath）
{
  const t0 = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-prof-a-"));
  const boot = await bootstrapEngine(dir, { llms: new Map([["default", mkLlm()]]), toolkit: new Toolkit(), dbPath: path.join(dir, "a.db") });
  console.log(`A SQLite bootstrap: ${Date.now() - t0}ms`);
  await boot.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
}

// B: 内存注入
{
  const t0 = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-prof-b-"));
  const mem = new InMemoryMemoryStore();
  const boot = await bootstrapEngine(dir, { llms: new Map([["default", mkLlm()]]), toolkit: new Toolkit(), memory: mem as never });
  console.log(`B 内存注入 bootstrap: ${Date.now() - t0}ms`);
  await boot.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
}
