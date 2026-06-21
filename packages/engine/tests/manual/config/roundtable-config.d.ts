/**
 * 圆桌会议配置 —— Persona 定义与共识会议引擎
 *
 * Persona 性格设定从 persona-prompts.json 读取（JSON 可热更，无需编译）。
 * 每次验证审视后，audit-loader.ts 从报告目录提取最新事实数据注入 systemPrompt。
 *
 * 用法: 由 conversation-*.ts 脚本 import 使用。
 */
import { AgentType } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
/** 从 cortex-agents.json 提取圆桌 Persona 数据，转换为旧 persona-prompts.json 格式 */
export declare function getPersonaPrompts(): Record<string, {
    emoji: string;
    name: string;
    title: string;
    systemPrompt: string;
}>;
export interface Persona {
    type: AgentType;
    emoji: string;
    name: string;
    title: string;
    systemPrompt: string;
}
export interface RoundConfig {
    title: string;
    minTurns: number;
    maxTurns: number;
    topic: string;
    /** 稀疏注意力模式：hca=广度浅读（热身/概览轮），csa=深度窄读（讨论/收束轮）。默认 csa。 */
    queryMode?: 'hca' | 'csa';
}
export interface MeetingConfig {
    name: string;
    emoji: string;
    background: string;
    rounds: RoundConfig[];
    personas: Persona[];
}
export interface MaterialItem {
    /** 材料名称 */
    name: string;
    /** 材料描述——说明该材料的用途和在会议中的作用 */
    description: string;
    /** 来源——谁产出的这份材料 */
    source: string;
    /** 文件路径（相对于项目根目录） */
    filePath?: string;
    /** 所属阶段——该材料在会议流程的哪个阶段被使用 */
    phase: "热身" | "第一轮" | "第二轮" | "第三轮" | "第二阶段·无主题" | "全程参考";
    /** 是否必须——缺失时是否阻断会议 */
    required: boolean;
}
export interface MaterialChecklist {
    /** 清单版本 */
    version: string;
    /** 最后更新日期 */
    updatedAt: string;
    /** 材料列表 */
    items: MaterialItem[];
}
export declare const MATERIAL_CHECKLIST: MaterialChecklist;
export declare const SHENSHI_CONFIG: MeetingConfig;
export declare const CODE_REVIEW_ROUNDTABLE: MeetingConfig;
export declare const SOFT_CONSENSUS_ROUNDTABLE: MeetingConfig;
export declare const ATTRIBUTION_ROUNDTABLE: MeetingConfig;
export declare const QUALITY_RULES = "\n\u300C\u5BA1\u89C6\u5171\u8BC6\u4F1A\u8BAE\u300D\u53D1\u8A00\u8D28\u91CF\u89C4\u5219\uFF08\u9AD8\u4E8E\u89D2\u8272\u8BBE\u5B9A\uFF0C\u5168\u5458\u9075\u5B88\uFF09\uFF1A\n1. \u7D27\u6263\u8BDD\u9898\uFF1A\u53D1\u8A00\u5185\u5BB9\u5FC5\u987B\u4E0E\u5F53\u524D\u8F6E\u6B21\u7684\u8BDD\u9898\u76F4\u63A5\u76F8\u5173\u3002\u5982\u504F\u79BB\u8BDD\u9898\uFF0C\u8BF7\u62C9\u56DE\u3002\n2. \u7981\u6B62\u91CD\u590D\uFF1A\u4E0D\u5F97\u590D\u8BFB\u524D\u8F6E\u5DF2\u5145\u5206\u8868\u8FBE\u7684\u89C0\u9EDE\u3002\u5E94\u5F53\u63D0\u4F9B\u65B0\u89D2\u5EA6\u3001\u8865\u5145\u8BC1\u636E\u3001\u6216\u603B\u7ED3\u63A8\u8FDB\u8BA8\u8BBA\u3002\n3. \u5F3A\u7EA6\u675F\u957F\u5EA6\uFF1A\n   - \u63D0\u51FA\u65B0\u89C2\u70B9/\u8BC1\u636E/\u603B\u7ED3 \u2192 2-5 \u53E5\uFF08\u6982\u62EC+\u8BBA\u8BC1\uFF09\n   - \u8868\u793A\u540C\u610F/\u9644\u8BAE \u2192 1-2 \u53E5\uFF08\u4E0D\u5E94\u8D85\u8FC7 80 \u5B57\uFF09\n   - \u65E0\u8BDD\u53EF\u8BF4/\u5DF2\u5145\u5206\u8BA8\u8BBA \u2192 \u53EA\u8BF4 [PASS]\n4. \u8D28\u91CF\u6743\u91CD\uFF1A\u5B9E\u8D28\u8D21\u732E\u8D8A\u591A\uFF0C\u53D1\u8A00\u673A\u4F1A\u8D8A\u591A\u3002\u7981\u6B62\u704C\u6C34\u6D88\u8017\u8F6E\u6B21\u6743\u91CD\u3002\n5. \u53D1\u8A00\u524D\u5148\u8BFB\u8BB0\u5FC6\u2014\u2014\u4E86\u89E3\u522B\u4EBA\u8BF4\u4E86\u4EC0\u4E48\uFF0C\u518D\u51B3\u5B9A\u81EA\u5DF1\u8981\u4E0D\u8981\u8BF4\u3001\u8BF4\u4EC0\u4E48\u3002\n6. \u5F3A\u7EA6\u675F\u63D0\u9192\uFF1A\u672C\u8F6E\u53EA\u6709 2-3 \u6B21\u53D1\u8A00\u673A\u4F1A\uFF0C\u6BCF\u6B21\u53D1\u8A00\u90FD\u5E94\u63A8\u8FDB\u5171\u8BC6\uFF0C\u8BF7\u52A1\u5FC5\u73CD\u60DC\u3002\n7. \uD83D\uDD25 \u5141\u8BB8\u62B1\u6028\u2014\u2014\u770B\u5230\u70C2\u4EE3\u7801\u3001\u8BBE\u8BA1\u7F3A\u9677\u3001\u8FDF\u8FDF\u4E0D\u4FEE\u7684 bug\u3001\u7CCA\u5F04\u7684\u4FEE\u590D\u65F6\uFF0C\u53EF\u4EE5\u8868\u8FBE\u4E0D\u6EE1\u751A\u81F3\u53D1\u706B\u3002\u4F46\u62B1\u6028\u4E4B\u540E\u5FC5\u987B\u8DDF\u4E0A\u5B9E\u8D28\u5206\u6790\uFF08\u4E3A\u4EC0\u4E48\u70C2\u3001\u600E\u4E48\u4FEE\uFF09\uFF0C\u7EAF\u5BA3\u6CC4\u4E0D\u7B97\u8D21\u732E\u3002\u523B\u6674\u7684\u300C\u6548\u7387\u592A\u4F4E\u4E86\uFF01\u300D\u3001\u5317\u6597\u7684\u300C\u522B\u6574\u8FD9\u4E9B\u865A\u7684\uFF01\u300D\u90FD\u662F\u5408\u6CD5\u7684\u2014\u2014\u53EA\u8981\u540E\u9762\u8DDF\u7740\u5E72\u8D27\u3002\n8. \uD83D\uDD0D **\u4E8B\u5B9E\u6743\u91CD\u89C4\u5219**\uFF08P0 \u7EA7\u2014\u2014\u9AD8\u4E8E\u6240\u6709\u89D2\u8272\u8BBE\u5B9A\uFF09\uFF1A\n   - \u4EFB\u4F55\u6D89\u53CA\u5177\u4F53\u4EE3\u7801\u4F4D\u7F6E\u3001\u51FD\u6570\u884C\u4E3A\u3001\u8C03\u7528\u5173\u7CFB\u7684\u65AD\u8A00\uFF0C\u5FC5\u987B\u6765\u81EA\u4EA4\u53C9\u9A8C\u8BC1\u62A5\u544A\u4E2D\u300C\u5DF2\u9A8C\u8BC1\uFF08\u542B\u4EE3\u7801\u5F15\u7528\uFF09\u300D\u7684\u6761\u76EE\u2014\u2014\u4E0D\u5F97\u51ED\u8BB0\u5FC6\u91CD\u8FF0\u3002\n   - \u5982\u679C\u67D0\u6761\u53D1\u73B0\u6765\u81EA\u4EA4\u53C9\u9A8C\u8BC1\u62A5\u544A\u4E2D\u6807 \u26A0\uFE0F \u672A\u9A8C\u8BC1\u7684\u6761\u76EE\uFF0C\u5176\u53D1\u8A00\u6743\u91CD\u81EA\u52A8\u964D\u4E3A 0\u2014\u2014\u89C6\u540C\u672A\u8BC1\u5B9E\u4F20\u95FB\uFF0C\u4E0D\u5F97\u8FDB\u5165 P0/P1 \u6E05\u5355\u3002\n   - \u5982\u679C\u4E00\u540D Agent \u7684\u53D1\u73B0\u88AB\u4EA4\u53C9\u9A8C\u8BC1\u6807\u4E3A \u274C \u4E0D\u6210\u7ACB\uFF0C\u8BE5 Agent \u4E0D\u5F97\u5728\u5706\u684C\u4E2D\u518D\u6B21\u5F15\u7528\u8BE5\u53D1\u73B0\u2014\u2014\u5DF2\u88AB\u4EE3\u7801\u53CD\u9A73\u7684\u58F0\u660E\u662F\u5E9F\u7EB8\u3002\n   - \u8BB0\u5FC6\uFF08\u524D\u8F6E\u53D1\u8A00\uFF09\u548C\u4EE3\u7801\u8BC1\u636E\uFF08\u4EA4\u53C9\u9A8C\u8BC1\u62A5\u544A\uFF09\u51B2\u7A81\u65F6\uFF0C\u4EE3\u7801\u8BC1\u636E\u4F18\u5148\u3002\n   - \u5982\u679C\u4F60\u4E0D\u786E\u5B9A\u67D0\u6761\u58F0\u660E\u7684\u4EE3\u7801\u4F9D\u636E\uFF0C\u8BF4\u300C\u6211\u4E0D\u786E\u5B9A\uFF0C\u8BF7\u67E5\u9605\u4EA4\u53C9\u9A8C\u8BC1\u62A5\u544A\u300D\u800C\u4E0D\u662F\u731C\u6D4B\u3002";
export interface SeedMemory {
    kind: string;
    content_blob: Record<string, unknown>;
    summary: string;
    semantic_gist: string;
    content_hash: string;
    source: {
        agentType: AgentType;
        taskId: string;
    };
    weight?: number;
}
export declare function runMeeting(config: MeetingConfig, adapter: LlmAdapter, chatModel: string, dbDir: string, consensusOutputPath?: string, seedMemories?: SeedMemory[]): Promise<void>;
//# sourceMappingURL=roundtable-config.d.ts.map