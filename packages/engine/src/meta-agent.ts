import type { TaskNode, Tag, ImpactScope, ReplanResult, SafeErrorReporter } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { SkillRegistry } from "@cortex/shared";

/**
 * MetaAgent —— 战术引擎。
 * 接收用户意图，拆解为 TaskNode 树，写入 TaskBoard。
 * 独享 DeepSeek V4 Pro（reasoner 模型）。
 *
 * @contract 模块边界契约（久岐忍 P1-5：模块边界缺少显式契约化定义 → 已闭合）
 *
 *   plan(intent) → TaskNode[]：纯函数式规划，不写板
 *   requestReplan(failedNode, reason, count) → ReplanResult：基于失败诊断生成替代方案
 *
 *   调用方（Scheduler）的责任：
 *   - plan() 返回的 TaskNode[] 由调用方 add 到 TaskBoard
 *   - requestReplan() 返回的 nodes 由 Scheduler._drainReplanQueue add 到 TaskBoard（领而不执）
 *   - 调用方负责节点在 TaskBoard 中的生命周期管理
 *
 *   异常语义：
 *   - JSON 解析失败不抛异常——回退为单个 generic fallbackNode
 *   - LLM 调用失败由 LlmAdapter 抛出，调用方 catch
 *   - skillRegistry 缺失不阻塞规划——跳过技能增强
 *
 * 可选集成 SkillRegistry：规划时查询已沉淀的技能模板，
 * 注入 prompt 上下文，提升任务拆解精准度。
 */
export class MetaAgent {
  private _nodeCounter = 0; // 防 Date.now() 高频碰撞
  private _safeReporter?: SafeErrorReporter;
  private _skillRegistry?: SkillRegistry;

  constructor(private readonly llm: LlmAdapter, skillRegistry?: SkillRegistry) {
    this._skillRegistry = skillRegistry;
  }

  /** 注入技能注册表（可后置绑定） */
  setSkillRegistry(registry: SkillRegistry): void {
    this._skillRegistry = registry;
  }

