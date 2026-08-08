/**
 * ChatView — 聊天界面（重写版 v4）
 *
 * 布局：
 * div.chat
 * ├── aside.chat__taskbar   最左图标导航（聊天/好友群聊/任务/设置/关闭）
 * ├── aside.chat__rail      好友 | 群聊 侧边栏
 * ├── div.chat__main        聊天界面（标题栏 + 消息 + 底部输入——一体）
 * └── aside.chat__side      右侧信息栏（默认收起——ℹ️ 展开）
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
  state?: MessageState;
}

interface Contact {
  id: string;
  name: string;
  type: "friend" | "group";
  avatar: string;
  desc: string;
  online?: boolean;
}

const PRESET_CONTACTS: Contact[] = [
  { id: "cyrene", name: "昔涟", type: "friend", avatar: "🌸", desc: "在线——陪你说话", online: true },
  { id: "work", name: "Cortex 工程助手", type: "friend", avatar: "🛠️", desc: "Work 模式 · 工具调用", online: true },
  { id: "learn", name: "学习伙伴", type: "friend", avatar: "📚", desc: "陪伴学习", online: false },
  { id: "daily", name: "日常助手", type: "friend", avatar: "📅", desc: "日常事务", online: true },
  { id: "group-proj", name: "Cortex 项目组", type: "group", avatar: "🏗️", desc: "工程协作 · 3 人" },
  { id: "group-life", name: "翁法罗斯", type: "group", avatar: "🌙", desc: "日常闲聊 · 5 人" },
];

function localErrorKind(msg: string): "timeout" | "fatal" | "network" {
  const t = msg.toLowerCase();
  if (/timeout|timed out|超时/.test(t)) return "timeout";
  if (/fetch failed|econn|enet|network|socket|连接|网络/.test(t)) return "network";
  return "fatal";
}

export function ChatView({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const raw = localStorage.getItem("cyrene-chat-history");
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        return parsed.filter((m) => m && typeof m.id === "string" && (m.role === "user" || m.role === "assistant"));
      }
    } catch { /* 无历史 */ }
    return [];
  });
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "tasks" | "settings">("chat");
  const [railTab, setRailTab] = useState<"friends" | "groups">("friends");
  const [active, setActive] = useState<Contact | null>(PRESET_CONTACTS[0]);
  const [sideOpen, setSideOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = messages.some((m) => m.state === "queued" || m.state === "sending" || m.state === "streaming" || m.state === "regenerating");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      const stable = messages.filter((m) => !m.state || m.state === "complete" || m.state === "stopped" || m.state === "interrupted" || m.state === "error_timeout" || m.state === "error_fatal");
      localStorage.setItem("cyrene-chat-history", JSON.stringify(stable));
    } catch { /* 忽略 */ }
  }, [messages]);

  const dispatch = useCallback((aiId: string, ev: Parameters<typeof messageReducer>[1]["type"] | "complete" | "timeout" | "fatal" | "net-error" | "ack") => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== aiId) return m;
      try { return { ...m, state: messageReducer(m.state ?? "idle", { type: ev as never }) }; } catch { return m; }
    }));
  }, []);

  const sendRequest = useCallback(async (aiId: string, text: string) => {
    dispatch(aiId, "ack");
    let first = true;
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
          if (first) { first = false; dispatch(aiId, "first-token"); }
          setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: m.content + chunk } : m)));
        },
        (full) => {
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
      const ev = kind === "timeout" ? "timeout" : kind === "network" ? "net-error" : "fatal";
      setMessages((prev) => prev.map((m) => {
        if (m.id !== aiId) return m;
        try { return { ...m, content: msg, state: messageReducer(m.state ?? "idle", { type: ev as never }) }; } catch { return m; }
      }));
    } finally {
      inputRef.current?.focus();
    }
  }, [dispatch, messages]);

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

  const copyMessage = useCallback(async (content: string) => {
    try { await navigator.clipboard.writeText(content); } catch { /* 忽略 */ }
  }, []);

  const resendMessage = useCallback((msg: Message) => {
    const from = msg.state ?? "idle";
    if (from !== "interrupted" && from !== "error_timeout" && from !== "complete" && from !== "stopped") return;
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
    void window.cortexDesktop.cancelStreamChat();
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      try { return { ...m, state: messageReducer(m.state ?? "idle", { type: "stop" }) }; } catch { return m; }
    }));
  }, []);

  const speakMessage = useCallback(async (content: string, msgId: string) => {
    if (speakingMsgId === msgId) { setSpeakingMsgId(null); return; }
    if (!content.trim()) return;
    setSpeakingMsgId(msgId);
    try {
      const res = await window.cortexDesktop.speak(content) as { ok: boolean; data?: string; error?: string };
      if (res?.ok && res.data) {
        const b64 = res.data.includes(",") ? res.data.split(",").pop() ?? "" : res.data;
        const mime = res.data.startsWith("data:") ? res.data.slice(5, res.data.indexOf(";")) : "audio/wav";
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = 1.5;
        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          void audio.play().catch((err) => {
            console.error("[speak] Audio.play 失败:", String(err));
            URL.revokeObjectURL(url);
            resolve();
          });
        });
      } else if (res?.error) {
        console.error("[speak] TTS 错误:", res.error);
      }
    } catch { /* 忽略 */ }
    setSpeakingMsgId(null);
  }, [speakingMsgId]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const railList = railTab === "friends"
    ? PRESET_CONTACTS.filter((c) => c.type === "friend")
    : PRESET_CONTACTS.filter((c) => c.type === "group");

  return (
    <div className="chat">
      {/* ① 任务栏 */}
      <aside className="chat__taskbar" aria-label="任务栏">
        <button type="button" className={`chat__taskbar-btn${tab === "chat" ? " is-active" : ""}`} onClick={() => setTab("chat")} title="聊天" aria-label="聊天">💬</button>
        <button type="button" className={`chat__taskbar-btn${railTab === "friends" || railTab === "groups" ? " is-active" : ""}`} onClick={() => setRailTab(railTab === "friends" ? "groups" : "friends")} title="好友与群聊" aria-label="好友与群聊">👥</button>
        <button type="button" className={`chat__taskbar-btn${tab === "tasks" ? " is-active" : ""}`} onClick={() => setTab("tasks")} title="任务" aria-label="任务">✅</button>
        <button type="button" className={`chat__taskbar-btn${tab === "settings" ? " is-active" : ""}`} onClick={() => setTab("settings")} title="设置" aria-label="设置">⚙️</button>
        <div className="chat__taskbar-spacer" />
        <button type="button" className="chat__taskbar-btn" onClick={onClose} title="关闭" aria-label="关闭">✕</button>
      </aside>

      {/* ② 好友/群聊侧边栏 */}
      {tab === "chat" && (
        <aside className="chat__rail" aria-label="会话列表">
          <div className="chat__rail-tabs">
            <button type="button" className={`chat__rail-tab${railTab === "friends" ? " is-active" : ""}`} onClick={() => setRailTab("friends")}>好友</button>
            <button type="button" className={`chat__rail-tab${railTab === "groups" ? " is-active" : ""}`} onClick={() => setRailTab("groups")}>群聊</button>
          </div>
          <div className="chat__rail-list" role="list">
            {railList.map((c) => (
              <button key={c.id} type="button" className={`chat__rail-item${active?.id === c.id ? " is-active" : ""}`} onClick={() => setActive(c)}>
                <span className="chat__rail-avatar" aria-hidden="true">{c.avatar}</span>
                <span className="chat__rail-meta">
                  <span className="chat__rail-name">{c.name}</span>
                  <span className="chat__rail-desc">{c.desc}</span>
                </span>
                {c.online && <span className="chat__rail-dot" aria-label="在线" />}
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* ③ 聊天界面（标题栏 + 消息 + 底部输入一体） */}
      <div className="chat__main">
        <header className="chat__titlebar">
          <div className="chat__titlebar-drag">
            <span className="chat__title-meta">
              <span className="chat__name">{active?.name ?? "昔涟"}</span>
              <span className="chat__name-sep" aria-hidden="true">·</span>
              <span className={`chat__hint${busy ? " chat__hint--busy" : ""}`}>{busy ? "思考中…" : (active?.online ? "在线" : "离线")}</span>
            </span>
          </div>
          <div className="chat__titlebar-actions">
            <button type="button" className={`chat__winbtn${sideOpen ? " is-active" : ""}`} onClick={() => setSideOpen((v) => !v)} aria-label="联系人信息" title="联系人信息">ℹ️</button>
            <button type="button" className="chat__winbtn chat__winbtn--close" onClick={onClose} aria-label="关闭" title="关闭">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        {/* 任务/设置面板 */}
        {tab === "tasks" && (
          <div className="chat__panel">
            <div className="chat__empty-state">
              <div className="chat__empty-icon">✅</div>
              <p className="chat__empty-text">任务面板——待实现</p>
            </div>
          </div>
        )}
        {tab === "settings" && (
          <div className="chat__panel">
            <div className="chat__empty-state">
              <div className="chat__empty-icon">⚙️</div>
              <p className="chat__empty-text">设置面板——待实现</p>
            </div>
          </div>
        )}

        {/* 聊天：消息 + 输入（一体） + 右侧信息栏（收起） */}
        {tab === "chat" && (
          <div className="chat__stage">
            <div className="chat__stage-main">
              <main className="chat__messages" aria-live="polite">
                {messages.length === 0 && (
                  <div className="chat__empty-state">
                    <div className="chat__empty-icon">💬</div>
                    <p className="chat__empty-text">和 {active?.name ?? "昔涟"} 说点什么吧 ✨</p>
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`msg msg--${msg.role === "user" ? "user" : "model"}`}>
                    <div className="msg__avatar">
                      {msg.role === "assistant" ? (
                        <img className="msg__avatar-img" src={resolveAsset("../avatars/cyrene-avatar.png")} alt="昔涟" />
                      ) : (
                        <span className="msg__avatar-user">⭐</span>
                      )}
                    </div>
                    <div className="msg__body">
                      <div className={`msg__bubble${msg.state ? ` msg__bubble--${msg.state}` : ""}`}>
                        {(msg.state === "sending" || msg.state === "queued" || msg.state === "regenerating") && !msg.content && (
                          <span className="msg__typing" aria-label="正在输入"><span /><span /><span /></span>
                        )}
                        {msg.content.split("\n").map((line, i) => (
                          <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
                        ))}
                        {msg.state === "stopped" && <span className="msg__state-badge">已停止</span>}
                        {msg.state === "interrupted" && <span className="msg__state-badge">连接中断</span>}
                        {msg.state === "error_timeout" && <span className="msg__state-badge">超时</span>}
                        {msg.state === "error_fatal" && <span className="msg__state-badge">出错了</span>}
                      </div>
                      <span className="msg__time">
                        {formatTime(msg.at)}
                        {msg.role === "assistant" && (
                          <>{` · `}
                            {(msg.state === "interrupted" || msg.state === "error_timeout") && (
                              <button className="msg__action-btn" onClick={() => resendMessage(msg)} title="重试">🔄</button>
                            )}
                            {(msg.state === "complete" || msg.state === "stopped") && (
                              <button className="msg__action-btn" onClick={() => resendMessage(msg)} title="重新生成">♻️</button>
                            )}
                            {(msg.state === "regenerating" || msg.state === "sending" || msg.state === "streaming") && (
                              <button className="msg__action-btn" onClick={() => stopMessage(msg)} title="停止">⏹️</button>
                            )}
                            <button className="msg__action-btn" onClick={() => void copyMessage(msg.content)} title="复制">📋</button>
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

              <form className="chat__input" onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
                <textarea ref={inputRef} rows={1} value={input}
                  onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder={`和 ${active?.name ?? "昔涟"} 说点什么…  Enter 发送 / Shift+Enter 换行`}
                  autoComplete="off" spellCheck={false} disabled={busy}
                />
                <button type="submit" className="chat__send" aria-label="发送" disabled={busy || !input.trim()}>
                  {busy ? "…" : "↵"}
                </button>
              </form>
            </div>

            {/* ④ 右侧信息栏（默认收起） */}
            <aside className={`chat__side${sideOpen ? "" : " is-collapsed"}`} aria-label="联系人信息">
              <div className="chat__side-avatar">{active?.avatar ?? "🌸"}</div>
              <div className="chat__side-name">{active?.name ?? "昔涟"}</div>
              <div className="chat__side-desc">{active?.desc ?? ""}</div>
              <div className={`chat__side-status${active?.online ? " is-online" : ""}`}>
                {active?.online ? "在线" : "离线"}
              </div>
              <div className="chat__side-divider" />
              <div className="chat__side-label">会话信息</div>
              <div className="chat__side-info">消息 {messages.length} 条</div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function resolveAsset(assetPath: string): string {
  const clean = assetPath.replace(/^\/+/, "");
  return new URL(clean, document.baseURI).href;
}
