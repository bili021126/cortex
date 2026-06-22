/**
 * solo-flight.ts —— 全系统闭环基准 E2E
 *
 * 唯一约束: 建造一个完整 TypeScript 包。其余一切由 Agent 自主决定。
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/solo-flight.ts [--intent <name>]
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { PipelinePriority } from "@cortex/shared";
import { bootstrapEngine, type BootstrapEngineResult } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e-utils.js";
import { setAgentToolPermissions } from "@cortex/shared";
import { PanoramaTracker } from "./panorama-tracker.js";
import { DEFAULT_ENGINE_CONFIG } from "@cortex/config";

// ── 全工具开放 ──────────────────────────────
const TOOLS = ["read_file","write_file","search_code","list_files","run_shell","web_search","delete_file","parse_ast"];

// ── 验收函数（纯函数，不依赖测试上下文）─────
function verify(pkgDir: string) {
  const r = { barrel: false, pkgJson: false, tests: 0, ciTags: 0, positioning: false, srcFiles: 0, compile: false as boolean|null, test: false as boolean|null };
  if (fs.existsSync(path.join(pkgDir, "src/index.ts"))) r.barrel = true;
  if (fs.existsSync(path.join(pkgDir, "package.json"))) r.pkgJson = true;
  if (fs.existsSync(path.join(pkgDir, "PACKAGE_POSITIONING.md"))) r.positioning = true;

  // 统计实际 TypeScript 源文件
  const srcDir = path.join(pkgDir, "src");
  if (fs.existsSync(srcDir)) {
    try { r.srcFiles = fs.readdirSync(srcDir).filter((f: string) => f.endsWith(".ts") && f !== "index.ts").length; } catch {}
  }

  const td = path.join(pkgDir, "tests");
  if (fs.existsSync(td)) {
    const tfs = fs.readdirSync(td).filter((f: string) => f.endsWith(".test.ts"));
    r.tests = tfs.length;
    for (const f of tfs) {
      if (fs.readFileSync(path.join(td, f), "utf-8").slice(0, 25).includes("@ci")) r.ciTags++;
    }
  }

  if (r.pkgJson) {
    try {
      require("child_process").execSync("npx tsc --noEmit", { cwd: pkgDir, timeout: 180_000, stdio: "ignore" });
      r.compile = true;
      try {
        require("child_process").execSync("npx vitest run --no-color", { cwd: pkgDir, timeout: 180_000, stdio: "ignore" });
        r.test = true;
      } catch { r.test = false; }
    } catch { r.compile = false; }
  }
  return r;
}

// ── 已知包名（排除）─────────────────────────
const KNOWN = new Set("cache|cli|config|consistency|context|data|doctor|engine|factory|fsm-compiler|governance|llm|logging|memory|memory-store|notification|option|parser|pattern-extractor|platform|plugin-runner|pm|policy-validator|prompt-kit|resilience|result|scheduler|self-examination|shared|skill-kit|skill-validator|src|telemetry|test-output|testing|tests|tools|tui".split("|"));

// ── 主流程 ──────────────────────────────────
async function main() {
  // 沙箱兼容：从脚本路径推导项目根
  try {
    const url = import.meta.url.replace("file:///", "");
    if (fs.existsSync(path.join(path.dirname(url), "../../../../../../cortex-cognition.json"))) {
      const rootDir = path.resolve(path.dirname(url), "../../../../../..");
      process.env["CORTEX_ROOT"] = rootDir;
    }
  } catch {}
  const { root, llm, toolkit } = e2eBootstrap();
  const P = path.join(root, "packages");

  log("╔══════════════════════════════════╗");
  log("║  🕊️  Solo Flight  全系统闭环    ║");
  log("╚══════════════════════════════════╝\n");

  // ── 全景追踪器 ──
  const tracker = new PanoramaTracker({ logToStderr: true });
  tracker.phase("S0", "启动");

  // ── S1 Bootstrap ──────────────────────────
  log("S1 Bootstrap");
  const engine: BootstrapEngineResult = await bootstrapEngine(root, {
    llms: new Map([["default", llm]]), toolkit,
    dbPath: path.join(root, ".cortex", "test", "sf.db"),
  } as any);
  setAgentToolPermissions(Object.fromEntries(
    ["code","review","analysis","ops","loop","doc-govern","api","data","fix","inspector"].map(t => [t, TOOLS])
  ));
  try { (toolkit as any).gate?.bypassAll?.(); } catch {}
  try { (engine as any).gate?.bypassAll?.(); } catch {}
  log("  ✅ ConfirmGate 已绕过");
  // bypassAll() TTL 仅 5 分钟，长任务必然过期→每 4 分钟刷新
  setInterval(() => {
    try { (toolkit as any).gate?.bypassAll?.(); } catch {}
    try { (engine as any).gate?.bypassAll?.(); } catch {}
  }, 240_000);
  process.env["CONFIRM_GATE_TIMEOUT_MS"] = "100";
  log(`  ${10} 组件就绪 | ${fs.readdirSync(P).filter(d => !d.startsWith(".") && fs.statSync(path.join(P,d)).isDirectory()).length} 个已有包\n`);
  tracker.phaseEnd("S0");

  // ── S2 组件健康 ──────────────────────────
  const diag = { MetaAgent: !!engine.metaAgent, Scheduler: !!engine.scheduler, Observer: !!engine.observer, TaskRouter: !!engine.taskRouter, Sentinel: !!engine.sentinelFilter, NotifyRuntime: !!engine.notificationRuntime, DecisionBridge: !!engine.decisionBridge, GovEmitter: !!engine.governanceEmitter, EnvRouter: !!engine.envRouter, MemoryStore: !!engine.memory, SkillRegistry: !!engine.skillRegistry };
  for (const [k, v] of Object.entries(diag)) log(`  ${v ? "✅" : "⚠️"} ${k}`);

  // 记忆六层防御 + 技能预检
  if (engine.memory) {
    try {
      const stats = (engine.memory as any).stats?.() ?? {};
      const all = (engine.memory as any).getAllEntries?.() ?? [];
      const pending = (engine.memory as any).getPendingEntries?.() ?? [];
      log(`  记忆: ${all.length}条 | Pending:${pending.length}条 | Active:${all.length-pending.length}条`);
    } catch { log("  记忆: 就绪 (统计不可用)"); }
  }
  if (engine.skillRegistry) {
    const skills = (engine.skillRegistry as any).getAll?.() ?? [];
    log(`  技能: ${(engine.skillRegistry as any).activeCount ?? skills.length} 活跃 | ${skills.length} 总数`);
  }

  // Agent 注册清单
  log("  ── Agent 注册 ──");
  if (engine.agents) {
    for (const [type, agent] of engine.agents) {
      const max = (engine as any).pool?.configs?.get?.(type)?.maxInstances ?? "?";
      log(`    ${type.padEnd(14)} max=${max}`);
    }
  }

  // 并发上限设为 6——防止节流阻塞但限制实例爆炸
  for (const augType of ["code","review","analysis","ops","inspector","doc-govern","loop","api","data"]) {
    try { (engine as any).pool?.setMaxInstances?.(augType, 6); } catch {}
  }
  log("  ✅ Agent 并发上限 → 6");

  // 工具注册清单
  log("  ── 工具注册 ──");
  try {
    const defs = (toolkit as any).listDefinitions?.("code") ?? [];
    const names = defs.map((d: any) => d.name ?? d);
    log(`    ${names.length} 工具: ${names.slice(0, 15).join(", ")}${names.length > 15 ? " ..." : ""}`);
  } catch { log("    工具清单不可用"); }
  log("");

  // ── S3 事件收集 + 实时日志 + ReactLoop 追踪 ──
  const events: string[] = [];
  let apiCallCount = 0;
  let toolCallCount = 0;
  let replanCount = 0;
  let reactLoopCount = 0;
  engine.observer.on(PipelinePriority.HIGH, (e: any) => {
    const t = e.type ?? "";
    events.push(t);
    const payload = e.payload as any;
    const nodeId = payload?.nodeId ?? "";
    const agentType = payload?.agentType ?? "";
    const ts = new Date().toISOString().slice(11, 23);

    // 全景追踪
    tracker.onEvent(e);

    // 节点事件
    if (t.includes("node.")) {
      if (t.includes("claimed")) {
        tracker.nodeClaimed(nodeId, agentType, payload?.type ?? "");
        log(`[${ts}] 👤 [${agentType}] ${nodeId}`);
      } else if (t.includes("started")) {
        tracker.nodeStarted(nodeId);
        log(`[${ts}] ▶ [${agentType}] ${nodeId}`);
      } else if (t.includes("completed")) {
        tracker.nodeCompleted(nodeId, true, payload?.output, "");
        log(`[${ts}] ✅ [${agentType}] ${nodeId}`);
      } else if (t.includes("failed")) {
        tracker.nodeCompleted(nodeId, false, "", payload?.error);
        log(`[${ts}] ❌ [${agentType}] ${nodeId}`);
      } else if (t.includes("replan")) {
        tracker.nodeReplanned(nodeId);
        replanCount++;
        log(`[${ts}] 🔄 重规划 ${nodeId}`);
      }
      return; // 避免命中后续域匹配
    }

    // 工具事件
    if (t.includes("tool.")) {
      if (t.includes("started")) {
        tracker.toolStarted(agentType, nodeId, payload?.toolName ?? "", payload?.params ?? {});
      } else if (t.includes("completed") || t.includes("failed")) {
        tracker.toolEnded(t.includes("completed"));
        toolCallCount++;
        log(`[${ts}] 🔧 [${agentType}] ${payload?.toolName ?? ""} 完成`);
      }
      return;
    }

    // 其他域事件
    if (t.includes("governance") || t.includes("constitution")) {
      log(`[${ts}] 🏛 ${t}`);
    } else if (t.includes("llm") || t.includes("api")) {
      apiCallCount++;
    } else if (t.includes("rlm.") || t.includes("react")) {
      reactLoopCount++;
      log(`[${ts}] 🔁 ReactLoop ${t}  node:${nodeId}`);
    } else if (t.includes("memory.write") || t.includes("memory.link")) {
      log(`[${ts}] 💾 ${t} [${nodeId}]`);
    } else if (t.includes("scheduler") || t.includes("agent_pool")) {
      log(`[${ts}] ⚙ ${t}`);
    } else if (t.includes("context.compress") || t.includes("context.")) {
      log(`[${ts}] 📐 ${t}  node:${nodeId}`);
    }
  });

  // 15s 心跳 + claimed 超时兜底
  let totalReactLoop = 0;
  let totalReplans = 0;
  const claimedAt = new Map<string, number>();
  const heartbeat = setInterval(() => {
    const allNodes = engine.board.getAllNodes() ?? [];
    const nc = allNodes.length;
    const pending = allNodes.filter((n: any) => n.status === "pending").length;
    const claimed = allNodes.filter((n: any) => n.status === "claimed").length;
    const running = allNodes.filter((n: any) => n.status === "running" || n.status === "in_progress").length;
    const done = allNodes.filter((n: any) => n.status === "done").length;
    const failed = allNodes.filter((n: any) => n.status === "failed").length;
    // 兜底：认领超 90s 强制释放
    const now = Date.now();
    for (const n of allNodes) {
      if (n.status === "claimed") {
        if (!claimedAt.has(n.id)) claimedAt.set(n.id, now);
        if (now - (claimedAt.get(n.id) ?? now) > 90_000) {
          log(`[${new Date().toISOString().slice(11, 19)}] ⛔ ${n.id} 认领超时 强制释放`);
          try { engine.board.release(n.id, (Array.isArray(n.claimedBy) ? n.claimedBy[0] : n.claimedBy) ?? ""); } catch {}
          try { engine.board.failNode(n.id); } catch {}
          claimedAt.delete(n.id);
        }
      } else { claimedAt.delete(n.id); }
    }
    const ts = new Date().toISOString().slice(11, 19);
    totalReactLoop += reactLoopCount;
    totalReplans += replanCount;
    log(`[${ts}] ⏳ 节点:${nc} (待:${pending} 认领:${claimed} 运行:${running} 完成:${done} 失败:${failed}) | API:${apiCallCount} 工具:${toolCallCount} ReAct:${reactLoopCount}(累计${totalReactLoop}) 重规划:${replanCount}(累计${totalReplans})`);
    apiCallCount = 0; toolCallCount = 0; reactLoopCount = 0; replanCount = 0;
  }, 15_000);

  // ── S4 自主决策 + 规划 ──────────────────
  if (!engine.metaAgent) { log("❌ no MetaAgent"); await engine.shutdown(); return; }
  
  const ai = process.argv.indexOf("--intent");
  const intent = ai >= 0 ? process.argv[ai + 1] : null;
  
  // 项目探索——扫描已有包、识别缺口
  const pkgDirs = fs.readdirSync(P).filter(d => !d.startsWith(".") && fs.statSync(path.join(P,d)).isDirectory());
  const scan = pkgDirs.filter(d => !KNOWN.has(d));
  const pkgInfo = pkgDirs.map(d => {
    const pj = path.join(P, d, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const j = JSON.parse(fs.readFileSync(pj, "utf-8"));
        return `  ${d}/ — ${j.description ?? "(无描述)"} [${j.name ?? "?"}]`;
      } catch { return `  ${d}/`; }
    }
    return `  ${d}/`;
  }).join("\n");
  
  // 联网搜索——了解 TypeScript 生态趋势
  let webCtx = "";
  try {
    const r = await (toolkit as any).execute?.({ toolName: "web_search", params: { query: "TypeScript monorepo useful packages 2025", max_results: 3 } }, "analysis" as any);
    if (r?.success && r.output) webCtx = "联网洞察:\n" + String(r.output).slice(0, 500);
  } catch { /* 搜索不可用 */ }
  
  const ctx = [
    "=== 关于母项目（Cortex）===",
    "",
    `Cortex —— TypeScript monorepo, ${pkgDirs.length} 个包:`,
    pkgInfo,
    scan.length > 0 ? `\n非标准包: ${scan.join(", ")}` : "",
    "",
    webCtx,
    "",
    "=== 你的任务 ===",
    "",
    intent
      ? `指定意图: ${intent}`
      : [
          "在母项目 monorepo 中建造一个**有价值的、可独立编译测试的 TypeScript 包**。",
          "",
          "自主决策造什么——基于上述已有包结构和母项目定位：",
          "  1. 哪些包已经存在？它们各自做什么？",
          "  2. 还缺什么？有什么明显需要但还没做的？",
        ].join("\n"),
    "",
    "=== 强制要求 ===",
    "",
    "1. 【核心交付】包必须包含：",
    "   - src/index.ts（公开 API，barrel 导出）",
    "   - src/ 下至少一个功能模块",
    "   - tests/ 下至少一个单元测试文件",
    "2. 【CI 标注】每个测试文件首行 `// @ci: unit`",
    "3. 【编译通过】`npx tsc --noEmit` 零错误",
    "4. 【测试通过】`npx vitest run` 全部通过",
    "5. 【编码规范】禁止 any/非空断言/空catch/var/魔法数字。JSDoc 全覆盖。",
    "6. 【补足声明】创建 PACKAGE_POSITIONING.md，回答三个问题：",
    "   - 这个包补足了什么？",
    "   - 它的定位是什么？",
    "   - 为什么值得合入？",
    "7. 【模块化注册】包名 @cortex/<name>，依赖声明用 workspace:*",
    "",
    "=== 路径规则 ===",
    "所有文件写在本目录内——不要嵌套多层：",
    "- ✅ src/index.ts（正确——扁平结构）",
    "- ❌ packages/xxx/src/index.ts（错误——不要嵌套）",
    "- ❌ src/cortex/xxx/（错误——不要复制母目录树）",
    "",
    "=== 团队 ===",
    "CodeAgent(阿贝多) ReviewAgent(刻晴) AnalysisAgent(纳西妲) OpsAgent(北斗)",
    "LoopAgent(莫娜) DocGovernAgent(凝光) ApiAgent(久岐忍) DataAgent(艾尔海森)",
    "",
    "必须 write_file——输出文本不算完成。tsc 零错, vitest 全过。",
  ].join("\n");
  
  log("S4 甘雨规划" + (webCtx ? " (含联网搜索)" : ""));
  tracker.phase("S4", "甘雨规划");
  const planT0 = Date.now();
  const nodes = await engine.metaAgent.plan(ctx);
  const planMs = Date.now() - planT0;

  // 从规划输出中提取甘雨的调度建议
  const planText = nodes.map(n => (n as any).payload ?? "").join(" ");
  const stratMatch = planText.match(/STRATEGY:\s*(\S+)\s*\|?\s*(\S*)\s*\|?\s*(\S*)/i);
  log(`  调度: ${stratMatch ? stratMatch[0] : "引擎默认 (tag-matching | topological-layered | pipeline)"}`);
  log(`  循环: 策略注册表 (direct/decompose/jury/react) — 节点层面动态选择`);
  log(`  规划耗时: ${(planMs/1000).toFixed(1)}s`);
  const types = [...new Set(nodes.map(n => String(n.type)))];
  log(`  ${nodes.length} 节点 | ${types.length} 种 Agent | ${types.join(",")}`);

  // 拓扑结构可视化
  const roots = nodes.filter(n => !n.parentId);
  const nonRoots = nodes.filter(n => n.parentId);
  log(`  🌳 拓扑: ${roots.length} 根节点, ${nonRoots.length} 子节点`);
  for (const n of nodes) {
    const parent = n.parentId ? ` ← parent:${n.parentId.slice(-20)}` : " ← root";
    const deps = (n as any).dependsOn;
    const depStr = deps?.length ? `  依赖:[${deps.map((d:any)=>d.slice(-12)).join(",")}]` : "";
    log(`    [${n.type.padEnd(14)}] ${n.id.slice(-24)}${parent}${depStr}`);
    log(`       ${(n as any).payload?.slice(0, 100)}`);
  }
  if (!nodes.length) { log("⚠️ 空计划"); await engine.shutdown(); return; }
  log("");

  // ── S5 执行 ──────────────────────────────
  log("S5 执行");
  const t0 = Date.now();
  for (const n of nodes) engine.board.addNode(n);
  const report = await engine.scheduler.executeAll();
  clearInterval(heartbeat);
  const elapsed = Date.now() - t0;

  let pass = 0, fail = 0;
  let wroteFiles = false;
  for (const r of report.results) {
    // 必须有 write_file 才算真正成功
    const hasWrite = tracker.toolCalls.some(t => t.nodeId === r.nodeId && t.toolName === "write_file" && t.success);
    const realSuccess = r.success && hasWrite;
    if (realSuccess) { pass++; } else { fail++; }
    if (hasWrite) wroteFiles = true;
    const summary = (r.output ?? r.error ?? "").slice(0, 100);
    const ms = (r as any).durationMs;
    log(`  ${realSuccess ? "✅" : "❌"} [${r.agentType}] ${r.nodeId?.slice(-16)} ${ms ? (ms/1000).toFixed(1)+"s" : ""} ${summary}`);
  }
  log(`  ${(elapsed / 1000).toFixed(1)}s | ${pass}/${nodes.length} pass (write_file✍️=${wroteFiles ? "有" : "无"})\n`);

  // ── S6 发现新包 ──────────────────────────
  const newPkg = fs.readdirSync(P).filter(d => !KNOWN.has(d) && !d.startsWith(".") && fs.statSync(path.join(P,d)).isDirectory())
    .find(d => !scan.includes(d)) ?? scan[0] ?? null;

  // ── S7 验收 ──────────────────────────────
  let vrfy: ReturnType<typeof verify> | null = null;
  if (newPkg) {
    log(`S7 验收: ${newPkg}`);
    vrfy = verify(path.join(P, newPkg));
    log(`  barrel:${vrfy.barrel?"✅":"❌"} pkgJson:${vrfy.pkgJson?"✅":"❌"} tests:${vrfy.tests} ciTags:${vrfy.ciTags} positioning:${vrfy.positioning?"✅":"❌"}`);
    log(`  compile:${vrfy.compile==null?"—":vrfy.compile?"✅":"❌"} vitest:${vrfy.test==null?"—":vrfy.test?"✅":"❌"}\n`);
  } else { log("S7 验收: (无新包)\n"); }

  // ── S8 全维度汇总 ────────────────────────
  const evt = (s: string) => events.filter(e => e.includes(s)).length;

  // 核心事件（对齐 PipelineEventType 枚举值）
  const nodeEvents = evt("node.");
  const govEvents  = evt("agent_pool.") + evt("scheduler.") + evt("error.");
  const memEvents  = evt("memory.");
  const skillEvents = evt("skill.");

  // 记忆指标
  const memPersist = evt("memory.persist_failed");
  const memBlocked = evt("memory.write_blocked");
  const memDbFailed = evt("memory.db_write_failed");
  const memFlushSkip = evt("memory.flush_skipped");

  // 技能指标
  const skillRef = evt("skill.referenced");

  // 标签覆盖
  const ALL_TAGS = ["code","review","analysis","ops","loop","doc-govern","api","data","fix","inspect"];
  const plannedTags = new Set(nodes.flatMap(n => n.tags?.map(t => String(t).toLowerCase()) ?? []));
  const missingTags = ALL_TAGS.filter(t => !plannedTags.has(t));

  // 扩展可观测性
  const mfgEvents = evt("manifold_gate.");
  const rlmDecompose = evt("rlm.decompose");
  const contextCompress = evt("context.compress");
  const replanEvents = evt("node.replan");

  log("S8 汇总");
  log(`  节点: ${pass}/${nodes.length} pass | ${(elapsed/1000).toFixed(1)}s | ${types.length}种Agent`);
  log(`  覆盖: ${[...plannedTags].join(",")}${missingTags.length?"  ⚠缺口:"+missingTags.join(","):""}`);
  log(`  管道: ${events.length}事件 (Node:${nodeEvents} Gov:${govEvents} Mem:${memEvents} Skill:${skillEvents})`);
  log(`  记忆: PersistFail:${memPersist} WriteBlock:${memBlocked} DbFail:${memDbFailed} FlushSkip:${memFlushSkip}`);
  log(`  技能: Referenced:${skillRef}`);
  log(`  扩展: Manifold:${mfgEvents} RLM:${rlmDecompose} Compress:${contextCompress} Replan:${replanEvents}`);
  log(`  循环: ReAct累计${totalReactLoop}  重规划累计${totalReplans}  Claimed超时释放${claimedAt.size}`);
  log(`  新包: ${newPkg ?? "(无)"}`);
  if (vrfy) log(`  结构: ${vrfy.barrel&&vrfy.pkgJson&&vrfy.tests>0&&vrfy.ciTags>0&&vrfy.positioning?"✅":"❌"}`);
  if (vrfy) log(`  编译: ${vrfy.compile?"✅":"❌"}  测试: ${vrfy.test?"✅":"❌"}`);
  log(`  综合: ${newPkg&&vrfy&&vrfy.compile&&vrfy.test&&pass===nodes.length?"✅ ALL PASS":"❌ GAPS"}`);

  await engine.shutdown();

  // ── S9 全景报告 ──
  try {
    const outputDir = path.join(root, DEFAULT_ENGINE_CONFIG.filePaths.soloFlightOutput ?? "solo-flight-output");
    const report = tracker.generateReport(outputDir, intent ?? "default");
    tracker.printSummary(report);
  } catch (e) { log(`⚠️ 全景报告生成失败: ${e}`); }

  log("\n✨ 闭环完成");
}

main().catch(e => { log(`💥 ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