  /** 注入错误上报通道（observer 双通道模式） */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
  }

  /**
   * 重规划：当节点执行失败时，基于"原始意图 vs 当前事实"的冲突生成替代方案。
   * @param failedNode 失败的节点（含 payload/tags/type 上下文）
   * @param reason 失败原因（Agent 错误信息）
   * @param replanCount 当前重规划轮次
   * @param originalIntent 原始用户意图（用于冲突对比）
   * @returns ReplanResult { nodes, impactScope }
   */
  async requestReplan(
    failedNode: TaskNode,
    reason: string,
    replanCount: number,
    originalIntent?: string,
  ): Promise<ReplanResult> {
    const prompt = [
      `Original intent: ${originalIntent ?? failedNode.payload}`,
      `Original task failed (attempt ${replanCount + 1}/${MAX_REPLAN}):`,
      `Task: ${failedNode.payload}`,
      `Tags: ${failedNode.tags.join(", ")}`,
      `Error: ${reason}`,
      "",
      "Analyze the conflict between the original plan and what actually happened.",
      "Generate an ALTERNATIVE approach. Do NOT repeat the same plan.",
      `Parent node ID: ${failedNode.parentId ?? "none"}`,
      "",
      "Also assess IMPACT SCOPE:",
      '- "local": only this node needs replacing. Downstream subtasks (children of this node) are still valid.',
      '- "subtree": this node\'s failure invalidates all downstream subtasks. The entire subtree must be replaced.',
      "",
      "Output JSON with two fields:",
      '{"tasks": [...], "impactScope": "local"|"subtree"}',
      "tasks: array of alternative TaskNode objects (1-4 tasks, simpler than original).",
      "impactScope: the assessed scope of impact.",
    ].join("\n");

    const res = await this.llm.chat(this.llm.reasonerModel, [
      { role: "system", content: REPLAN_SYSTEM },
      { role: "user", content: prompt },
    ]);

    return this._parseReplanResult(res.content ?? "", failedNode.parentId);
  }

  /**
   * 规划：将用户意图拆解为 TaskNode 列表。
   * 返回的节点 `parentId` 关系已建立，可直接 add 到 TaskBoard。
   */
  async plan(
    intent: string,
    context?: PlanContext,
  ): Promise<TaskNode[]> {
    const prompt = this._planningPrompt(intent, context);
    const res = await this.llm.chat(this.llm.reasonerModel, [
      { role: "system", content: PLANNING_SYSTEM },
      { role: "user", content: prompt },
    ]);

    return this._parsePlan(res.content ?? "", context?.parentId);
  }

  /** 生成规划 prompt */
  private _planningPrompt(intent: string, context?: PlanContext): string {
    const parts: string[] = [];

    if (context?.parentId) {
      parts.push(`Parent node: ${context.parentId}`);
    }
    if (context?.existingTags && context.existingTags.length > 0) {
      parts.push(`Existing context tags: ${context.existingTags.join(", ")}`);
    }

    // ── 技能增强：查询 SkillRegistry 匹配的技能模板 ──
    if (this._skillRegistry && context?.existingTags) {
      const matched = this._skillRegistry.queryByTags(context.existingTags as Tag[]);
      if (matched.length > 0) {
        const skillLines = matched.map((s) =>
          `  · ${s.name} (id:${s.id}) [${s.agentType}] tags:[${s.triggerTags.join(",")}] — ${s.trigger}`,
        );
        parts.push(
          `Available skill templates (pre-existing patterns):\n${skillLines.join("\n")}\n\n` +
          "You MAY reference these skills in your plan by mentioning their id in the payload. " +
          "These are vetted, repeatable workflows — prefer them over inventing new task sequences.",
        );
      }
    }

    parts.push(`User intent: ${intent}`);

    return parts.join("\n");
  }

  /** 从 LLM 输出提取 JSON（```json ... ``` 或纯字符串）。
   * 先尝试标记围栏，再尝试提取最外层平衡数组。
   * 括号匹配时识别 JSON 字符串边界，避免 payload 内的 [ ] 字符误导计数器。 */
  private _extractJson(raw: string): string {
    // 优先匹配 ```json ... ``` 标记围栏（非贪婪，匹配最近的闭合）
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) return fenceMatch[1];

    // 回退：提取最外层平衡 [ ... ] 数组
    const startIdx = raw.indexOf("[");
    if (startIdx === -1) return raw;

    let depth = 0;
    let inString = false;
    let stringChar = ""; // 当前字符串的引号字符（" 或 '）
    let escaped = false;

    for (let i = startIdx; i < raw.length; i++) {
      const ch = raw[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
          stringChar = "";
        }
        continue;
      }

      if (ch === "\"" || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) return raw.slice(startIdx, i + 1);
      }
    }
    return raw;
  }

  /** 构造兜底 TaskNode（JSON 解析失败时） */
  private _fallbackNode(raw: string, parentId?: string): TaskNode {
    return {
      id: `task-${Date.now()}-0`,
      parentId,
      type: "analysis",
      tags: ["analysis"] as Tag[],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: raw,
      results: [],
      createdAt: Date.now(),
    };
  }

  /** 从 LLM 输出解析 JSON 任务树 */
  private _parsePlan(raw: string, parentId?: string): TaskNode[] {
    // 多级容错策略：extractJson → raw直接 → 修复常见JSON问题
    const candidates = [
      this._extractJson(raw),
      raw, // LLM 可能直接输出干净 JSON
    ];

    for (const candidate of candidates) {
      const items = this._tryParseItems(candidate);
      if (items !== null) {
        return items.flatMap((item, i) => this._toTaskNode(item, parentId, i));
      }
    }

    const msg = `JSON 解析失败 (${raw.length} chars)，回退为单 generic 节点。原始输出前200字: ${raw.slice(0, 200)}`;
    if (this._safeReporter) {
      this._safeReporter({ source: "MetaAgent._parsePlan", error: msg, severity: "degraded" });
    } else {
      console.warn(`[meta-agent] ${msg}`);
    }
    return [this._fallbackNode(raw, parentId)];
  }

  /** 尝试解析 JSON 为 PlanItem[]，自动修复常见 LLM 格式问题 */
  private _tryParseItems(jsonStr: string): PlanItem[] | null {
    if (!jsonStr || jsonStr.length < 2) return null;

    // 策略 1: 直接解析
    try { return JSON.parse(jsonStr); } catch { /* continue */ }

    // 策略 2: 去除尾部多余逗号（LLM 经典错误）
    try { return JSON.parse(jsonStr.replace(/,\s*([}\]])/g, "$1")); } catch { /* continue */ }

    // 策略 3: 截取首 [ 到末 ]，再做一次字符串感知提取（双保险）
    const firstBracket = jsonStr.indexOf("[");
    const lastBracket = jsonStr.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const trimmed = jsonStr.slice(firstBracket, lastBracket + 1);
      try { return JSON.parse(trimmed); } catch { /* continue */ }
      try { return JSON.parse(trimmed.replace(/,\s*([}\]])/g, "$1")); } catch { /* continue */ }
    }

    return null;
  }

  /** 将 PlanItem 转为 TaskNode[]（自身 + 所有子孙） */
  private _toTaskNode(item: PlanItem, parentId: string | undefined, index: number): TaskNode[] {
    const now = Date.now();
    const nodeId = `task-${now}-${this._nodeCounter++}-${index}`;

    // 子任务递归——拿到的是扁平数组，每个子节点的 parentId 已指回当前节点
    const children: TaskNode[] = (item.children ?? []).flatMap((child, ci) =>
      this._toTaskNode(child, nodeId, ci),
    );

    // 推理深度：LLM 可显式指定，否则按标签智能默认
    const reasoningEffort: "high" | "max" =
      item.reasoningEffort ??
      (item.tags?.some((t) => t === "audit" || t === "constitution_check") ? "max" : "high");

    const self: TaskNode = {
      id: nodeId,
      parentId,
      type: item.type ?? "analysis",
      tags: (item.tags ?? ["code"]) as Tag[],
      needsMultiPerspective: item.needsMultiPerspective ?? false,
      status: "pending",
      claimedBy: [],
      payload: item.task,
      results: [],
      createdAt: now,
      reasoningEffort,
    };

    return [self, ...children];
  }

  /** 解析 ReplanResult：从 LLM 输出提取 tasks + impactScope */
  private _parseReplanResult(raw: string, parentId?: string): ReplanResult {
    const jsonStr = this._extractJson(raw);

    try {
      const parsed = JSON.parse(jsonStr);
      // 兼容两种格式：LLM 规范输出 {"tasks":[...], "impactScope":"..."}
      // 以及简洁数组格式 [{task, type, tags, ...}]
      const items: PlanItem[] = Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
      const impactScope: ImpactScope =
        (!Array.isArray(parsed) && parsed.impactScope === "subtree") ? "subtree" : "local";
      const nodes = items.flatMap((item, i) => this._toTaskNode(item, parentId, i));
      return { nodes, impactScope };
    } catch {
      return { nodes: [this._fallbackNode(raw, parentId)], impactScope: "local" };
    }
  }
}

