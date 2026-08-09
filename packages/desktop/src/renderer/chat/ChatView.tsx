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

/** 设置域列表 + 子组（左中右三栏：域 → 子组 → 配置项） */
const SETTINGS_DOMAINS = [
  { id: "llm", name: "模型", icon: "🧠", desc: "LLM 配置", groups: ["主模型", "推理", "输出"] },
  { id: "memory", name: "记忆", icon: "💭", desc: "记忆策略", groups: ["分层", "检索", "生命周期"] },
  { id: "skills", name: "技能", icon: "🎯", desc: "技能系统", groups: ["注册", "行为"] },
  { id: "scheduler", name: "调度", icon: "⏱️", desc: "调度参数", groups: ["执行", "限制"] },
  { id: "timeouts", name: "超时", icon: "⏳", desc: "超时配置", groups: ["请求", "会话"] },
  { id: "governance", name: "治理", icon: "⚖️", desc: "治理规则", groups: ["宪法", "流程", "记录"] },
  { id: "env", name: "环境", icon: "🌐", desc: "环境变量", groups: ["运行", "服务"] },
  { id: "file-paths", name: "路径", icon: "📁", desc: "文件路径", groups: ["项目", "数据"] },
  { id: "agent-quota", name: "配额", icon: "📊", desc: "Agent 配额", groups: ["数量", "资源"] },
  { id: "version", name: "版本", icon: "🏷️", desc: "版本信息", groups: ["产品", "运行环境"] },
];

