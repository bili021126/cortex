/**
 * ChatView — 完整聊天界面
 *
 * 照搬 cyrene-agent chat.css 的 DOM 结构：
 * .msg > .msg__avatar(.msg__avatar-img) + .msg__body > .msg__bubble + .msg__time
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import "./chat.css";
import { messageReducer, type MessageState } from "./message-state-machine";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  at: number;
  thinking?: boolean;
  /** U1 状态机（assistant 消息）——驱动气泡/按钮/辅助 */
  state?: MessageState;
}

/** 前端错误分类（与 server 的 classifyChatError 同规则——WS 未接线时的本地兜底） */
function localErrorKind(msg: string): "timeout" | "fatal" | "network" {
  const t = msg.toLowerCase();
  if (/timeout|timed out|超时/.test(t)) return "timeout";
  if (/fetch failed|econn|enet|network|socket|连接|网络/.test(t)) return "network";
  return "fatal";
}

export function ChatView({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // U1：busy = 任一消息在 queued/sending/streaming（驱动输入禁用与状态提示）
  const busy = messages.some((m) => m.state === "queued" || m.state === "sending" || m.state === "streaming" || m.state === "regenerating");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || messages.some((m) => m.state === "queued" || m.state === "sending" || m.state === "streaming")) return;
    setInput("");

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text, at: Date.now() };
    const aiId = crypto.randomUUID();
    const aiMsg: Message = { id: aiId, role: "assistant", content: "", at: Date.now(), state: "queued" };
    setMessages((prev) => [...prev, userMsg, aiMsg]);

    // U1 状态推进：queued → sending（ack 由 chat 调用隐含——非流式无 first-token 边界）
    const dispatch = (ev: Parameters<typeof messageReducer>[1]["type"] | "complete" | "timeout" | "fatal" | "net-error" | "ack") => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== aiId) return m;
        try { return { ...m, state: messageReducer(m.state ?? "idle", { type: ev as never }) }; } catch { return m; }
      }));
    };
    dispatch("ack");

    try {
      const res = await window.cortexDesktop.chat(text);
      setMessages((prev) => prev.map((m) =>
        m.id === aiId ? { ...m, content: res.data ?? "", state: "complete" } : m,
      ));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = localErrorKind(msg);
      setMessages((prev) => prev.map((m) =>
        m.id === aiId ? { ...m, state: kind === "timeout" ? "error_timeout" : kind === "network" ? "interrupted" : "error_fatal" } : m,
      ));
    } finally {
      inputRef.current?.focus();
    }
  }, [input, messages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    },
    [handleSend],
  );

  const copyMessage = useCallback(async (content: string, _msgId: string) => {
    try { await navigator.clipboard.writeText(content); } catch { /* 剪贴板写入可能被拒，忽略 */ }
  }, []);

  const speakMessage = useCallback(async (content: string, msgId: string) => {
    if (speakingMsgId === msgId) { setSpeakingMsgId(null); return; }
    setSpeakingMsgId(msgId);
    try { await window.cortexDesktop.speak(content); } catch { /* TTS 播放可能失败，忽略 */ }
    setSpeakingMsgId(null);
  }, [speakingMsgId]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="chat">
      <canvas className="chat__particles" id="particles" aria-hidden="true" />

      <div className="chat__body">
        <div className="chat__main">
          {/* 标题栏 */}
          <header className="chat__titlebar">
            <div className="chat__titlebar-drag">
              <span className="chat__title-meta">
                <span className="chat__name">昔涟</span>
                <span className="chat__name-sep" aria-hidden="true">·</span>
                <span className="chat__hint" id="chat-hint">
                  {busy ? "思考中…" : "在线"}
                </span>
              </span>
            </div>
            <div className="chat__titlebar-actions">
              <button type="button" className="chat__winbtn chat__winbtn--close" onClick={onClose} aria-label="关闭" title="关闭">
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </header>

          {/* 消息列表 */}
          <main className="chat__messages" id="messages" aria-live="polite">
            {messages.length === 0 && (
              <div className="chat__empty-state" id="chat-empty">
                <div className="chat__empty-icon">💬</div>
                <p className="chat__empty-text">昔涟期待与你聊天哦 ✨</p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`msg msg--${msg.role === "user" ? "user" : "model"}`}>
                {/* 头像 — 对齐 chat.css: .msg__avatar > .msg__avatar-img */}
                <div className="msg__avatar">
                  {msg.role === "assistant" ? (
                    <img className="msg__avatar-img" src={resolveAsset("../avatars/cyrene-avatar.png")} alt="昔涟" />
                  ) : (
                    <span style={{ fontSize: 18, lineHeight: "46px" }}>⭐</span>
                  )}
                </div>

                {/* 正文 — .msg__body > .msg__bubble + .msg__time */}
                <div className="msg__body">
                  <div className={`msg__bubble${msg.state ? ` msg__bubble--${msg.state}` : ""}`}>
                    {msg.thinking && <span className="msg__thinking-badge">💭 思考中…</span>}
                    {msg.content.split("\n").map((line, i) => (
                      <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
                    ))}
                    {/* U1 状态角标（stopped/interrupted/error 的语义提示） */}
                    {msg.state === "stopped" && <span className="msg__state-badge">已停止</span>}
                    {msg.state === "interrupted" && <span className="msg__state-badge">连接中断</span>}
                    {msg.state === "error_timeout" && <span className="msg__state-badge">超时</span>}
                    {msg.state === "error_fatal" && <span className="msg__state-badge">出错了</span>}
                  </div>
                  <span className="msg__time">
                    {formatTime(msg.at)}
                    {msg.role === "assistant" && (
                      <>{" · "}
                        <button className="msg__action-btn" onClick={() => void copyMessage(msg.content, msg.id)} title="复制">📋</button>
                        <button className="msg__action-btn" onClick={() => void speakMessage(msg.content, msg.id)} title="朗读">
                          {speakingMsgId === msg.id ? "🔊" : "🔈"}
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </main>
        </div>
      </div>

      {/* 输入区 */}
      <form className="chat__input" id="composer" onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
        <textarea ref={inputRef} id="input" rows={1} value={input}
          onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="说点什么…  Enter 发送 / Shift+Enter 换行"
          autoComplete="off" spellCheck={false} disabled={busy}
        />
        <button type="submit" className="chat__send" id="send" aria-label="发送" disabled={busy || !input.trim()}>
          {busy ? "…" : "↵"}
        </button>
      </form>
    </div>
  );
}

function resolveAsset(assetPath: string): string {
  const clean = assetPath.replace(/^\/+/, "");
  return new URL(clean, document.baseURI).href;
}
