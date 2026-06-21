// @ci: unit
/**
 * @cortex/prompt-kit — PromptAssembler 单元测试
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PromptAssembler } from "../../src/assembler/prompt-assembler.js";
import { PromptTemplateEngine } from "../../src/template-engine/prompt-template-engine.js";
import { PromptBlockType } from "../../src/types.js";
describe("PromptAssembler", () => {
    let engine;
    let assembler;
    let defaultTemplate;
    let defaultAssembly;
    let defaultContext;
    beforeEach(() => {
        engine = new PromptTemplateEngine();
        assembler = new PromptAssembler(engine);
        defaultContext = {
            variables: {
                userName: "开拓者",
                role: "分析师",
                hasMemory: true,
            },
        };
        defaultTemplate = {
            id: "test-agent",
            name: "测试Agent",
            version: "1.0.0",
            blocks: [
                {
                    id: "identity",
                    type: PromptBlockType.Identity,
                    content: "你是{{role}}。",
                    priority: 10,
                },
                {
                    id: "instruction",
                    type: PromptBlockType.Instruction,
                    content: "请帮助{{userName}}完成任务。",
                    priority: 40,
                },
            ],
            tags: ["test"],
            source: "test",
        };
        defaultAssembly = {
            baseTemplateId: "test-agent",
            context: defaultContext,
            blockSeparator: "\n\n",
            injectIdentityAnchor: false,
        };
    });
    it("应组装完整的 PromptResult", async () => {
        const result = await assembler.assemble(defaultTemplate, defaultAssembly);
        expect(result).toBeDefined();
        expect(result.text).toBe("你是分析师。\n\n请帮助开拓者完成任务。");
        expect(result.templateId).toBe("test-agent");
        expect(result.version).toBe("1.0.0");
        expect(result.renderedBlocks).toHaveLength(2);
        expect(result.skippedBlocks).toHaveLength(0);
        expect(result.renderTimeMs).toBeGreaterThanOrEqual(0);
        expect(result.timestamp).toBeGreaterThan(0);
    });
    describe("块过滤", () => {
        it("condition=false 的块应被跳过", async () => {
            const template = {
                ...defaultTemplate,
                blocks: [
                    ...defaultTemplate.blocks,
                    {
                        id: "memory",
                        type: PromptBlockType.Context,
                        content: "记忆内容：{{memoryContext}}",
                        priority: 30,
                        condition: "hasMemory",
                    },
                    {
                        id: "secret",
                        type: PromptBlockType.Private,
                        content: "私有内容",
                        priority: 100,
                        condition: "false",
                    },
                ],
            };
            const result = await assembler.assemble(template, defaultAssembly);
            expect(result.renderedBlocks.map((b) => b.id)).toContain("memory");
            expect(result.renderedBlocks.map((b) => b.id)).not.toContain("secret");
            expect(result.skippedBlocks.map((b) => b.id)).toContain("secret");
        });
        it("activeBlockIds 白名单应过滤块", async () => {
            const assembly = {
                ...defaultAssembly,
                context: {
                    ...defaultContext,
                    activeBlockIds: ["identity"],
                },
            };
            const result = await assembler.assemble(defaultTemplate, assembly);
            expect(result.renderedBlocks).toHaveLength(1);
            expect(result.renderedBlocks[0].id).toBe("identity");
            expect(result.skippedBlocks.map((b) => b.id)).toContain("instruction");
        });
        it("自定义 blockFilter 应过滤块", async () => {
            const assembly = {
                ...defaultAssembly,
                context: {
                    ...defaultContext,
                    blockFilter: (block) => block.type !== PromptBlockType.Instruction,
                },
            };
            const result = await assembler.assemble(defaultTemplate, assembly);
            expect(result.renderedBlocks).toHaveLength(1);
            expect(result.skippedBlocks.map((b) => b.id)).toContain("instruction");
        });
        it("access_denied 原因应正确标记", async () => {
            const template = {
                ...defaultTemplate,
                blocks: [
                    {
                        id: "private",
                        type: PromptBlockType.Private,
                        content: "私密内容",
                        priority: 100,
                        accessLevel: "private",
                    },
                ],
            };
            const assembly = {
                ...defaultAssembly,
                context: {
                    ...defaultContext,
                    activeBlockIds: [], // 不包含 "private"
                },
            };
            const result = await assembler.assemble(template, assembly);
            expect(result.skippedBlocks.map((b) => b.reason)).toContain("access_denied");
        });
    });
    describe("块排序", () => {
        it("默认按 priority 升序排列", async () => {
            const template = {
                ...defaultTemplate,
                blocks: [
                    { id: "b1", type: PromptBlockType.Instruction, content: "指令1", priority: 50 },
                    { id: "b2", type: PromptBlockType.Identity, content: "身份", priority: 10 },
                    { id: "b3", type: PromptBlockType.Context, content: "上下文", priority: 30 },
                ],
            };
            const result = await assembler.assemble(template, defaultAssembly);
            expect(result.renderedBlocks[0].id).toBe("b2"); // priority 10
            expect(result.renderedBlocks[1].id).toBe("b3"); // priority 30
            expect(result.renderedBlocks[2].id).toBe("b1"); // priority 50
        });
        it("按类型排序应遵循固定顺序", async () => {
            const template = {
                ...defaultTemplate,
                blocks: [
                    { id: "b1", type: PromptBlockType.OutputFormat, content: "格式", priority: 1 },
                    { id: "b2", type: PromptBlockType.Identity, content: "身份", priority: 2 },
                ],
            };
            const assembly = {
                ...defaultAssembly,
                sortStrategy: "by_type",
            };
            const result = await assembler.assemble(template, assembly);
            expect(result.renderedBlocks[0].type).toBe(PromptBlockType.Identity);
            expect(result.renderedBlocks[1].type).toBe(PromptBlockType.OutputFormat);
        });
    });
    describe("身份锚点注入", () => {
        it("injectIdentityAnchor=true 应注入身份锚点块", async () => {
            const assembly = {
                ...defaultAssembly,
                injectIdentityAnchor: true,
            };
            const result = await assembler.assemble(defaultTemplate, assembly);
            expect(result.renderedBlocks[0].id).toBe("shared-identity-anchor");
            expect(result.renderedBlocks[0].content).toContain("身份锚点");
        });
        it("已包含锚点不应重复注入", async () => {
            const template = {
                ...defaultTemplate,
                blocks: [
                    {
                        id: "shared-identity-anchor",
                        type: PromptBlockType.Identity,
                        content: "已有锚点",
                        priority: 1,
                    },
                    ...defaultTemplate.blocks,
                ],
            };
            const assembly = {
                ...defaultAssembly,
                injectIdentityAnchor: true,
            };
            const result = await assembler.assemble(template, assembly);
            const anchorBlocks = result.renderedBlocks.filter((b) => b.id === "shared-identity-anchor");
            expect(anchorBlocks).toHaveLength(1);
        });
    });
    describe("额外块合并", () => {
        it("additionalBlocks 应追加到模板块之后", async () => {
            const assembly = {
                ...defaultAssembly,
                additionalBlocks: [
                    {
                        id: "extra-output",
                        type: PromptBlockType.OutputFormat,
                        content: "输出JSON格式",
                        priority: 60,
                    },
                ],
            };
            const result = await assembler.assemble(defaultTemplate, assembly);
            expect(result.renderedBlocks).toHaveLength(3);
            expect(result.renderedBlocks.map((b) => b.id)).toContain("extra-output");
        });
    });
    describe("预处理器与后处理器", () => {
        it("预处理器应能修改块列表", async () => {
            assembler.registerPreprocessor("add-greeting", (blocks) => {
                return [
                    {
                        id: "greeting",
                        type: PromptBlockType.Identity,
                        content: "你好！",
                        priority: 0,
                    },
                    ...blocks,
                ];
            });
            const result = await assembler.assemble(defaultTemplate, defaultAssembly);
            expect(result.renderedBlocks[0].id).toBe("greeting");
        });
        it("后处理器应能修改结果", async () => {
            assembler.registerPostprocessor("append-footer", (result) => {
                return {
                    ...result,
                    text: result.text + "\n--- 结束 ---",
                };
            });
            const result = await assembler.assemble(defaultTemplate, defaultAssembly);
            expect(result.text).toContain("--- 结束 ---");
        });
    });
    describe("自定义分隔符", () => {
        it("应使用自定义分隔符连接块", async () => {
            const assembly = {
                ...defaultAssembly,
                blockSeparator: "\n---\n",
            };
            const result = await assembler.assemble(defaultTemplate, assembly);
            expect(result.text).toContain("\n---\n");
            expect(result.text).not.toContain("\n\n"); // 默认分隔符
        });
    });
});
//# sourceMappingURL=assembler.test.js.map