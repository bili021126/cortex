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
import { IconChat, IconUsers, IconTasks, IconSettings, IconClose, IconInfo } from "./icons";

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

const PRESET_GROUPS: Contact[] = [
  { id: "group-proj", name: "Cortex 项目组", type: "group", avatar: "🏗️", desc: "工程协作 · 3 人" },
  { id: "group-life", name: "翁法罗斯", type: "group", avatar: "🌙", desc: "日常闲聊 · 5 人" },
];

function localErrorKind(msg: string): "timeout" | "fatal" | "network" {
  const t = msg.toLowerCase();
  if (/timeout|timed out|超时/.test(t)) return "timeout";
  if (/fetch failed|econn|enet|network|socket|连接|网络/.test(t)) return "network";
  return "fatal";
}

/** 设置域列表（对应 config/constants 的域） */
const SETTINGS_DOMAINS = [
  { id: "llm", name: "模型", icon: "🧠", desc: "LLM 配置" },
  { id: "memory", name: "记忆", icon: "💭", desc: "记忆策略" },
  { id: "skills", name: "技能", icon: "🎯", desc: "技能系统" },
  { id: "scheduler", name: "调度", icon: "⏱️", desc: "调度参数" },
  { id: "timeouts", name: "超时", icon: "⏳", desc: "超时配置" },
  { id: "governance", name: "治理", icon: "⚖️", desc: "治理规则" },
  { id: "env", name: "环境", icon: "🌐", desc: "环境变量" },
  { id: "file-paths", name: "路径", icon: "📁", desc: "文件路径" },
  { id: "agent-quota", name: "配额", icon: "📊", desc: "Agent 配额" },
  { id: "version", name: "版本", icon: "🏷️", desc: "版本信息" },
];

