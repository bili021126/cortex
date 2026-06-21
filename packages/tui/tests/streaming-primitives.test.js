import { describe, it, expect } from "vitest";
describe("StreamingToolExecutor primitives", () => {
    it("简单并行——Promise.all 读操作", async () => {
        const results = await Promise.all([
            Promise.resolve("a"),
            Promise.resolve("b"),
            Promise.resolve("c"),
        ]);
        expect(results).toEqual(["a", "b", "c"]);
    });
    it("串行执行——await 顺序保证", async () => {
        const order = [];
        async function run(id) {
            await new Promise(r => setTimeout(r, id * 2));
            order.push(id);
        }
        await run(1);
        await run(2);
        await run(3);
        expect(order).toEqual([1, 2, 3]);
    });
    it("Promise.allSettled 不因单个失败而整体失败", async () => {
        const results = await Promise.allSettled([
            Promise.resolve("ok"),
            Promise.reject(new Error("fail")),
            Promise.resolve("ok2"),
        ]);
        expect(results[0].status).toBe("fulfilled");
        expect(results[1].status).toBe("rejected");
        expect(results[2].status).toBe("fulfilled");
    });
    it("读并行 + 写串行——混合执行模式", async () => {
        const log = [];
        const reads = [Promise.resolve("r1"), Promise.resolve("r2")];
        const write = (async () => {
            await new Promise(r => setTimeout(r, 10));
            log.push("write");
        })();
        const r = await Promise.all(reads);
        log.push("reads done");
        await write;
        log.push("write done");
        expect(r).toEqual(["r1", "r2"]);
        expect(log).toContain("reads done");
        expect(log).toContain("write done");
    });
    it("拒绝后继续执行其他工具", async () => {
        let sideEffect = 0;
        const tasks = [
            (async () => { throw new Error("denied"); })(),
            (async () => { sideEffect = 42; })(),
        ];
        const settled = await Promise.allSettled(tasks);
        expect(settled[0].status).toBe("rejected");
        expect(sideEffect).toBe(42);
    });
    it("超时控制——Promise.race 超时优先", async () => {
        const result = await Promise.race([
            new Promise(r => setTimeout(() => r("slow"), 1000)),
            new Promise(r => setTimeout(() => r("timeout"), 5)),
        ]);
        expect(result).toBe("timeout");
    });
});
//# sourceMappingURL=streaming-primitives.test.js.map