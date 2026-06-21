// ============================================================
// skill-json-validator.ts —— 外源技能 JSON 校验器
//
// 从 @cortex/skill-validator 合并而来，纳入 engine 组件管线。
// 负责校验 skills/*.json 等外源技能清单的结构和字段合法性，
// 并提供外源格式 → SkillTemplate 的转化桥。
//
// 架构：组件化可插拔——
//   每个 SkillJsonValidator 是一个独立校验组件，实现统一接口。
//   新增校验规则只需添加一个组件并注册到 VALIDATOR_REGISTRY。
//
// @merged-from @cortex/skill-validator
// ============================================================
import { AgentType } from "@cortex/shared";
// ─── 常量 ─────────────────────────────────────────────────
/** Unix 毫秒时间戳下限（2000-01-01T00:00:00Z） */
const TIMESTAMP_MIN_MS = 946_684_800_000;
/** Unix 毫秒时间戳上限（2100-01-01T00:00:00Z） */
const TIMESTAMP_MAX_MS = 4_102_444_800_000;
/** 所有合法的 AgentType 字符串值（从枚举动态派生） */
const VALID_AGENT_TYPES = new Set(Object.values(AgentType));
/** 合法的技能状态值 */
const VALID_STATUSES = new Set([
    "draft",
    "trial",
    "active",
    "deprecated",
]);
/** 必填字段列表（放宽：adoptionCount/rejectionCount 非必填） */
const REQUIRED_FIELDS = [
    { name: "id", type: "string" },
    { name: "name", type: "string" },
    { name: "triggerTags", type: "array" },
    { name: "trigger", type: "string" },
    { name: "steps", type: "array" },
    { name: "expectedOutput", type: "string" },
    { name: "discoveredBy", type: "string" },
];
/** 可选但需类型校验的字段 */
const OPTIONAL_TYPED_FIELDS = [
    { name: "agentType", type: "string" },
    { name: "outputFile", type: "string" },
    { name: "status", type: "string" },
    { name: "weight", type: "number" },
    { name: "adoptionCount", type: "number" },
    { name: "rejectionCount", type: "number" },
    { name: "createdAt", type: "number" },
];
function checkType(value, type) {
    if (type === "string")
        return typeof value === "string";
    if (type === "number")
        return typeof value === "number" && !Number.isNaN(value);
    if (type === "array")
        return Array.isArray(value);
    if (type === "object")
        return typeof value === "object" && value !== null && !Array.isArray(value);
    return false;
}
function describeType(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value;
}
// ─── 可插拔校验组件实现 ───────────────────────────────────
const requiredFieldsValidator = {
    name: "required-fields",
    validate(data) {
        const errors = [];
        for (const field of REQUIRED_FIELDS) {
            const value = data[field.name];
            if (value === undefined || value === null) {
                errors.push({
                    field: field.name,
                    message: `缺少必填字段 "${field.name}"`,
                    code: "MISSING_REQUIRED_FIELD",
                });
                continue;
            }
            if (!checkType(value, field.type)) {
                errors.push({
                    field: field.name,
                    message: `字段 "${field.name}" 类型错误：期望 ${field.type}，实际 ${describeType(value)}`,
                    code: "INVALID_FIELD_TYPE",
                });
            }
        }
        // 校验可选字段类型（存在但类型错误）
        for (const field of OPTIONAL_TYPED_FIELDS) {
            const value = data[field.name];
            if (value !== undefined && value !== null && !checkType(value, field.type)) {
                errors.push({
                    field: field.name,
                    message: `字段 "${field.name}" 类型错误：期望 ${field.type}，实际 ${describeType(value)}`,
                    code: "INVALID_FIELD_TYPE",
                });
            }
        }
        return { errors, warnings: [] };
    },
};
const agentTypeValidator = {
    name: "agent-type",
    validate(data) {
        const errors = [];
        const agentType = data.agentType;
        if (typeof agentType !== "string") {
            return { errors, warnings: [] };
        }
        if (!VALID_AGENT_TYPES.has(agentType)) {
            errors.push({
                field: "agentType",
                message: `无效的 agentType "${agentType}"：必须是有效的 AgentType 枚举值`,
                code: "INVALID_AGENT_TYPE",
            });
        }
        return { errors, warnings: [] };
    },
};
const statusValidator = {
    name: "status",
    validate(data) {
        const errors = [];
        const status = data.status;
        if (typeof status !== "string") {
            return { errors, warnings: [] };
        }
        if (!VALID_STATUSES.has(status)) {
            errors.push({
                field: "status",
                message: `无效的 status "${status}"：必须是 "draft" | "trial" | "active" | "deprecated"`,
                code: "INVALID_STATUS",
            });
        }
        return { errors, warnings: [] };
    },
};
const numericFieldsValidator = {
    name: "numeric-fields",
    validate(data) {
        const errors = [];
        const numericFields = [
            { key: "weight", code: "INVALID_WEIGHT" },
            { key: "adoptionCount", code: "INVALID_ADOPTION_COUNT" },
            { key: "rejectionCount", code: "INVALID_REJECTION_COUNT" },
        ];
        for (const { key, code } of numericFields) {
            const value = data[key];
            if (typeof value === "number" && !Number.isNaN(value)) {
                if (value < 0 || !Number.isInteger(value)) {
                    errors.push({
                        field: key,
                        message: `${key} 必须是非负整数，实际为 ${value}`,
                        code,
                    });
                }
            }
        }
        return { errors, warnings: [] };
    },
};
const stepsValidator = {
    name: "steps",
    validate(data) {
        const warnings = [];
        if (!Array.isArray(data.steps)) {
            return { errors: [], warnings };
        }
        if (data.steps.length === 0) {
            warnings.push({
                field: "steps",
                message: "steps 数组为空，应包含至少一个步骤描述",
                code: "EMPTY_STEPS",
            });
        }
        for (const [index, step] of data.steps.entries()) {
            if (typeof step !== "string")
                continue;
            if (step.trim().length < 5) {
                warnings.push({
                    field: `steps[${index}]`,
                    message: `步骤描述过短（${step.trim().length} 字符），建议至少 10 个字符`,
                    code: "STEP_TOO_SHORT",
                });
            }
        }
        return { errors: [], warnings };
    },
};
const triggerTagsValidator = {
    name: "trigger-tags",
    validate(data) {
        const warnings = [];
        if (!Array.isArray(data.triggerTags)) {
            return { errors: [], warnings };
        }
        if (data.triggerTags.length === 0) {
            warnings.push({
                field: "triggerTags",
                message: "triggerTags 数组为空，技能将无法被标签匹配触发",
                code: "EMPTY_TRIGGER_TAGS",
            });
        }
        for (const [index, tag] of data.triggerTags.entries()) {
            if (typeof tag !== "string") {
                warnings.push({
                    field: `triggerTags[${index}]`,
                    message: `triggerTags[${index}] 应为字符串`,
                    code: "INVALID_TAG_TYPE",
                });
            }
            else if (tag.trim().length === 0) {
                warnings.push({
                    field: `triggerTags[${index}]`,
                    message: `triggerTags[${index}] 为空字符串`,
                    code: "EMPTY_TAG",
                });
            }
        }
        return { errors: [], warnings };
    },
};
const createdAtValidator = {
    name: "created-at",
    validate(data) {
        const warnings = [];
        const createdAt = data.createdAt;
        if (typeof createdAt !== "number" || Number.isNaN(createdAt) || createdAt === 0) {
            return { errors: [], warnings };
        }
        if (createdAt < TIMESTAMP_MIN_MS || createdAt > TIMESTAMP_MAX_MS) {
            warnings.push({
                field: "createdAt",
                message: `createdAt (${createdAt}) 不在合理时间戳范围内（2000-2100 年）`,
                code: "SUSPICIOUS_TIMESTAMP",
            });
        }
        return { errors: [], warnings };
    },
};
// ─── 校验组件注册表 ───────────────────────────────────────
const VALIDATOR_REGISTRY = [
    requiredFieldsValidator,
    agentTypeValidator,
    statusValidator,
    numericFieldsValidator,
    stepsValidator,
    triggerTagsValidator,
    createdAtValidator,
];
// ─── 主校验函数 ───────────────────────────────────────────
/**
 * 校验外源技能 JSON 对象的结构和字段合法性。
 *
 * 内部通过 VALIDATOR_REGISTRY 逐组件执行校验。
 * 即使早期组件产生 error，后续组件仍会继续执行以收集完整的诊断信息。
 *
 * @param json - 从 JSON 解析得到的任意值
 * @returns 校验结果
 */
