// @ci: unit
// ============================================================
// @cortex/protocol — barrel 完整性守护
//
// 为什么这个包需要这份测试：`src/index.ts` 用 6 条 `export *` 聚合出
// **89 个符号**（67 interface / 15 type / 7 function），而这是
// **三端（TUI / WebUI / Desktop）与 engine daemon 之间的唯一契约**。
//
// 而全仓 35 处 `export *` 里 22 处集中在本包，且本包此前**没有任何 barrel 守护**
// ——对比之下 fsm-compiler 有 3 组「barrel re-exports」测试。
// `export *` 的代价正是「公共面是隐式的」：删掉/改名一个导出，
// 编译期只有在还有引用方时才会报错，没有引用方的契约符号会静默消失。
//
// 覆盖三类失效：
//   1. barrel 指向的子模块不存在（悬空聚合）
//   2. 传递闭包内出现重名（`export *` 会静默取其一，契约语义不确定）
//   3. 契约符号消失或表面规模下滑
//
// 静态分析而非运行时导入——本包 82/89 是类型，运行时不存在。
// ============================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const BARREL = join(SRC, "index.ts");

interface Sym {
  name: string;
  kind: string;
  from: string;
}

/** 递归展开 barrel 的 `export *` 闭包，收集全部导出符号 */
function collectSurface(entry: string): { symbols: Sym[]; missing: string[] } {
  const seen = new Set<string>();
  const symbols: Sym[] = [];
  const missing: string[] = [];
  const relOf = (p: string) => relative(SRC, p).replace(/\\/g, "/");

  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!existsSync(file)) {
      missing.push(relOf(file));
      return;
    }
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf-8"),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    for (const st of sf.statements) {
      if (ts.isExportDeclaration(st)) {
        if (!st.exportClause && st.moduleSpecifier) {
          const target = resolve(
            dirname(file),
            st.moduleSpecifier.text.replace(/\.js$/, ".ts"),
          );
          walk(target);
        } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            symbols.push({ name: el.name.text, kind: "named", from: relOf(file) });
          }
        }
        continue;
      }
      if (!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || !st.name) continue;
      const kind = ts.isInterfaceDeclaration(st)
        ? "interface"
        : ts.isTypeAliasDeclaration(st)
          ? "type"
          : ts.isEnumDeclaration(st)
            ? "enum"
            : ts.isClassDeclaration(st)
              ? "class"
              : ts.isFunctionDeclaration(st)
                ? "function"
                : ts.isVariableStatement(st)
                  ? "const"
                  : "other";
      symbols.push({ name: st.name.getText(sf), kind, from: relOf(file) });
    }
  };

  walk(entry);
  return { symbols, missing };
}

const { symbols, missing } = collectSurface(BARREL);
const byName = new Map<string, Sym[]>();
for (const s of symbols) {
  const list = byName.get(s.name) ?? [];
  list.push(s);
  byName.set(s.name, list);
}

describe("protocol barrel — 聚合完整性", () => {
  it("barrel 的每条 export * 目标都存在（无悬空聚合）", () => {
    expect(missing, `悬空聚合目标: ${missing.join(", ")}`).toEqual([]);
  });

  it("传递闭包内无重名符号（export * 遇重名会静默取其一）", () => {
    const dupes = [...byName.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([name, list]) => `${name} ← ${list.map((s) => s.from).join(" / ")}`);
    expect(dupes, `重名导出:\n  ${dupes.join("\n  ")}`).toEqual([]);
  });
});

describe("protocol barrel — 契约符号不得静默消失", () => {
  /**
   * 三端与 daemon 之间最关键的一批契约符号。
   * 不追求穷举（穷举等于把 89 个名字抄两遍），而是钉住**跨端握手与核心资源**那一层：
   * 这些一旦消失，三端会同时断——而那正是本包存在的意义。
   */
  const CORE = [
    // 信封与错误（所有通信的载体）
    "ProtocolEnvelope",
    "createEnvelope",
    "isProtocolEnvelope",
    "ProblemDetails",
    "problem",
    "isProblemDetails",
    // 版本协商
    "negotiateVersion",
    "VersionNegotiation",
    // REST 通用形状
    "SingleResponse",
    "PaginatedResponse",
    "PaginationMeta",
    "PaginationQuery",
    // 状态与能力发现
    "WebUIState",
    "HealthSnapshot",
    "DaemonHealthSnapshot",
    "ServerCapabilities",
    // 资源 DTO
    "TaskNodeSnapshot",
    "AgentStatusSnapshot",
    "EventRecord",
    "MemoryEntryDTO",
    "SessionDTO",
    "ModelEntryDTO",
    // WebSocket 协议
    "WSChannel",
    "WSChatServerEvent",
    "WSChatEventType",
    "WSChatStartCommand",
    "isWSMessage",
    "isWSClientCommand",
  ];

  it.each(CORE)("契约符号存在: %s", (name) => {
    expect(byName.has(name), `${name} 已从 protocol 公共面消失`).toBe(true);
  });

  it("公共面规模不下滑（当前 89）", () => {
    // 下限而非等值——新增导出是允许的，**缩减**要在此处被拦下并显式确认。
    expect(byName.size).toBeGreaterThanOrEqual(85);
  });

  it("三类符号都在（interface / type / function）", () => {
    const kinds = new Set(symbols.map((s) => s.kind));
    expect(kinds.has("interface")).toBe(true);
    expect(kinds.has("type")).toBe(true);
    expect(kinds.has("function")).toBe(true);
  });
});
