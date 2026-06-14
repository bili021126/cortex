/**
 * ManifoldGate —— mHC 流形约束门控。
 *
 * 灵感来自 DeepSeek mHC (Manifold-Constrained Hyper-Connections) 论文：
 * - 流形约束：同类型 Agent 并发数 ≤ maxInstances
 * - 恒等保持：保证节点不静默丢失——等待到超时，或优雅失败
 * - FIFO 公平：先到先服务，无饥饿
 *
 * 集成方式：
 * - SpawnStep: spawn 前 acquire(type)，失败时 release(type)
 * - CleanupStep: destroy 后 release(type)
 *
 * @since mHC-Constrained Dispatch Pipeline
 */
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
/** 最大等待时间（ms），超时后节点标记失败而非无限等待 */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 60_000;
/**
 * 将事件发射推迟到下一个微任务，消除 observer 回调重入 acquired/release 的风险窗口。
 * - release 中: active-- 和 onAcquired() 之间如果同步 emit，observer 可能重入 release/acquire
 * - acquire 中: active++ 和 return 之间同样存在窗口
 * - 通过 queueMicrotask 确保所有状态变更在当前同步帧完成后才对外可见
 */
function scheduleMicrotask(fn) {
    if (typeof queueMicrotask === "function") {
        queueMicrotask(fn);
    }
    else {
        void Promise.resolve().then(fn);
    }
}
/**
 * ManifoldGate —— 全局单例流约束门控。
 *
 * 设计决策：使用静态 Map 而非实例，因为：
 * 1. Scheduler 单例运行期间只存在一个调度循环
 * 2. SpawnStep/CleanupStep 通过 dispatch 管道自然串行化
 * 3. 无需跨 Scheduler 实例共享状态
 */