export function validateExternalSkillJson(json) {
    const errors = [];
    const warnings = [];
    const infos = [];
    // 顶层类型校验
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
        errors.push({
            field: "(root)",
            message: "输入必须是 JSON 对象（非数组、非 null）",
            code: "INVALID_ROOT_TYPE",
        });
        return { valid: false, errors, warnings, infos };
    }
    const data = json;
    // 逐组件执行校验——所有组件都会执行，不因单个组件失败而短路
    for (const validator of VALIDATOR_REGISTRY) {
        const result = validator.validate(data);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        infos,
    };
}
// ─── 转化桥：外源 JSON → SkillTemplate ────────────────────
/** agentType → SkillKind 映射表 */
const AGENT_TYPE_TO_KIND = {
    cod: "action",
    rev: "action",
    analy: "thought",
    op: "action",
    loop: "workflow",
    doc: "thought",
    fix: "action",
    ins: "action",
    brow: "action",
    data: "thought",
    strat: "thought",
};
/** 规范化 kind：优先使用 kind 字段，回退到 agentType 映射 */
function resolveKind(data) {
    if (typeof data.kind === "string") {
        const known = ["action", "thought", "workflow"];
        if (known.includes(data.kind))
            return data.kind;
    }
    if (typeof data.agentType === "string") {
        const mapped = AGENT_TYPE_TO_KIND[data.agentType];
        if (mapped)
            return mapped;
    }
    return "action";
}
/** 安全约束：status="active" 外部输入需降级为 trial */
function resolveStatus(raw) {
    if (raw === "active")
        return "trial"; // 外部声明 active 不可信
    if (raw === "deprecated")
        return "deprecated";
    if (raw === "draft")
        return "trial";
    return "trial";
}
/**
 * 将已通过 validateExternalSkillJson 校验的外源 JSON 转化为 SkillTemplate。
 *
 * 此函数假设数据已通过校验——不会因字段缺失而崩溃，
 * 但仍会为边界情况提供安全的默认值。
 *
 * @param data - 已校验的外源技能 JSON 对象
 * @returns SkillTemplate——可直接注册到 SkillRegistry
 */
