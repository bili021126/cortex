/**
 * ChatView — 完整聊天界面（布局 v2：左侧任务栏 + 好友/群聊侧边栏 + 聊天主区）
 *
 * 结构：
 * div.chat
 * ├── aside.chat__taskbar        最左窄栏（图标导航：聊天/好友/群聊/任务/设置）
 * ├── aside.chat__rail           侧边栏（好友 Tab + 群聊 Tab + 列表）
 * └── div.chat__main             聊天主区（标题栏 + 消息 + 输入）
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

/** 好友/群聊项 */
interface Contact {
  id: string;
  name: string;
  type: "friend" | "group";
  avatar: string;   // emoji 或路径
  desc: string;
  online?: boolean;
}

/** 前端错误分类（与 server 的 classifyChatError 同规则） */
function localErrorKind(msg: string): "timeout" | "fatal" | "network" {
  const t = msg.toLowerCase();
  if (/timeout|timed out|超时/.test(t)) return "timeout";
  if (/fetch failed|econn|enet|network|socket|连接|网络/.test(t)) return "network";
  return "fatal";
}

/** 预设联系人（好友 + 群聊） */
const PRESET_CONTACTS: Contact[] = [
  { id: "cyrene", name: "昔涟", type: "friend", avatar: "🌸", desc: "在线——陪你说话", online: true },
  { id: "work", name: "Cortex 工程助手", type: "friend", avatar: "🛠️", desc: "Work 模式 · 工具调用", online: true },
  { id: "learn", name: "学习伙伴", type: "friend", avatar: "📚", desc: "陪伴学习", online: false },
  { id: "daily", name: "日常助手", type: "friend", avatar: "📅", desc: "日常事务", online: true },
  { id: "group-proj", name: "Cortex 项目组", type: "group", avatar: "🏗️", desc: "工程协作 · 3 人" },
  { id: "group-life", name: "翁法罗斯", type: "group", avatar: "🌙", desc: "日常闲聊 · 5 人" },
];

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
  // 布局 v2：任务栏选中项（chat/contacts/tasks/settings）+ 侧边栏 Tab（friends/groups）+ 选中联系人
  const [taskbarTab, setTaskbarTab] = useState<"chat" | "contacts" | "tasks" | "settings">("chat");
  const [railTab, setRailTab] = useState<"friends" | "groups">("friends");
  const [activeContact, setActiveContact] = useState<Contact | null>(PRESET_CONTACTS[0]);
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
    } catch { /* 存储失败不阻断 */ }
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

  // 侧边栏可见：contacts tab（聊天/联系人）或 tasks 时显示
  const railVisible = taskbarTab === "chat" || taskbarTab === "contacts";
  const railList = railTab === "friends"
    ? PRESET_CONTACTS.filter((c) => c.type === "friend")
    : PRESET_CONTACTS.filter((c) => c.type === "group");

  return (
    <div className="chat">
      <canvas className="chat__particles" id="particles" aria-hidden="true" />

      {/* 左侧任务栏（图标导航） */}
      <aside className="chat__taskbar" aria-label="任务栏">
        <button type="button" className={`chat__taskbar-btn${taskbarTab === "chat" ? " is-active" : ""}`} onClick={() => setTaskbarTab("chat")} title="聊天" aria-label="聊天">💬</button>
        <button type="button" className={`chat__taskbar-btn${taskbarTab === "contacts" ? " is-active" : ""}`} onClick={() => setTaskbarTab("contacts")} title="好友与群聊" aria-label="好友与群聊">👥</button>
        <button type="button" className={`chat__taskbar-btn${taskbarTab === "tasks" ? " is-active" : ""}`} onClick={() => setTaskbarTab("tasks")} title="任务" aria-label="任务">✅</button>
        <button type="button" className={`chat__taskbar-btn${taskbarTab === "settings" ? " is-active" : ""}`} onClick={() => setTaskbarTab("settings")} title="设置" aria-label="设置">⚙️</button>
        <div className="chat__taskbar-spacer" />
        <button type="button" className="chat__taskbar-btn" onClick={onClose} title="关闭" aria-label="关闭">✕</button>
      </aside>

      {/* 好友 + 群聊侧边栏 */}
      {railVisible && (
        <aside className="chat__rail" id="chat-rail">
          <div className="chat__rail-tabs">
            <button type="button" className={`chat__rail-tab${railTab === "friends" ? " is-active" : ""}`} onClick={() => setRailTab("friends")}>好友</button>
            <button type="button" className={`chat__rail-tab${railTab === "groups" ? " is-active" : ""}`} onClick={() => setRailTab("groups")}>群聊</button>
          </div>
          <div className="chat__rail-list" role="list">
            {railList.map((c) => (
              <button key={c.id} type="button" className={`chat__rail-item${activeContact?.id === c.id ? " is-active" : ""}`} onClick={() => setActiveContact(c)}>
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

      <div className="chat__body">
        <div className="chat__main">
          {/* 标题栏 */}
          <header className="chat__titlebar">
            <div className="chat__titlebar-drag">
              <span className="chat__title-meta">
                <span className="chat__name">{activeContact?.name ?? "昔涟"}</span>
                <span className="chat__name-sep" aria-hidden="true">·</span>
                <span className={`chat__hint${busy ? " chat__hint--busy" : ""}`} id="chat-hint">
                  {busy ? "思考中…" : (activeContact?.online ? "在线" : "离线")}
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

          {/* 任务面板（占位——后续实现） */}
          {taskbarTab === "tasks" && (
            <div className="chat__panel">
              <div className="chat__empty-state">
                <div className="chat__empty-icon">✅</div>
                <p className="chat__empty-text">任务面板——待实现</p>
              </div>
            </div>
          )}
          {/* 设置面板（占位） */}
          {taskbarTab === "settings" && (
            <div className="chat__panel">
              <div className="chat__empty-state">
                <div className="chat__empty-icon">⚙️</div>
                <p className="chat__empty-text">设置面板——待实现</p>
              </div>
            </div>
          )}

          {/* 消息列表 */}
          {(taskbarTab === "chat" || taskbarTab === "contacts") && (
            <main className="chat__messages" id="messages" aria-live="polite">
              {messages.length === 0 && (
                <div className="chat__empty-state" id="chat-empty">
                  <div className="chat__empty-icon">💬</div>
                  <p className="chat__empty-text">和 {activeContact?.name ?? "昔涟"} 说点什么吧 ✨</p>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`msg msg--${msg.role === "user" ? "user" : "model"}`}>
                  <div className="msg__avatar">
                    {msg.role === "assistant" ? (
                      <img className="msg__avatar-img" src={resolveAsset("../avatars/cyrene-avatar.png")} alt="昔涟" />
                    ) : (
                      <span style={{ fontSize: 18, lineHeight: "46px" }}>⭐</span>
                    )}
                  </div>
                  <div className="msg__body">
                    <div className={`msg__bubble${msg.state ? ` msg__bubble--${msg.state}` : ""}`}>
                      {msg.thinking && <span className="msg__thinking-badge">💭 思考中…</span>}
                      {(msg.state === "sending" || msg.state === "queued" || msg.state === "regenerating") && !msg.content && (
                        <span className="msg__typing" aria-label="昔涟正在输入">
                          <span /><span /><span />
                        </span>
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
                          {msg.state === "regenerating" && (
                            <button className="msg__action-btn" onClick={() => stopMessage(msg)} title="停止">⏹️</button>
                          )}
                          {(msg.state === "sending" || msg.state === "streaming") && (
                            <button className="msg__action-btn" onClick={() => stopMessage(msg)} title="停止生成">⏹️</button>
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
          )}
        </div>
      </div>

      {/* 输入区（任务/设置面板时不显示） */}
      {(taskbarTab === "chat" || taskbarTab === "contacts") && (
        <form className="chat__input" id="composer" onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
          <textarea ref={inputRef} id="input" rows={1} value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={`和 ${activeContact?.name ?? "昔涟"} 说点什么…  Enter 发送 / Shift+Enter 换行`}
            autoComplete="off" spellCheck={false} disabled={busy}
          />
          <button type="submit" className="chat__send" id="send" aria-label="发送" disabled={busy || !input.trim()}>
            {busy ? "…" : "↵"}
          </button>
        </form>
      )}
    </div>
  );
}

function resolveAsset(assetPath: string): string {
  const clean = assetPath.replace(/^\/+/, "");
  return new URL(clean, document.baseURI).href;
}