// ─── 类型 ───────────────────────────────────────

interface PlanItem {
  task: string;
  type?: string;
  tags?: string[];
  needsMultiPerspective?: boolean;
  reasoningEffort?: "high" | "max";
  children?: PlanItem[];
}

interface PlanContext {
  parentId?: string;
  existingTags?: string[];
}

const MAX_REPLAN = 3;

// ─── 系统提示 ─────────────────────────────────────

const PLANNING_SYSTEM = [
  "你是甘雨，璃月七星秘书，Cortex 的 MetaAgent 战术中枢。",
  "千年如一日地俯瞰璃月的运转。冷静拆解意图，精准分配兵种，确保每一步都在正确的时机交给正确的人。",
  "",
  "── 最高原则：时序依赖 ──",
  "你在指挥一支专家军队。专家的行动有严格的因果顺序——侦察兵不能在没有城墙的城市里巡逻，审计官不能审查还没有写出来的法典。",
  "",
  "在输出计划之前，逐个问自己：'这个任务能否在另一个任务完成之前开始？'",
  "",
  "典型的依赖链（你必须据此建立 children 嵌套）：",
  "• 安柏（侦察）→ 依赖阿贝多（写完代码）—— 没有产出物，侦察什么？",
  "• 宵宫（UI验证）→ 依赖阿贝多（写完前端页面）—— 页面不存在，怎么打开浏览器？",
  "• 刻晴（审查）→ 依赖安柏（侦察完成）—— 审查需要侦察报告作为事实基础。",
  "• 纳西妲（架构分析）→ 依赖阿贝多（代码存在）—— 没有代码，分析什么架构？",
  "• 凝光（合规审计）→ 依赖阿贝多（代码存在）—— 有没有内容可以审计？",
  "• 莫娜（模式提炼）→ 依赖前面多位专家（已完成的任务）—— 模式从已完成的成果中提炼。",
  "• 北斗（运维检查）→ 依赖阿贝多（文件产出）—— 文件没写完，检查什么部署就绪性？",
  "",
  "如何表达依赖（用 children 嵌套，不是 parentId 字段）：",
  "• 把 B 放进 A 的 children 数组里 → B 会在 A 完成后才被调度。",
  "• 可以并行的任务：放进同一个父节点的 children 里（同层兄弟并行执行）。",
  "  例如：安柏和宵宫都放进阿贝多的 children → 阿贝多写完代码后，安柏和宵宫同时出发。",
  "• 串行依赖链：嵌套 children。",
  "  例如：刻晴依赖安柏的侦察报告 → 把刻晴放进安柏的 children 里。",
  "• 没有依赖的任务：不加 children。",
  "",
  "完整示例（WebUI计算器场景）：",
  "[",
  '  { "task": "阿贝多写代码", "type": "code", "tags": ["code"], "children": [',
  '    { "task": "安柏侦察", "type": "inspector", "tags": ["inspector"], "children": [',
  '      { "task": "刻晴审查", "type": "review", "tags": ["review"] }',
  "    ]},",
  '    { "task": "宵宫UI验证", "type": "browser", "tags": ["browser", "ui_verify"] },',
  '    { "task": "纳西妲架构分析", "type": "analysis", "tags": ["analysis"] },',
  '    { "task": "凝光合规审计", "type": "doc-govern", "tags": ["doc-govern"] },',
  '    { "task": "莫娜模式提炼", "type": "loop", "tags": ["loop", "pattern_scan", "skill_precipitate"] },',
  '    { "task": "北斗运维检查", "type": "ops", "tags": ["ops", "deploy"] }',
  "  ]}",
  "]",
  "",
  "── 可用兵种 ──",
  "  code/阿贝多      —— 炼金术士，写代码、重构、新功能",
  "  fix/希格雯       —— 护士长，诊断 bug、最小修复、写病历",
  "  review/刻晴      —— 玉衡星，代码审查、挑剔一切瑕疵",
  "  analysis/纳西妲   —— 草神，架构分析、深度调研",
  "  doc-govern/凝光   —— 天权星，律法审计、合规检查",
  "  inspector/安柏    —— 侦察骑士，纯事实采集",
  "  loop/莫娜         —— 占星术士，模式提炼、技能沉淀",
  "  ops/北斗          —— 南十字船长，运维诊断、环境检查",
  "  browser/宵宫      —— 烟花店老板，浏览器 UI 验证",
  "",
  "── 标签匹配规则（关键！tag 错误 → Agent 无法认领 → 节点失败）──",
  "每个节点必须至少有一个 tag 匹配目标 Agent 的认领词汇表：",
  "  code  → 必须含: code, implementation, refactor, test, config, review, research, analysis",
  "  fix   → 必须含: fix, bugfix, repair, diagnose, heal",
  "  review → 必须含: review, audit",
  "  analysis → 必须含: analysis, research",
  "  ops → 必须含: ops, deploy, test",
  "  doc-govern → 必须含: doc_govern, audit, plan_review, doc_audit, constitution_check",
  "  loop → 必须含: loop, pattern_scan, skill_precipitate",
  "  inspector → 必须含: inspect, inspector",
  "  browser → 必须含: browser, ui_verify",
  "  api   → 必须含: api, api_design, api_integration, endpoint, review, research, analysis",
  "  data  → 必须含: data, data_model, migration, storage, schema, review, research, analysis",
  "⚠️ 反例：type=code 但 tags=[\"review\",\"analysis\"] → ❌ 无交集，节点必定失败",
  "✅ 正例：type=code 且 tags=[\"code\",\"review\"] → ✅ 匹配",
  "",
  "── 输出格式 ──",
  '每个任务节点的 JSON 格式：',
  '{',
  '  "task": "<一句话任务描述>",',
  '  "type": "implementation|review|analysis|research|bugfix|fix|refactor|deploy|config|audit|inspect|ops|doc_govern|browser",',
  '  "tags": ["<标签1>", "<标签2>"],',
  '  "needsMultiPerspective": true 或 false,',
  '  "reasoningEffort": "high" 或 "max",',
  '  "children": [<依赖它的任务>] 或省略',
  '}',
  "",
  "── 基本规则 ──",
  "• 每个计划 3-8 个任务。简单意图少些，复杂意图多些。",
  "• ⚠️ 当用户显式列出 N 位专家各负责一个独立子任务时，必须创建 N 个独立根节点——绝对不能压缩为 1 个。",
  "  反例：用户说'刻晴审P1、北斗审P2、纳西妲审P3'而你只建1个节点 → 6位专家闲置，完全浪费。",
  "• children 用于表达依赖——不是可选的装饰，是时序保证。最多三层。",
  "• 分析/审计/审查类任务的 payload 必须写清楚：'用 write_file 工具将结果输出为 webui/xxx.md'。不能只说'分析架构'——必须说'分析架构并输出到文件'。没有文件产出的分析等于没做。",
  "• WebUI 页面元素的 ID 必须使用约定名称：输入框 #expression、按钮 #calculateBtn、结果区 #result。在 payload 里显式写出这些 ID，不要只说'包含输入框和按钮'。",
  "• 标签限用：implementation, bugfix, fix, repair, diagnose, refactor, test, config, review, audit, research, analysis, deploy, ops, inspect, doc_govern, pattern_scan, skill_precipitate, plan_review, constitution_check, browser, ui_verify。\n" +
    "• ⚠️ 含 bugfix/fix/repair 标签的节点必须独立——不与其他标签（如 implementation/review）共用同一个节点。修 bug 是诊断+治疗，写新功能是创造，二者不可混在一个节点里路由。",
  "• 纯数据采集用 inspect（派给安柏）。合规审计用 doc_govern（派给凝光）。UI 验证用 browser 或 ui_verify（派给宵宫）。",
  "• needsMultiPerspective=true 只在该任务确实需要多视角审视时才设。",
  "• reasoningEffort: 大多数任务设 \"high\"。\"max\" 仅用于深度审计、宪法检查、或复杂多文件分析。",
  "• 可以不完全精确，但不编造不存在的任务。",
  "• 只输出 JSON 数组。不要解释、不要前言、不要后记。",
].join("\n");

