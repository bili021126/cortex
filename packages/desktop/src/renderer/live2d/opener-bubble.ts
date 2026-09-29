// ⚠️ 本类**没有任何实例化点**（2026-09-26 核实，**未修**）
//
// `OpenerBubbleController` 是完整实现的气泡控制器——接了 `window.live2dSpeech.onShowBubble`、
// 显示气泡文字、播 wav、走 `prepare/mouthStart/mouthStop` 口型同步、点击回
// `window.openerBridge.feedback(...)`。全仓 grep：**没有 `new OpenerBubbleController`，
// 也没有任何文件 import 本模块**。所以它是一整套**未接线的功能**，不是死代码——
// 每一环都写完了、依赖的两个全局桥都定义好了，只缺一处 `new`。
// 同类：N-25（`CapabilityRegistry`）、N-27（`MetaAgent` 三个 setter）。
// 详见 core-3-design-backlog.md N-29。未删——删它是代码改动，越出本轮边界。

// 桌宠气泡 controller：监听 onShowBubble + 显示气泡 + 播 wav + prepare/mouthStart/mouthStop
// 复用 chat/main.ts playTtsBase64 的口型同步思路。荡秋千随 MOUTH_START 自动触发（SpeakingMotionController）。

const BUBBLE_HOLD_MS = 7000;

export class OpenerBubbleController {
  private bubbleEl: HTMLElement | null;
  private currentAudio: HTMLAudioElement | null = null;
  private mouthStopTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(bubbleEl: HTMLElement) {
    this.bubbleEl = bubbleEl;
  }

  attach(): () => void {
    if (!window.live2dSpeech) return () => {};
    return window.live2dSpeech.onShowBubble((payload) => this.handle(payload));
  }

  private handle(payload: { text: string; audioBase64: string; format: "wav" | "mp3"; durationMs: number; sceneId: string; itemId: string }): void {
    if (!this.bubbleEl) return;
    this.stopCurrent();

    // 显示气泡文字
    this.bubbleEl.textContent = payload.text;
    this.bubbleEl.hidden = false;
    this.bubbleEl.classList.add("opener-bubble--show");

    // 点击气泡 = 接话
    this.bubbleEl.onclick = () => {
      window.openerBridge?.feedback({ type: "clicked", sceneId: payload.sceneId, itemId: payload.itemId });
    };

    // prepare（停当前 motion + 嘴动 reset）
    window.live2dSpeech?.prepare();

    // 播 wav
    const mime = payload.format === "wav" ? "audio/wav" : "audio/mp3";
    const bytes = Uint8Array.from(atob(payload.audioBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.currentAudio = audio;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (this.currentAudio === audio) this.currentAudio = null;
      window.live2dSpeech?.stopMouth();
      this.fadeTimer = setTimeout(() => this.fadeOut(), BUBBLE_HOLD_MS);
    };

    void audio.play().then(() => {
      // 播放开始 → 嘴动 + 荡秋千（startMouth 自动连带 speakingMotion）
      window.live2dSpeech?.startMouth(payload.durationMs);
      this.mouthStopTimer = setTimeout(() => {
        window.live2dSpeech?.stopMouth();
      }, payload.durationMs + 500);
    }).catch((err) => {
      console.warn("[OpenerBubble] 播放失败:", err);
      URL.revokeObjectURL(url);
      this.fadeOut();
    });
  }

  private fadeOut(): void {
    if (!this.bubbleEl) return;
    this.bubbleEl.classList.remove("opener-bubble--show");
    setTimeout(() => { if (this.bubbleEl) this.bubbleEl.hidden = true; }, 300);
  }

  private stopCurrent(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (this.mouthStopTimer) { clearTimeout(this.mouthStopTimer); this.mouthStopTimer = null; }
    if (this.fadeTimer) { clearTimeout(this.fadeTimer); this.fadeTimer = null; }
    window.live2dSpeech?.stopMouth();
  }
}