/** 各域配置项（静态——完整清单） */
const SETTINGS_ITEMS: Record<string, Array<{ label: string; key: string; value: string }>> = {
  llm: [
    { label: "默认模型", key: "llm.defaultModel", value: "DeepSeek-V4" },
    { label: "备用模型", key: "llm.fallbackModel", value: "Qwen-Max" },
    { label: "推理档位", key: "llm.reasoning", value: "Auto" },
    { label: "最大 Token", key: "llm.maxTokens", value: "8192" },
    { label: "温度", key: "llm.temperature", value: "0.7" },
    { label: "Top-P", key: "llm.topP", value: "0.95" },
    { label: "流式输出", key: "llm.streaming", value: "开启" },
    { label: "超时", key: "llm.timeoutMs", value: "60000" },
    { label: "重试次数", key: "llm.maxRetries", value: "3" },
    { label: "供应商", key: "llm.provider", value: "DeepSeek" },
  ],
  memory: [
    { label: "记忆分层", key: "memory.tiers", value: "L0/L1/L2" },
    { label: "检索条数", key: "memory.topK", value: "8" },
    { label: "召回阈值", key: "memory.similarityThreshold", value: "0.72" },
    { label: "持久化", key: "memory.persist", value: "开启" },
    { label: "自动沉淀", key: "memory.autoConsolidate", value: "开启" },
    { label: "冲突检测", key: "memory.conflictDetection", value: "开启" },
    { label: "过期天数", key: "memory.ttlDays", value: "180" },
    { label: "检索方式", key: "memory.retrieval", value: "BFS+权重" },
    { label: "Worldbook", key: "memory.worldbook", value: "开启" },
  ],
  skills: [
    { label: "技能注册", key: "skills.registry", value: "内置 + 自定义" },
    { label: "技能上限", key: "skills.maxCount", value: "64" },
    { label: "Slash 命令", key: "skills.slashCommands", value: "开启" },
    { label: "技能校验", key: "skills.validateOnLoad", value: "开启" },
    { label: "技能缓存", key: "skills.cache", value: "开启" },
    { label: "失败降级", key: "skills.degradeOnError", value: "开启" },
    { label: "参考资料", key: "skills.references", value: "可注入" },
    { label: "技能目录", key: "skills.dir", value: ".qoder/skills" },
  ],
  scheduler: [
    { label: "轮询间隔", key: "scheduler.intervalMs", value: "1000" },
    { label: "并发上限", key: "scheduler.concurrency", value: "4" },
    { label: "队列上限", key: "scheduler.queueLimit", value: "64" },
    { label: "任务超时", key: "scheduler.taskTimeoutMs", value: "300000" },
    { label: "优先级", key: "scheduler.priority", value: "P0-P3" },
    { label: "重试策略", key: "scheduler.retry", value: "指数退避" },
    { label: "定时任务", key: "scheduler.cron", value: "开启" },
    { label: "调度窗口", key: "scheduler.windowMs", value: "60000" },
  ],
  timeouts: [
    { label: "请求超时", key: "timeouts.requestMs", value: "60000" },
    { label: "会话空闲", key: "timeouts.idleMs", value: "300000" },
    { label: "工具超时", key: "timeouts.toolMs", value: "120000" },
    { label: "编译超时", key: "timeouts.buildMs", value: "600000" },
    { label: "确认门超时", key: "timeouts.confirmMs", value: "30000" },
    { label: "连接超时", key: "timeouts.connectMs", value: "10000" },
    { label: "流式空闲", key: "timeouts.streamIdleMs", value: "15000" },
  ],
  governance: [
    { label: "宪法版本", key: "governance.constitution", value: "v2.5" },
    { label: "门禁等级", key: "governance.gateLevel", value: "五层" },
    { label: "确认门", key: "governance.confirmGate", value: "开启" },
    { label: "修订流程", key: "governance.amendment", value: "委员会" },
    { label: "事件路由", key: "governance.eventRouting", value: "声明式" },
    { label: "审计日志", key: "governance.audit", value: "开启" },
    { label: "共识机制", key: "governance.consensus", value: "圆桌" },
    { label: "决策记录", key: "governance.decisionLog", value: "ADR" },
  ],
  env: [
    { label: "运行环境", key: "env.nodeEnv", value: "production" },
    { label: "日志级别", key: "env.logLevel", value: "info" },
    { label: "数据目录", key: "env.dataDir", value: ".cortex" },
    { label: "daemon 端口", key: "env.daemonPort", value: "3210" },
    { label: "TTS 服务", key: "env.gptsovitsUrl", value: "9880" },
    { label: "LLM API", key: "env.llmBaseUrl", value: "配置中" },
    { label: "遥测上报", key: "env.telemetry", value: "开启" },
    { label: "调试模式", key: "env.debug", value: "关闭" },
  ],
  "file-paths": [
    { label: "工作区", key: "paths.workspace", value: "D:/cortex" },
    { label: "数据目录", key: "paths.data", value: ".cortex" },
    { label: "日志目录", key: "paths.logs", value: ".cortex/logs" },
    { label: "配置目录", key: "paths.config", value: ".cortex/config" },
    { label: "临时目录", key: "paths.tmp", value: ".tmp" },
    { label: "记忆库", key: "paths.memoryDb", value: ".cortex/memory.db" },
    { label: "技能目录", key: "paths.skills", value: ".qoder/skills" },
    { label: "画布目录", key: "paths.canvases", value: "~/.qoder/projects" },
  ],
  "agent-quota": [
    { label: "Agent 上限", key: "quota.agents", value: "8" },
    { label: "并行会话", key: "quota.sessions", value: "3" },
    { label: "每会话消息", key: "quota.messagesPerSession", value: "200" },
    { label: "工具调用上限", key: "quota.toolCalls", value: "50" },
    { label: "token 日配额", key: "quota.dailyTokens", value: "1M" },
    { label: "子任务上限", key: "quota.subTasks", value: "8" },
    { label: "重试上限", key: "quota.retries", value: "3" },
    { label: "内存上限", key: "quota.memoryMb", value: "512" },
  ],
  version: [
    { label: "Cortex", key: "version.cortex", value: "2.5.28" },
    { label: "桌面端", key: "version.desktop", value: "0.1.0" },
    { label: "引擎", key: "version.engine", value: "Core-2" },
    { label: "宪法", key: "version.constitution", value: "v2.5" },
    { label: "Node.js", key: "version.node", value: "24 LTS" },
    { label: "Electron", key: "version.electron", value: "43" },
    { label: "构建时间", key: "version.buildAt", value: "2026-08-09" },
    { label: "Git", key: "version.gitHead", value: "21863f02" },
  ],
};

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
  const [active, setActive] = useState<Contact | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  // 模式状态（Chat/Work/Code/Learn/Daily——UI 先装，功能后接）
  const [mode, setMode] = useState("Chat");
  const [modeOpen, setModeOpen] = useState(false);
  const MODES = ["Chat", "Work", "Code", "Learn", "Daily"];
  // 设置面板：当前域
  const [settingsDomain, setSettingsDomain] = useState("llm");
  // 好友 = Cortex agents（动态拉取）；群聊 = 预设
  const [friends, setFriends] = useState<Contact[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await window.cortexDesktop.getAgents() as { ok: boolean; data?: string[] };
        if (res?.ok && Array.isArray(res.data) && res.data.length > 0) {
          setFriends(res.data.map((name, i) => ({
            id: "agent-" + name,
            name,
            type: "friend" as const,
            avatar: name.slice(0, 1).toUpperCase(),
            desc: "Cortex Agent",
            online: true,
          })));
          setActive((prev) => prev ?? { id: "agent-" + res.data[0], name: res.data[0], type: "friend", avatar: res.data[0].slice(0, 1).toUpperCase(), desc: "Cortex Agent", online: true });
        }
      } catch { /* daemon 未起时保持空 */ }
    })();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleNewSession = useCallback(() => {
    if (messages.length === 0) { setToast("已经是新会话"); return; }
    if (window.confirm("创建新会话？当前会话记录将保留在本地历史。")) {
      setMessages([]);
      setToast("已创建新会话 ✨");
    }
  }, [messages]);

  // 重启桌面：自动编译并重启
  const handleRestart = useCallback(() => {
    setToast("正在编译并重启桌面…");
    void window.cortexDesktop.restartDesktop()
      .then((res) => { if (!res?.ok) setToast(res?.error ?? "重启失败"); })
      .catch(() => setToast("重启失败"));
  }, []);

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
    ? friends
    : PRESET_GROUPS.filter((c) => c.type === "group");

  return (
    <div className="chat">
      {/* ① 任务栏 */}
      <aside className="chat__taskbar" aria-label="任务栏">
        <button type="button" className={`chat__taskbar-btn${tab === "chat" ? " is-active" : ""}`} onClick={() => setTab("chat")} title="聊天" aria-label="聊天"><IconChat /></button>
        <button type="button" className={`chat__taskbar-btn${railTab === "friends" || railTab === "groups" ? " is-active" : ""}`} onClick={() => setRailTab(railTab === "friends" ? "groups" : "friends")} title="好友与群聊" aria-label="好友与群聊"><IconUsers /></button>
        <button type="button" className={`chat__taskbar-btn${tab === "tasks" ? " is-active" : ""}`} onClick={() => setTab("tasks")} title="任务" aria-label="任务"><IconTasks /></button>
        <button type="button" className={`chat__taskbar-btn${tab === "settings" ? " is-active" : ""}`} onClick={() => setTab("settings")} title="设置" aria-label="设置"><IconSettings /></button>
        <div className="chat__taskbar-spacer" />
        <button type="button" className="chat__taskbar-btn" onClick={onClose} title="关闭" aria-label="关闭"><IconClose /></button>
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
              {/* agent 站位：仅聊天界面显示 */}
              {tab === "chat" && (
                <>
                  <span className="chat__name">{active?.name ?? "昔涟"}</span>
                  <span className="chat__name-sep" aria-hidden="true">·</span>
                  <span className={`chat__hint${busy ? " chat__hint--busy" : ""}`}>{busy ? "思考中…" : (active?.online ? "在线" : "离线")}</span>
                  {/* 模式状态 */}
                  <span className="chat__mode-wrap">
                    <button type="button" className={`chat__mode-btn${modeOpen ? " is-open" : ""}`} onClick={() => setModeOpen((v) => !v)} title="切换模式">
                      {mode} <span className="chat__mode-caret">▾</span>
                    </button>
                    {modeOpen && (
                      <div className="chat__mode-menu">
                        {MODES.map((m) => (
                          <button key={m} type="button" className={`chat__mode-opt${m === mode ? " is-active" : ""}`} onClick={() => { setMode(m); setModeOpen(false); }}>
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                </>
              )}
              {/* 非聊天界面：显示面板名 */}
              {tab === "tasks" && <span className="chat__name">任务面板</span>}
              {tab === "settings" && <span className="chat__name">设置</span>}
            </span>
          </div>
          <div className="chat__titlebar-actions">
            {/* 重启按钮（自动编译并重启桌面） */}
            {tab === "chat" && (
              <button type="button" className="chat__winbtn" onClick={handleRestart} aria-label="重启桌面" title="重启桌面（自动编译）">↻</button>
            )}
            <button type="button" className={`chat__winbtn${sideOpen ? " is-active" : ""}`} onClick={() => setSideOpen((v) => !v)} aria-label="联系人信息" title="联系人信息"><IconInfo size={16} /></button>
            <button type="button" className="chat__winbtn chat__winbtn--close" onClick={onClose} aria-label="关闭" title="关闭">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        {/* 任务面板（静态——布局理顺） */}
        {tab === "tasks" && (
          <div className="chat__panel chat__panel--tasks">
            <div className="chat__panel-head">
              <span className="chat__panel-title">任务</span>
              <button type="button" className="chat__session-btn" onClick={() => setToast("新建任务——待实现")}>✚ 新建</button>
            </div>
            <div className="chat__task-list">
              <TaskItem icon="🔍" title="调研接口全景" desc="HTTP/IPC/WS 盘点" status="done" tag="analysis" />
              <TaskItem icon="🛠️" title="修复 daemon 僵死" desc="进程清理 + 重启" status="done" tag="fix" />
              <TaskItem icon="🎨" title="布局静态化" desc="任务/设置面板铺开" status="doing" tag="ui" />
              <TaskItem icon="⚙️" title="Agent 配置接入" desc="思考模式/上下文/档位" status="todo" tag="core" />
            </div>
          </div>
        )}
        {/* 设置面板（域列表 + 配置项双栏） */}
        {tab === "settings" && (
          <div className="chat__panel chat__panel--settings">
            <div className="chat__settings-layout">
              {/* 左：域列表 */}
              <aside className="chat__settings-domains">
                {SETTINGS_DOMAINS.map((d) => (
                  <button key={d.id} type="button" className={`chat__settings-domain${settingsDomain === d.id ? " is-active" : ""}`} onClick={() => setSettingsDomain(d.id)}>
                    <span aria-hidden="true">{d.icon}</span>
                    <span>{d.name}</span>
                  </button>
                ))}
              </aside>
              {/* 右：配置项 */}
              <div className="chat__settings-config">
                <div className="chat__panel-head">
                  <span className="chat__panel-title">{SETTINGS_DOMAINS.find((d) => d.id === settingsDomain)?.name ?? "设置"}</span>
                  <span className="chat__settings-domain-desc">{SETTINGS_DOMAINS.find((d) => d.id === settingsDomain)?.desc ?? ""}</span>
                </div>
                <div className="chat__settings-items">
                  {(SETTINGS_ITEMS[settingsDomain] ?? []).map((it) => (
                    <div key={it.key} className="chat__setting-item">
                      <span className="chat__setting-item-label">{it.label}</span>
                      <span className="chat__setting-item-key">{it.key}</span>
                      <span className="chat__setting-item-value">{it.value}</span>
                    </div>
                  ))}
                </div>
              </div>
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
                <div className="chat__input-row">
                  <textarea ref={inputRef} rows={1} value={input}
                    onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                    placeholder={`和 ${active?.name ?? "昔涟"} 说点什么…  Enter 发送 / Shift+Enter 换行`}
                    autoComplete="off" spellCheck={false} disabled={busy}
                  />
                  <button type="submit" className="chat__send" aria-label="发送" disabled={busy || !input.trim()}>
                    {busy ? "…" : "↵"}
                  </button>
                </div>
                {/* 会话管理 + Agent 配置（独立子菜单） */}
                <div className="chat__session-bar">
                  <button type="button" className="chat__session-btn" onClick={handleNewSession} title="创建新会话">✚ 创建会话</button>
                  <button type="button" className="chat__session-btn" onClick={() => setToast("合并会话——待实现")} title="合并会话">⧉ 合并会话</button>
                  <button type="button" className="chat__session-btn" onClick={() => setToast("压缩会话——待实现")} title="压缩会话">🗜 压缩会话</button>
                  <span className="chat__session-sep" />
                  <button type="button" className="chat__session-btn chat__session-btn--config" onClick={() => setConfigOpen(true)} title="Agent 配置">⚙ Agent 配置</button>
                </div>
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
      {/* Toast */}
      {toast && <div className="chat__toast">{toast}</div>}
      {/* Agent 配置弹窗（独立子菜单） */}
      {configOpen && (
        <div className="chat__modal-mask" onClick={() => setConfigOpen(false)}>
          <div className="chat__modal" onClick={(e) => e.stopPropagation()}>
            <div className="chat__modal-title">⚙ Agent 配置 · {active?.name ?? "昔涟"}</div>
            <div className="chat__modal-body">
              <div className="chat__cfg-row">
                <span className="chat__cfg-label">思考模式</span>
                <span className="chat__cfg-desc">是否开启深度思考</span>
                <span className="chat__cfg-toggle" aria-hidden="true"><span /></span>
              </div>
              <div className="chat__cfg-row">
                <span className="chat__cfg-label">上下文长度</span>
                <span className="chat__cfg-desc">单次会话携带的历史消息数</span>
                <span className="chat__cfg-value">32</span>
              </div>
              <div className="chat__cfg-row">
                <span className="chat__cfg-label">思考档位</span>
                <span className="chat__cfg-desc">推理强度（低/中/高）</span>
                <span className="chat__cfg-value">Auto</span>
              </div>
            </div>
            <div className="chat__modal-footer">
              <button type="button" className="chat__modal-btn" onClick={() => setConfigOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function resolveAsset(assetPath: string): string {
  const clean = assetPath.replace(/^\/+/, "");
  return new URL(clean, document.baseURI).href;
}

/** 任务项（静态） */
function TaskItem({ icon, title, desc, status, tag }: { icon: string; title: string; desc: string; status: "done" | "doing" | "todo"; tag: string }) {
  const statusMap = { done: "✓ 完成", doing: "● 进行中", todo: "○ 待办" } as const;
  return (
    <div className="chat__task-item">
      <span className="chat__task-icon" aria-hidden="true">{icon}</span>
      <span className="chat__task-meta">
        <span className="chat__task-title">{title}</span>
        <span className="chat__task-desc">{desc}</span>
      </span>
      <span className={`chat__task-tag chat__task-tag--${tag}`}>{tag}</span>
      <span className={`chat__task-status chat__task-status--${status}`}>{statusMap[status]}</span>
    </div>
  );
}

/** 设置卡片（静态） */
function SettingCard({ icon, title, items }: { icon: string; title: string; items: string[] }) {
  return (
    <div className="chat__setting-card">
      <div className="chat__setting-head"><span aria-hidden="true">{icon}</span><b>{title}</b></div>
      {items.map((it) => (
        <div key={it} className="chat__setting-row">{it}</div>
      ))}
    </div>
  );
}
