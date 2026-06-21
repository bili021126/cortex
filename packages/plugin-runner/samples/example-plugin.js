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
/**
 * 示例插件：将输入文本转为大写。
 */
export class UpperCasePlugin extends AbstractPlugin {
    name = "upper-case";
    version = "1.0.0";
    description = "将输入文本转为大写";
    tags = ["transform", "text"];
    async execute(context) {
        const input = String(context.payload ?? "");
        context.output = input.toUpperCase();
    }
}
/**
 * 示例插件：延迟执行，模拟耗时操作。
 */
export class DelayPlugin extends AbstractPlugin {
    name = "delay";
    version = "1.0.0";
    description = "延迟指定毫秒数后返回";
    tags = ["utility", "timing"];
    async execute(context) {
        const ms = context.payload?.delayMs ?? 100;
        await new Promise((resolve) => setTimeout(resolve, ms));
        context.output = { delayed: ms };
    }
}
//# sourceMappingURL=example-plugin.js.map