export class ManifoldGate {
    static _gates = new Map();
    static _maxByType = new Map();
    static _observer = null;
    static _requestSeq = 0;
    /** 生成唯一 requestId——格式 mg-{seq}-{timestamp36} */
    static _nextRequestId() {
        ManifoldGate._requestSeq++;
        return `mg-${ManifoldGate._requestSeq}-${Date.now().toString(36)}`;
    }
    /**
     * 注入 PipelineObserver（用于上报流控事件）。
     */
    static setObserver(observer) {
        ManifoldGate._observer = observer;
    }
    /**
     * 注册 AgentType 的最大并发数（由 AgentPool.register 同步调用）。
     * maxInstances 必须 > 0，否则降级为 1（防御性默认）。
     */
    static register(agentType, maxInstances) {
        const safeMax = maxInstances > 0 ? maxInstances : 1;
        ManifoldGate._maxByType.set(agentType, safeMax);
        if (!ManifoldGate._gates.has(agentType)) {
            ManifoldGate._gates.set(agentType, { active: 0, waiters: [] });
        }
    }
    /**
     * 热更新 AgentType 的最大并发数。
     * 若 newMax < 当前 active，多余槽位在后续 release 时自然回收。
     */
    static updateMax(agentType, newMax) {
        if (newMax <= 0) {
            scheduleMicrotask(() => {
                ManifoldGate._emitInvariant(agentType, `updateMax: newMax=${newMax} ≤ 0, rejected`);
            });
            return;
        }
        ManifoldGate._maxByType.set(agentType, newMax);
        if (!ManifoldGate._gates.has(agentType)) {
            ManifoldGate._gates.set(agentType, { active: 0, waiters: [] });
        }
        const gate = ManifoldGate._gates.get(agentType);
        if (!gate)
            return;
        let woken = 0;
        while (gate.active < newMax && gate.waiters.length > 0) {
            const next = gate.waiters.shift();
            if (!next)
                break;
            clearTimeout(next.timeoutId);
            next.onAcquired();
            woken++;
        }
        // 对称于 release 的 _emitReleased：上限变更完成后，推迟发射事件
        scheduleMicrotask(() => {
            ManifoldGate._emitMaxUpdated(agentType, newMax, woken, gate.waiters.length);
        });
    }
    /**
     * 获取当前活跃实例数。
     */
    static active(agentType) {
        return ManifoldGate._gates.get(agentType)?.active ?? 0;
    }
    /**
     * 获取等待队列长度。
     */
    static waiting(agentType) {
        return ManifoldGate._gates.get(agentType)?.waiters.length ?? 0;
    }
    /**
     * 获取最大并发数。
     */
    static max(agentType) {
        return ManifoldGate._maxByType.get(agentType) ?? 1;
    }
    /**
     * 获取执行槽位。
     *
     * - 当前活跃 < maxInstances → 立即返回
     * - 当前活跃 ≥ maxInstances → FIFO 排队等待，最长等 acquireTimeoutMs
     * - 超时 → 返回 false
     */
    static async acquire(agentType, acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS) {
        const max = ManifoldGate._maxByType.get(agentType) ?? 1;
        if (max <= 0) {
            return false;
        }
        let gate = ManifoldGate._gates.get(agentType);
        if (!gate) {
            gate = { active: 0, waiters: [] };
            ManifoldGate._gates.set(agentType, gate);
        }
        if (gate.draining) {
            return false;
        }
        // 槽位充足 → 立即获取
        if (gate.active < max) {
            gate.active++;
            return true;
        }
        // 槽位已满 → 排队等待（FIFO）
        const capturedGate = gate;
        const requestId = ManifoldGate._nextRequestId();
        scheduleMicrotask(() => {
            ManifoldGate._emitWaitStart(agentType, capturedGate.waiters.length + 1, requestId);
        });
        return await new Promise((resolve) => {
            const onAcquired = () => {
                capturedGate.active++;
                scheduleMicrotask(() => {
                    ManifoldGate._emitWaitEnd(agentType, capturedGate.waiters.length, requestId);
                });
                resolve(true);
            };
            const timeoutId = setTimeout(() => {
                const idx = capturedGate.waiters.findIndex((w) => w.requestId === requestId);
                if (idx >= 0) {
                    capturedGate.waiters.splice(idx, 1);
                }
                scheduleMicrotask(() => {
                    ManifoldGate._emitWaitTimeout(agentType, acquireTimeoutMs, requestId);
                });
                resolve(false);
            }, acquireTimeoutMs);
            capturedGate.waiters.push({ requestId, onAcquired, resolve, timeoutId });
        });
    }
    /**
     * 释放执行槽位，唤醒下一个等待者（FIFO）。
     */
    static release(agentType) {
        const gate = ManifoldGate._gates.get(agentType);
        if (!gate) {
            scheduleMicrotask(() => {
                ManifoldGate._emitReleaseOrphan(agentType);
            });
            return;
        }
        if (gate.active > 0) {
            gate.active--;
        }
        else {
            scheduleMicrotask(() => {
                ManifoldGate._emitInvariant(agentType, "release called with active=0 (possible double-release)");
            });
        }
        const requestId = ManifoldGate._nextRequestId();
        scheduleMicrotask(() => {
            ManifoldGate._emitReleased(agentType, ManifoldGate.active(agentType), ManifoldGate.waiting(agentType), requestId);
        });
        if (gate.waiters.length > 0) {
            const next = gate.waiters.shift();
            if (!next)
                return;
            clearTimeout(next.timeoutId);
            next.onAcquired();
        }
    }
    /**
     * 重置所有门控状态（测试用）。
     */
    static reset() {
        for (const gate of ManifoldGate._gates.values()) {
            for (const waiter of gate.waiters) {
                clearTimeout(waiter.timeoutId);
                waiter.resolve(false);
            }
            gate.waiters.length = 0;
        }
        ManifoldGate._gates.clear();
        ManifoldGate._maxByType.clear();
        ManifoldGate._observer = null;
    }
    /**
     * 优雅关闭指定类型的门控。
     */
    static async drain(agentType) {
        const gate = ManifoldGate._gates.get(agentType);
        if (!gate)
            return;
        gate.draining = true;
        for (const waiter of gate.waiters) {
            clearTimeout(waiter.timeoutId);
            waiter.resolve(false);
        }
        gate.waiters.length = 0;
        const maxWaitMs = 30_000;
        const pollIntervalMs = 200;
        const start = Date.now();
        while (gate.active > 0 && Date.now() - start < maxWaitMs) {
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
    }
    // ── 事件上报 ──────────────────────────────────
    static _emitWaitStart(agentType, queuePosition, requestId) {
        ManifoldGate._observer?.emit({
            type: PipelineEventType.ManifoldGateWaitStart,
            priority: PipelinePriority.HIGH,
            payload: {
                agentType,
                queuePosition,
                active: ManifoldGate._gates.get(agentType)?.active ?? 0,
                max: ManifoldGate._maxByType.get(agentType) ?? 1,
                requestId,
            },
            timestamp: Date.now(),
            notificationType: "FYI",
        });
    }
    static _emitWaitEnd(agentType, remainingWaiters, requestId) {
        ManifoldGate._observer?.emit({
            type: PipelineEventType.ManifoldGateWaitEnd,
            priority: PipelinePriority.HIGH,
            payload: {
                agentType,
                remainingWaiters,
                requestId,
            },
            timestamp: Date.now(),
        });
    }
    static _emitWaitTimeout(agentType, timeoutMs, requestId) {
        ManifoldGate._observer?.emit({
            type: PipelineEventType.ManifoldGateAcquireTimeout,
            priority: PipelinePriority.HIGH,
            payload: {
                agentType,
                timeoutMs,
                requestId,
            },
            timestamp: Date.now(),
            notificationType: "WARNING",
        });
    }
    static _emitReleased(agentType, active, waiting, requestId) {
        ManifoldGate._observer?.emit({
            type: PipelineEventType.ManifoldGateReleased,
            priority: PipelinePriority.HIGH,
            payload: {
                agentType,
                active,
                waiting,
                requestId,
            },
            timestamp: Date.now(),
        });
    }
    static _emitInvariant(agentType, message) {
        ManifoldGate._observer?.emit({
            type: PipelineEventType.ManifoldGateInvariantViolation,
            priority: PipelinePriority.HIGH,
            payload: {
                agentType,
                message,
            },
            timestamp: Date.now(),
            notificationType: "WARNING",
        });
    }
    static _emitReleaseOrphan(agentType) {
        ManifoldGate._observer?.emit({
            type: PipelineEventType.ManifoldGateReleaseOrphan,
            priority: PipelinePriority.HIGH,
            payload: {
                agentType,
                message: `release called on unregistered or reset agentType: ${agentType}`,
            },
            timestamp: Date.now(),
        });
    }
    /** 上限变更事件——与 _emitReleased 对称，updateMax 扩容时发射 */
    static _emitMaxUpdated(agentType, newMax, woken, remainingWaiters) {
        ManifoldGate._observer?.emit({
            type: PipelineEventType.ManifoldGateMaxUpdated,
            priority: PipelinePriority.HIGH,
            payload: {
                agentType,
                newMax,
                woken,
                remainingWaiters,
            },
            timestamp: Date.now(),
            notificationType: "FYI",
        });
    }
}
//# sourceMappingURL=manifold-gate.js.map