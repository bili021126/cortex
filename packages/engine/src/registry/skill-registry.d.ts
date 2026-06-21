/**
 * SkillRegistry —— 莫娜技能池。
 *
 * 技能不是可执行函数，是 Agent 产出的结构化认知。
 * 技能即记忆：一个 Agent 对另一个 Agent 说"我曾这样做成过"。
 *
 * 设计宪法：
 *   - 技能是"被参照"而非"被执行"——执行权属于 Agent
 *   - 状态是衍生标签（deriveStatus），而非状态机
 *   - 可靠性来自评价累加（weight + feedbackHistory），而非二值判断
 *   - 三层权限：莫娜持有池子 → MetaAgent 建议标签 → 执行Agent 自主拉取
 *
 * 双路径入池：
 *   内生——Agent 产出 → Pipeline 事件 → 注册（trial, weight=0）
 *   外源——skills/*.json → Schema 校验 → 注册（trial, weight=0）
 *
 * 生命周期闭环：
 *   生产→注册→MetaAgent 建议→执行Agent 拉取→使用→评价回流→更新
 *
 * @since v2.6 — 技能系统重构：压扁两套 Registry，回归记忆本质
 * @moved-from @cortex/shared/src/skill-registry.ts
 */
import { type SkillTemplate, type SerializedSkillRegistry, type Tag, type FeedbackEntry } from "@cortex/shared";
/**
 * 从 weight 和评价次数推导状态标签。
 * 这不是状态机——是纯函数的标签化显示。
 *
 *   - trial:   weight <= 0 或尚无正向评价
 *   - active:  weight >= 1 且有至少一次正向评价
 *   - deprecated: 连续 3+ 条 rating=-1
 */
export declare function deriveStatus(weight: number, feedbackHistory: FeedbackEntry[]): "trial" | "active" | "deprecated";
export declare class SkillRegistry {
    /** 按标签索引 */
    private _byTag;
    /** 按 id 索引 */
    private _byId;
    /** 注册一个技能模板（有则覆盖） */
    register(template: SkillTemplate): void;
    /**
     * 注销技能模板。
     * 收集待删除 key 到数组后再统一删除，不在 for-of 中修改 Map。
     */
    unregister(id: string): boolean;
    /**
     * 按标签查询匹配的技能模板。
     * 匹配规则：template.triggerTags ∩ queryTags ≠ ∅
     * 仅返回 trial 或 active 状态的模板。
     */
    queryByTags(queryTags: Tag[]): SkillTemplate[];
    /** 按 id 获取 */
    get(id: string): SkillTemplate | undefined;
    /** 获取所有已注册技能 */
    getAll(): SkillTemplate[];
    /** 获取活跃技能数 */
    get activeCount(): number;
    /** 获取总数 */
    get totalCount(): number;
    /**
     * Agent 使用技能后，带回评价。
     * weight 累加，feedbackHistory 追加。
     * 这是技能闭环的核心——评价驱动进化。
     */
    recordFeedback(id: string, agentId: string, rating: number, suggestion?: string): boolean;
    /**
     * 清理孤技能——weight=0 且创建超过 maxAgeMs 毫秒未被领取的技能。
     * 返回被清理的技能 id 列表。
     */
    cleanupOrphans(maxAgeMs?: number): string[];
    /** 批量注册 */
    registerAll(templates: SkillTemplate[]): void;
    /** 清空注册表 */
    clear(): void;
    toJSON(): SerializedSkillRegistry;
    static fromJSON(data: SerializedSkillRegistry): SkillRegistry;
    /**
     * 序列化为 JSON 字符串。
     */
    toJSONString(): string;
}
//# sourceMappingURL=skill-registry.d.ts.map