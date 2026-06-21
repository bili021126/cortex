// @ci: unit
// @cortex/result —— Result<T, E> 类型全套测试
import { describe, it, expect as vitestExpect } from "vitest";
import { ok, err, isOk, isErr, unwrap, unwrapOr, unwrapOrElse, expect, map, mapErr, andThen, orElse, match, tryCatch, tryCatchAsync, fromNullable, all, toString, PanicError, } from "../src/index.js";
// ─── 构造函数 ─────────────────────────────────────────
describe("ok / err", () => {
    it("ok 创建包含成功值的 Ok 变体", () => {
        const r = ok(42);
        vitestExpect(isOk(r)).toBe(true);
        vitestExpect(isErr(r)).toBe(false);
    });
    it("err 创建包含错误值的 Err 变体", () => {
        const r = err("fail");
        vitestExpect(isOk(r)).toBe(false);
        vitestExpect(isErr(r)).toBe(true);
    });
    it("ok 与 err 的类型参数可正确推断", () => {
        // T 推断为 number，E 推断为 never
        const r1 = ok(42);
        vitestExpect(isOk(r1)).toBe(true);
        // E 推断为 string，T 推断为 never
        const r2 = err("something went wrong");
        vitestExpect(isErr(r2)).toBe(true);
    });
});
// ─── 类型守卫 ─────────────────────────────────────────
describe("isOk / isErr", () => {
    it("isOk 在类型守卫中正确窄化类型", () => {
        const r = ok(10);
        if (isOk(r)) {
            // 此处 value 应为 number
            const n = r.value;
            vitestExpect(n).toBe(10);
        }
    });
    it("isErr 在类型守卫中正确窄化类型", () => {
        const r = err("error");
        if (isErr(r)) {
            // 此处 error 应为 string
            const e = r.error;
            vitestExpect(e).toBe("error");
        }
    });
});
// ─── 解包 ─────────────────────────────────────────────
describe("unwrap", () => {
    it("unwrap 返回 Ok 中的值", () => {
        vitestExpect(unwrap(ok(42))).toBe(42);
    });
    it("unwrap 在 Err 时抛出 PanicError", () => {
        vitestExpect(() => unwrap(err("fail"))).toThrow(PanicError);
    });
    it("unwrap 抛出的 PanicError 保留原始错误原因链", () => {
        const original = new Error("root cause");
        try {
            unwrap(err(original));
            vitestExpect.unreachable("应抛出异常");
        }
        catch (e) {
            if (e instanceof PanicError) {
                vitestExpect(e.cause).toBe(original);
            }
            else {
                vitestExpect.unreachable("应抛出 PanicError");
            }
        }
    });
});
describe("unwrapOr", () => {
    it("unwrapOr 在 Ok 时返回值", () => {
        vitestExpect(unwrapOr(ok(42), 0)).toBe(42);
    });
    it("unwrapOr 在 Err 时返回默认值", () => {
        vitestExpect(unwrapOr(err("fail"), 0)).toBe(0);
    });
});
describe("unwrapOrElse", () => {
    it("unwrapOrElse 在 Ok 时返回值", () => {
        vitestExpect(unwrapOrElse(ok(42), (_e) => 0)).toBe(42);
    });
    it("unwrapOrElse 在 Err 时通过 fn 计算替代值", () => {
        const r = unwrapOrElse(err("not_found"), (e) => `fallback: ${e}`);
        vitestExpect(r).toBe("fallback: not_found");
    });
});
describe("expect", () => {
    it("expect 在 Ok 时返回值", () => {
        vitestExpect(expect(ok(42), "should be 42")).toBe(42);
    });
    it("expect 在 Err 时抛出带自定义消息的 PanicError", () => {
        vitestExpect(() => expect(err("fail"), "custom message")).toThrow("custom message");
    });
});
// ─── 转换 ─────────────────────────────────────────────
describe("map", () => {
    it("map 在 Ok 时应用转换函数", () => {
        const r = map(ok(42), (n) => n.toString());
        vitestExpect(unwrap(r)).toBe("42");
    });
    it("map 在 Err 时保持不变", () => {
        const r = map(err("fail"), (n) => n.toString());
        vitestExpect(isErr(r)).toBe(true);
    });
});
describe("mapErr", () => {
    it("mapErr 在 Err 时应用转换函数", () => {
        const r = mapErr(err("not_found"), (e) => `error: ${e}`);
        if (isErr(r)) {
            vitestExpect(r.error).toBe("error: not_found");
        }
    });
    it("mapErr 在 Ok 时保持不变", () => {
        const r = mapErr(ok(42), (e) => `error: ${e}`);
        vitestExpect(unwrap(r)).toBe(42);
    });
});
// ─── 链式操作 ─────────────────────────────────────────
describe("andThen", () => {
    it("andThen 在 Ok 时链式调用", () => {
        const r = andThen(ok(42), (n) => ok(n * 2));
        vitestExpect(unwrap(r)).toBe(84);
    });
    it("andThen 在 Ok 时返回 Err 可提前终止链", () => {
        const r = andThen(ok(42), (_n) => err("chain failed"));
        vitestExpect(isErr(r)).toBe(true);
    });
    it("andThen 在 Err 时跳过链式调用", () => {
        const r = andThen(err("fail"), (n) => ok(n * 2));
        vitestExpect(isErr(r)).toBe(true);
    });
});
describe("orElse", () => {
    it("orElse 在 Err 时恢复", () => {
        const r = orElse(err("not_found"), (_e) => ok("recovered"));
        vitestExpect(unwrap(r)).toBe("recovered");
    });
    it("orElse 在 Ok 时保持不变", () => {
        const r = orElse(ok(42), (_e) => ok(0));
        vitestExpect(unwrap(r)).toBe(42);
    });
});
// ─── 模式匹配 ─────────────────────────────────────────
describe("match", () => {
    it("match 的 ok 分支在 Ok 时被调用", () => {
        const r = match(ok(42), {
            ok: (val) => `Success: ${val}`,
            err: (_e) => "Error",
        });
        vitestExpect(r).toBe("Success: 42");
    });
    it("match 的 err 分支在 Err 时被调用", () => {
        const r = match(err("fail"), {
            ok: (val) => `Success: ${val}`,
            err: (e) => `Error: ${e}`,
        });
        vitestExpect(r).toBe("Error: fail");
    });
});
// ─── try/catch 桥接 ───────────────────────────────────
describe("tryCatch", () => {
    it("tryCatch 在函数不抛异常时返回 Ok", () => {
        const r = tryCatch(() => 42, (_e) => "error");
        vitestExpect(unwrap(r)).toBe(42);
    });
    it("tryCatch 在函数抛出异常时返回 Err", () => {
        const r = tryCatch(() => { throw new Error("boom"); }, (e) => `caught: ${e instanceof Error ? e.message : String(e)}`);
        if (isErr(r)) {
            vitestExpect(r.error).toBe("caught: boom");
        }
    });
});
describe("tryCatchAsync", () => {
    it("tryCatchAsync 在 Promise resolve 时返回 Ok", async () => {
        const r = await tryCatchAsync(async () => 42, (_e) => "error");
        vitestExpect(unwrap(r)).toBe(42);
    });
    it("tryCatchAsync 在 Promise reject 时返回 Err", async () => {
        const r = await tryCatchAsync(async () => { throw new Error("async boom"); }, (e) => `caught: ${e instanceof Error ? e.message : String(e)}`);
        if (isErr(r)) {
            vitestExpect(r.error).toBe("caught: async boom");
        }
    });
});
// ─── 集合操作 ─────────────────────────────────────────
describe("fromNullable", () => {
    it("fromNullable 在值不为 null/undefined 时返回 Ok", () => {
        const r = fromNullable(42, () => "null");
        vitestExpect(unwrap(r)).toBe(42);
    });
    it("fromNullable 在值为 null 时返回 Err", () => {
        const r = fromNullable(null, () => "value is null");
        if (isErr(r)) {
            vitestExpect(r.error).toBe("value is null");
        }
    });
    it("fromNullable 在值为 undefined 时返回 Err", () => {
        const r = fromNullable(undefined, () => "value is undefined");
        if (isErr(r)) {
            vitestExpect(r.error).toBe("value is undefined");
        }
    });
});
describe("all", () => {
    it("all 在全部为 Ok 时返回包含所有值的 Ok 数组", () => {
        const r = all([ok(1), ok(2), ok(3)]);
        vitestExpect(unwrap(r)).toEqual([1, 2, 3]);
    });
    it("all 在任一为 Err 时返回第一个 Err", () => {
        const r = all([ok(1), err("fail"), ok(3)]);
        if (isErr(r)) {
            vitestExpect(r.error).toBe("fail");
        }
    });
});
// ─── 辅助 ─────────────────────────────────────────────
describe("toString", () => {
    it("toString 格式化 Ok 变体", () => {
        vitestExpect(toString(ok(42))).toBe("Ok(42)");
    });
    it("toString 格式化 Err 变体", () => {
        vitestExpect(toString(err("fail"))).toBe("Err(fail)");
    });
    it("toString 在值包含非字符串时仍能输出", () => {
        vitestExpect(toString(ok(null))).toBe("Ok(null)");
    });
});
//# sourceMappingURL=result.test.js.map