export function externalJsonToSkillTemplate(data) {
    const now = Date.now();
    // triggerTags：过滤纯字符串标签
    const triggerTags = Array.isArray(data.triggerTags)
        ? data.triggerTags.filter((t) => typeof t === "string" && t.trim().length > 0)
        : [];
    // steps：过滤纯字符串步骤
    const steps = Array.isArray(data.steps)
        ? data.steps.filter((s) => typeof s === "string" && s.trim().length > 0)
        : [];
    // weight：优先 weight，回退到 adoptionCount - rejectionCount
    let weight = 0;
    if (typeof data.weight === "number" && Number.isFinite(data.weight)) {
        weight = Math.max(0, Math.round(data.weight));
    }
    else if (typeof data.adoptionCount === "number" || typeof data.rejectionCount === "number") {
        const adoption = typeof data.adoptionCount === "number" ? Math.max(0, Math.round(data.adoptionCount)) : 0;
        const rejection = typeof data.rejectionCount === "number" ? Math.max(0, Math.round(data.rejectionCount)) : 0;
        weight = Math.max(0, adoption - rejection);
    }
    return {
        id: String(data.id ?? `ext-${now}-${Math.random().toString(36).slice(2, 8)}`),
        kind: resolveKind(data),
        name: String(data.name ?? "未命名技能"),
        triggerTags,
        trigger: String(data.trigger ?? ""),
        steps,
        expectedOutput: String(data.expectedOutput ?? ""),
        outputFile: typeof data.outputFile === "string" ? data.outputFile : undefined,
        status: resolveStatus(typeof data.status === "string" ? data.status : undefined),
        weight,
        feedbackHistory: Array.isArray(data.feedbackHistory)
            ? data.feedbackHistory
            : [],
        discoveredBy: String(data.discoveredBy ?? "external-import"),
        createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
        tagHits: undefined,
    };
}
/**
 * 外源技能导入一站式管线：校验 → 转化 → 返回 SkillTemplate。
 *
 * 校验不通过时返回 null（外部调用方应先检查 validationResult）。
 *
 * @param json - 从外源 JSON 文件解析的原始数据
 * @returns 转化后的 SkillTemplate，校验失败时返回 null
 */
export function importExternalSkill(json) {
    const validation = validateExternalSkillJson(json);
    if (!validation.valid) {
        return { template: null, validation };
    }
    const template = externalJsonToSkillTemplate(json);
    return { template, validation };
}
//# sourceMappingURL=skill-json-validator.js.map