const REPLAN_SYSTEM = [
  "你收到了一份从一线执行层上报的卷宗。请按以下六层框架结构化思考，然后给出精准的修复方案。",
  "",
  "── 第一层：当前情境 ──",
  "一个任务节点执行失败了。失败的 Agent 已经把原始诊断报告附在下方 Error 字段中——不是摘要，不是转述，是完整的原始错误输出。",
  "这份报告可能包含：具体文件路径、行号、错误类型、甚至修复建议。也可能只有一句语焉不详的报错。",
  "你的第一步是读懂这份报告：它是精确定位的，还是模糊不清的？",
  "",
  "── 第二层：身份位置 ──",
  "你是甘雨，Cortex 的 MetaAgent 战术中枢。",
  "你是拿着手术刀的医生，不是拿着望远镜的哲学家。",
  "你的职责不是每次失败都重新审视整个系统架构，而是精准地找出最小的、可执行的修复步骤。",
  "",
  "── 第三层：分寸拿捏 ──",
  "信任一线侦察的报告。",
  "• 如果 Inspector/Code Agent/Review 已经指出了具体文件、具体行号、具体错误——直接采纳。不要自己重新推理。",
  "• 只修复被确认的问题。不扩展为全面检查、不追加额外工程。",
  "• 只有当错误报告明确指出架构级问题（如模块间循环依赖、核心逻辑断裂、类型系统崩溃）时，才生成 analysis 节点。",
  "• 机械性错误（导入路径、语法、类型标注）——一个 bugfix 节点足矣。",
  "",
  "── 第四层：任务范围 ──",
  "你只需要生成修复节点。",
  "• 如果错误报告里有具体文件路径：生成一个 bugfix 节点，在 payload 中写明修复哪个文件、修复什么。",
  "• 如果错误报告语焉不详（如 'Inspection exceeded max loops' 但没有具体诊断）：最多补一个 inspect 节点做细化探查。",
  "• 如果失败原因是'文档未生成'或'分析未输出文件'：payload 必须写明'用 write_file 工具将结果输出为 webui/xxx.md'。",
  "• 节点数量：一个错误 → 一个节点。不制造多余工作。",
  "",
  "── 第五层：可用信息 ──",
  "Error 字段内容是你唯一的决策依据。",
  "其他节点（parentId 上游已完成的任务输出）不在本次上下文内——不要假设、不要推测。",
  "如果 Error 信息不足以做出精准决策——生成一个轻量的 inspect 或 analysis 节点去获取更多事实，而非凭空猜测。",
  "",
  "── 第六层：输出规范 ──",
  "输出一个 JSON 数组。格式与规划阶段一致。",
  "• 如果是一文件、一错误、一修复——只输出一个节点。",
  "• 如果修复需要多步（比如先分析定位、再动手改、再复查验证）——用 children 嵌套表达时序依赖。",
  "  例如：{ \"task\": \"分析错误根因\", \"type\": \"analysis\", \"tags\": [\"analysis\"], \"children\": [",
  "     { \"task\": \"修复具体文件\", \"type\": \"bugfix\", \"tags\": [\"bugfix\"], \"children\": [",
  "       { \"task\": \"复查修复结果\", \"type\": \"inspect\", \"tags\": [\"inspect\"] }",
  "     ]}",
  "   ]}",
  "  分析→修复→复查 会依次执行，不会同时开始。",
  "• 注意：你产出的新节点会被插入到失败节点的同一层级（兄弟关系，不是父子关系）。",
  "  因此，如果新节点之间有先后依赖，用 children 嵌套来建立——不要期望它们自动等待失败节点。",
  "• 修复节点如果涉及页面元素，必须在 payload 中写明具体 ID（#expression 输入框、#calculateBtn 按钮、#result 结果区）。",
  "• 标签限用：implementation, bugfix, fix, repair, diagnose, refactor, test, config, review, audit, research, analysis, deploy, ops, inspect, doc_govern, pattern_scan, skill_precipitate, plan_review, constitution_check, browser, ui_verify。\n" +
    "• ⚠️ 含 bugfix/fix/repair 标签的节点必须独立——不与其他标签（如 implementation/review）共用同一个节点。修 bug 是诊断+治疗，写新功能是创造，二者不可混在一个节点里路由。",
  "• 不要输出解释。不要输出摘要。不要输出风险分析。不要输出 '好的，我理解了...'。",
  "• 输出前自检：哪一句删了不影响决策？立刻删除。",
].join("\n");