/** 各子组配置项（静态——完整清单） */
const SETTINGS_ITEMS: Record<string, Record<string, Array<{ label: string; key: string; value: string }>>> = {
  llm: {
    "主模型": [
      { label: "默认模型", key: "llm.defaultModel", value: "DeepSeek-V4" },
      { label: "备用模型", key: "llm.fallbackModel", value: "Qwen-Max" },
      { label: "供应商", key: "llm.provider", value: "DeepSeek" },
    ],
    "推理": [
      { label: "推理档位", key: "llm.reasoning", value: "Auto" },
      { label: "温度", key: "llm.temperature", value: "0.7" },
      { label: "Top-P", key: "llm.topP", value: "0.95" },
    ],
    "输出": [
      { label: "最大 Token", key: "llm.maxTokens", value: "8192" },
      { label: "流式输出", key: "llm.streaming", value: "开启" },
      { label: "超时", key: "llm.timeoutMs", value: "60000" },
      { label: "重试次数", key: "llm.maxRetries", value: "3" },
    ],
  },
  memory: {
    "分层": [
      { label: "记忆分层", key: "memory.tiers", value: "L0/L1/L2" },
      { label: "自动沉淀", key: "memory.autoConsolidate", value: "开启" },
      { label: "Worldbook", key: "memory.worldbook", value: "开启" },
    ],
    "检索": [
      { label: "检索条数", key: "memory.topK", value: "8" },
      { label: "召回阈值", key: "memory.similarityThreshold", value: "0.72" },
      { label: "检索方式", key: "memory.retrieval", value: "BFS+权重" },
    ],
    "生命周期": [
      { label: "持久化", key: "memory.persist", value: "开启" },
      { label: "冲突检测", key: "memory.conflictDetection", value: "开启" },
      { label: "过期天数", key: "memory.ttlDays", value: "180" },
    ],
  },
  skills: {
    "注册": [
      { label: "技能注册", key: "skills.registry", value: "内置 + 自定义" },
      { label: "技能上限", key: "skills.maxCount", value: "64" },
      { label: "技能目录", key: "skills.dir", value: ".qoder/skills" },
    ],
    "行为": [
      { label: "Slash 命令", key: "skills.slashCommands", value: "开启" },
      { label: "技能校验", key: "skills.validateOnLoad", value: "开启" },
      { label: "技能缓存", key: "skills.cache", value: "开启" },
      { label: "失败降级", key: "skills.degradeOnError", value: "开启" },
      { label: "参考资料", key: "skills.references", value: "可注入" },
    ],
  },
  scheduler: {
    "执行": [
      { label: "轮询间隔", key: "scheduler.intervalMs", value: "1000" },
      { label: "任务超时", key: "scheduler.taskTimeoutMs", value: "300000" },
      { label: "重试策略", key: "scheduler.retry", value: "指数退避" },
      { label: "定时任务", key: "scheduler.cron", value: "开启" },
    ],
    "限制": [
      { label: "并发上限", key: "scheduler.concurrency", value: "4" },
      { label: "队列上限", key: "scheduler.queueLimit", value: "64" },
      { label: "优先级", key: "scheduler.priority", value: "P0-P3" },
      { label: "调度窗口", key: "scheduler.windowMs", value: "60000" },
    ],
  },
  timeouts: {
    "请求": [
      { label: "请求超时", key: "timeouts.requestMs", value: "60000" },
      { label: "工具超时", key: "timeouts.toolMs", value: "120000" },
      { label: "编译超时", key: "timeouts.buildMs", value: "600000" },
      { label: "连接超时", key: "timeouts.connectMs", value: "10000" },
    ],
    "会话": [
      { label: "会话空闲", key: "timeouts.idleMs", value: "300000" },
      { label: "确认门超时", key: "timeouts.confirmMs", value: "30000" },
      { label: "流式空闲", key: "timeouts.streamIdleMs", value: "15000" },
    ],
  },
  governance: {
    "宪法": [
      { label: "宪法版本", key: "governance.constitution", value: "v2.5" },
      { label: "门禁等级", key: "governance.gateLevel", value: "五层" },
      { label: "确认门", key: "governance.confirmGate", value: "开启" },
    ],
    "流程": [
      { label: "修订流程", key: "governance.amendment", value: "委员会" },
      { label: "事件路由", key: "governance.eventRouting", value: "声明式" },
      { label: "共识机制", key: "governance.consensus", value: "圆桌" },
    ],
    "记录": [
      { label: "审计日志", key: "governance.audit", value: "开启" },
      { label: "决策记录", key: "governance.decisionLog", value: "ADR" },
    ],
  },
  env: {
    "运行": [
      { label: "运行环境", key: "env.nodeEnv", value: "production" },
      { label: "日志级别", key: "env.logLevel", value: "info" },
      { label: "数据目录", key: "env.dataDir", value: ".cortex" },
      { label: "调试模式", key: "env.debug", value: "关闭" },
    ],
    "服务": [
      { label: "daemon 端口", key: "env.daemonPort", value: "3210" },
      { label: "TTS 服务", key: "env.gptsovitsUrl", value: "9880" },
      { label: "LLM API", key: "env.llmBaseUrl", value: "配置中" },
      { label: "遥测上报", key: "env.telemetry", value: "开启" },
    ],
  },
  "file-paths": {
    "项目": [
      { label: "工作区", key: "paths.workspace", value: "D:/cortex" },
      { label: "技能目录", key: "paths.skills", value: ".qoder/skills" },
      { label: "画布目录", key: "paths.canvases", value: "~/.qoder/projects" },
    ],
    "数据": [
      { label: "数据目录", key: "paths.data", value: ".cortex" },
      { label: "日志目录", key: "paths.logs", value: ".cortex/logs" },
      { label: "配置目录", key: "paths.config", value: ".cortex/config" },
      { label: "临时目录", key: "paths.tmp", value: ".tmp" },
      { label: "记忆库", key: "paths.memoryDb", value: ".cortex/memory.db" },
    ],
  },
  "agent-quota": {
    "数量": [
      { label: "Agent 上限", key: "quota.agents", value: "8" },
      { label: "并行会话", key: "quota.sessions", value: "3" },
      { label: "子任务上限", key: "quota.subTasks", value: "8" },
    ],
    "资源": [
      { label: "每会话消息", key: "quota.messagesPerSession", value: "200" },
      { label: "工具调用上限", key: "quota.toolCalls", value: "50" },
      { label: "token 日配额", key: "quota.dailyTokens", value: "1M" },
      { label: "重试上限", key: "quota.retries", value: "3" },
      { label: "内存上限", key: "quota.memoryMb", value: "512" },
    ],
  },
  version: {
    "产品": [
      { label: "Cortex", key: "version.cortex", value: "2.5.28" },
      { label: "桌面端", key: "version.desktop", value: "0.1.0" },
      { label: "引擎", key: "version.engine", value: "Core-2" },
      { label: "宪法", key: "version.constitution", value: "v2.5" },
    ],
    "运行环境": [
      { label: "Node.js", key: "version.node", value: "24 LTS" },
      { label: "Electron", key: "version.electron", value: "43" },
      { label: "构建时间", key: "version.buildAt", value: "2026-08-09" },
      { label: "Git", key: "version.gitHead", value: "21863f02" },
    ],
  },
};

/** 任务面板：分组 + 任务数据（静态） */
const TASK_FILTERS = [
  { id: "全部", name: "全部", icon: "📋" },
  { id: "doing", name: "进行中", icon: "⏳" },
  { id: "done", name: "已完成", icon: "✅" },
  { id: "failed", name: "失败", icon: "❌" },
];

