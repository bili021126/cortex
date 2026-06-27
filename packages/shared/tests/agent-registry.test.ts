// @ci: unit
// ============================================================
// @cortex/shared — agent-registry 单元测试
// 覆盖：标签/展示/权限注册表的编译期正确性与运行时覆写
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentType,
  TAG_VOCABULARY,
  AGENT_TAGS,
  AGENT_CHINESE_ROLE,
  CHINESE_NAME_TO_TYPE,
  AGENT_DISPLAY,
  AGENT_DISPLAY_BY_TYPE,
  AGENT_DISPLAY_FALLBACK,
  CHAT_AGENT_ALIASES,
  AGENT_TOOL_PERMISSIONS,
  resolveAgentPermissions,
  getAgentTags,
  setAgentTags,
  getAgentToolPermissions,
  setAgentToolPermissions,
  setAgentRegistry,
  buildChineseRoleMap,
  type AgentDefinition,
} from "@cortex/shared";
import { AgentContext } from "@cortex/shared";

describe("agent-registry — TAG_VOCABULARY", () => {
  it("包含核心调度标签", () => {
    expect(TAG_VOCABULARY).toContain("code");
    expect(TAG_VOCABULARY).toContain("review");
    expect(TAG_VOCABULARY).toContain("audit");
    expect(TAG_VOCABULARY).toContain("research");
    expect(TAG_VOCABULARY).toContain("inspect");
    expect(TAG_VOCABULARY).toContain("browser");
    expect(TAG_VOCABULARY).toContain("fix");
  });

  it("零重复", () => {
    const seen = new Set<string>();
    for (const t of TAG_VOCABULARY) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it("所有 AGENT_TAGS 的值均在词汇表内", () => {
    for (const tags of Object.values(AGENT_TAGS)) {
      for (const t of tags) {
        expect(TAG_VOCABULARY).toContain(t);
      }
    }
  });
});

describe("agent-registry — AGENT_TAGS (AgentType-key)", () => {
  it("所有 AgentType 均有标签条目", () => {
    const allTypes = Object.values(AgentType) as AgentType[];
    for (const t of allTypes) {
      expect(AGENT_TAGS[t]).toBeDefined();
    }
  });

  it("Inspector → inspect", () => {
    expect(AGENT_TAGS[AgentType.Inspector]).toContain("inspect");
  });

  it("Browser → browser + ui_verify", () => {
    expect(AGENT_TAGS[AgentType.Browser]).toContain("browser");
    expect(AGENT_TAGS[AgentType.Browser]).toContain("ui_verify");
  });

  it("Fix → fix + bugfix + repair + diagnose + heal", () => {
    expect(AGENT_TAGS[AgentType.Fix]).toContain("fix");
    expect(AGENT_TAGS[AgentType.Fix]).toContain("bugfix");
    expect(AGENT_TAGS[AgentType.Fix]).toContain("repair");
    expect(AGENT_TAGS[AgentType.Fix]).toContain("diagnose");
    expect(AGENT_TAGS[AgentType.Fix]).toContain("heal");
  });

  it("Butler 无标签（纯响应式 Agent）", () => {
    expect(AGENT_TAGS[AgentType.Butler]).toHaveLength(0);
  });
});

describe("agent-registry — AGENT_CHINESE_ROLE / CHINESE_NAME_TO_TYPE", () => {
  it("所有 AgentType 均有中文角色名", () => {
    const allTypes = Object.values(AgentType) as AgentType[];
    for (const t of allTypes) {
      expect(AGENT_CHINESE_ROLE[t]).toBeTruthy();
    }
  });

  it("CHINESE_NAME_TO_TYPE 与 AGENT_CHINESE_ROLE 双向一致", () => {
    for (const [agentType, chineseName] of Object.entries(AGENT_CHINESE_ROLE)) {
      expect(CHINESE_NAME_TO_TYPE[chineseName]).toBe(agentType);
    }
  });

  it("昔涟 → Butler", () => {
    expect(CHINESE_NAME_TO_TYPE["昔涟"]).toBe(AgentType.Butler);
  });

  it("甘雨 → Meta", () => {
    expect(CHINESE_NAME_TO_TYPE["甘雨"]).toBe(AgentType.Meta);
  });

  it("霜凝 → Strategist（双名共用）", () => {
    expect(CHINESE_NAME_TO_TYPE["霜凝"]).toBe(AgentType.Strategist);
  });
});

describe("agent-registry — AGENT_DISPLAY / AGENT_DISPLAY_BY_TYPE", () => {
  it("AGENT_DISPLAY（string-key）包含所有已知类型", () => {
    expect(AGENT_DISPLAY.code).toBeDefined();
    expect(AGENT_DISPLAY.meta).toBeDefined();
    expect(AGENT_DISPLAY["doc-govern"]).toBeDefined();
  });

  it("AGENT_DISPLAY_BY_TYPE 与 AgentType 枚举严格对齐", () => {
    const allTypes = Object.values(AgentType) as AgentType[];
    for (const t of allTypes) {
      expect(AGENT_DISPLAY_BY_TYPE[t]).toBeDefined();
      expect(AGENT_DISPLAY_BY_TYPE[t].emoji).toBeTruthy();
      expect(AGENT_DISPLAY_BY_TYPE[t].name).toBeTruthy();
    }
  });

  it("AGENT_DISPLAY_BY_TYPE 与 AGENT_DISPLAY (string-key) 值一致", () => {
    expect(AGENT_DISPLAY_BY_TYPE[AgentType.Code]).toEqual(AGENT_DISPLAY.code);
    expect(AGENT_DISPLAY_BY_TYPE[AgentType.Review]).toEqual(AGENT_DISPLAY.review);
    expect(AGENT_DISPLAY_BY_TYPE[AgentType.DocGovern]).toEqual(AGENT_DISPLAY["doc-govern"]);
    expect(AGENT_DISPLAY_BY_TYPE[AgentType.Meta]).toEqual(AGENT_DISPLAY.meta);
  });

  it("AGENT_DISPLAY_FALLBACK 存在且不为空", () => {
    expect(AGENT_DISPLAY_FALLBACK.emoji).toBeTruthy();
    expect(AGENT_DISPLAY_FALLBACK.name).toBeTruthy();
  });
});

describe("agent-registry — CHAT_AGENT_ALIASES", () => {
  it("英文别名返回 AgentType 值", () => {
    expect(CHAT_AGENT_ALIASES.code).toBe(AgentType.Code);
    expect(CHAT_AGENT_ALIASES.review).toBe(AgentType.Review);
    expect(CHAT_AGENT_ALIASES.meta).toBe(AgentType.Meta);
    expect(CHAT_AGENT_ALIASES.inspector).toBe(AgentType.Inspector);
  });

  it("中文别名返回 AgentType 值", () => {
    expect(CHAT_AGENT_ALIASES["阿贝多"]).toBe(AgentType.Code);
    expect(CHAT_AGENT_ALIASES["刻晴"]).toBe(AgentType.Review);
    expect(CHAT_AGENT_ALIASES["纳西妲"]).toBe(AgentType.Analysis);
    expect(CHAT_AGENT_ALIASES["昔涟"]).toBe(AgentType.Butler);
  });

  it("inspect / inspector 双路由指向 Inspector", () => {
    expect(CHAT_AGENT_ALIASES.inspect).toBe(AgentType.Inspector);
    expect(CHAT_AGENT_ALIASES.inspector).toBe(AgentType.Inspector);
  });

  it("doc / doc-govern 双路由指向 DocGovern", () => {
    expect(CHAT_AGENT_ALIASES.doc).toBe(AgentType.DocGovern);
    expect(CHAT_AGENT_ALIASES["doc-govern"]).toBe(AgentType.DocGovern);
  });
});

describe("agent-registry — AGENT_TOOL_PERMISSIONS / resolveAgentPermissions", () => {
  it("所有 AgentType 均有权限条目", () => {
    const allTypes = Object.values(AgentType) as AgentType[];
    for (const t of allTypes) {
      expect(AGENT_TOOL_PERMISSIONS[t]).toBeDefined();
    }
  });

  it("Code / Ops / Fix 有 run_shell", () => {
    expect(AGENT_TOOL_PERMISSIONS[AgentType.Code]).toContain("run_shell");
    expect(AGENT_TOOL_PERMISSIONS[AgentType.Ops]).toContain("run_shell");
    expect(AGENT_TOOL_PERMISSIONS[AgentType.Fix]).toContain("run_shell");
  });

  it("Meta 无 run_shell", () => {
    expect(AGENT_TOOL_PERMISSIONS[AgentType.Meta]).not.toContain("run_shell");
  });

  it("Resolver: Review Production → 无 run_shell", () => {
    const perms = resolveAgentPermissions(AgentType.Review, AgentContext.Production);
    expect(perms).not.toContain("run_shell");
  });

  it("Resolver: Review SelfExamination → 无 run_shell（context 忽略，走静态表）", () => {
    const perms = resolveAgentPermissions(AgentType.Review, AgentContext.SelfExamination);
    expect(perms).not.toContain("run_shell");
  });

  it("Resolver: Inspector Production → 无 run_shell", () => {
    const perms = resolveAgentPermissions(AgentType.Inspector, AgentContext.Production);
    expect(perms).not.toContain("run_shell");
  });

  it("Resolver: Inspector PostVerification → 无 run_shell（context 忽略，走静态表）", () => {
    const perms = resolveAgentPermissions(AgentType.Inspector, AgentContext.PostVerification);
    expect(perms).not.toContain("run_shell");
  });

  it("Resolver: 未知 AgentType 返回空数组", () => {
    const perms = resolveAgentPermissions("nonexistent" as AgentType);
    expect(perms).toEqual([]);
  });
});

describe("agent-registry — 运行时覆写", () => {
  beforeEach(() => {
    // 恢复到编译期默认值
    setAgentTags({} as Record<string, readonly string[]>);
    setAgentToolPermissions({} as Record<string, readonly string[]>);
  });

  it("getAgentTags 默认返回编译期 AGENT_TAGS", () => {
    const tags = getAgentTags();
    expect(tags[AgentType.Code]).toContain("code");
  });

  it("setAgentTags 覆写后 getAgentTags 反映变更", () => {
    setAgentTags({ code: ["custom_tag"] });
    const tags = getAgentTags();
    expect(tags.code).toContain("custom_tag");
    // 未覆写的仍保留编译期值
    expect(tags[AgentType.Review]).toContain("review");
  });

  it("setAgentToolPermissions 覆写后 getAgentToolPermissions 反映变更", () => {
    setAgentToolPermissions({ code: ["custom_perm"] });
    const perms = getAgentToolPermissions();
    expect(perms.code).toContain("custom_perm");
    // 未覆写的仍保留编译期值
    expect(perms[AgentType.Review]).toContain("read_file");
  });

  it("setAgentRegistry 同时注入 tags + toolPermissions", () => {
    setAgentRegistry(
      { code: ["registry_tag"] },
      { code: ["registry_perm"] },
    );
    const tags = getAgentTags();
    const perms = getAgentToolPermissions();
    expect(tags.code).toContain("registry_tag");
    expect(perms.code).toContain("registry_perm");
  });
});

describe("agent-registry — buildChineseRoleMap", () => {
  it("从 AgentDisplayEntry 列表构建中文映射", () => {
    const defs = [
      { type: "code", shortName: "阿贝多" },
      { type: "review", shortName: "刻晴" },
    ];
    const { role, nameToType } = buildChineseRoleMap(defs);
    expect(role.code).toBe("阿贝多");
    expect(role.review).toBe("刻晴");
    expect(nameToType["阿贝多"]).toBe("code");
    expect(nameToType["刻晴"]).toBe("review");
  });

  it("中文名冲突时保留第一个映射", () => {
    const defs = [
      { type: "meta", shortName: "甘雨" },
      { type: "backup", shortName: "甘雨" },
    ];
    const { nameToType } = buildChineseRoleMap(defs);
    expect(nameToType["甘雨"]).toBe("meta");
  });
});

describe("agent-registry — 集成：AGENT_DEFS 统一派生", () => {
  // AgentDefinition 类型由 barrel 导出

  it("AGENT_TAGS 与 AGENT_DEFS 值一致", () => {
    for (const agentType of Object.values(AgentType) as AgentType[]) {
      expect(AGENT_TAGS[agentType]).toBeDefined();
      expect(Array.isArray(AGENT_TAGS[agentType])).toBe(true);
    }
  });

  it("AGENT_DISPLAY_BY_TYPE 与 AGENT_DISPLAY (string-key) 完全对齐", () => {
    for (const agentType of Object.values(AgentType) as AgentType[]) {
      const byType = AGENT_DISPLAY_BY_TYPE[agentType];
      const byString = AGENT_DISPLAY[agentType as string];
      expect(byType).toBeDefined();
      expect(byString).toBeDefined();
      if (byType && byString) {
        expect(byType.emoji).toBe(byString.emoji);
        expect(byType.name).toBe(byString.name);
      }
    }
  });

  it("CHAT_AGENT_ALIASES 包含所有 AgentType 的 string-key", () => {
    for (const agentType of Object.values(AgentType) as AgentType[]) {
      expect(CHAT_AGENT_ALIASES[agentType as string]).toBe(agentType);
    }
  });

  it("CHAT_AGENT_ALIASES 包含所有中文名", () => {
    for (const chineseName of Object.values(AGENT_CHINESE_ROLE)) {
      expect(CHAT_AGENT_ALIASES[chineseName]).toBeDefined();
    }
  });

  it("CHINESE_NAME_TO_TYPE 包含所有 AGENT_CHINESE_ROLE 的反向映射", () => {
    for (const [agentType, chineseName] of Object.entries(AGENT_CHINESE_ROLE)) {
      expect(CHINESE_NAME_TO_TYPE[chineseName]).toBe(agentType as AgentType);
    }
  });

  it("AgentType 枚举与 AGENT_DEFS 派生数量一致——无遗漏", () => {
    const enumCount = Object.values(AgentType).filter(v => typeof v === "string").length;
    const tagsCount = Object.keys(AGENT_TAGS).length;
    const chineseRoleCount = Object.keys(AGENT_CHINESE_ROLE).length;
    const displayCount = Object.keys(AGENT_DISPLAY_BY_TYPE).length;
    const permCount = Object.keys(AGENT_TOOL_PERMISSIONS).length;
    expect(tagsCount).toBe(enumCount);
    expect(chineseRoleCount).toBe(enumCount);
    expect(displayCount).toBe(enumCount);
    expect(permCount).toBe(enumCount);
  });

  it("AGENT_TOOL_PERMISSIONS 所有值均为非空数组", () => {
    for (const [agentType, perms] of Object.entries(AGENT_TOOL_PERMISSIONS)) {
      expect(perms.length, `${agentType} 权限为空`).toBeGreaterThan(0);
    }
  });

  it("AGENT_DISPLAY (string-key) 键集合与 AgentType 枚举值一致", () => {
    const enumValues = Object.values(AgentType).filter(v => typeof v === "string") as string[];
    const displayKeys = Object.keys(AGENT_DISPLAY);
    for (const v of enumValues) {
      expect(displayKeys).toContain(v);
    }
    expect(displayKeys.length).toBe(enumValues.length);
  });
});
