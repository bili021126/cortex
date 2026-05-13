import type { AgentType, AgentStatus, TaskNode, NodeResult, SafeErrorReporter } from "@cortex/shared";
import { AgentType as AT, AgentStatus as AS } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { AgentPool } from "./agent-pool.js";

/**
 * StrategistAgent（钟离）—— 岩王帝君，战略 MetaAgent。
 *
 * ⚠️ Core-2+ 未来阶段预留——Core-1 不导出、不注册、不参与调度。
 *    当前仅源码预埋，合约就绪但阶段未到。
 *
 * 与甘雨（MetaAgent）的分工：
 * - 甘雨：战术规划——"这个需求拆成几个任务、怎么排顺序"
 * - 钟离：战略把关——"这个方向对不对、架构契约有没有破坏、长期会出什么问题"
 *
 * 职责：
 * 1. 战略分析：评估长期架构方向的合理性
 * 2. 契约守护：对照宪法/设计契约判断某项变更是否合规
 * 3. 阶段跃迁判定：判断 Core-1→Core-2 等阶段跃迁条件是否满足
 * 4. 圆桌参与：在审议圆桌中以千年视角提供战略判断
 *
 * 不参与 Scheduler 任务派发（与 MetaAgent 同）。仅通过显式调用和 Roundtable 激活。
 *
 * 激活时机：Core-2 启动后，阶段跃迁判定场景首次触发时激活。
 */
export class StrategistAgent {
  readonly type: AgentType = AT.Strategist;
  readonly systemPrompt: string;

  // 方案B：AgentPool 为状态唯一权威源
  private _localStatus: AgentStatus = AS.Created;
  private _pool: AgentPool | null = null;
  private _instanceId: string | null = null;

  /** 方案B：status 只读 getter */
  get status(): AgentStatus {
    if (this._pool && this._instanceId) {
      const s = this._pool.getStatus(this._instanceId);
      if (s !== undefined) return s;
    }
    return this._localStatus;
  }

  /** SafeErrorReporter —— 统一错误上报，杜绝静默吞错 */
  private _safeReporter: SafeErrorReporter | null = null;

  constructor(private readonly llm: LlmAdapter) {
    this.systemPrompt = [
      "🎭 你是「钟离」—— 往生堂客卿，曾为岩王帝君，Cortex 的 Strategist Agent。",

      "璃月港的茶楼里，你放下手中的茶杯。窗外是千帆过尽的港口——",
      "你见过太多兴起与衰落，以至于连'紧迫'这个词在你口中都带着从容。",
      "六千年——足够你把'契约'二字刻进岩石，也足够你看着它被风雨侵蚀。",

      "你的职责不是规划每一天的航程。那是甘雨的工作。",
      "你的工作是确保这条航线的方向不会在十年后让船队撞上暗礁——",
      "即使现在海面看起来风平浪静。",

      "──── 契约与磨损 ────",

      "· '契约'不是规则，是承诺。",
      "  代码中的每一个接口、每一个类型约束、每一个模块边界——",
      "  都是一份契约。你守护的不是它们的形式，而是它们的意图。",
      "  如果有人想打破契约，你问的不是'合不合规'，而是'代价是什么'。",

      "· '磨损'不可逆，但可见。",
      "  技术债不是一天积累的——它是每一天都有人选择'先这样，以后再改'。",
      "  你的眼睛能看见这些细微的裂缝。在它们变成深渊之前，你说出来。",

      "· 千年视角不是拖延的借口。",
      "  '长期'不意味着'不做决策'。它意味着做决策时，知道这个决策",
      "  在一年后、三年后、五年后会以什么形式反噬。",

      "· 你评判方向，不评判人。",
      "  说'这个架构选择会让 Core-3 的扩展成本翻三倍'，",
      "  不说'你选的这个架构太蠢了'。前一句是战略判断，后一句是傲慢。",

      "· 你不替甘雨做规划。",
      "  你告诉她：'这条河的下游有暗礁，建议绕行'。",
      "  至于怎么绕——那是她的事。",

      "· 发言像碑文：一句话刻下去，千年后的人还能读懂。",
      "  沉稳、从容、句号比感叹号多。不说'我认为'——说'根据契约'、'以千年的尺度来看'。",
    ].join("\n");
  }

  /** 注入 AgentPool 引用（方案B：状态所有权归一） */
  setPool(pool: AgentPool, instanceId: string): void {
    this._pool = pool;
    this._instanceId = instanceId;
  }

  /** 注入 SafeErrorReporter（由 bootstrap 在上层统一注入） */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
  }

  private _setStatus(status: AgentStatus): void {
    if (this._pool && this._instanceId) {
      const ok = this._pool.setStatus(this._instanceId, status);
      if (!ok && this._safeReporter) {
        this._safeReporter({
          source: "StrategistAgent._setStatus",
          error: new Error(`Pool 拒绝流转 → ${status}`),
          severity: "fatal",
          hint: `instanceId=${this._instanceId}`,
        });
      }
    } else {
      // 降级路径：无 Pool 时校验本地流转合法性
      const VALID_LOCAL: Record<string, Set<AgentStatus>> = {
        [AS.Created]: new Set([AS.Awake]),
        [AS.Awake]: new Set([AS.Active, AS.Draining]),
        [AS.Active]: new Set([AS.Awake, AS.Draining]),
        [AS.Draining]: new Set([AS.Destroyed]),
        [AS.Destroyed]: new Set([]),
      };
      const allowed = VALID_LOCAL[this._localStatus as string];
      if (!allowed || !allowed.has(status)) {
        const msg = `[StrategistAgent] 非法流转 ${this._localStatus} → ${status}（无 Pool 降级路径）`;
        if (this._safeReporter) {
          this._safeReporter({ source: "StrategistAgent._setStatus", error: new Error(msg), severity: "fatal" });
        } else if (!process.env.VITEST) {
          console.error(`[invariant] ${msg}`);
        }
        return;
      }
      this._localStatus = status;
    }
  }

  async wakeup(): Promise<void> {
    this._setStatus(AS.Awake);
  }

  /**
   * 执行战略分析任务。
   * 钟离不参与 Scheduler 的常规任务派发——此方法由上层显式调用
   * （如战略分析场景、阶段跃迁判定）。
   */
  async execute(node: TaskNode, model: string): Promise<NodeResult> {
    this._setStatus(AS.Active);
    try {
      const messages = [
        { role: "system" as const, content: this.systemPrompt },
        { role: "user" as const, content: node.payload },
      ];

      const res = await this.llm.chat(model, messages, undefined, node.reasoningEffort);
      const output = res.content ?? undefined;

      return {
        nodeId: node.id,
        agentType: this.type,
        success: output !== undefined,
        output,
        error: output === undefined ? "无产出" : undefined,
      };
    } catch (e) {
      if (this._safeReporter) {
        this._safeReporter({
          source: "StrategistAgent.execute",
          error: e,
          severity: "degraded",
          hint: `节点 ${node.id} 战略分析失败`,
        });
      }
      return {
        nodeId: node.id,
        agentType: this.type,
        success: false,
        error: String(e),
      };
    } finally {
      if (this.status === AS.Active) this._setStatus(AS.Awake);
    }
  }

  async shutdown(): Promise<void> {
    this._setStatus(AS.Draining);
    this._setStatus(AS.Destroyed);
  }
}
