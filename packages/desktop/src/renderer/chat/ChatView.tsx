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
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import "./chat.css";
import { messageReducer, type MessageState } from "./message-state-machine";
import { IconChat, IconUsers, IconTasks, IconSettings, IconClose, IconInfo, IconRefresh, IconStop, IconCopy, IconVolumeLow, IconVolumeHigh } from "./icons";

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

/** meta/规划 agent 常把结构化 JSON 直接吐进气泡——提取人话部分渲染，type 作徽标；非 JSON 原样返回 */
function extractAgentPayload(content: string): { display: string; badge?: string } {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return { display: content };
  const jsonText = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!jsonText.startsWith("{")) return { display: content };
  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { display: content };
    const textFields = ["payload", "output", "summary", "result", "content", "message", "answer", "text"];
    for (const f of textFields) {
      const v = obj[f];
      if (typeof v === "string" && v.trim()) {
        const badge = typeof obj.type === "string" ? obj.type : undefined;
        return { display: v, badge };
      }
    }
    return { display: content };
  } catch {
    return { display: content };
  }
}

/** 配置域中文名（左列显示；未命中回退英文 name，tooltip 仍给原始域标识） */
const DOMAIN_LABELS: Record<string, string> = {
  engine: "引擎参数", enginePlugins: "引擎插件", tools: "工具集", eventRouting: "事件路由",
  roundtable: "圆桌会议", searchProviders: "搜索源", mcpServers: "MCP 服务", selfExamination: "自我检查",
  crossVerification: "交叉验证", seedMemories: "种子记忆", governancePipeline: "治理流程",
  architectureFlows: "架构流向", cognition: "认知", docs: "文档注册", models: "模型清单",
  keysContext: "密钥上下文", agentManifests: "Agent 清单", tuning: "调参",
};

/** 常见配置项 key 中文名（右列显示；未命中回退英文 key） */
const KEY_LABELS: Record<string, string> = {
  description: "说明", _description: "说明", inspectorMaxLoops: "巡检最大轮数",
  maxReplanPerNode: "单节点最大重规划", maxTotalReplans: "总重规划上限",
  executeAllTimeoutMs: "全量执行超时(ms)", reactLoopTimeoutMs: "ReAct 循环超时(ms)",
  toolTimeouts: "工具超时", inspector: "巡检器", plugins: "插件", tools: "工具",
  routeTable: "路由表", committeeRules: "委员会规则", mergeRules: "归并规则",
  templates: "模板", providers: "供应商", servers: "服务器", agents: "智能体",
  pairs: "验证配对", flows: "流程", principles: "原则", layers: "分层",
  knownUnassigned: "未归类模块", constitutionPath: "宪法路径", docRegistry: "文档注册表",
  keys: "密钥", contextLimits: "上下文限额", env: "环境", tuning: "调参",
  activationMatrix: "激活矩阵", attention: "注意力", templates_: "模板",
  enabled: "启用", stages: "阶段", ciGate: "CI 门禁", triggers: "触发器", _note: "备注",
  script: "脚本", timeoutMs: "超时(ms)", blockOnFailure: "失败即阻断",
  onAmendmentProposed: "提案时", onSchedule: "定时", onCommit: "提交时",
};

/** 已知枚举键 → 真实候选值（源自现有配置词表）。用作 datalist 建议，仍可自由填写（当前值≠全部合法值） */
const ENUM_OPTIONS: Record<string, string[]> = {
  profile: ["code-writer", "code-fixer", "read-only", "read-write-gov", "read-only-inspect"],
  channel: ["routine", "important", "urgent"],
  model: ["deepseek-flash", "deepseek-v4-pro"],
  chatModel: ["deepseek-flash", "deepseek-v4-pro"],
  reasonerModel: ["deepseek-flash", "deepseek-v4-pro"],
  fallbackModel: ["deepseek-flash", "deepseek-v4-pro"],
  key: ["DEEPSEEK_CHAT", "DEEPSEEK_REASONER", "DEEPSEEK_CYRENE", "DEEPSEEK_GANYU", "DEEPSEEK_API_KEY"],
  modelFallback: ["DEEPSEEK_CHAT", "DEEPSEEK_REASONER", "DEEPSEEK_API_KEY"],
  reasoningEffort: ["high", "max"],
  logLevel: ["debug", "info", "warn", "error"],
  nodeEnv: ["development", "production"],
};

/** 布尔叶：开关按钮，点击即翻 开/关 并立即写回（值以 "true"/"false" 串提交，daemon 按原布尔类型强转） */
function ToggleLeaf({
  v,
  path,
  onCommit,
}: {
  v: boolean;
  path: Array<string | number>;
  onCommit: (path: Array<string | number>, value: string) => Promise<boolean>;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const flip = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    await onCommit(path, !v ? "true" : "false");
    setBusy(false);
  };
  return (
    <button
      type="button"
      className={`chat__cfg-toggle${v ? " is-on" : ""}${busy ? " is-busy" : ""}`}
      disabled={busy}
      onClick={() => { void flip(); }}
      title="点击切换 开/关（写回引擎实读配置）"
    >
      <span className="chat__cfg-toggle-knob" />
      <span className="chat__cfg-toggle-txt">{v ? "开" : "关"}</span>
    </button>
  );
}

/** 可编辑标量叶（字符串/数字）：点击→输入框→Enter/失焦提交（走 config.set 写回），Esc 取消。
 *  命中 ENUM_OPTIONS 的键附 datalist 真实候选（仍可自由填，当前值≠全部合法值）。 */
