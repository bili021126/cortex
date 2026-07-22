/**
 * live2d/param-driver.ts — 连续情绪量 → Live2D 标准参数驱动层
 *
 * 背景：emotion-map 精算的 smileDelta 此前在 presence-engine 被算出后丢弃
 * （代码里两条"留待 Live2D 参数层完善"注释）。本控制器兑现这条断掉的链路，
 * 把她的"不自觉扬起嘴角"真正送达模型，而不是只有整块表情切换。
 *
 * 参数策略：
 *   - 微笑 → ParamMouthForm（Cubism 标准微笑参数，值域 [-1,1]，0 中性）。
 *     与 MouthSync 的 ParamMouthOpenY、库内置 AutoBreath 的 ParamBreath
 *     三方互不冲突——各写各的参数。
 *   - 呼吸深度（breathDepth）暂不在此接管：pixi-live2d-display 内置 AutoBreath
 *     已每帧驱动 ParamBreath，二次写入会互相覆盖抖动，需库层协调，留待后续。
 *
 * 能力探测：ParamMouthForm 是否存在于当前模型是运行时事实（此模型表情文件
 * 用泛化 Param/Param2… 命名）。探测失败则整体降级为 no-op，绝不抛错。
 *
 * 时序语义：smileDelta 是"脉冲增量"——注入后目标值自然向中性回落，
 * current 再缓动逼近 target，形成"扬嘴角→缓缓收回"的自然微表情。
 *
 * @module renderer/live2d/param-driver
 * @since v7 — 三端 UI 设计 Phase P1 深化
 */
import type { Live2DModel } from "pixi-live2d-display/cubism4";
import { clamp } from "@cortex/shared";

/** Cubism 标准微笑参数 ID */
const PARAM_MOUTH_FORM = "ParamMouthForm";
/** 微笑值域下/上限 */
const SMILE_MIN = -1;
const SMILE_MAX = 1;
/** current → target 每帧缓动系数（越大越快逼近） */
const EASE = 0.18;
/** target → 中性每帧衰减系数（脉冲自然回落速度） */
const DECAY = 0.04;
/** current 与 target 差值小于此阈值视为静止，暂停写参数省开销 */
const EPSILON = 0.001;

type CoreModelWithParameters = {
  setParameterValueById?: (id: string, value: number) => void;
  setParameterValueByIndex?: (index: number, value: number) => void;
  getParameterIndex?: (id: string) => number;
};

export class ParamDriver {
  private readonly model: Live2DModel;
  /** ParamMouthForm 是否可驱动（运行时探测结果） */
  private smileAvailable = false;
  /** 微笑目标值（脉冲注入点，随时间衰减回 0） */
  private targetSmile = 0;
  /** 微笑当前值（缓动逼近 target，实际写入模型的值） */
  private currentSmile = 0;
  private rafId: number | null = null;
  private disposed = false;

  constructor(model: Live2DModel) {
    this.model = model;
    this.smileAvailable = this.probe(PARAM_MOUTH_FORM);
    if (!this.smileAvailable) {
      console.warn("[Cyrene] ParamMouthForm 不可用，微笑参数驱动降级为 no-op");
    }
  }

  /** 启动每帧驱动循环（仅在有可驱动参数时才真正启动） */
  start(): void {
    if (this.disposed || !this.smileAvailable) return;
    if (this.rafId !== null) return;
    const loop = (): void => {
      if (this.disposed) return;
      this.tick();
      this.rafId = window.requestAnimationFrame(loop);
    };
    this.rafId = window.requestAnimationFrame(loop);
  }

  /**
   * 注入一次微笑增量脉冲（叠加到当前目标，clamp 到值域）。
   * 由 presence-engine 消费 ExpressionDelta.smileDelta 时调用。
   */
  addSmile(delta: number): void {
    if (this.disposed || !this.smileAvailable || !Number.isFinite(delta)) return;
    this.targetSmile = clamp(this.targetSmile + delta, SMILE_MIN, SMILE_MAX);
  }

  /** 立即把微笑目标拉回中性（表情打断/恢复时调用） */
  neutralizeSmile(): void {
    this.targetSmile = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ─── 内部实现 ─────────────────────────────────────────

  /** 每帧：target 衰减回中性，current 缓动逼近 target，写入模型 */
  private tick(): void {
    // 目标脉冲自然回落
    this.targetSmile += (0 - this.targetSmile) * DECAY;
    // 当前值缓动逼近目标
    this.currentSmile += (this.targetSmile - this.currentSmile) * EASE;

    // 已足够接近中性且目标也归零——省去无谓写入
    if (Math.abs(this.currentSmile) < EPSILON && Math.abs(this.targetSmile) < EPSILON) {
      if (this.currentSmile !== 0) {
        this.currentSmile = 0;
        this.setParam(PARAM_MOUTH_FORM, 0);
      }
      return;
    }
    this.setParam(PARAM_MOUTH_FORM, this.currentSmile);
  }

  /** 探测参数是否存在于当前模型 */
  private probe(id: string): boolean {
    try {
      const core = this.coreModel();
      if (!core || typeof core.getParameterIndex !== "function") return false;
      return core.getParameterIndex(id) >= 0;
    } catch {
      return false;
    }
  }

  private setParam(id: string, value: number): void {
    try {
      const core = this.coreModel();
      if (!core) return;
      if (typeof core.setParameterValueById === "function") {
        core.setParameterValueById(id, value);
        return;
      }
      if (typeof core.getParameterIndex === "function" && typeof core.setParameterValueByIndex === "function") {
        const index = core.getParameterIndex(id);
        if (index >= 0) core.setParameterValueByIndex(index, value);
      }
    } catch (err) {
      console.warn("[Cyrene] param driver write failed", id, err);
      // 写入异常——停掉驱动，避免每帧刷屏
      this.smileAvailable = false;
      this.dispose();
    }
  }

  private coreModel(): CoreModelWithParameters | undefined {
    return (this.model.internalModel as unknown as { coreModel?: CoreModelWithParameters }).coreModel;
  }
}
