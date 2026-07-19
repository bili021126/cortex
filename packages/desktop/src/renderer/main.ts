/**
 * 主窗口入口 — Live2D 桌宠
 *
 * 照搬 cyrene-agent 原版架构：无 React，直接操作 DOM。
 * canvas + 气泡 + 拖拽 + 点击交互。
 */
import { Live2DManager } from "./live2d/manager";
import { InteractionController } from "./live2d/interaction";
import { MouseFocusController } from "./live2d/focus";
import { ExpressionResetController } from "./live2d/expression-reset";
import { MouthSyncController } from "./live2d/mouth-sync";
import { SpeakingMotionController } from "./live2d/speaking-motion";
import { ClickThroughController } from "./live2d/click-through";

const canvas = document.getElementById("live2d-canvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #live2d-canvas not found");

// ── 兜底 window.cyrene（preload 未就绪时降级）──
if (!window.cyrene) {
  (window as unknown as { cyrene: unknown }).cyrene = {
    minimize: () => {}, hide: () => {}, quit: () => {},
    setInteractive: (_: boolean) => Promise.resolve(),
    moveBy: (_dx: number, _dy: number) => {},
    moveTo: (_x: number, _y: number) => {},
    setDragging: (_isDragging: boolean) => {},
    captureFrame: () => Promise.resolve(null),
    getCursorPosition: () => Promise.resolve(null),
    onPetZoom: (_cb: (zoom: number) => void) => () => {},
  };
}

// ── 资源路径 ──
function resolveAsset(assetPath: string): string {
  const clean = assetPath.replace(/^\/+/, "");
  return new URL(clean, document.baseURI).href;
}

let focus: MouseFocusController | null = null;
let clickThrough: ClickThroughController | null = null;

const manager = new Live2DManager({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
  modelPath: resolveAsset("models/cyrene/Cyrene.model3.json"),
  onLoad: () => {
    console.log("[Cyrene] Model loaded");
    const model = manager.getModel();
    if (!model) return;

    new ExpressionResetController(model);
    new MouthSyncController(model);
    new SpeakingMotionController(model);

    new InteractionController(canvas, model, manager.getHitAreaDefs(), {
      onTrigger: (area) => console.log("[Cyrene] hit", area.name),
    });
    focus = new MouseFocusController(canvas, model);
    focus.focusCenter(true);

    clickThrough = new ClickThroughController(canvas, manager, {
      onInteractive: (interactive) => void window.cyrene.setInteractive(interactive),
    });
  },
  onError: (err) => console.error("[Cyrene] Failed to load model:", err),
});

void manager.init();

window.addEventListener("resize", () => {
  manager.resize(window.innerWidth, window.innerHeight);
  focus?.focusCenter(true);
});

// ── 窗口拖拽 ──────────────────────────────────────────
let isDragging = false;
let dragOffX = 0;
let dragOffY = 0;
let pendingPos: { x: number; y: number } | null = null;
let rafId: number | null = null;

function flushMove() {
  rafId = null;
  if (pendingPos) {
    window.cyrene.moveTo(pendingPos.x, pendingPos.y);
    pendingPos = null;
  }
}

canvas.addEventListener("pointerdown", (e) => {
  isDragging = true;
  dragOffX = e.screenX - window.screenX;
  dragOffY = e.screenY - window.screenY;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  pendingPos = null;
  clickThrough?.pause();
  focus?.pause(true);
  manager.pause();
  void window.cyrene.setInteractive(true);
  window.cyrene.setDragging(true);
  try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* 拖拽频繁时 setPointerCapture 可能抛错，忽略 */ }
});

canvas.addEventListener("pointermove", (e) => {
  if (!isDragging) return;
  pendingPos = { x: e.screenX - dragOffX, y: e.screenY - dragOffY };
  if (rafId === null) rafId = requestAnimationFrame(flushMove);
});

function finishDrag(e?: PointerEvent) {
  if (!isDragging) return;
  if (e) {
    pendingPos = { x: e.screenX - dragOffX, y: e.screenY - dragOffY };
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    flushMove();
  }
  isDragging = false;
  manager.resume();
  focus?.resume();
  window.cyrene.setDragging(false);
  clickThrough?.resume();
  if (e) { try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* 指针已释放时 releasePointerCapture 可能抛错，忽略 */ } }
}

canvas.addEventListener("pointerup", (e) => finishDrag(e));
canvas.addEventListener("pointercancel", (e) => finishDrag(e));
canvas.addEventListener("pointerleave", () => {
  if (isDragging) return;
  void window.cyrene.setInteractive(false);
});

// ── 双击打开聊天 ────────────────────────────────────
canvas.addEventListener("dblclick", () => {
  window.cyrene.openChat?.();
});