function EditableLeaf({
  v,
  path,
  onCommit,
}: {
  v: string | number;
  path: Array<string | number>;
  onCommit: (path: Array<string | number>, value: string) => Promise<boolean>;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  const listId = "cdl" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const leafKey = typeof path[path.length - 1] === "string" ? String(path[path.length - 1]) : "";
  const opts = leafKey ? ENUM_OPTIONS[leafKey] : undefined;

  const start = (): void => {
    if (busy) return;
    setDraft(String(v));
    setEditing(true);
  };
  const commit = async (): Promise<void> => {
    setEditing(false);
    if (String(draft) === String(v)) return; // 未改动不写
    setBusy(true);
    await onCommit(path, draft);
    setBusy(false);
  };

  if (editing) {
    const input = (
      <input
        type="text"
        className={`chat__cfg-input${opts ? " chat__cfg-input--enum" : ""}`}
        list={opts ? listId : undefined}
        autoFocus
        value={draft}
        onChange={(e) => { setDraft(e.target.value); }}
        onBlur={() => {
          if (cancelled.current) { cancelled.current = false; return; }
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            setEditing(false);
          }
        }}
      />
    );
    return opts ? (
      <>
        {input}
        <datalist id={listId}>{opts.map((o) => (<option key={o} value={o} />))}</datalist>
      </>
    ) : input;
  }
  return (
    <span
      className={`chat__cfg-scalar chat__cfg-edit${opts ? " chat__cfg-enum" : ""}${busy ? " is-busy" : ""}`}
      onClick={start}
      title={opts ? `点击编辑（候选：${opts.join(" / ")}，可自由填）` : "点击编辑（写回引擎实读配置）"}
    >
      {String(v)}
    </span>
  );
}

