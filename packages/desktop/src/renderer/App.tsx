import React, { useState, useEffect, useRef } from "react";
import { Live2DManager } from "./live2d/manager";
import { InteractionController } from "./live2d/interaction";
import { MouseFocusController } from "./live2d/focus";
import { ExpressionResetController } from "./live2d/expression-reset";
import { MouthSyncController } from "./live2d/mouth-sync";
import { SpeakingMotionController } from "./live2d/speaking-motion";
import { ClickThroughController } from "./live2d/click-through";
import { ChatView } from "./chat/ChatView";
import "./ui/tokens.css";
import "./ui/fonts.css";

type ViewMode = "pet" | "chat" | "settings";

function resolveAsset(assetPath: string): string {
  const base = document.baseURI;
  const clean = assetPath.replace(/^\/+/, "");
  return new URL(clean, base).href;
}

export default function App() {
  const [view, setView] = useState<ViewMode>("pet");
  const managerRef = useRef<Live2DManager | null>(null);

  useEffect(() => {
    const canvas = document.getElementById("live2d-canvas") as HTMLCanvasElement | null;
    if (!canvas) return;

    const modelPath = resolveAsset("models/cyrene/Cyrene.model3.json");

    const manager = new Live2DManager({
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      modelPath,
      onLoad: () => {
        console.log("[Desktop] Live2D model loaded OK");
        const model = manager.getModel();
        if (!model) return;

        new InteractionController(canvas, model, manager.getHitAreaDefs(), {
          onTrigger: (area) => { console.log("[Desktop] hit", area.name); },
        });

        new MouseFocusController(canvas, model);
        new ExpressionResetController(model);
        new MouthSyncController(model);
        new SpeakingMotionController(model);
        new ClickThroughController(canvas, manager, {
          onInteractive: (interactive) => { console.log("[Desktop] interactive:", interactive); },
        });
      },
      onError: (err) => {
        console.error("[Desktop] Failed to load model:", err);
      },
    });

    manager.init();
    managerRef.current = manager;

    const handleResize = () => manager.resize(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      manager.dispose();
      managerRef.current = null;
    };
  }, []);

  // ── 窗口拖拽（原版 cyrene-agent：setPointerCapture + moveTo + rAF）──
  useEffect(() => {
    let isDragging = false;
    let dragOffX = 0;
    let dragOffY = 0;
    let pendingPos: { x: number; y: number } | null = null;
    let rafId: number | null = null;

    const flushMove = () => {
      rafId = null;
      if (pendingPos) {
        window.cyrene.moveTo(pendingPos.x, pendingPos.y);
        pendingPos = null;
      }
    };

    const handleDown = (e: PointerEvent) => {
      if (view !== "pet") return;
      isDragging = true;
      dragOffX = e.screenX - window.screenX;
      dragOffY = e.screenY - window.screenY;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      pendingPos = null;
      void window.cyrene.setInteractive(true);
      window.cyrene.setDragging(true);
      try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
    };

    const handleMove = (e: PointerEvent) => {
      if (!isDragging) return;
      pendingPos = { x: e.screenX - dragOffX, y: e.screenY - dragOffY };
      if (rafId === null) rafId = requestAnimationFrame(flushMove);
    };

    const handleUp = (e: PointerEvent) => {
      if (!isDragging) return;
      pendingPos = { x: e.screenX - dragOffX, y: e.screenY - dragOffY };
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      flushMove();
      isDragging = false;
      window.cyrene.setDragging(false);
      try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
      void window.cyrene.setInteractive(false);
    };

    document.addEventListener("pointerdown", handleDown);
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleUp);
    return () => {
      document.removeEventListener("pointerdown", handleDown);
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleUp);
    };
  }, [view]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {view === "chat" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20 }}>
          <ChatView onClose={() => setView("pet")} />
        </div>
      )}

      {view === "settings" && (
        <div style={{
          position: "absolute", inset: 0,
          background: "rgba(10, 8, 25, 0.95)", color: "#ebe5f5",
          zIndex: 30, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
        }}>
          <p style={{ opacity: 0.6 }}>⚙️ 设置（开发中）</p>
          <button onClick={() => setView("pet")} style={{
            background: "var(--rb-grad-pink)", border: "none",
            borderRadius: "var(--rb-radius-full)", color: "#fff",
            padding: "8px 24px", fontSize: 14, cursor: "pointer",
          }}>返回</button>
        </div>
      )}

      {view === "pet" && (
        <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 40, display: "flex", gap: 8 }}>
          <button onClick={() => setView("chat")} style={btnStyle} title="聊天">💬</button>
          <button onClick={() => setView("settings")} style={btnStyle} title="设置">⚙️</button>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%",
  border: "1px solid rgba(236, 72, 153, 0.25)",
  background: "rgba(255, 255, 255, 0.08)", color: "#ebe5f5",
  fontSize: 16, cursor: "pointer", display: "flex",
  alignItems: "center", justifyContent: "center",
};
