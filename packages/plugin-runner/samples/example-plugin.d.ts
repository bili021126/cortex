/**
 * @cortex/plugin-runner — 示例插件实现
 *
 * 展示如何继承 AbstractPlugin 实现一个二级插件。
 * 所有生命周期方法（init / execute / destroy）均返回 Promise<void>，
 * 执行结果通过 ExecuteContext.output 传递。
 *
 * 供集成测试和开发者参考。
 */
import { AbstractPlugin } from "../src/plugin.js";
import type { ExecuteContext } from "../src/types.js";
/**
 * 示例插件：将输入文本转为大写。
 */
export declare class UpperCasePlugin extends AbstractPlugin {
    readonly name = "upper-case";
    readonly version = "1.0.0";
    readonly description = "\u5C06\u8F93\u5165\u6587\u672C\u8F6C\u4E3A\u5927\u5199";
    readonly tags: string[];
    execute(context: ExecuteContext): Promise<void>;
}
/**
 * 示例插件：延迟执行，模拟耗时操作。
 */
export declare class DelayPlugin extends AbstractPlugin {
    readonly name = "delay";
    readonly version = "1.0.0";
    readonly description = "\u5EF6\u8FDF\u6307\u5B9A\u6BEB\u79D2\u6570\u540E\u8FD4\u56DE";
    readonly tags: string[];
    execute(context: ExecuteContext): Promise<void>;
}
//# sourceMappingURL=example-plugin.d.ts.map