/** 递归渲染配置值：原始值→可编辑；数组→逐条列出；对象→可展开子菜单（<details>） */
function CfgValue({
  v,
  path,
  onCommit,
}: {
  v: unknown;
  path: Array<string | number>;
  onCommit: (path: Array<string | number>, value: string) => Promise<boolean>;
}): React.ReactElement {
  if (v === null || v === undefined) return <span className="chat__cfg-scalar">—</span>;
  if (typeof v === "boolean") return <ToggleLeaf v={v} path={path} onCommit={onCommit} />;
  if (typeof v !== "object") return <EditableLeaf v={v as string | number} path={path} onCommit={onCommit} />;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="chat__cfg-scalar">（空）</span>;
    return (
      <div className="chat__cfg-array">
        {v.map((item, i) => (
          <div key={i} className="chat__cfg-array-item">
            <span className="chat__cfg-idx">{i}</span>
            <CfgValue v={item} path={[...path, i]} onCommit={onCommit} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(v as Record<string, unknown>);
  return (
    <details className="chat__cfg-obj">
      <summary className="chat__cfg-obj-summary">{entries.length} 项</summary>
      <div className="chat__cfg-obj-body">
        {entries.map(([k, val]) => {
          const t = val === null ? "null" : Array.isArray(val) ? "arr" : typeof val === "object" ? "obj" : typeof val === "number" ? "num" : typeof val === "boolean" ? "bool" : "str";
          return (
            <div key={k} className="chat__cfg-kv">
              <span className={`chat__cfg-type chat__cfg-type--${t}`}>{t}</span>
              <span className="chat__cfg-k">{KEY_LABELS[k] ?? k}</span>
              <CfgValue v={val} path={[...path, k]} onCommit={onCommit} />
            </div>
          );
        })}
      </div>
    </details>
  );
}


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
  const [threads, setThreads] = useState<Record<string, Message[]>>(() => {
    const ok = (arr: unknown): arr is Message[] =>
      Array.isArray(arr) && (arr as Message[]).every((m) => m && typeof m.id === "string" && (m.role === "user" || m.role === "assistant"));
    try {
      const raw = localStorage.getItem("cyrene-chat-threads");
      if (raw) {
        const map = JSON.parse(raw) as Record<string, unknown>;
        const out: Record<string, Message[]> = {};
        for (const [k, v] of Object.entries(map)) if (ok(v)) out[k] = v;
        return out;
      }
      // 迁移旧的单线程 key → 归到默认 "cyrene"
      const legacy = localStorage.getItem("cyrene-chat-history");
      if (legacy) {
        const arr = JSON.parse(legacy);
        if (ok(arr)) return { cyrene: arr };
      }
    } catch { /* 无历史 */ }
    return {};
  });
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "tasks" | "settings" | "design" | "memory" | "editor">("chat");
  const [railTab, setRailTab] = useState<"friends" | "groups">("friends");
  const [active, setActive] = useState<Contact | null>(null);
  // 会话按联系人隔离：messages 派生自当前 active 的线程，setMessages 写回该线程
  const activeKey = active?.id ?? "cyrene";
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  // 每线程稳定 sessionId：一个对话线程复用同一 daemon session（否则每消息新建刷屏）
  const sessionIdsRef = useRef<Map<string, string>>(new Map());
  const getOrCreateSessionId = useCallback((key: string): string => {
    let sid = sessionIdsRef.current.get(key);
    if (!sid) { sid = crypto.randomUUID(); sessionIdsRef.current.set(key, sid); }
    return sid;
  }, []);
  const messages = useMemo(() => threads[activeKey] ?? [], [threads, activeKey]);
  const setMessages = useCallback(
    (action: Message[] | ((prev: Message[]) => Message[])) => {
      setThreads((prev) => {
        const k = activeKeyRef.current;
        const cur = prev[k] ?? [];
        const next = typeof action === "function" ? (action as (p: Message[]) => Message[])(cur) : action;
        return { ...prev, [k]: next };
      });
    },
    [],
  );
  const [sideOpen, setSideOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  // 通知铃（设计历史唯一持久三项之一——四通道路由小红点）
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0); // 真事件到达才 +1（见 onNotification），不再硬编码假未读数
  // 通知接真：daemon WS 事件 → 未读 +1（pipeline/notification 频道）
  const [notifItems, setNotifItems] = useState<Array<{ icon: string; text: string; time: string }>>([]);
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = window.cortexDesktop.onNotification((e) => {
        const ch = e.channel;
        const d = (e.data ?? {}) as { type?: string; priority?: string; payload?: { task?: string } };
        const icon = ch === "notification" ? "🔔" : d.priority === "critical" ? "🚨" : d.priority === "high" ? "⚠️" : "📡";
        const text = d.payload?.task ? `${ch}: ${d.payload.task}` : d.type ? `${ch}: ${d.type}` : `${ch}: 新事件`;
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setNotifItems((prev) => [{ icon, text, time }, ...prev].slice(0, 8));
        setNotifCount((c) => c + 1);
      });
    } catch { /* 旧版 preload */ }
    return () => { try { off?.(); } catch { /* 已卸载 */ } };
  }, []);
  // 通知接真实系统健康：拉 health 降级告警（WS 事件之外的补充源）
  const loadNotifications = useCallback(async () => {
    try {
      const res = await window.cortexDesktop.health.get() as { ok: boolean; data?: { totalDegradations?: number; bySource?: Record<string, number>; byLevel?: Record<string, number>; recentSources?: string[]; degradedSince?: number | null } };
      const h = res?.ok ? res.data : undefined;
      if (!h || !h.totalDegradations) return;
      const time = new Date(h.degradedSince ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const critical = (h.byLevel?.critical ?? 0) > 0;
      const alerts = (h.recentSources ?? Object.keys(h.bySource ?? {})).slice(0, 8).map((src) => ({
        icon: critical ? "🚨" : "⚠️",
        text: `系统降级：${src}（${h.bySource?.[src] ?? 1}）`,
        time,
      }));
      setNotifItems((prev) => {
        const seen = new Set(prev.map((p) => p.text));
        return [...alerts.filter((a) => !seen.has(a.text)), ...prev].slice(0, 8);
      });
      setNotifCount((c) => Math.max(c, h.totalDegradations ?? 0));
    } catch { /* health 不可用 */ }
  }, []);
  useEffect(() => {
    if (!notifOpen) return;
    void loadNotifications();
    const t = setInterval(() => { void loadNotifications(); }, 30000);
    return () => clearInterval(t);
  }, [notifOpen, loadNotifications]);
  // D7b：确认门浮层——gate.request 订阅（L2/L3 工具调用需人工确认）
  const [gateRequests, setGateRequests] = useState<Array<{ requestId: string; toolName: string; level: string; summary: string; detail?: string }>>([]);
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = window.cortexDesktop.onGateRequest((e) => {
        const d = (e.data ?? {}) as { type?: string; requestId?: string; toolName?: string; level?: string; summary?: string; detail?: string };
        if (d.type !== "gate.request" || !d.requestId) return;
        setGateRequests((prev) => [...prev, { requestId: d.requestId!, toolName: d.toolName ?? "未知工具", level: d.level ?? "L2", summary: d.summary ?? "", detail: d.detail }].slice(-4));
      });
    } catch { /* 旧版 preload */ }
    return () => { try { off?.(); } catch { /* 已卸载 */ } };
  }, []);
  const resolveGate = (requestId: string, approved: boolean): void => {
    void window.cortexDesktop.resolveGate(requestId, approved);
    setGateRequests((prev) => prev.filter((g) => g.requestId !== requestId));
  };
  // A3 吸收：权限请求一句话化（Cyrene 设计——参数翻译为人话，审批零认知负担）
  const humanizeTool = (tool: string, input?: string): string => {
    const map: Record<string, string> = {
      read_file: "读取文件", write_file: "写入文件", edit_file: "编辑文件",
      run_shell: "执行命令", search_codebase: "搜索代码库", search_symbol: "查找符号",
      web_search: "联网搜索", web_fetch: "抓取网页", search_memory: "搜索记忆",
      update_memory: "更新记忆", get_problems: "检查代码问题", get_terminal_output: "读取终端输出",
    };
    const base = map[tool] ?? tool;
    return input ? `${base}：${input.slice(0, 40)}${input.length > 40 ? "…" : ""}` : base;
  };
  // A2 吸收：工具调用内联状态（🔧 调用中 → ✅ 完成 → ❌ 失败）
  const [toolLogs, setToolLogs] = useState<Array<{ id: string; toolName: string; state: "running" | "done" | "failed" }>>([]);
  // Agent 配置接真：思考模式/上下文/档位（settings:get 拉 + settings:set 写）
  // Agent 配置弹窗：从 config.get("agentManifests") 拉当前 agent 真实配置
  const [agentCfg, setAgentCfg] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!configOpen || !active) { setAgentCfg(null); return; }
    const agentId = active.id.replace(/^agent-/, "");
    void (async () => {
      try {
        const res = await window.cortexDesktop.config.get("agentManifests") as { ok: boolean; data?: { value?: { agents?: Record<string, Record<string, unknown>> } } };
        const agents = res?.ok ? res.data?.value?.agents : undefined;
        setAgentCfg(agents?.[agentId] ?? null);
      } catch { setAgentCfg(null); }
    })();
  }, [configOpen, active]);
  const commitAgentField = useCallback(async (field: string, value: unknown) => {
    const agentId = active?.id?.replace(/^agent-/, "") ?? "";
    if (!agentId) return;
    try {
      const res = await window.cortexDesktop.config.set("agentManifests", ["agents", agentId, field], String(value)) as { ok: boolean; error?: string };
      setToast(res?.ok ? `已保存 ${field}` : `保存失败：${res?.error ?? "未知"}`);
      if (res?.ok) setAgentCfg((prev) => prev ? { ...prev, [field]: value } : prev);
    } catch (e) { setToast(`保存失败：${String(e)}`); }
  }, [active]);
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
  // 真实配置面板：config.get() 拉引擎实际读取的 ~/.cortex/config 各域（替换 mock 渲染）
  const [cfg, setCfg] = useState<{ dir: string; domains: Array<{ name: string; fileName: string; required: boolean; present: boolean; topKeys: string[] }> } | null>(null);
  const [cfgSel, setCfgSel] = useState<string | null>(null);
  const [cfgVal, setCfgVal] = useState<Record<string, unknown> | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [cfgLoading, setCfgLoading] = useState(false);
  // 进设置 tab：拉引擎真实配置域概览（dir + 各域），默认选中第一个域
  useEffect(() => {
    if (tab !== "settings") return;
    void (async () => {
      try {
        const res = await window.cortexDesktop.config.get() as { ok: boolean; data?: { dir?: string; domains?: Array<{ name: string; fileName: string; required: boolean; present: boolean; topKeys: string[] }> } };
        if (res?.ok && res.data) {
          const domains = res.data.domains ?? [];
          setCfg({ dir: res.data.dir ?? "?", domains });
          setCfgSel((prev) => prev ?? domains[0]?.name ?? null);
        } else {
          setCfg(null);
        }
      } catch { setCfg(null); }
    })();
  }, [tab]);
  // 选中域变化：拉该域完整 JSON 值
  useEffect(() => {
    if (!cfgSel) { setCfgVal(null); return; }
    void (async () => {
      setCfgLoading(true);
      try {
        const res = await window.cortexDesktop.config.get(cfgSel) as { ok: boolean; data?: { value?: unknown } };
        const v = res?.ok ? res.data?.value : undefined;
        setCfgVal(v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
      } catch { setCfgVal(null); }
      setCfgLoading(false);
    })();
  }, [cfgSel]);
  // 写回某标量叶 → daemon 落盘到引擎实读文件 → 回读刷新该域（编辑所见即所存）
  const commitCfg = useCallback(
    async (path: Array<string | number>, value: string): Promise<boolean> => {
      if (!cfgSel) return false;
      try {
        const res = await window.cortexDesktop.config.set(cfgSel, path, value) as { ok: boolean; error?: string };
        if (res?.ok) {
          setToast(`已保存 ${String(path[path.length - 1])}`);
          setFlashKey(path.join("."));
          setTimeout(() => setFlashKey(null), 1500);
          const g = await window.cortexDesktop.config.get(cfgSel) as { ok: boolean; data?: { value?: unknown } };
          const v = g?.ok ? g.data?.value : undefined;
          setCfgVal(v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
          return true;
        }
        setToast(`保存失败：${res?.error ?? "未知错误"}`);
        return false;
      } catch (e) {
        setToast(`保存失败：${String(e)}`);
        return false;
      }
    },
    [cfgSel],
  );
  const [taskFilter, setTaskFilter] = useState("全部");
  const [taskSelected, setTaskSelected] = useState(0);
  // 任务接真：打开任务面板时拉真实节点（GET /api/v1/nodes——无节点时静态）
  const [realTasks, setRealTasks] = useState<Array<{ id: string; title: string; status: string; agent: string }> | null>(null);
  useEffect(() => {
    if (tab !== "tasks") return;
    let alive = true;
    const load = async () => {
      try {
        // 走 P0 IPC 桥（不再硬编码 127.0.0.1:3210、不绕 renderer→daemon 边界）
        const res = await window.cortexDesktop.nodes.list({ limit: 50 });
        if (!alive || !res.ok) return;
        const nodes = (res.data as { data: Array<{ id: string; nodeType: string; agent: string; description: string; status: string }> }).data; // PaginatedResponse<TaskNodeSnapshot>
        if (nodes.length > 0) {
          setRealTasks(nodes.map((n) => ({
            id: n.id,
            title: n.description || n.nodeType || n.id.slice(0, 12), // 真字段 description/nodeType（此前误读 n.task）
            status: n.status,
            agent: n.agent || "—", // 真字段 agent（此前误读 claimedBy）
          })));
        }
      } catch { /* 无 daemon——保持静态 */ }
    };
    void load();
    // 轮询刷新（瞬态化——任务状态实时可见）
    const t = setInterval(() => void load(), 5000);
    return () => { alive = false; clearInterval(t); };
  }, [tab]);
  // 好友 = Cortex agents（动态拉取）；群聊 = 预设
  const [friends, setFriends] = useState<Contact[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await window.cortexDesktop.config.get("agentManifests") as { ok: boolean; data?: { value?: { agents?: Record<string, { type?: string; emoji?: string; role?: string; model?: string; key?: string }> } } };
        const agents = res?.ok ? res.data?.value?.agents : undefined;
        if (agents && Object.keys(agents).length > 0) {
          const list: Contact[] = Object.entries(agents).map(([id, a]) => ({
            id: "agent-" + id,
            name: id,
            type: "friend" as const,
            avatar: a.emoji || id.slice(0, 1).toUpperCase(),
            desc: a.role || a.type || "Cortex Agent",
            online: true,
          })).sort((a, b) => a.name === "cyrene" ? -1 : b.name === "cyrene" ? 1 : a.name.localeCompare(b.name));
          setFriends(list);
          setActive((prev) => prev ?? list[0] ?? null);
        }
      } catch { /* daemon 未起时保持空 */ }
    })();
  }, []);
  // 会话列表：按当前 agent 拉真实 sessions + 切换/删除
  const [sessions, setSessions] = useState<Array<{ id: string; agent: string; mode: string; createdAt: number; lastActiveAt: number; messageCount: number }> | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const loadSessions = useCallback(async () => {
    try {
      const res = await window.cortexDesktop.sessions.list() as { ok: boolean; data?: unknown };
      const list = res?.ok && Array.isArray(res.data) ? res.data as Array<{ id: string; agent: string; mode: string; createdAt: number; lastActiveAt: number; messageCount: number }> : null;
      setSessions(list);
    } catch { setSessions(null); }
  }, []);
  useEffect(() => { void loadSessions(); }, [active, loadSessions]);
  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await window.cortexDesktop.sessions.delete(id);
      if (activeSessionId === id) setActiveSessionId(null);
      void loadSessions();
      setToast("会话已删除");
    } catch { setToast("删除失败"); }
  }, [activeSessionId, loadSessions]);
  const handleSelectSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
    try {
      const res = await window.cortexDesktop.sessions.get(id) as { ok: boolean; data?: { history?: Array<{ role: string; content: string }> } };
      if (res?.ok && Array.isArray(res.data?.history)) {
        const now = Date.now();
        setMessages(res.data.history.map((h, i) => ({
          id: `sess-${id}-${i}`,
          role: h.role === "user" ? "user" : "assistant",
          content: h.content ?? "",
          at: now,
          state: h.role === "user" ? undefined : "complete",
        })));
      }
    } catch { setToast("加载会话历史失败"); }
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleNewSession = useCallback(() => {
    if (messages.length === 0) { setToast("已经是新会话"); return; }
    setMessages([]);
    sessionIdsRef.current.delete(activeKey);
    setActiveSessionId(null);
    setToast("已开始新会话 ✨（首条消息起新建 daemon 会话）");
  }, [messages, activeKey]);

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
      const isStable = (m: Message) => !m.state || m.state === "complete" || m.state === "stopped" || m.state === "interrupted" || m.state === "error_timeout" || m.state === "error_fatal";
      const stableThreads: Record<string, Message[]> = {};
      for (const [k, arr] of Object.entries(threads)) stableThreads[k] = arr.filter(isStable);
      localStorage.setItem("cyrene-chat-threads", JSON.stringify(stableThreads));
    } catch { /* 忽略 */ }
  }, [threads]);

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
        active?.id?.replace(/^agent-/, ""),
        (chunk) => {
          if (first) { first = false; dispatch(aiId, "first-token"); }
          setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: m.content + chunk } : m)));
        },
        (full) => {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiId) return m;
            try { return { ...m, content: full, state: messageReducer(m.state ?? "idle", { type: "complete" }) }; } catch { return m; }
          }));
          void loadSessions();
        },
        history,
        // A2 吸收：工具调用内联状态（🔧 调用中 → ✅ 完成 → 淡出保留）
        (evt) => {
          const tid = evt.toolCallId || evt.toolName;
          setToolLogs((prev) => {
            if (evt.type === "start") {
              return [{ id: tid, toolName: evt.toolName, state: "running" as const }, ...prev].slice(0, 6);
            }
            return prev.map((t) => (t.id === tid ? { ...t, state: evt.success ? ("done" as const) : ("failed" as const) } : t));
          });
        },
        getOrCreateSessionId(activeKey),
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
  }, [dispatch, messages, active, getOrCreateSessionId, activeKey, loadSessions]);

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
        <button type="button" className={`chat__taskbar-btn${tab === "editor" ? " is-active" : ""}`} onClick={() => setTab("editor")} title="编辑器" aria-label="编辑器">📝</button>
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
                <span className="chat__rail-avatar" aria-hidden="true">
                  <img
                    className="chat__rail-avatar-img"
                    src={resolveAsset(`../avatars/${c.name}-avatar.png`)}
                    alt={c.name}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("chat__rail-avatar-fallback--hidden"); }}
                  />
                  <span className="chat__rail-avatar-fallback chat__rail-avatar-fallback--hidden">{c.avatar}</span>
                </span>
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

        {/* 编辑器层（Monaco——设计第三层：纯净编码体验） */}
        {tab === "editor" && <CodeEditor />}

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
                  // F2：真列表配真详情——realTasks 存在时按真实节点渲染，不再回退 mock（此前"真列表假详情"错位）
                  if (realTasks && realTasks.length > 0) {
                    const rt = realTasks[taskSelected] ?? realTasks[0];
                    if (!rt) return <div className="chat__panel-head"><span className="chat__panel-title">未选择任务</span></div>;
                    const statusCls = rt.status === "complete" ? "done" : rt.status === "failed" ? "failed" : "doing";
                    return (
                      <>
                        <div className="chat__panel-head">
                          <span className="chat__panel-title">{rt.title}</span>
                          <span className={`chat__task-status chat__task-status--${statusCls}`}>{rt.status}</span>
                        </div>
                        <div className="chat__tasks-detail-meta">
                          <span>Agent：{rt.agent}</span>
                          <span>节点 ID：{rt.id.slice(0, 12)}</span>
                        </div>
                        <div className="chat__tasks-events">
                          <div className="chat__task-event">步骤流 / 事件流：节点级明细待接入（当前 daemon 快照不含 steps/events）</div>
                        </div>
                        <div className="chat__tasks-actions">
                          <button type="button" className="chat__session-btn" title="取消任务（功能待接线）" disabled>⏹ 取消</button>
                          <button type="button" className="chat__session-btn" title="重试任务（功能待接线）" disabled>↻ 重试</button>
                        </div>
                      </>
                    );
                  }
                  // 演示模式（daemon 无节点）：保留 mock 详情
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
                          <div key={st.name} className={`chat__task-step chat__task-step--${st.state}`}>
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
                        <button type="button" className="chat__session-btn" onClick={() => setToast("取消任务——待实现")} title="取消任务（F10：功能待接线，暂禁用）" disabled>⏹ 取消</button>
                        <button type="button" className="chat__session-btn" onClick={() => setToast("重试任务——待实现")} title="重试任务（F10：功能待接线，暂禁用）" disabled>↻ 重试</button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
        {/* 设置面板：真实配置域浏览器（config.get 拉引擎实际读取的 ~/.cortex/config） */}
        {tab === "settings" && (
          <div className="chat__panel chat__panel--settings">
            <div className="chat__settings-layout">
              {/* 左：真实配置域列表 */}
              <aside className="chat__settings-domains">
                <div className="chat__settings-domain" style={{ opacity: 0.7, cursor: "default" }}>
                  <span aria-hidden="true">📂</span>
                  <span>{cfg ? `${cfg.domains.length} 域` : "加载中…"}</span>
                </div>
                {(cfg?.domains ?? []).map((d) => (
                  <button key={d.name} type="button" className={`chat__settings-domain${cfgSel === d.name ? " is-active" : ""}`} onClick={() => setCfgSel(d.name)} title={`${d.name} · ${d.fileName}${d.required ? " · 必填" : ""}`}>
                    <span className={`chat__cfg-dot${d.present ? " is-ok" : d.required ? " is-missing" : " is-idle"}`} />
                    <span>{DOMAIN_LABELS[d.name] ?? d.name}</span>
                  </button>
                ))}
              </aside>
              {/* 右：选中域的真实配置值（可编辑标量 + 递归展开） */}
              <div className="chat__settings-config">
                <div className="chat__panel-head">
                  <span className="chat__panel-title" title={cfgSel ?? ""}>{cfgSel ? (DOMAIN_LABELS[cfgSel] ?? cfgSel) : "选择配置域"}</span>
                  <span className="chat__settings-domain-desc" title="引擎实际读取的配置目录">源：{cfg?.dir ?? "…"}</span>
                </div>
                <div className="chat__settings-items">
                  {cfgSel && cfgVal && Object.entries(cfgVal).map(([k, v]) => {
                    const type = v === null ? "null" : Array.isArray(v) ? "arr" : typeof v === "object" ? "obj" : typeof v === "number" ? "num" : typeof v === "boolean" ? "bool" : "str";
                    return (
                      <div key={k} className={`chat__setting-item${flashKey === k ? " is-flash" : ""}`}>
                        <span className={`chat__cfg-type chat__cfg-type--${type}`}>{type}</span>
                        <span className="chat__setting-item-label">{KEY_LABELS[k] ?? k}</span>
                        <span className="chat__setting-item-key">{k}</span>
                        <CfgValue v={v} path={[k]} onCommit={commitCfg} />
                      </div>
                    );
                  })}
                  {cfgSel && !cfgVal && cfgLoading && (
                    <div className="chat__cfg-skeleton">
                      <div className="chat__cfg-sk-line" /><div className="chat__cfg-sk-line" /><div className="chat__cfg-sk-line" /><div className="chat__cfg-sk-line" />
                    </div>
                  )}
                  {cfgSel && !cfgVal && !cfgLoading && <div className="chat__setting-item"><span className="chat__setting-item-label">（该域无数据）</span></div>}
                  {!cfgSel && <div className="chat__setting-item"><span className="chat__setting-item-label">← 选择左侧配置域查看真实值</span></div>}
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
                        {(() => {
                          const parsed = msg.role === "assistant" ? extractAgentPayload(msg.content) : { display: msg.content };
                          return (
                            <>
                              {parsed.badge && <span className="msg__json-badge">{parsed.badge}</span>}
                              {parsed.display.split("\n").map((line, i) => (
                                <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
                              ))}
                            </>
                          );
                        })()}
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
                              <button className="msg__action-btn" onClick={() => resendMessage(msg)} title="重试"><IconRefresh size={15} /></button>
                            )}
                            {(msg.state === "complete" || msg.state === "stopped") && (
                              <button className="msg__action-btn" onClick={() => resendMessage(msg)} title="重新生成"><IconRefresh size={15} /></button>
                            )}
                            {(msg.state === "regenerating" || msg.state === "sending" || msg.state === "streaming") && (
                              <button className="msg__action-btn" onClick={() => stopMessage(msg)} title="停止"><IconStop size={15} /></button>
                            )}
                            <button className="msg__action-btn" onClick={() => void copyMessage(msg.content)} title="复制"><IconCopy size={15} /></button>
                            <button className="msg__action-btn" onClick={() => void speakMessage(msg.content, msg.id)} title="朗读">
                              {speakingMsgId === msg.id ? <IconVolumeHigh size={15} /> : <IconVolumeLow size={15} />}
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
                  <button type="button" className="chat__session-btn" onClick={() => setToast("合并会话——待实现")} title="合并会话（F10：功能待接线，暂禁用）" disabled>⧉ 合并会话</button>
                  <button type="button" className="chat__session-btn" onClick={() => setToast("压缩会话——待实现")} title="压缩会话（F10：功能待接线，暂禁用）" disabled>🗜 压缩会话</button>
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
              <div className="chat__side-label">当前消息</div>
              <div className="chat__side-info">{messages.length} 条</div>
              <div className="chat__side-divider" />
              <div className="chat__side-label">会话列表（{sessions?.length ?? "…"}）</div>
              <div className="chat__side-sessions">
                {sessions === null && <div className="chat__side-info">加载中…</div>}
                {sessions?.length === 0 && <div className="chat__side-info">暂无会话</div>}
                {sessions?.map((s) => (
                  <div key={s.id} className={`chat__side-session${activeSessionId === s.id ? " is-active" : ""}`} onClick={() => { void handleSelectSession(s.id); }}>
                    <span className="chat__side-session-mode">{s.mode}</span>
                    <span className="chat__side-session-time">{new Date(s.lastActiveAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="chat__side-session-count">{s.messageCount}</span>
                    <button type="button" className="chat__side-session-del" onClick={(e) => { e.stopPropagation(); void handleDeleteSession(s.id); }} title="删除会话">×</button>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        )}
      </div>
      {/* 工具调用内联状态（A2 吸收：🔧 调用中 → ✅/❌ 完成，工具进度融入消息流） */}
      {toolLogs.length > 0 && (
        <div className="chat__tool-strip">
          {toolLogs.map((t) => (
            <span key={t.id} className={`chat__tool-pill${t.state === "running" ? " is-running" : ""}${t.state === "failed" ? " is-failed" : ""}`}>
              {t.state === "running" ? "🔧" : t.state === "done" ? "✅" : "❌"} {t.toolName}
            </span>
          ))}
        </div>
      )}
      {/* 确认门浮层（D7b：L2/L3 工具调用需人工确认——gate.request 驱动，resolve 后消隐） */}
      {gateRequests.length > 0 && (
        <div className="chat__notif-panel" style={{ bottom: 76 }}>
          <div className="chat__panel-title">⚖️ 需要确认（{gateRequests.length}）</div>
          {gateRequests.map((g) => (
            <div key={g.requestId} className="chat__notif-item">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{humanizeTool(g.toolName)} · {g.level}</span>
                <span style={{ fontSize: 12, opacity: 0.75, wordBreak: "break-all" }}>{g.summary || "（无摘要）"}</span>
              </div>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="chat__session-btn chat__session-btn--config" onClick={() => resolveGate(g.requestId, true)}>允许</button>
                <button type="button" className="chat__session-btn" onClick={() => resolveGate(g.requestId, false)}>拒绝</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {/* 通知面板（持久锚点——四通道 + 实时事件） */}
      {notifOpen && (
        <div className="chat__notif-panel">
          {notifItems.map((n, i) => (
            <div key={i} className="chat__notif-item chat__notif-item--unread"><span>{n.icon}</span><span>{n.text}</span><span className="chat__notif-time">{n.time}</span></div>
          ))}
          {notifItems.length === 0 && (
            <div className="chat__notif-item"><span>✅</span><span>暂无通知——系统正常，等待实时事件</span></div>
          )}
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
              {!agentCfg && <div className="chat__cfg-row"><span className="chat__cfg-label">加载中…</span></div>}
              {agentCfg && (<>
                <div className="chat__cfg-row">
                  <span className="chat__cfg-label">模型</span>
                  <span className="chat__cfg-desc">路由到的 LLM（点击切换）</span>
                  <button type="button" className="chat__cfg-value chat__cfg-value--btn" onClick={() => { const cur = String(agentCfg.model ?? ""); const next = cur.includes("flash") ? "deepseek-v4-pro" : "deepseek-flash"; void commitAgentField("model", next); }}>{String(agentCfg.model ?? "—")}</button>
                </div>
                <div className="chat__cfg-row">
                  <span className="chat__cfg-label">密钥</span>
                  <span className="chat__cfg-desc">API 密钥路由（点击切换）</span>
                  <button type="button" className="chat__cfg-value chat__cfg-value--btn" onClick={() => { const keys = ["DEEPSEEK_CHAT","DEEPSEEK_REASONER","DEEPSEEK_CYRENE","DEEPSEEK_GANYU"]; const cur = String(agentCfg.key ?? keys[0]); const idx = keys.indexOf(cur); void commitAgentField("key", keys[(idx + 1) % keys.length]!); }}>{String(agentCfg.key ?? "—")}</button>
                </div>
                <div className="chat__cfg-row">
                  <span className="chat__cfg-label">类型</span>
                  <span className="chat__cfg-desc">Agent 职能分类</span>
                  <span className="chat__cfg-value">{String(agentCfg.type ?? "—")}</span>
                </div>
                <div className="chat__cfg-row">
                  <span className="chat__cfg-label">最大并发</span>
                  <span className="chat__cfg-desc">同时运行实例数（点击 +1，最大 8）</span>
                  <button type="button" className="chat__cfg-value chat__cfg-value--btn" onClick={() => { const cur = Number(agentCfg.maxInstances ?? 1); void commitAgentField("maxInstances", cur >= 8 ? 1 : cur + 1); }}>{String(agentCfg.maxInstances ?? "—")}</button>
                </div>
              </>)}
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

/* ── 编辑器层：Monaco（设计第三层——纯净编码体验） ── */
function CodeEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ dispose: () => void } | null>(null);
  const [fileName, setFileName] = useState("未打开文件");
  const [content, setContent] = useState("// 打开一个文件开始编辑——纯净编码体验\n// Monaco Editor（设计第三层：不与 AI 组件混排）\n");
  const [editorToast, setEditorToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const monaco = await import("monaco-editor");
        if (cancelled || !containerRef.current) return;
        const ed = monaco.editor.create(containerRef.current, {
          value: content,
          language: "typescript",
          theme: "vs-dark",
          automaticLayout: true,
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
        });
        editorRef.current = ed;
      } catch (e) {
        console.error("[editor] Monaco 加载失败:", String(e));
      }
    })();
    return () => { cancelled = true; editorRef.current?.dispose(); editorRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ts,.tsx,.js,.json,.md,.css,.html,.py,.rs";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        const text = await file.text();
        setFileName(file.name);
        setContent(text);
        const monaco = await import("monaco-editor");
        const model = monaco.editor.getModels()[0];
        if (model) {
          model.setValue(text);
          // 按扩展名自动切换语言（高亮）
          const lang = ({ ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".json": "json", ".md": "markdown", ".css": "css", ".html": "html", ".py": "python", ".rs": "rust" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() ? `.${file.name.split(".").pop()?.toLowerCase()}` : ""];
          if (lang) monaco.editor.setModelLanguage(model, lang);
        }
      })();
    };
    input.click();
  }, []);

  // 保存：读编辑器当前内容 → IPC 写回 userData/editor-files/
  const saveFile = useCallback(async () => {
    try {
      const monaco = await import("monaco-editor");
      const model = monaco.editor.getModels()[0];
      const text = model?.getValue() ?? content;
      const res = await window.cortexDesktop.editorSave(fileName === "未打开文件" ? "untitled.ts" : fileName, text) as { ok: boolean; path?: string; error?: string };
      setEditorToast(res?.ok ? `已保存: ${res.path ?? ""}` : `保存失败: ${res?.error ?? ""}`);
    } catch (e) {
      setEditorToast(`保存失败: ${String(e)}`);
    }
  }, [fileName, content]);

  // 另存为：dialog 选路径
  const saveAs = useCallback(async () => {
    try {
      const monaco = await import("monaco-editor");
      const model = monaco.editor.getModels()[0];
      const text = model?.getValue() ?? content;
      const res = await window.cortexDesktop.editorSaveAs(text) as { ok: boolean; path?: string; error?: string };
      setEditorToast(res?.ok ? `已另存为: ${res.path ?? ""}` : `另存为失败: ${res?.error ?? ""}`);
    } catch (e) {
      setEditorToast(`另存为失败: ${String(e)}`);
    }
  }, [content]);

  return (
    <div className="chat__panel chat__panel--editor">
      <div className="chat__panel-head">
        <span className="chat__panel-title">📝 编辑器 · {fileName}</span>
        {editorToast && <span className="chat__panel-title" style={{ fontSize: 12, opacity: 0.7 }}>{editorToast}</span>}
        <span style={{ display: "flex", gap: 8 }}>
          <button type="button" className="chat__session-btn chat__session-btn--config" onClick={() => void saveFile()}>保存</button>
          <button type="button" className="chat__session-btn chat__session-btn--config" onClick={() => void saveAs()}>另存为</button>
          <button type="button" className="chat__session-btn chat__session-btn--config" onClick={openFile}>打开文件</button>
        </span>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(236,72,153,0.12)" }} />
    </div>
  );
}

/* ── 记忆面板：接真（GET /api/v1/memory） ── */
interface MemItem { id: string; summary?: string; content?: string; kind: string; domain?: string; semanticState?: string; tags?: string[]; createdAt: number; }
function MemoryPanel() {
  const [items, setItems] = useState<MemItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      // 走 P0 IPC 桥（不再硬编码 3210、不绕 renderer→daemon 边界）
      const res = await window.cortexDesktop.memory.search(q, { limit: 50 });
      setItems(res.ok ? (res.data as MemItem[]) : []);
    } catch { setItems([]); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(""); }, [load]);
  // 轮询刷新（与任务面板一致——5s）
  useEffect(() => {
    const t = setInterval(() => { void load(query); }, 5000);
    return () => clearInterval(t);
  }, [load, query]);
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
              <span className="chat__memory-summary">{m.summary || m.content?.slice(0, 80) || "（无摘要）"}</span>
              <span className="chat__memory-sub">{m.kind} · {m.domain || "—"}{m.tags?.length ? ` · ${m.tags.slice(0, 2).join(", ")}` : ""}</span>
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
