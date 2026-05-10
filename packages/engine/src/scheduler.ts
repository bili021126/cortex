import type { TaskNode, NodeResult, ExecutionReport, AgentType, Agent } from "@cortex/shared";
import { AGENT_TAGS, AgentType as AT, PipelinePriority, AgentStatus } from "@cortex/shared";
import type { TaskBoard } from "./task-board.js";
import type { AgentPool } from "./agent-pool.js";
import type { PipelineObserver } from "./pipeline-observer.js";
import type { ConfirmGate } from "./confirm-gate.js";
import type { MetaAgent } from "./meta-agent.js";

/**
 * 拓扑排序：按 parentId 依赖关系分层。
 * 无 parentId（根节点）→ 第 0 层，子节点排在父节点之后一层。
 */
export function topologicalSort(nodes: TaskNode[]): string[][] {
  const idSet = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>(); // parentId → childIds
  const roots: string[] = [];

  for (const n of nodes) {
    if (!n.parentId || !idSet.has(n.parentId)) {
      roots.push(n.id);
    } else {
      const list = children.get(n.parentId) ?? [];
      list.push(n.id);
      children.set(n.parentId, list);
    }
  }

  // BFS 分层
  const layers: string[][] = [];
  let current = roots;
  while (current.length > 0) {
    layers.push(current);
    const next: string[] = [];
    for (const id of current) {
      const kids = children.get(id);
      if (kids) next.push(...kids);
    }
    current = next;
  }

  return layers;
}

/**
 * Scheduler —— 调度引擎。
 *
 * 职责：
 * 1. 拓扑排序任务树
 * 2. 逐层并行分发节点给匹配的 AgentRunner
 * 3. 通过 PipelineObserver 发布节点生命周期事件
 * 4. 产出 ExecutionReport
 *
 * **订阅者注册**：PipelineObserver 的订阅者（Sentinel/MemoryStore/管家）
 * 由 bootstrap 入口点在 Scheduler 构造前注册，不在 Scheduler 内部隐式注册。
 * 订阅约定见 PipelineObserver.emit() 注释。
 */
export class Scheduler {
  private agents = new Map<string, Agent>();
  private models = new Map<string, string>();
  private replanCount = new Map<string, number>(); // nodeId → 已重规划次数
  private replanQueue: Array<{ node: TaskNode; reason: string; count: number }> = [];
  private totalReplans = 0;
  private replanResults: NodeResult[] = []; // 重规划成功的合成结果
  private replanMap = new Map<string, string[]>(); // originalId → replan-generated new ids
  private static readonly REPLAN_MAX_ROUNDS = 3; // 单节点最多重规划轮次
  private static readonly MAX_TOTAL_REPLANS = 3;  // 全局兜底：单次 executeAll 最大重规划次数

  constructor(
    private readonly board: TaskBoard,
    private readonly pool: AgentPool,
    private readonly observer: PipelineObserver,
    private readonly gate: ConfirmGate,
    private readonly metaAgent?: MetaAgent,
  ) {}

  /** 注册一个 AgentRunner 及其所用模型 */
  register(agentType: string, agent: Agent, model: string): void {
    this.agents.set(agentType, agent);
    this.models.set(agentType, model);
  }

  /**
   * 执行 TaskBoard 上全部节点。
   * 动态消费模式：只要有 pending/claimed 节点就继续拓扑排序 + 逐层并行执行。
   * 每轮执行后处理 replanQueue，MetaAgent 产出新节点仅入板不执行——
   * 由下一轮循环统一调度（"领而不执"）。
   */
  async executeAll(): Promise<ExecutionReport> {
    const startTime = Date.now();
    const allResults: NodeResult[] = [];
    let completed = 0;
    let failed = 0;
    let round = 0;
    let replanFlight: Promise<void> | null = null; // 后台 replan 批次

    while (true) {
      round++;
      const pendingNodes = this.board.getPendingNodes();

      // ── 无 pending 节点时的处理 ──
      if (pendingNodes.length === 0) {
        // 等待上一批后台 replan 完成（新节点已入板）
        if (replanFlight) {
          await replanFlight;
          replanFlight = null;
        }
        // 检查 replan 是否产出了新 pending 节点
        if (this.board.getPendingNodes().length > 0) continue;
        // 仍有待处理的 replan → 发射后台批次
        if (this.replanQueue.length > 0) {
          replanFlight = this._tryFireReplan();
          continue;
        }
        // 真正无事可做
        break;
      }

      // ── 执行当前板上的 pending/claimed 节点 ──
      const layers = topologicalSort(pendingNodes);
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        this.observer.emit({
          type: "scheduler.layer.start",
          priority: PipelinePriority.HIGH,
          payload: { layer: li, nodes: layer.length, round },
          timestamp: Date.now(),
          notificationType: "FYI",
        });

        const layerPromises = layer.map((nodeId) => this._dispatchNode(nodeId));
        const layerResults = await Promise.all(layerPromises);

        for (const r of layerResults) {
          allResults.push(r);
          if (r.success) completed++;
          else failed++;
        }
      }

      // ── 执行完毕，若有积压 replan 则后台发射（不 await，下轮循环取结果） ──
      if (this.replanQueue.length > 0 && !replanFlight) {
        replanFlight = this._tryFireReplan();
      }
    }

