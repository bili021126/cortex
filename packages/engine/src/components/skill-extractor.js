import { extractJsonBlock, getTagVocabulary } from "@cortex/shared";
/** 解析 outputFile 模板变量：{date} → YYYY-MM-DD, {time} → HH-MM-SS */
export function resolveOutputFile(template) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return template
        .replace(/\{date\}/g, `${y}-${m}-${d}`)
        .replace(/\{time\}/g, `${hh}-${mm}-${ss}`);
}
/**
 * 从 LoopAgent 的 LLM 输出中提取 SkillTemplate JSON。
 *
 * 支持两种输出格式：
 *   1. 单个 SkillTemplate JSON 对象
 *   2. SkillTemplate JSON 数组
 *
 * 提取策略：
 *   1. 优先匹配 ```json ... ``` 围栏
 *   2. 回退到最外层平衡 { } 或 [ ] 结构
 *   3. 验证必需字段完整性
 *   4. 为缺失字段填充安全默认值
 */
export function extractSkillsFromOutput(raw) {
    const diagnostics = [];
    const skills = [];
    if (!raw || raw.trim().length === 0) {
        diagnostics.push("空输出，无技能可提取");
        return { skills, diagnostics };
    }
    // 步骤1：提取 JSON 文本
    const jsonStr = extractJsonBlock(raw);
    if (!jsonStr) {
        diagnostics.push(`无法从 ${raw.length} 字符的输出中提取 JSON`);
        return { skills, diagnostics };
    }
    // 步骤2：解析 JSON
    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    }
    catch (e) {
        diagnostics.push(`JSON 解析失败: ${String(e).slice(0, 200)}`);
        return { skills, diagnostics };
    }
    // 步骤3：规范化数组
    const items = Array.isArray(parsed) ? parsed : [parsed];
    // 步骤4：验证 + 填充
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof item !== "object" || item === null) {
            diagnostics.push(`条目[${i}]不是对象，跳过`);
            continue;
        }
        const result = normalizeSkillTemplate(item, diagnostics);
        if (result) {
            skills.push(result);
        }
        else {
            diagnostics.push(`条目[${i}]验证失败，跳过`);
        }
    }
    return { skills, diagnostics };
}
/**
 * 规范化：验证字段完整性 + 填充安全默认值。
 * 返回 null 表示完全无效（连核心字段都没有）。
 */
function normalizeSkillTemplate(raw, diagnostics) {
    // 必需：id
    let id = typeof raw.id === "string" ? raw.id : "";
    if (!id) {
        // 无 id 自动生成
        id = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        diagnostics.push(`缺少 id，自动生成: ${id}`);
    }
    // 必需：name（至少要有描述性标题）
    const name = typeof raw.name === "string" ? raw.name : "";
    if (!name) {
        diagnostics.push(`技能 ${id} 缺少 name，跳过`);
        return null;
    }
    // 必需：kind
    const kind = normalizeSkillKind(raw.kind ?? raw.agentType, diagnostics, id);
    // 必需：triggerTags
    const triggerTags = normalizeTriggerTags(raw.triggerTags ?? raw.trigger_tags, diagnostics, id);
    // 必需：trigger
    const trigger = typeof raw.trigger === "string" ? raw.trigger : "";
    // 必需：steps
    const steps = normalizeSteps(raw.steps ?? raw.steps_json, id);
    if (steps.length === 0) {
        diagnostics.push(`技能 ${id} 缺少 steps，跳过`);
        return null;
    }
    // 可选：expectedOutput
    const expectedOutput = typeof raw.expectedOutput === "string" || typeof raw.expected_output === "string"
        ? (raw.expectedOutput ?? raw.expected_output)
        : "";
    // 可选：outputFile（解析模板变量 {date}/{time}）
    const rawOutputFile = typeof raw.outputFile === "string" || typeof raw.output_file === "string"
        ? (raw.outputFile ?? raw.output_file)
        : undefined;
    const outputFile = rawOutputFile ? resolveOutputFile(rawOutputFile) : undefined;
    // 状态：默认为 trial（需验证后升级为 active）
    const status = normalizeStatus(raw.status, diagnostics, id);
    return {
        id,
        kind,
        name,
        triggerTags,
        trigger,
        steps,
        expectedOutput,
        outputFile,
        status,
        weight: typeof raw.weight === "number" ? raw.weight : (typeof raw.adoptionCount === "number" ? raw.adoptionCount : 0),
        feedbackHistory: Array.isArray(raw.feedbackHistory) ? raw.feedbackHistory : [],
        discoveredBy: typeof raw.discoveredBy === "string" ? raw.discoveredBy : "LoopAgent",
        createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    };
}
/** 规范化 skillKind */
function normalizeSkillKind(raw, diagnostics, skillId) {
    if (typeof raw === "string") {
        const known = ["action", "thought", "workflow"];
        if (known.includes(raw))
            return raw;
        // 容错：旧版 agentType → kind 映射
        const agentTypeAliasMap = {
            "cod": "action", "rev": "action",
            "analy": "thought", "op": "action",
            "loop": "workflow", "doc": "thought",
            "fix": "action", "ins": "action",
            "brow": "action", "api": "action",
            "data": "thought", "strat": "thought",
        };
        if (agentTypeAliasMap[raw])
            return agentTypeAliasMap[raw];
    }
    diagnostics.push(`技能 ${skillId} kind 无效，默认 action`);
    return "action";
}
/** 规范化 triggerTags */
function normalizeTriggerTags(raw, diagnostics, skillId) {
    if (!Array.isArray(raw)) {
        diagnostics.push(`技能 ${skillId} triggerTags 不是数组，设为空`);
        return [];
    }
    const vocabSet = new Set(getTagVocabulary());
    const tags = raw
        .filter((t) => typeof t === "string")
        .map((t) => {
        if (!vocabSet.has(t)) {
            diagnostics.push(`技能 ${skillId} 的标签 "${t}" 不在预定义词汇表中——保留为自定义标签，请确认 MetaAgent 节点标签与之匹配`);
        }
        return t;
    });
    if (tags.length === 0) {
        diagnostics.push(`技能 ${skillId} triggerTags 为空（所有标签被过滤）`);
    }
    return tags;
}
/** 规范化 steps */
function normalizeSteps(raw, _skillId) {
    if (!Array.isArray(raw)) {
        if (typeof raw === "string") {
            // 容错：LLM 可能输出逗号分隔的字符串
            return raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        }
        return [];
    }
    return raw.filter((s) => typeof s === "string" && s.trim().length > 0);
}
/** 规范化 status */
function normalizeStatus(raw, diagnostics, skillId) {
    const valid = ["trial", "active", "deprecated"];
    if (typeof raw === "string" && valid.includes(raw)) {
        // 安全约束：LLM 输出不能直接声明为 active
        if (raw === "active") {
            diagnostics.push(`技能 ${skillId} status="active" 降级为 "trial"，需人工审核后升级`);
            return "trial";
        }
        return raw;
    }
    return "trial";
}
//# sourceMappingURL=skill-extractor.js.map