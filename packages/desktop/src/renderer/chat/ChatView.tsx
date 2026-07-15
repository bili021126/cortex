/**
 * ChatView — 完整聊天界面
 *
 * 照搬 cyrene-agent chat.css 的 DOM 结构：
 * .msg > .msg__avatar(.msg__avatar-img) + .msg__body > .msg__bubble + .msg__time
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import "./chat.css";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  at: number;
  thinking?: boolean;
}

export function ChatView({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text, at: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await window.cortexDesktop.chat(text);
      const reply = res.data ?? "";
      const aiMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: reply, at: Date.now() };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e) {
      const errMsg: Message = {
        id: crypto.randomUUID(), role: "assistant",
        content: `[错误] ${e instanceof Error ? e.message : String(e)}`, at: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    },
    [handleSend],
  );

  const copyMessage = useCallback(async (content: string, _msgId: string) => {
    try { await navigator.clipboard.writeText(content); } catch {}
  }, []);

  const speakMessage = useCallback(async (content: string, msgId: string) => {
    if (speakingMsgId === msgId) { setSpeakingMsgId(null); return; }
    setSpeakingMsgId(msgId);
    try { await window.cortexDesktop.speak(content); } catch {}
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
                  {sending ? "思考中…" : "在线"}
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
                  <div className="msg__bubble">
                    {msg.thinking && <span className="msg__thinking-badge">💭 思考中…</span>}
                    {msg.content.split("\n").map((line, i) => (
                      <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
                    ))}
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
          autoComplete="off" spellCheck={false} disabled={sending}
        />
        <button type="submit" className="chat__send" id="send" aria-label="发送" disabled={sending || !input.trim()}>
          {sending ? "…" : "↵"}
        </button>
      </form>
    </div>
  );
}

function resolveAsset(assetPath: string): string {
  const clean = assetPath.replace(/^\/+/, "");
  return new URL(clean, document.baseURI).href;
}
