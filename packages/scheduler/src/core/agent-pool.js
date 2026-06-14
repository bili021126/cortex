import { AgentStatus, PipelineEventType, PipelinePriority } from "@cortex/shared";
import { isTestEnv } from "../utils/internal.js";
import { ManifoldGate } from "../dispatch-steps/manifold-gate.js";
/**
 * AgentPool —— Agent 生命周期管理 + 状态机追踪
 * 每种 Agent 类型保留至少 1 个实例配额，防饥饿。
 * 状态流转：Created → Awake → Active → Awake → ... → Draining → Destroyed
 *
 * 方案B：AgentPool 为 Agent 状态的唯一权威源。
 * Agent.status 改为只读 getter，委托到 Pool；写路径仅通过 Pool.setStatus()。
 */
export class AgentPool {
    configs = new Map();
    active = new Map();
    statuses = new Map(); // instanceId → status
    _observer;
    /**
     * invariant 违规上报后端。
     * 默认为 `null`（末尾兜底 console.error）。
     * 在 bootstrap 中注入 observer.emit 后，所有状态机违规会走 observer 管道。
     *
     * 优先级：实例 _observer > 静态 onInvariant > console.error
     */
    static onInvariant = null;
    /** 注入 PipelineObserver（与 onInvariant 互补的双通道模式） */
    setObserver(observer) {
        this._observer = observer;
        // mHC 流形约束：注入 observer 用于流控事件上报
        ManifoldGate.setObserver(observer);
    }
    /** 合法状态流转表
     *  Active → Active 允许作为无操作：调度器可能对同一实例并发分发任务，
     *  已激活的 agent 再次执行时无需变更状态，静默通过即可。 */
    static VALID_TRANSITIONS = {
        [AgentStatus.Created]: new Set([AgentStatus.Awake, AgentStatus.Destroyed]),
        [AgentStatus.Awake]: new Set([AgentStatus.Active, AgentStatus.Draining]),
        [AgentStatus.Active]: new Set([AgentStatus.Awake, AgentStatus.Draining, AgentStatus.Active]),
        [AgentStatus.Draining]: new Set([AgentStatus.Destroyed]),
        [AgentStatus.Destroyed]: new Set([]),
    };
    register(config) {
        this.configs.set(config.type, config);
        if (!this.active.has(config.type)) {
            this.active.set(config.type, new Set());
        }
        // mHC 流形约束注册：同步 ManifoldGate 的 maxInstances
        ManifoldGate.register(config.type, config.maxInstances ?? 1);
    }
    /**
     * 动态更新 AgentType 的最大并发数（热扩容/缩容）。
     * 同步更新本地 configs 和 ManifoldGate 流控上限。
     */
    setMaxInstances(agentType, newMax) {
        const config = this.configs.get(agentType);
        if (config) {
            config.maxInstances = newMax;
        }
        ManifoldGate.updateMax(agentType, newMax);
    }
    /** 启动一个 Agent 实例。超限返回 false。新实例初始状态为 Created。 */
    spawn(agentType, instanceId) {
        const config = this.configs.get(agentType);
        if (!config)
            return false;
        const instances = this.active.get(agentType);
        if (!instances)
            return false;
        if (instances.size >= (config.maxInstances ?? 1))
            return false;
        instances.add(instanceId);
        this.statuses.set(instanceId, AgentStatus.Created);
        return true;
    }
    /**
     * 生成 RLM 子任务实例——不占主配额，不计入 maxInstances。
     * 子任务与父任务共享同一 Agent 类型，但不应受池子限制。
     * 使用场景：MetaAgent replan 产生的子任务、RLM ExecuteStep 拆解的 SubTask。
     */
    spawnSubtask(agentType, instanceId) {
        const config = this.configs.get(agentType);
        if (!config)
            return false;
        const instances = this.active.get(agentType);
        if (!instances)
            return false;
        instances.add(instanceId);
        this.statuses.set(instanceId, AgentStatus.Created);
        return true;
    }
    /** 更新实例状态（含流转合法性校验）。成功返回 true，非法流转返回 false。 */
    setStatus(instanceId, status) {
        const current = this.statuses.get(instanceId);
        if (current === undefined)
            return false;
        const allowed = AgentPool.VALID_TRANSITIONS[current];
        if (!allowed.has(status)) {
            const msg = `非法流转 ${current} → ${status} (instance: ${instanceId})`;
            this._reportInvariant("AgentPool.setStatus", msg, { instanceId, current, attempted: status });
            return false;
        }
        this.statuses.set(instanceId, status);
        return true;
    }
    /** 获取某类型下所有实例的状态列表 */
    getStatuses(agentType) {
        const instances = this.active.get(agentType);
        if (!instances)
            return [];
        return [...instances].map((id) => this.statuses.get(id) ?? AgentStatus.Created);
    }
    /** 获取单个实例的状态 */
    getStatus(instanceId) {
        return this.statuses.get(instanceId);
    }
    /** 检查某类型是否有 Awake 状态的实例 */
    hasAwake(agentType) {
        const instances = this.active.get(agentType);
        if (!instances)
            return false;
        return [...instances].some((id) => this.statuses.get(id) === AgentStatus.Awake);
    }
    /** 回收 Agent 实例 */
    destroy(agentType, instanceId) {
        const current = this.statuses.get(instanceId);
        if (current === undefined || current === AgentStatus.Destroyed) {
            this.active.get(agentType)?.delete(instanceId);
            return;
        }
        const ok = this.setStatus(instanceId, AgentStatus.Destroyed);
        if (!ok) {
            const violation = {
                source: "AgentPool.destroy",
                message: `destroy 绕过状态机: ${current} → Destroyed`,
                details: { instanceId, agentType },
            };
            this.statuses.set(instanceId, AgentStatus.Destroyed);
            this._reportInvariant("AgentPool.destroy", violation.message, violation.details);
        }
        this.active.get(agentType)?.delete(instanceId);
        this.statuses.delete(instanceId);
    }
    /** 某类型还有可用配额？ */
    canSpawn(agentType) {
        const config = this.configs.get(agentType);
        if (!config)
            return false;
        const instances = this.active.get(agentType);
        if (!instances)
            return false;
        return instances.size < (config.maxInstances ?? 1);
    }
    /** 某类型当前实例数 */
    count(agentType) {
        return this.active.get(agentType)?.size ?? 0;
    }
    /**
     * 统一 invariant 上报通道。
     * 优先级：_observer > onInvariant > console.error
     * 单通道收敛，消除双路径重复 emit 风险。
     */
    _reportInvariant(source, message, details) {
        if (this._observer) {
            this._observer.emit({
                type: PipelineEventType.AgentPoolInvariantViolation,
                priority: PipelinePriority.CRITICAL,
                payload: { source, message, detail: JSON.stringify(details ?? {}) },
                timestamp: Date.now(),
                notificationType: "WARNING",
            });
        }
        else if (AgentPool.onInvariant) {
            AgentPool.onInvariant({ source, message, details });
        }
        else if (!isTestEnv()) {
            console.error(`[invariant] ${source}: ${message}`);
        }
    }
}
//# sourceMappingURL=agent-pool.js.map