const TASKS = [
  {
    id: 1, icon: "🔍", title: "调研接口全景", agent: "analysis", duration: "3min",
    status: "doing", statusCls: "doing", statusText: "● 进行中", source: "cmd",
    stepDone: 3, stepTotal: 5,
    steps: [
      { name: "盘点 HTTP 路由", state: "done" },
      { name: "盘点 IPC 通道", state: "done" },
      { name: "盘点 WS 事件", state: "doing" },
      { name: "统计包导出", state: "todo" },
      { name: "汇总报告", state: "todo" },
    ],
    events: ["10:32:01 开始", "10:32:04 读取 router.ts", "10:32:09 匹配 WS 事件", "10:32:15 统计导出符号"],
  },
  {
    id: 2, icon: "🛠️", title: "修复 daemon 僵死", agent: "fix", duration: "2min",
    status: "done", statusCls: "done", statusText: "✓ 完成", source: "cmd",
    stepDone: 4, stepTotal: 4,
    steps: [
      { name: "定位僵死进程", state: "done" },
      { name: "清理 PID", state: "done" },
      { name: "重启 daemon", state: "done" },
      { name: "验证 3210", state: "done" },
    ],
    events: ["09:15:02 开始", "09:15:10 定位 20920", "09:15:30 重启完成", "09:16:00 验证通过"],
  },
  {
    id: 3, icon: "🌤️", title: "查询天气", agent: "daily", duration: "8s",
    status: "done", statusCls: "done", statusText: "✓ 完成", source: "tool",
    stepDone: 2, stepTotal: 2,
    steps: [
      { name: "调用天气工具", state: "done" },
      { name: "返回结果", state: "done" },
    ],
    events: ["11:20:00 工具调用", "11:20:08 返回结果"],
  },
  {
    id: 4, icon: "⚙️", title: "Agent 配置接入", agent: "core", duration: "0s",
    status: "failed", statusCls: "failed", statusText: "✕ 失败", source: "cmd",
    stepDone: 1, stepTotal: 3,
    steps: [
      { name: "读取配置域", state: "done" },
      { name: "映射 UI 配置项", state: "failed" },
      { name: "写入生效", state: "todo" },
    ],
    events: ["11:02:00 开始", "11:02:05 读取配置域", "11:02:11 映射失败——key 不匹配"],
  },
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
  const [tab, setTab] = useState<"chat" | "tasks" | "settings" | "design" | "memory">("chat");
  const [railTab, setRailTab] = useState<"friends" | "groups">("friends");
  const [active, setActive] = useState<Contact | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  // 通知铃（设计历史唯一持久三项之一——四通道路由小红点）
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(3);
  // Agent 配置接真：思考模式/上下文/档位（settings:get 拉 + settings:set 写）
  const [thinkingOn, setThinkingOn] = useState(true);
  const [ctxLen, setCtxLen] = useState(32);
  const [reasoningLevel, setReasoningLevel] = useState("Auto");
  useEffect(() => {
    if (!configOpen) return;
    void (async () => {
      try {
        const res = await window.cortexDesktop.settings.get() as { ok: boolean; data?: Record<string, unknown> };
        if (res?.ok && res.data) {
          if (typeof res.data.thinking === "boolean") setThinkingOn(res.data.thinking);
          if (typeof res.data.contextLength === "number") setCtxLen(res.data.contextLength);
          if (typeof res.data.reasoning === "string") setReasoningLevel(res.data.reasoning);
        }
      } catch { /* 保持默认 */ }
    })();
  }, [configOpen]);
  // 模式状态（Chat/Work/Code/Learn/Daily——UI 先装，功能后接）
  const [mode, setMode] = useState("Chat");
  const [modeOpen, setModeOpen] = useState(false);
  const MODES = ["Chat", "Work", "Code", "Learn", "Daily"];
  // Agent 类型 → 默认模式映射（选中好友时联动）
  const AGENT_MODE_MAP: Record<string, string> = {
    cyrene: "Chat", fix: "Code", review: "Code", analysis: "Work",
    code: "Code", scheduler: "Daily", inspector: "Learn", strategist: "Work",
  };
  // 选中联系人：agent 类型 → 默认模式
  const selectContact = useCallback((c: Contact) => {
    setActive(c);
    if (c.type === "friend") {
      const agentName = c.name.toLowerCase();
      const m = AGENT_MODE_MAP[agentName] ?? AGENT_MODE_MAP[agentName.split("-")[0] ?? ""] ?? "Chat";
      setMode(m);
    }
  }, []);
  // 设置面板：当前域 + 子组
  const [settingsDomain, setSettingsDomain] = useState("llm");
  const [settingsGroup, setSettingsGroup] = useState("主模型");
  // 设置接真：settings:get 拉真值（覆盖静态默认）
  const [settingsData, setSettingsData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await window.cortexDesktop.settings.get() as { ok: boolean; data?: Record<string, unknown> };
        if (res?.ok && res.data && Object.keys(res.data).length > 0) setSettingsData(res.data);
      } catch { /* 保持静态默认 */ }
    })();
  }, []);
  // 任务面板：筛选 + 选中
  const [taskFilter, setTaskFilter] = useState("全部");
  const [taskSelected, setTaskSelected] = useState(0);
  // 任务接真：打开任务面板时拉真实节点（GET /api/v1/nodes——无节点时静态）
  const [realTasks, setRealTasks] = useState<Array<{ id: string; title: string; status: string; agent: string }> | null>(null);
  useEffect(() => {
    if (tab !== "tasks") return;
    void (async () => {
      try {
        const res = await fetch("http://127.0.0.1:3210/api/v1/nodes?limit=50");
        const j = await res.json() as { data?: Array<{ id: string; task?: string; status?: string; claimedBy?: string[] }> };
        const nodes = j.data ?? [];
        if (nodes.length > 0) {
          setRealTasks(nodes.map((n) => ({
            id: n.id,
            title: n.task ?? n.id.slice(0, 12),
            status: n.status ?? "pending",
            agent: n.claimedBy?.[0] ?? "—",
          })));
        }
      } catch { /* 无 daemon——静态 */ }
    })();
  }, [tab]);
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

  const handleNewSession = useCallback(async () => {
    if (messages.length === 0) { setToast("已经是新会话"); return; }
    try {
      // 接真：POST /api/v1/sessions（daemon）——创建真实会话
      const res = await fetch("http://127.0.0.1:3210/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `会话 ${new Date().toLocaleTimeString()}`, agent: active?.id ?? "cyrene" }),
      });
      if (res.ok) {
        setMessages([]);
        setToast("已创建新会话 ✨");
      } else {
        // 兜底：本地清空
        if (window.confirm("创建新会话？当前会话记录将保留在本地历史。")) {
          setMessages([]);
          setToast("已创建新会话 ✨（本地）");
        }
      }
    } catch {
      if (window.confirm("创建新会话？当前会话记录将保留在本地历史。")) {
        setMessages([]);
        setToast("已创建新会话 ✨（本地）");
      }
    }
  }, [messages, active]);

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
    // 桌宠联动：发送时表情（无表情名兜底）
    try { void window.cortexDesktop.expression("talk"); } catch { /* 桌宠未就绪 */ }
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
        <button type="button" className={`chat__taskbar-btn${tab === "memory" ? " is-active" : ""}`} onClick={() => setTab("memory")} title="记忆" aria-label="记忆">💭</button>
        <button type="button" className={`chat__taskbar-btn${tab === "settings" ? " is-active" : ""}`} onClick={() => setTab("settings")} title="设置" aria-label="设置"><IconSettings /></button>
        <button type="button" className={`chat__taskbar-btn${tab === "design" ? " is-active" : ""}`} onClick={() => setTab("design")} title="设计预览" aria-label="设计预览">🎨</button>
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
              <button key={c.id} type="button" className={`chat__rail-item${active?.id === c.id ? " is-active" : ""}`} onClick={() => selectContact(c)}>
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
            {/* 通知铃（未读小红点——点击展开通知面板） */}
            <button type="button" className={`chat__winbtn${notifOpen ? " is-active" : ""}`} onClick={() => { setNotifOpen((v) => !v); if (!notifOpen) setNotifCount(0); }} aria-label="通知" title="通知">🔔{notifCount > 0 && <span className="chat__notif-badge">{notifCount}</span>}</button>
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

        {/* 记忆面板（接真：GET /api/v1/memory） */}
        {tab === "memory" && <MemoryPanel />}

        {/* 设计预览（全状态静态展示） */}
        {tab === "design" && <DesignPreview />}

        {/* 任务面板（三栏：分组 → 列表 → 详情——渐进式披露） */}
        {tab === "tasks" && (
          <div className="chat__panel chat__panel--tasks">
            <div className="chat__tasks-layout">
              {/* 左：分组（简） */}
              <aside className="chat__tasks-filters">
                {TASK_FILTERS.map((f) => (
                  <button key={f.id} type="button" className={`chat__tasks-filter${taskFilter === f.id ? " is-active" : ""}`} onClick={() => setTaskFilter(f.id)}>
                    <span aria-hidden="true">{f.icon}</span>
                    <span>{f.name}</span>
                  </button>
                ))}
              </aside>
              {/* 中：任务列表（中）——真实节点优先 */}
              <aside className="chat__tasks-list">
                {(realTasks ?? []).map((t, i) => (
                  <button key={t.id} type="button" className={`chat__task-item${taskSelected === i ? " is-active" : ""}`} onClick={() => setTaskSelected(i)}>
                    <span className="chat__task-icon" aria-hidden="true">📌</span>
                    <span className="chat__task-meta">
                      <span className="chat__task-title">{t.title}</span>
                      <span className="chat__task-desc">{t.agent} · {t.id.slice(0, 8)}</span>
                    </span>
                    <span className={`chat__task-status chat__task-status--${t.status === "done" ? "done" : t.status === "failed" ? "failed" : "doing"}`}>{t.status}</span>
                  </button>
                ))}
                {realTasks === null && TASKS.filter((t) => taskFilter === "全部" || t.status === taskFilter).map((t, i) => (
                  <button key={t.id} type="button" className={`chat__task-item${taskSelected === i ? " is-active" : ""}`} onClick={() => setTaskSelected(i)}>
                    <span className="chat__task-icon" aria-hidden="true">{t.icon}</span>
                    <span className="chat__task-meta">
                      <span className="chat__task-title">{t.title} <span className={`chat__task-source chat__task-source--${t.source}`}>{t.source === "cmd" ? "命令" : "工具"}</span></span>
                      <span className="chat__task-desc">{t.agent} · {t.duration}</span>
                    </span>
                    <span className={`chat__task-status chat__task-status--${t.statusCls}`}>{t.statusText}</span>
                  </button>
                ))}
                {realTasks !== null && realTasks.length === 0 && (
                  <div style={{ fontSize: 12, color: "#c9a3b8", padding: "12px", textAlign: "center" }}>暂无任务节点</div>
                )}
              </aside>
              {/* 右：任务详情（复——渐进披露） */}
              <div className="chat__tasks-detail">
                {(() => {
                  const t = TASKS[taskSelected];
                  return (
                    <>
                      <div className="chat__panel-head">
                        <span className="chat__panel-title">{t.icon} {t.title}</span>
                        <span className={`chat__task-status chat__task-status--${t.statusCls}`}>{t.statusText}</span>
                      </div>
                      <div className="chat__tasks-detail-meta">
                        <span>Agent：{t.agent}</span>
                        <span>耗时：{t.duration}</span>
                        <span>进度：{t.stepDone}/{t.stepTotal} 步</span>
                      </div>
                      {/* 步骤流 */}
                      <div className="chat__tasks-steps">
                        {t.steps.map((st) => (
                          <div key={st.name} className={`chat__task-step chat__task-step--${st.state}"`}>
                            <span className="chat__task-step-mark">{st.state === "done" ? "✓" : st.state === "doing" ? "●" : "○"}</span>
                            <span className="chat__task-step-name">{st.name}</span>
                          </div>
                        ))}
                      </div>
                      {/* 事件流 */}
                      <div className="chat__tasks-events">
                        {t.events.map((ev) => (
                          <div key={ev} className="chat__task-event">{ev}</div>
                        ))}
                      </div>
                      <div className="chat__tasks-actions">
                        <button type="button" className="chat__session-btn" onClick={() => setToast("取消任务——待实现")}>⏹ 取消</button>
                        <button type="button" className="chat__session-btn" onClick={() => setToast("重试任务——待实现")}>↻ 重试</button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
        {/* 设置面板（左中右三栏：域 → 子组 → 配置项） */}
        {tab === "settings" && (
          <div className="chat__panel chat__panel--settings">
            <div className="chat__settings-layout">
              {/* 左：域列表（简） */}
              <aside className="chat__settings-domains">
                {SETTINGS_DOMAINS.map((d) => (
                  <button key={d.id} type="button" className={`chat__settings-domain${settingsDomain === d.id ? " is-active" : ""}`} onClick={() => { setSettingsDomain(d.id); setSettingsGroup(d.groups[0]); }}>
                    <span aria-hidden="true">{d.icon}</span>
                    <span>{d.name}</span>
                  </button>
                ))}
              </aside>
              {/* 中：子组列表（中） */}
              <aside className="chat__settings-groups">
                {(SETTINGS_DOMAINS.find((d) => d.id === settingsDomain)?.groups ?? []).map((g) => (
                  <button key={g} type="button" className={`chat__settings-group${settingsGroup === g ? " is-active" : ""}`} onClick={() => setSettingsGroup(g)}>
                    {g}
                  </button>
                ))}
              </aside>
              {/* 右：配置项（复） */}
              <div className="chat__settings-config">
                <div className="chat__panel-head">
                  <span className="chat__panel-title">{settingsGroup}</span>
                  <span className="chat__settings-domain-desc">{SETTINGS_DOMAINS.find((d) => d.id === settingsDomain)?.desc ?? ""}</span>
                </div>
                <div className="chat__settings-items">
                  {(SETTINGS_ITEMS[settingsDomain]?.[settingsGroup] ?? []).map((it) => {
                    // 真值优先：settingsData 里有对应 key 时覆盖静态值
                    const real = settingsData?.[it.key] ?? settingsData?.[it.key.split(".")[0]];
                    const display = real !== undefined && real !== null ? String(real) : it.value;
                    return (
                      <div key={it.key} className="chat__setting-item">
                        <span className="chat__setting-item-label">{it.label}</span>
                        <span className="chat__setting-item-key">{it.key}</span>
                        <span className="chat__setting-item-value">{display}</span>
                      </div>
                    );
                  })}
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
      {/* 通知面板（持久锚点——四通道） */}
      {notifOpen && (
        <div className="chat__notif-panel">
          <div className="chat__notif-item chat__notif-item--unread"><span>💬</span><span>聊天：新消息</span><span className="chat__notif-time">10:32</span></div>
          <div className="chat__notif-item chat__notif-item--unread"><span>📋</span><span>任务：布局静态化完成</span><span className="chat__notif-time">10:15</span></div>
          <div className="chat__notif-item"><span>📝</span><span>文档：审计报告更新</span><span className="chat__notif-time">09:48</span></div>
        </div>
      )}
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
                <span className={`chat__cfg-toggle${thinkingOn ? " is-on" : ""}`} onClick={() => { setThinkingOn((v) => !v); void window.cortexDesktop.settings.set({ thinking: !thinkingOn }); }} aria-hidden="true"><span /></span>
              </div>
              <div className="chat__cfg-row">
                <span className="chat__cfg-label">上下文长度</span>
                <span className="chat__cfg-desc">单次会话携带的历史消息数</span>
                <button type="button" className="chat__cfg-value chat__cfg-value--btn" onClick={() => { const n = ctxLen >= 64 ? 16 : ctxLen * 2; setCtxLen(n); void window.cortexDesktop.settings.set({ contextLength: n }); }}>{ctxLen}</button>
              </div>
              <div className="chat__cfg-row">
                <span className="chat__cfg-label">思考档位</span>
                <span className="chat__cfg-desc">推理强度（低/中/高）</span>
                <button type="button" className="chat__cfg-value chat__cfg-value--btn" onClick={() => { const next = reasoningLevel === "Auto" ? "Low" : reasoningLevel === "Low" ? "Medium" : reasoningLevel === "Medium" ? "High" : "Auto"; setReasoningLevel(next); void window.cortexDesktop.settings.set({ reasoning: next }); }}>{reasoningLevel}</button>
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

/* ── 记忆面板：接真（GET /api/v1/memory） ── */
interface MemItem { id: string; summary: string; kind: string; domain: string; semanticState: string; agentType: string; createdAt: number; weight: number; accessCount: number; }
function MemoryPanel() {
  const [items, setItems] = useState<MemItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = `http://127.0.0.1:3210/api/v1/memory?limit=50${q ? `&query=${encodeURIComponent(q)}` : ""}`;
      const j = await (await fetch(url)).json() as { data?: MemItem[] };
      setItems(j.data ?? []);
    } catch { setItems([]); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(""); }, [load]);
  const kindColor = (k: string) => ({
    episodic: "#f9a8c8", knowledge: "#c3b8f5", conceptual: "#7ed6b8",
  } as Record<string, string>)[k] ?? "#c9a3b8";
  return (
    <div className="chat__panel chat__panel--memory">
      <div className="chat__panel-head">
        <span className="chat__panel-title">💭 记忆</span>
        <span className="chat__settings-domain-desc">{items ? `${items.length} 条` : "加载中…"}</span>
      </div>
      <div className="chat__memory-search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(query); }} placeholder="搜索记忆… Enter 查询" style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(236,72,153,0.18)", background: "rgba(255,255,255,0.8)", color: "#5c4a5c", fontSize: 13 }} />
        <button type="button" className="chat__session-btn chat__session-btn--config" onClick={() => void load(query)}>查询</button>
      </div>
      <div className="chat__memory-list">
        {loading && <div style={{ fontSize: 12, color: "#c9a3b8", padding: 12 }}>加载中…</div>}
        {!loading && items?.length === 0 && <div style={{ fontSize: 12, color: "#c9a3b8", padding: 12 }}>暂无记忆</div>}
        {!loading && (items ?? []).map((m) => (
          <div key={m.id} className="chat__memory-item">
            <span className="chat__memory-dot" style={{ background: kindColor(m.kind) }} aria-hidden="true" />
            <span className="chat__memory-meta">
              <span className="chat__memory-summary">{m.summary}</span>
              <span className="chat__memory-sub">{m.kind} · {m.domain} · {m.agentType} · w{m.weight}</span>
            </span>
            <span className="chat__memory-state">{m.semanticState}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 设计预览：全状态静态展示 ── */

const MSG_STATES = [
  { state: "queued", text: "排队中——等待发送", badge: null },
  { state: "sending", text: "发送中——正在请求", badge: null },
  { state: "streaming", text: "流式——逐字输出中…", badge: null },
  { state: "complete", text: "完成——回复正常落地", badge: null },
  { state: "stopped", text: "停止——用户中断生成", badge: "已停止" },
  { state: "interrupted", text: "中断——连接断开", badge: "连接中断" },
  { state: "error_timeout", text: "超时——请求超时", badge: "超时" },
  { state: "error_fatal", text: "出错——致命错误", badge: "出错了" },
  { state: "regenerating", text: "重新生成——♻️ 触发", badge: null },
  { state: "retry", text: "重试——🔄 恢复发送", badge: null },
];

const TASK_STATES = [
  { cls: "todo", text: "排队", icon: "○" },
  { cls: "doing", text: "执行中", icon: "●" },
  { cls: "done", text: "完成", icon: "✓" },
  { cls: "failed", text: "失败", icon: "✕" },
  { cls: "cancelled", text: "取消", icon: "—" },
  { cls: "timeout", text: "超时", icon: "⏳" },
];

const CONTACT_STATES = [
  { cls: "online", text: "在线", color: "#7ed6b8" },
  { cls: "offline", text: "离线", color: "#c9c2d6" },
  { cls: "busy", text: "忙碌", color: "#f0a35e" },
  { cls: "thinking", text: "思考中", color: "#f9a8c8" },
];

const PANEL_STATES = [
  { icon: "📭", text: "空状态——暂无数据", cls: "empty" },
  { icon: "⏳", text: "加载中——请求中…", cls: "loading" },
  { icon: "📊", text: "有数据——正常展示", cls: "data" },
  { icon: "⚠️", text: "错误——加载失败", cls: "error" },
];

const INPUT_STATES = [
  { text: "空闲——可输入", cls: "idle" },
  { text: "输入中——有内容", cls: "typing" },
  { text: "发送中——busy", cls: "busy" },
  { text: "禁用——不可用", cls: "disabled" },
];

function DesignPreview() {
  return (
    <div className="chat__panel chat__panel--design">
      <div className="chat__panel-head"><span className="chat__panel-title">🎨 设计预览 · 全状态展示</span></div>

      {/* ① 消息十态 */}
      <PreviewSection title="① 消息状态（状态机十态）">
        {MSG_STATES.map((m) => (
          <div key={m.state} className="msg msg--model">
            <div className="msg__avatar"><img className="msg__avatar-img" src={resolveAsset("../avatars/cyrene-avatar.png")} alt="昔涟" /></div>
            <div className="msg__body">
              <div className={`msg__bubble msg__bubble--${m.state}`}>
                {m.text}
                {m.badge && <span className="msg__state-badge">{m.badge}</span>}
              </div>
              <span className="msg__time">{m.state} · 00:00</span>
            </div>
          </div>
        ))}
      </PreviewSection>

      {/* ② 任务六态 */}
      <PreviewSection title="② 任务状态（六态）">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {TASK_STATES.map((t) => (
            <span key={t.text} className={`chat__task-status chat__task-status--${t.cls}`} style={{ fontSize: 13, minWidth: "auto" }}>{t.icon} {t.text}</span>
          ))}
        </div>
      </PreviewSection>

      {/* ③ 好友四态 */}
      <PreviewSection title="③ 好友/Agent 状态（四态）">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {CONTACT_STATES.map((c) => (
            <span key={c.text} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b4a5e" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
              {c.text}
            </span>
          ))}
        </div>
      </PreviewSection>

      {/* ④ 模式五态 */}
      <PreviewSection title="④ 模式（五态）">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Chat", "Work", "Code", "Learn", "Daily"].map((m, i) => (
            <span key={m} className={`chat__mode-btn${i === 0 ? " is-active" : ""}`} style={{ cursor: "default", opacity: i === 0 ? 1 : 0.65 }}>{m} ▾</span>
          ))}
        </div>
      </PreviewSection>

      {/* ⑤ 面板四态 */}
      <PreviewSection title="⑤ 面板状态（四态）">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {PANEL_STATES.map((p) => (
            <div key={p.cls} style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(236,72,153,0.12)", borderRadius: 12, padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{p.icon}</div>
              <div style={{ fontSize: 12, color: "#a57895" }}>{p.text}</div>
            </div>
          ))}
        </div>
      </PreviewSection>

      {/* ⑥ 输入区四态 */}
      <PreviewSection title="⑥ 输入区状态（四态）">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {INPUT_STATES.map((s) => (
            <div key={s.cls} style={{ flex: 1, minWidth: 180, background: "rgba(255,255,255,0.75)", border: "1px solid rgba(236,72,153,0.15)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6b4a5e" }}>
              {s.text}
            </div>
          ))}
        </div>
      </PreviewSection>

      {/* ⑦ 会话操作 */}
      <PreviewSection title="⑦ 会话操作状态">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="chat__session-btn">✚ 创建会话</span>
          <span className="chat__session-btn">⧉ 合并会话（待实现）</span>
          <span className="chat__session-btn">🗜 压缩会话（待实现）</span>
          <span className="chat__session-btn chat__session-btn--config">⚙ Agent 配置</span>
        </div>
      </PreviewSection>

      {/* ⑧ 布局变体 */}
      <PreviewSection title="⑧ 窗口布局变体（宽/中/窄）">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          {[
            { w: 220, label: "宽 ≥1000px" },
            { w: 160, label: "中 820-1000px" },
            { w: 90, label: "窄 <820px" },
          ].map((v) => (
            <div key={v.label} style={{ textAlign: "center" }}>
              <div style={{ width: v.w, height: 60, background: "rgba(255,255,255,0.7)", border: "1px solid rgba(236,72,153,0.2)", borderRadius: 8, display: "flex" }}>
                <div style={{ width: 14, background: "rgba(236,72,153,0.15)", borderRadius: "8px 0 0 8px" }} />
                <div style={{ flex: 1 }} />
              </div>
              <div style={{ fontSize: 11, color: "#c9a3b8", marginTop: 4 }}>{v.label}</div>
            </div>
          ))}
        </div>
      </PreviewSection>

      {/* ⑨ 消息类型：todo-list 消息 */}
      <PreviewSection title="⑨ 消息类型 A · Todo-List 消息">
        <div className="msg msg--model">
          <div className="msg__avatar"><img className="msg__avatar-img" src={resolveAsset("../avatars/cyrene-avatar.png")} alt="昔涟" /></div>
          <div className="msg__body">
            <div className="msg__bubble msg__bubble--complete">
              <div style={{ marginBottom: 6 }}>布局落地计划：</div>
              <div className="chat__todo">
                <div className="chat__todo-item chat__todo-item--done"><span>✓</span><span>任务栏 + 侧边栏</span></div>
                <div className="chat__todo-item chat__todo-item--done"><span>✓</span><span>聊天界面 + 输入区</span></div>
                <div className="chat__todo-item chat__todo-item--doing"><span>●</span><span>设置面板三栏</span></div>
                <div className="chat__todo-item chat__todo-item--todo"><span>○</span><span>通知铃 + 瞬态层</span></div>
                <div className="chat__todo-item chat__todo-item--todo"><span>○</span><span>Monaco 编辑器层</span></div>
              </div>
            </div>
            <span className="msg__time">todo-list · 00:00</span>
          </div>
        </div>
      </PreviewSection>

      {/* ⑩ 消息类型：agent 操作/工具调用卡片 */}
      <PreviewSection title="⑩ 消息类型 B · Agent 操作 / 工具调用">
        <div className="msg msg--model">
          <div className="msg__avatar"><img className="msg__avatar-img" src={resolveAsset("../avatars/cyrene-avatar.png")} alt="昔涟" /></div>
          <div className="msg__body">
            <div className="msg__bubble msg__bubble--complete">
              <div style={{ marginBottom: 8 }}>开始执行——共 3 步：</div>
              <div className="chat__toolcall">
                <div className="chat__toolcall-item chat__toolcall-item--done">
                  <span className="chat__toolcall-icon">🔍</span>
                  <span className="chat__toolcall-name">搜索接口文档</span>
                  <span className="chat__toolcall-status">✓ 完成 · 1.2s</span>
                </div>
                <div className="chat__toolcall-item chat__toolcall-item--doing">
                  <span className="chat__toolcall-icon">📖</span>
                  <span className="chat__toolcall-name">读取 router.ts</span>
                  <span className="chat__toolcall-status">● 运行中…</span>
                </div>
                <div className="chat__toolcall-item chat__toolcall-item--todo">
                  <span className="chat__toolcall-icon">📝</span>
                  <span className="chat__toolcall-name">汇总报告</span>
                  <span className="chat__toolcall-status">○ 等待</span>
                </div>
              </div>
              <div className="chat__toolcall-item chat__toolcall-item--failed" style={{ marginTop: 8 }}>
                <span className="chat__toolcall-icon">⚠️</span>
                <span className="chat__toolcall-name">调用天气 API</span>
                <span className="chat__toolcall-status">✕ 失败 · 重试中</span>
              </div>
            </div>
            <span className="msg__time">tool-call · 00:00</span>
          </div>
        </div>
      </PreviewSection>
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#6b4a5e", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
