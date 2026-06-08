import { getTagVocabulary, type FeedbackEntry, type SkillKind, type SkillTemplate, type Tag } from "@cortex/shared";

/** 解析 outputFile 模板变量：{date} → YYYY-MM-DD, {time} → HH-MM-SS */
export function resolveOutputFile(template: string): string {
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

/** 提取结果：成功提取的技能 + 解析诊断信息 */
export interface SkillExtractResult {
  skills: SkillTemplate[];
  diagnostics: string[];
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
export function extractSkillsFromOutput(raw: string): SkillExtractResult {
  const diagnostics: string[] = [];
  const skills: SkillTemplate[] = [];

  if (!raw || raw.trim().length === 0) {
    diagnostics.push("空输出，无技能可提取");
    return { skills, diagnostics };
  }

  // 步骤1：提取 JSON 文本
  const jsonStr = extractJson(raw);
  if (!jsonStr) {
    diagnostics.push(`无法从 ${raw.length} 字符的输出中提取 JSON`);
    return { skills, diagnostics };
  }

  // 步骤2：解析 JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
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

    const result = normalizeSkillTemplate(item as Record<string, unknown>, diagnostics);
    if (result) {
      skills.push(result);
    } else {
      diagnostics.push(`条目[${i}]验证失败，跳过`);
    }
  }

  return { skills, diagnostics };
}

/**
 * 规范化：验证字段完整性 + 填充安全默认值。
 * 返回 null 表示完全无效（连核心字段都没有）。
 */
function normalizeSkillTemplate(
  raw: Record<string, unknown>,
  diagnostics: string[],
): SkillTemplate | null {
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
    ? (raw.expectedOutput ?? raw.expected_output) as string
    : "";

  // 可选：outputFile（解析模板变量 {date}/{time}）
  const rawOutputFile = typeof raw.outputFile === "string" || typeof raw.output_file === "string"
    ? (raw.outputFile ?? raw.output_file) as string
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
    feedbackHistory: Array.isArray(raw.feedbackHistory) ? raw.feedbackHistory as FeedbackEntry[] : [],
    discoveredBy: typeof raw.discoveredBy === "string" ? raw.discoveredBy : "LoopAgent",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

/** 从 LLM 原始输出提取 JSON 子串 */
function extractJson(raw: string): string | null {
  // 优先 ```json ... ``` 围栏
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // 回退：最外层 { } 或 [ ]
  const trimmed = raw.trim();
  const startChar = trimmed[0];
  const endChar = startChar === "{" ? "}" : startChar === "[" ? "]" : null;
  if (!endChar) {
    // 尝试找到第一个 { 或 [
    const objStart = trimmed.indexOf("{");
    const arrStart = trimmed.indexOf("[");
    if (objStart === -1 && arrStart === -1) return null;
    const start = objStart === -1 ? arrStart :
      arrStart === -1 ? objStart :
      Math.min(objStart, arrStart);
    return extractBalanced(trimmed, start);
  }

  return extractBalanced(trimmed, 0);
}

/** 提取从 startIdx 开始的平衡括号内容 */
function extractBalanced(text: string, startIdx: number): string | null {
  const stack: string[] = [];
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      if (stack.length === 0) return null; // 不平衡
      const expected = stack.pop();
      if (expected === undefined) return null; // 不平衡
      if (stack.length === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return null; // 未闭合
}

/** 规范化 skillKind */
function normalizeSkillKind(
  raw: unknown,
  diagnostics: string[],
  skillId: string,
): SkillKind {
  if (typeof raw === "string") {
    const known: SkillKind[] = ["action", "thought", "workflow"];
    if (known.includes(raw as SkillKind)) return raw as SkillKind;

    // 容错：旧版 agentType → kind 映射
    const agentTypeAliasMap: Record<string, SkillKind> = {
      "cod": "action", "rev": "action",
      "analy": "thought", "op": "action",
      "loop": "workflow", "doc": "thought",
      "fix": "action", "ins": "action",
      "brow": "action", "api": "action",
      "data": "thought", "strat": "thought",
    };
    if (agentTypeAliasMap[raw]) return agentTypeAliasMap[raw];
  }
  diagnostics.push(`技能 ${skillId} kind 无效，默认 action`);
  return "action";
}

/** 规范化 triggerTags */
function normalizeTriggerTags(
  raw: unknown,
  diagnostics: string[],
  skillId: string,
): Tag[] {
  if (!Array.isArray(raw)) {
    diagnostics.push(`技能 ${skillId} triggerTags 不是数组，设为空`);
    return [];
  }
  const vocabSet = new Set<string>(getTagVocabulary());
  const tags = raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => {
      if (!vocabSet.has(t)) {
        diagnostics.push(`技能 ${skillId} 的标签 "${t}" 不在预定义词汇表中——保留为自定义标签，请确认 MetaAgent 节点标签与之匹配`);
      }
      return t;
    });
  if (tags.length === 0) {
    diagnostics.push(`技能 ${skillId} triggerTags 为空（所有标签被过滤）`);
  }
  return tags as Tag[];
}

/** 规范化 steps */
function normalizeSteps(raw: unknown, _skillId: string): string[] {
  if (!Array.isArray(raw)) {
    if (typeof raw === "string") {
      // 容错：LLM 可能输出逗号分隔的字符串
      return raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }
  return raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
}

/** 规范化 status */
function normalizeStatus(
  raw: unknown,
  diagnostics: string[],
  skillId: string,
): SkillTemplate["status"] {
  const valid = ["trial", "active", "deprecated"];
  if (typeof raw === "string" && valid.includes(raw)) {
    // 安全约束：LLM 输出不能直接声明为 active
    if (raw === "active") {
      diagnostics.push(`技能 ${skillId} status="active" 降级为 "trial"，需人工审核后升级`);
      return "trial";
    }
    return raw as SkillTemplate["status"];
  }
  return "trial";
}
