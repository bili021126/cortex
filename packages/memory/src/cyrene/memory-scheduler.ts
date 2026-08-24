// ============================================================
// Cyrene-Agent 记忆系统 — MemoryScheduler（适配版）
//
// 从 Cyrene-Agent src/main/memory/memory-scheduler.ts 提取。
// 适配：移除 Electron/IPC 依赖。依赖通过构造注入。
// ============================================================

import type { MemoryManager } from "./memory-manager.js"
/** 诊断输出——统一走 stderr（可观测性：不进 stdout/不被程序消费） */
function diag(...args: unknown[]): void {
  process.stderr.write(args.map(String).join(" ") + "\n");
}

import type { L1Profile, MemoryCandidate, MemoryJudgeTurn } from "./memory-types.js"

const MEMORY_JUDGE_INTERVAL = 6
const MEMORY_JUDGE_CONTEXT_TURNS = 8

export interface MemorySchedulerDeps {
  ingestEntity: (text: string) => void
  enqueueTask: <T>(label: string, task: () => Promise<T>) => Promise<T>
  judgeMemory: (turns: MemoryJudgeTurn[], conversationId: string) => Promise<MemoryCandidate[]>
  writeMemory: (candidates: MemoryCandidate[]) => Promise<void>
  getL1: () => Promise<L1Profile>
  replaceL1Field: (field: "roundCount", value: number) => Promise<void>
  runReflectionAndCompression: () => Promise<void>
  runResolverQueueOnce: () => Promise<unknown>
}

export class MemoryScheduler {
  private recentTurns: Array<MemoryJudgeTurn & { seq: number }> = []
  private nextTurnSeq = 0

  constructor(private readonly deps: MemorySchedulerDeps) {}

  scheduleMemoryWrite(userInput: string, assistantReply: string): void {
    const seq = ++this.nextTurnSeq
    this.recentTurns.push({ seq, userInput, assistantReply })
    if (this.recentTurns.length > MEMORY_JUDGE_CONTEXT_TURNS * 2) {
      this.recentTurns = this.recentTurns.slice(-MEMORY_JUDGE_CONTEXT_TURNS * 2)
    }

    try {
      this.deps.ingestEntity(userInput)
      this.deps.ingestEntity(assistantReply)
    } catch (err) {
      diag("[Memory] 实体图谱提取失败:", err)
    }

    this.deps.enqueueTask("MemoryMaintenance", async () => {
      await this.runQueuedMemoryWrite(seq)
    }).catch((e) => {
      // P2: 结构化上报——主流程不受影响，但失败原因必须可见
      diag("[Memory] 记忆写入失败，不影响主流程", {
        phase: "MemoryMaintenance",
        seq,
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }

  private async runQueuedMemoryWrite(seq: number): Promise<void> {
    const l1 = await this.deps.getL1()
    const newCount = (l1.roundCount || 0) + 1

    if (newCount % MEMORY_JUDGE_INTERVAL === 0) {
      try {
        const turns = this.recentTurns
          .filter((turn) => turn.seq <= seq)
          .slice(-MEMORY_JUDGE_CONTEXT_TURNS)
          .map(({ userInput, assistantReply }) => ({ userInput, assistantReply }))
        const candidates = await this.deps.judgeMemory(turns, "default")

        if (candidates.length > 0) {
          await this.deps.writeMemory(candidates)
        }
      } catch (err) {
        diag("[Memory] MemoryJudge/Manager 执行失败，本轮仍会计数", err)
      }
    }

    try {
      await this.deps.replaceL1Field("roundCount", newCount)
    } catch (err) {
      diag("[Memory] roundCount 更新失败，不影响主流程", err)
    }

    if (newCount % 5 === 0) {
      try {
        await this.deps.runResolverQueueOnce()
      } catch (err) {
        diag("[Memory] Resolver 队列处理失败，不影响主流程", err)
      }
    }

    if (newCount % 20 === 0) {
       
      diag("[Memory] 达到 20 轮，触发 Reflection + 记忆压缩")
      await this.deps.runReflectionAndCompression()
    }
  }
}