    // 收尾：等待最后一轮后台 replan
    if (replanFlight) await replanFlight;

    // ── 重规划链解析：若任意后代节点成功执行，视原始节点为成功 ──
    for (const [origId, newIds] of this.replanMap) {
      const origIdx = allResults.findIndex((r) => r.nodeId === origId);
      if (origIdx < 0) continue;

      if (this._isReplanChainSuccessful(newIds, allResults)) {
        if (allResults[origIdx].success === false) {
          failed--;
          completed++;
        }
        allResults[origIdx] = {
          nodeId: origId,
          success: true,
          output: "Replanned: task completed by new nodes",
        };
      }
    }
    this.replanMap.clear(); // 防止跨 executeAll() 调用状态污染
    this.totalReplans = 0;  // 重置全局计数器，下次 executeAll() 重新计数

    const durationMs = Date.now() - startTime;
    const allNodes = this.board.getAllNodes();

    this.observer.emit({
      type: "scheduler.done",
      priority: PipelinePriority.CRITICAL,
      payload: { total: allNodes.length, completed, failed, durationMs, rounds: round },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    return {
      totalNodes: allNodes.length,
      completed,
      failed,
      results: allResults,
      durationMs,
    };
  }

  /**
   * 递归检查重规划链中是否有任意节点最终成功执行。
   * 若后代也被重规划，则继续向下追踪直到叶子节点。
   * visited 防 ID 碰撞导致的自环无限递归。
   */
  private _isReplanChainSuccessful(nodeIds: string[], allResults: NodeResult[], visited = new Set<string>()): boolean {
    for (const id of nodeIds) {
      if (visited.has(id)) continue; // 防自环
      visited.add(id);

      const result = allResults.find((r) => r.nodeId === id);
      if (result && result.success) return true;

      // 该节点也被重规划过，追踪其后代
      const childIds = this.replanMap.get(id);
      if (childIds && childIds.length > 0) {
        if (this._isReplanChainSuccessful(childIds, allResults, visited)) return true;
      }
    }
    return false;
  }

  /**
   * 尝试发射后台 replan 批次。
   * 检查全局上限，未触顶则调用 _drainReplanQueue 并行处理。
   * 触顶时不清空队列——保留待下一次 executeAll() 消费（totalReplans 届时已重置）。
   * 返回 Promise（调用方可 await 或 fire-and-forget）。
   */
  private _tryFireReplan(): Promise<void> | null {
    if (this.totalReplans >= Scheduler.MAX_TOTAL_REPLANS) {
      this.observer.emit({
        type: "scheduler.replan.limit",
        priority: PipelinePriority.CRITICAL,
        payload: {
          totalReplans: this.totalReplans,
          maxReplans: Scheduler.MAX_TOTAL_REPLANS,
          deferred: this.replanQueue.length,
        },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
      return null;
    }
    return this._drainReplanQueue();
  }

  /**
   * 消费重规划队列（并行异步）。
   * 所有队列项同时调用 MetaAgent.requestReplan，产出新节点入板（不执行），
   * 根据影响范围回收旧节点。新节点由后续 executeAll 循环统一调度。
   */
  private async _drainReplanQueue(): Promise<void> {
    // 防御性守卫：MetaAgent 未注入时不应触发 replan，但若因代码路径疏漏导致入队后调用，
    // 优雅降级而非抛 TypeError 崩溃整个 executeAll()。
    if (!this.metaAgent) {
      // 清空队列并上报——这些节点将保持失败状态，不会得到重规划。
      const orphanCount = this.replanQueue.length;
      this.replanQueue.length = 0;
      if (this.observer && orphanCount > 0) {
        this.observer.emit({
          type: "scheduler.replan.no_meta_agent",
          priority: PipelinePriority.CRITICAL,
          payload: { orphanCount, hint: "MetaAgent not configured; replan queue drained silently" },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
      return;
    }

    const fullBatch = this.replanQueue.splice(0); // 原子取出，清空队列

    // 入口截断：计算可用额度，只取 batch 内能容纳的项
    const available = Scheduler.MAX_TOTAL_REPLANS - this.totalReplans;
    if (available <= 0) return;
    const batch = fullBatch.slice(0, available);
    this.totalReplans += batch.length; // 同步预留计数器，避免并行回调竞态超限

    const promises = batch.map(async (item) => {
      const count = item.count + 1;
      this.replanCount.set(item.node.id, count);

      this.observer.emit({
        type: "node.replan",
        priority: PipelinePriority.CRITICAL,
        payload: { nodeId: item.node.id, reason: item.reason, attempt: count },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });

      const result = await this.metaAgent!.requestReplan(item.node, item.reason, count);

      // 领而不执：新节点入板，不 dispatch
      const newIds: string[] = [];
      for (const n of result.nodes) {
        this.board.addNode(n);
        this.replanCount.set(n.id, count); // 继承父节点 replanCount，确保轮次追踪不断裂
        newIds.push(n.id);
      }
      this.replanMap.set(item.node.id, newIds);

      // 按影响范围回收旧节点
      if (result.impactScope === "subtree") {
        this.board.removeSubtree(item.node.id);
      } else {
        this.board.removeNode(item.node.id);
      }
    });

    const results = await Promise.allSettled(promises);

    // 记录个别 replan 失败（不阻断其余）——通过 observer 管道上报而非 console.error
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        const nodeId = batch[i]?.node.id ?? "unknown";
        const errMsg = String(r.reason).slice(0, 200);
        this.observer.emit({
          type: "scheduler.replan.failed",
          priority: PipelinePriority.CRITICAL,
          payload: { nodeId, error: errMsg },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
    }
  }

  // ── 内部分发 ──────────────────────────────────

  private async _dispatchNode(nodeId: string): Promise<NodeResult> {
    const node = this.board.getNode(nodeId);
    if (!node) {
      return { nodeId, success: false, error: "Node not found" };
    }

    this.observer.emit({
      type: "node.start",
      priority: PipelinePriority.HIGH,
      payload: { nodeId, type: node.type },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    let result: NodeResult;
    try {
      if (node.needsMultiPerspective) {
        result = await this._dispatchMulti(node);
      } else {
        result = await this._dispatchSingle(node);
      }
    } catch (e) {
      result = {
        nodeId,
        success: false,
        error: String(e),
      };
    }

    // ── 失败入重规划队列（领而不执：不入 dispatch） ──
    // L1 哨兵：ReAct 超限不触发重规划——是参数问题不是计划问题
    if (!result.success && this.metaAgent) {
      const isReActTimeout = ((result.error ?? "") + (result.output ?? "")).includes("Exceeded max loops");
      if (!isReActTimeout) {
        const count = this.replanCount.get(nodeId) ?? 0;
        if (count < Scheduler.REPLAN_MAX_ROUNDS) {
          this.replanQueue.push({ node, reason: result.output ?? result.error ?? "unknown", count });
          this.observer.emit({
            type: "node.replan.queued",
            priority: PipelinePriority.HIGH,
            payload: { nodeId, reason: result.error, attempt: count + 1 },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
        }
      }
    }

    // 失败发射 node.failed（哨兵/管家需要感知）
    if (!result.success) {
      this.observer.emit({
        type: "node.failed",
        priority: PipelinePriority.CRITICAL,
        payload: { nodeId, error: result.error ?? "unknown" },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }

    return result;
  }

  /** 单视角节点：找一个匹配 Agent 执行 */
  private async _dispatchSingle(node: TaskNode): Promise<NodeResult> {
    // 找第一个标签匹配且有 runner 的 Agent 类型
    const agentType = this._findMatchingAgent(node);
    if (!agentType) {
      this.board.failNode(node.id);
      return {
        nodeId: node.id,
        success: false,
        error: `No agent matches tags: ${node.tags.join(", ")}`,
      };
    }

    const agent = this.agents.get(agentType);
    if (!agent) {
      this.board.failNode(node.id);
      return {
        nodeId: node.id,
        agentType: agentType as AgentType,
        success: false,
        error: `No agent registered for type: ${agentType}`,
      };
    }

    // ── 双层防护：MetaAgent 可能将多个独立任务合并为单节点 ──
    // 如果 node.type 不是已知 AgentType 且仅靠 tags 模糊匹配，发出诊断警告
    const knownTypes = new Set<string>(Object.values(AT) as string[]);
    if (!knownTypes.has(node.type) && !node.needsMultiPerspective) {
      let matchedCount = 0;
      for (const [type, atags] of Object.entries(AGENT_TAGS)) {
        if (this.agents.has(type) && node.tags.some((tag) => (atags as readonly string[]).includes(tag))) {
          matchedCount++;
        }
      }
      console.warn(
        `[scheduler] 节点 ${node.id} type="${node.type}" 非标准 AgentType——` +
        `仅 ${matchedCount} 个 Agent 可匹配 (已分配 ${agentType})，` +
        `其余 ${this.agents.size - matchedCount} 个空闲。` +
        `建议 MetaAgent 将大任务拆分为 type="review"+"ops"+"code"... 的独立节点以利用并行。`
      );
      this.observer.emit({
        type: "scheduler.nonstandard_type",
        priority: PipelinePriority.HIGH,
        payload: { nodeId: node.id, nodeType: node.type, matchedCount, assigned: agentType, totalAgents: this.agents.size },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }

    // 状态检查：仅 Awake 状态可执行
    if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) {
      this.board.failNode(node.id);
      return {
        nodeId: node.id,
        agentType: agentType as AgentType,
        success: false,
        error: `Agent ${agentType} is ${agent.status}, cannot execute`,
      };
    }

    // 认领
    const claimed = this.board.claim(node.id, agentType as AgentType);
    if (!claimed) {
      this.board.failNode(node.id);
      return {
        nodeId: node.id,
        agentType: agentType as AgentType,
        success: false,
        error: `Failed to claim node ${node.id} for ${agentType}`,
      };
    }

    // Spawn —— claim 已生效，spawn 失败须以 release 释放认领，防节点卡 claimed
    const instanceId = `${agentType}-${node.id}`;
    const spawned = this.pool.spawn(agentType as AgentType, instanceId);
    if (!spawned) {
      this.board.release(node.id, agentType as AgentType);
      this.board.failNode(node.id);
      this.observer.emit({
        type: "node.spawn_failed",
        priority: PipelinePriority.HIGH,
        payload: { nodeId: node.id, agentType, reason: "pool_exhausted" },
        timestamp: Date.now(),
      });
      return {
        nodeId: node.id,
        agentType: agentType as AgentType,
        success: false,
        error: `Agent pool exhausted for ${agentType}`,
      };
    }

    const model = this.models.get(agentType) ?? "mock";
    let result: NodeResult;
    try {
      result = await agent.execute(claimed, model);
    } catch (e) {
      result = {
        nodeId: node.id,
        agentType: agentType as AgentType,
        success: false,
        error: String(e),
      };
    }

    // destroy 异常不应阻断 complete 落盘，但需上报追踪实例泄漏
    try { this.pool.destroy(agentType as AgentType, instanceId); } catch (e) {
      this.observer.emit({
        type: "pool.destroy_failed",
        priority: PipelinePriority.HIGH,
        payload: { agentType, instanceId, error: String(e).slice(0, 200) },
        timestamp: Date.now(),
      });
    }

    // 写入 TaskBoard（即使 execute 抛异常也要落盘，防节点卡在 claimed）
    this.board.complete(node.id, agentType as AgentType, result.success, result.output, result.error);

    // node.complete 仅成功时发射——失败由 _dispatchNode 统一发射 node.failed，避免双重通知
    if (result.success) {
      this.observer.emit({
        type: "node.complete",
        priority: PipelinePriority.HIGH,
        payload: { nodeId: node.id, agentType, success: true },
        timestamp: Date.now(),
      });
    }

    return result;
  }

  /** 多视角节点：所有匹配 Agent 并行执行 */
  private async _dispatchMulti(node: TaskNode): Promise<NodeResult> {
    const agentTypes = this._findAllMatchingAgents(node);

    if (agentTypes.length === 0) {
      this.board.failNode(node.id);
      return {
        nodeId: node.id,
        success: false,
        error: `No agents match multi-perspective node ${node.id}`,
      };
    }

    // 并行认领+执行
    const promises = agentTypes.map(async (at) => {
      const agent = this.agents.get(at);
      if (!agent) return null;

      // 状态检查
      if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) return null;

      const claimed = this.board.claim(node.id, at as AgentType);
      if (!claimed) return null;

      const instanceId = `${at}-${node.id}`;
      const spawned = this.pool.spawn(at as AgentType, instanceId);
      if (!spawned) {
        // claim 已生效，以 release 释放认领，防 claimedBy 中有该类型但永无结果
        this.board.release(node.id, at as AgentType);
        this.observer.emit({
          type: "node.spawn_failed",
          priority: PipelinePriority.HIGH,
          payload: { nodeId: node.id, agentType: at, reason: "pool_exhausted" },
          timestamp: Date.now(),
        });
        return null;
      }

      const model = this.models.get(at) ?? "mock";
      let result: NodeResult;
      try {
        result = await agent.execute(claimed, model);
      } catch (e) {
        result = { nodeId: node.id, agentType: at as AgentType, success: false, error: String(e) };
      }

      // destroy 异常不应阻断 complete 落盘，但需上报追踪实例泄漏
      try { this.pool.destroy(at as AgentType, instanceId); } catch (e) {
        this.observer.emit({
          type: "pool.destroy_failed",
          priority: PipelinePriority.HIGH,
          payload: { agentType: at, instanceId, error: String(e).slice(0, 200) },
          timestamp: Date.now(),
        });
      }
      this.board.complete(node.id, at as AgentType, result.success, result.output, result.error);

      return result;
    });

    const results = (await Promise.all(promises)).filter((r): r is NodeResult => r !== null);

    // ── invariant：claimedBy 中每个条目最终要么在 results 中，要么已被 release — 防未来新增 early return 导致死锁
    if (results.length > 0) {
      const currentNode = this.board.getNode(node.id);
      if (currentNode && currentNode.status !== "failed") {
        const resultTypes = new Set(results.map((r) => r.agentType).filter((t): t is AgentType => t != null));
        for (const at of currentNode.claimedBy) {
          if (!resultTypes.has(at)) {
            this.observer.emit({
              type: "scheduler.invariant_violation",
              priority: PipelinePriority.CRITICAL,
              payload: {
                nodeId: node.id,
                message: `claimedBy 中 ${at} 无对应 result — claimedBy=[${currentNode.claimedBy}], results=[${[...resultTypes]}]`,
              },
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    if (results.length === 0) {
      this.board.failNode(node.id);
      return {
        nodeId: node.id,
        success: false,
        error: "All agents failed to claim multi-perspective node",
      };
    }

    // 返回聚合结果
    const combined = results.map((r) => `[${r.agentType}] ${r.output ?? r.error}`).join("\n");
    const allSuccess = results.every((r) => r.success);

    // node.complete 仅全成功时发射——失败由 _dispatchNode 统一发射 node.failed
    if (allSuccess) {
      this.observer.emit({
        type: "node.complete",
        priority: PipelinePriority.HIGH,
        payload: {
          nodeId: node.id,
          perspectives: results.map((r) => r.agentType),
          allSuccess: true,
        },
        timestamp: Date.now(),
      });
    }

    return {
      nodeId: node.id,
      agentType: agentTypes[0] as AgentType,
      success: allSuccess,
      output: combined,
    };
  }

  // ── 标签匹配 ──────────────────────────────────

  private _findMatchingAgent(node: TaskNode): string | null {
    let bestType: string | null = null;
    let bestScore = 0;
    for (const [type, tags] of Object.entries(AGENT_TAGS)) {
      if (!this.agents.has(type)) continue;
      let score = node.tags.filter((t) => (tags as readonly string[]).includes(t)).length;
      // 平局时：node.type 匹配的 Agent 类型加分（更精准）
      if (score > 0 && node.type === type) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }
    return bestType;
  }

  private _findAllMatchingAgents(node: TaskNode): string[] {
    return Object.entries(AGENT_TAGS)
      .filter(
        ([type, tags]) =>
          this.agents.has(type) &&
          node.tags.some((t) => (tags as readonly string[]).includes(t)),
      )
      .map(([type]) => type);
  }
}
