/**
 * ChatView — 完整聊天界面（UX 完成版 2026-08-08）
 *
 * 照搬 cyrene-agent chat.css 的 DOM 结构：
 * .msg > .msg__avatar(.msg__avatar-img) + .msg__body > .msg__bubble + .msg__time
 *
 * UX 设计（显示 + 交互）：
 * - 显示：打字指示器（sending/queued/regenerating 空内容）/ busy 标题呼吸点 /
 *         消息进入动画 / 呼吸气泡 / 错误强调（CSS 同文件）
 * - 交互：sendRequest 单一执行路径（handleSend/retry/regenerate 复用——真正重发）
 *         状态机全边（含 sending → complete）/ 动作按钮按状态可见
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
  const [messages, setMessages] = useState<Message[]>(() => {
    // UX 完全体：历史持久化（重开窗口不丢对话——localStorage）
    try {
      const raw = localStorage.getItem("cyrene-chat-history");
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        return parsed.filter((m) => m && typeof m.id === "string" && m.role === "user" || (m && typeof m.id === "string" && m.role === "assistant"));
      }
    } catch { /* 无历史或损坏——空对话 */ }
    return [];
  });
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // U1：busy = 任一消息在 queued/sending/streaming（驱动输入禁用与状态提示）
  const busy = messages.some((m) => m.state === "queued" || m.state === "sending" || m.state === "streaming" || m.state === "regenerating");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // UX 完全体：历史自动保存（每次消息变化）
  useEffect(() => {
    try {
      // 进行中的消息不持久化（状态类字段会过时）——只存完成的对话
      const stable = messages.filter((m) => !m.state || m.state === "complete" || m.state === "stopped" || m.state === "interrupted" || m.state === "error_timeout" || m.state === "error_fatal");
      localStorage.setItem("cyrene-chat-history", JSON.stringify(stable));
    } catch { /* 存储失败不阻断 */ }
  }, [messages]);

  // UX：状态推进 dispatch（按 aiId 定位——retry/regenerate 复用）
  const dispatch = useCallback((aiId: string, ev: Parameters<typeof messageReducer>[1]["type"] | "complete" | "timeout" | "fatal" | "net-error" | "ack") => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== aiId) return m;
      try { return { ...m, state: messageReducer(m.state ?? "idle", { type: ev as never }) }; } catch { return m; }
    }));
  }, []);

  // UX 核心：发送的单一执行路径（ack → streamChat 流式 → complete/error）——handleSend/retry/regenerate 复用
  // 完全体：WS 流式打通（sessionId 修复）——真实打字机效果（chunk 逐字累积）+ 多轮上下文（history）
  const sendRequest = useCallback(async (aiId: string, text: string) => {
    dispatch(aiId, "ack");
    let first = true;
    // 多轮上下文：收集历史（该 ai 消息之前的完整对话——user/assistant 交替）
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const idx = messages.findIndex((m) => m.id === aiId);
    for (let i = 0; i < idx; i++) {
      const m = messages[i];
      if (m.role === "user" || m.role === "assistant") history.push({ role: m.role, content: m.content || "" });
    }
    try {
      await window.cortexDesktop.streamChat(
        text,
        undefined,
        (chunk) => {
          // 首 chunk → streaming 态（打字机开始）
          if (first) { first = false; dispatch(aiId, "first-token"); }
          setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: m.content + chunk } : m)));
        },
        (full) => {
          // 完成 → complete 态（内容以完整版为准）
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiId) return m;
            try { return { ...m, content: full, state: messageReducer(m.state ?? "idle", { type: "complete" }) }; } catch { return m; }
          }));
        },
        history,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = localErrorKind(msg);
      // 错误经 reducer（sending --timeout/net-error/fatal--> error_*）+ 错误消息上屏
      const ev = kind === "timeout" ? "timeout" : kind === "network" ? "net-error" : "fatal";
      setMessages((prev) => prev.map((m) => {
        if (m.id !== aiId) return m;
        try { return { ...m, content: msg, state: messageReducer(m.state ?? "idle", { type: ev as never }) }; } catch { return m; }
      }));
    } finally {
      inputRef.current?.focus();
    }
  }, [dispatch]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || messages.some((m) => m.state === "queued" || m.state === "sending" || m.state === "streaming")) return;
    setInput("");

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text, at: Date.now() };
    const aiId = crypto.randomUUID();
    const aiMsg: Message = { id: aiId, role: "assistant", content: "", at: Date.now(), state: "queued" };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    void sendRequest(aiId, text);
  }, [input, messages, sendRequest]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    },
    [handleSend],
  );

  const copyMessage = useCallback(async (content: string, _msgId: string) => {
    try { await navigator.clipboard.writeText(content); } catch { /* 剪贴板写入可能被拒，忽略 */ }
  }, []);

  // U1 动作：retry（interrupted/error_timeout → 重发）/ regenerate（stopped/complete → 重新生成）/ stop（→ stopped）
  // UX 完整化：重发/重新生成真正调用 chat（不再只改状态——否则 regenerating 永卡）
  const resendMessage = useCallback((msg: Message) => {
    const from = msg.state ?? "idle";
    if (from !== "interrupted" && from !== "error_timeout" && from !== "complete" && from !== "stopped") return;
    // 找对应的用户消息（该 assistant 消息之前的最后一条 user——重发的输入）
    let prompt = "";
    const idx = messages.findIndex((m) => m.id === msg.id);
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") { prompt = messages[i].content; break; }
    }
    if (!prompt) return;
    const ev = (from === "interrupted" || from === "error_timeout" ? "retry" : "regenerate") as never;
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      try { return { ...m, content: "", state: messageReducer(from, { type: ev }) }; } catch { return m; }
    }));
    void sendRequest(msg.id, prompt);
  }, [messages, sendRequest]);

  const stopMessage = useCallback((msg: Message) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      try { return { ...m, state: messageReducer(m.state ?? "idle", { type: "stop" }) }; } catch { return m; }
    }));
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
          {/* 标题栏 — UX：busy 时粉色呼吸点（chat__hint--busy） */}
          <header className="chat__titlebar">
            <div className="chat__titlebar-drag">
              <span className="chat__title-meta">
                <span className="chat__name">昔涟</span>
                <span className="chat__name-sep" aria-hidden="true">·</span>
                <span className={`chat__hint${busy ? " chat__hint--busy" : ""}`} id="chat-hint">
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

          {/* 消息列表 — UX：消息进入动画（.msg chatFadeSlideIn） */}
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
                    {/* UX：发送/再生成中的打字指示器（内容空时——三跳动点——chat.css 动画） */}
                    {(msg.state === "sending" || msg.state === "queued" || msg.state === "regenerating") && !msg.content && (
                      <span className="msg__typing" aria-label="昔涟正在输入">
                        <span /><span /><span />
                      </span>
                    )}
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
                      <>{` · `}
                        {/* U1 状态动作：retry/regenerate/stop 按状态可见 */}
                        {(msg.state === "interrupted" || msg.state === "error_timeout") && (
                          <button className="msg__action-btn" onClick={() => resendMessage(msg)} title="重试">🔄</button>
                        )}
                        {(msg.state === "complete" || msg.state === "stopped") && (
                          <button className="msg__action-btn" onClick={() => resendMessage(msg)} title="重新生成">♻️</button>
                        )}
                        {msg.state === "regenerating" && (
                          <button className="msg__action-btn" onClick={() => stopMessage(msg)} title="停止">⏹️</button>
                        )}
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

      {/* 输入区 — UX：busy 时发送按钮 … */}
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
