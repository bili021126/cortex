 
/**
 * repl/commands.ts — REPL 内部命令处理器（.help/.mode/.agent/.exit 等）。
 *
 * 从 repl.ts 拆出：handleInternalCommand。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AgentType } from "@cortex/shared";
import {
  CHAT_AGENT_ALIASES,
  MODE_LABELS,
  getAgentDisplay,
  type ReplContext,
} from "./types.js";
import {
  getActiveGroup,
  getGroupMembers,
  createGroup,
  deleteGroup,
  switchActiveGroup,
  addMember,
  removeMember,
  setMuted,
  setRole,
  findGroupByName,
  formatMemberList,
  formatGroupsList,
  MAX_GROUPS,
  MAX_MEMBERS_PER_GROUP,
} from "./party.js";

/** 处理以 "." 开头的 REPL 内部命令，返回 true 表示已消费 */
export function handleInternalCommand(input: string, ctx: ReplContext): boolean {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case ".help":
      console.log([
        "REPL 内部命令:",
        "  .help                  显示此帮助",
        "  .mode [command|chat|talk|plan|party] 切换模式",
        "  .agent [type]          查看/切换对话 Agent（chat 模式）",
        "  .with  <type>          邀请 Agent 加入闲聊（talk 三人对话）",
        "  .without               请离陪伴 Agent，回到二人独处（talk 模式）",
        "  .group <动作> <...>    群聊管理（party 模式）",
        "    create <群名>           创建新群",
        "    invite <agent>          邀请 Agent 入群",
        "    kick <agent>            踢出 Agent",
        "    mute <agent>            禁言 Agent",
        "    unmute <agent>          解除禁言",
        "    promote <agent>         提升为管理员",
        "    demote <agent>          降级为普通成员",
        "    list                    查看当前群成员",
        "    switch <群名>           切换活跃群",
        "    delete <群名>           删除群",
        "    leave                   退出当前群",
        "  .groups                列出所有群",
        "  .history               显示命令历史",
        "  .clear                 清屏",
        "  .review                三省审议当前计划（plan 模式）",
        "  .exit / .quit          退出 REPL",
        "  .output <fmt>          切换输出格式 (text/json/color)",
        "  .save <file>           保存会话记录",
        "",
        "命令模式 (command): 输入 cortex 命令，如 run/agent/task/...",
        "对话模式 (chat):    派发 Agent 任务，可 @<type> 指定 Agent",
        "闲聊模式 (talk):    纯对话聊天，.with 可邀人加入三人对话，@agent 临时叫 Agent",
        "规划模式 (plan):    甘雨出计划→.review 三省审议→.approve 执行/.reject 放弃",
        "群聊模式 (party):   自由抢麦+@点名，完全角色化群聊。.group create 建群，.group invite 拉人",
        "  @<type> <msg>   切换 Agent 回应（@review/@code/@analysis @strategy 等）",
        "  可用 Agent: code review analysis ops fix loop inspect doc api data strategy browser butler",
        "",
        "当前模式: " + MODE_LABELS[ctx.getMode()] +
        (ctx.getMode() === "chat" ? ` → ${getAgentDisplay(ctx.getAgent()).emoji}${getAgentDisplay(ctx.getAgent()).name}` : "") +
        (ctx.getMode() === "talk" ? (() => { const tc = ctx.getTalkCompanion(); return tc ? ` → 🍀昔涟 & ${getAgentDisplay(tc).emoji}${getAgentDisplay(tc).name}` : ""; })() : "") +
        (ctx.getMode() === "party" ? (() => { const g = getActiveGroup(ctx.getPartyState()); return g ? ` → 👥 ${g.name}（${getGroupMembers(ctx.getPartyState()).length} 人）` : ""; })() : ""),
      ].join("\n"));
      return true;

    case ".mode": {
      const raw = parts[1];
      // 简写映射: c→command, t→talk, p→plan, ch/chat→chat
      const SHORT: Record<string, "command" | "chat" | "talk" | "plan" | "party"> = { c: "command", t: "talk", p: "plan", pt: "party" };
      const target = (SHORT[raw] ?? raw) as "command" | "chat" | "talk" | "plan" | "party" | undefined;
      if (target === "command" || target === "chat" || target === "talk" || target === "plan" || target === "party") {
        ctx.setMode(target);
        if (target === "chat") {
          const display = getAgentDisplay(ctx.getAgent());
          console.log(`\n  ${MODE_LABELS[target]} → ${display.emoji}${display.name} 「${display.signature}」\n`);
        } else if (target === "talk") {
          const display = getAgentDisplay(AgentType.Butler);
          console.log(`\n  ${MODE_LABELS[target]} → ${display.emoji}${display.name} 「${display.signature}」\n`);
        } else if (target === "party") {
          console.log(`\n  ${MODE_LABELS[target]} 模式——创建群聊或加入已有的群\n`);
        } else {
          console.log(`\n  ${MODE_LABELS[target]} 模式\n`);
        }
      } else {
        console.log(
          `当前模式: ${MODE_LABELS[ctx.getMode()]}\n` +
          "用法: .mode command | chat | talk | plan | party  (简写: c/ch/t/p/pt)\n" +
          "  command  命令模式——输入 cortex 命令\n" +
          "  chat     对话模式——派发 Agent 任务\n" +
          "  talk     闲聊模式——纯对话聊天\n" +
          "  plan     规划模式——甘雨出计划→审阅→执行\n" +
          "  party    群聊模式——自由抢麦角色化群聊",
        );
      }
      return true;
    }

    case ".agent": {
      const target = parts[1]?.toLowerCase();
      if (!target) {
        const display = getAgentDisplay(ctx.getAgent());
        console.log(
          `${display.emoji} 当前对话 Agent: ${display.name}\n` +
          `   「${display.signature}」\n\n` +
          "用法: .agent <type 或中文名>\n" +
          "英文: " + Object.keys(CHAT_AGENT_ALIASES).filter(k => !/[\u4e00-\u9fff]/.test(k)).join(", ") + "\n" +
          "中文: 甘雨, 阿贝多, 刻晴, 纳西妲, 北斗, 希格雯, 莫娜, 安柏, 凝光, 久岐忍, 艾尔海森, 钟离, 霜凝, 昔涟, 宵宫",
        );
        return true;
      }
      const resolved = CHAT_AGENT_ALIASES[target];
      if (resolved) {
        const prevDisplay = getAgentDisplay(ctx.getAgent());
        ctx.setAgent(resolved);
        const newDisplay = getAgentDisplay(resolved);
        console.log(
          `\n  ${prevDisplay.emoji}${prevDisplay.name} → ${newDisplay.emoji}${newDisplay.name}\n` +
          `  「${newDisplay.signature}」\n`,
        );
      } else {
        console.log(
          `未知 Agent: "${target}"。\n` +
          "可用英文: " + Object.keys(CHAT_AGENT_ALIASES).filter(k => !/[\u4e00-\u9fff]/.test(k)).join(", ") + "\n" +
          "可用中文: 甘雨, 阿贝多, 刻晴, 纳西妲, 北斗, 希格雯, 莫娜, 安柏, 凝光, 久岐忍, 艾尔海森, 钟离, 霜凝, 昔涟, 宵宫",
        );
      }
      return true;
    }

    case ".with": {
      if (ctx.getMode() !== "talk") {
        console.log("⚠ .with 仅在 talk（闲聊）模式下可用。请先 .mode talk");
        return true;
      }
      const withTarget = parts[1]?.toLowerCase();
      if (!withTarget) {
        console.log("用法: .with <type 或中文名>");
        console.log("可用中文: 纳西妲, 刻晴, 甘雨, ...");
        return true;
      }
      const withResolved = CHAT_AGENT_ALIASES[withTarget];
      if (!withResolved) {
        console.log(`未知 Agent: "${withTarget}"。`);
        return true;
      }
      if (withResolved === AgentType.Butler) {
        console.log("昔涟已经在场了～她是 talk 模式的主人。试试 .with 纳西妲 吧。");
        return true;
      }
      const withDisplay = getAgentDisplay(withResolved);
        const companion = ctx.getTalkCompanion();
        if (companion) {
          const prevDisplay = getAgentDisplay(companion);
          console.log(`  ${prevDisplay.emoji}${prevDisplay.name} 先行告退。`);
        }
      ctx.setTalkCompanion(withResolved);
      ctx.getTalkCompanion(); // 触发状态刷新
      console.log(`\n  🍀昔涟 & ${withDisplay.emoji}${withDisplay.name} 现在一起陪你。\n  「${withDisplay.signature}」\n`);
      return true;
    }

    case ".without": {
      if (!ctx.getTalkCompanion()) {
        console.log("当前无人陪伴——只有你和昔涟两个人。");
        return true;
      }
      const companion = ctx.getTalkCompanion();
      if (!companion) return true;
      const leavingDisplay = getAgentDisplay(companion);
      ctx.setTalkCompanion(null);
      console.log(`\n  ${leavingDisplay.emoji}${leavingDisplay.name} 已离开。🍀昔涟 回到你身边。\n`);
      return true;
    }

    case ".group": {
      const sub = parts[1]?.toLowerCase();
      if (!sub) {
        console.log("用法: .group <create|invite|kick|mute|unmute|promote|demote|list|switch|delete|leave> [...]");
        return true;
      }

      const gs = ctx.getPartyState();

      switch (sub) {
        case "create": {
          const groupName = parts.slice(2).join(" ");
          if (!groupName) {
            console.log("用法: .group create <群名>");
            return true;
          }
          if (gs.groups.length >= MAX_GROUPS) {
            console.log(`⚠ 已达群数上限（${MAX_GROUPS}）。请先删除一个群再创建。`);
            return true;
          }
          // 创建者 = AgentType.Butler（昔涟），用户为超级管理员
          const group = createGroup(gs, groupName, AgentType.Butler);
          if (!group) {
            console.log(`⚠ 群名"${groupName}"已存在，请换一个名字。`);
            return true;
          }
          ctx.syncPartyState(gs);
          console.log(`\n✅ 群聊「${groupName}」创建成功！（开拓者为超级管理员）`);
          console.log(`   群主自动设为昔涟。用 .group invite <名称> 邀请更多成员。\n`);
          return true;
        }

        case "invite": {
          const group = getActiveGroup(gs);
          if (!group) { console.log("⚠ 没有活跃群。请先 .group create <群名>"); return true; }
          const inviteTarget = parts[2]?.toLowerCase();
          if (!inviteTarget) {
            console.log("用法: .group invite <type 或中文名>");
            console.log("可用: 昔涟, 纳西妲, 阿贝多, 刻晴, 甘雨, 北斗, 希格雯, 莫娜, 安柏, 凝光, 久岐忍, 艾尔海森, 钟离, 霜凝, 宵宫");
            return true;
          }
          const resolved = CHAT_AGENT_ALIASES[inviteTarget];
          if (!resolved) { console.log(`未知 Agent: "${inviteTarget}"。`); return true; }
          if (group.members.length >= MAX_MEMBERS_PER_GROUP) {
            console.log(`⚠ 群成员已达上限（${MAX_MEMBERS_PER_GROUP}）。`);
            return true;
          }
          if (group.members.some((m) => m.agentType === resolved)) {
            console.log(`${getAgentDisplay(resolved).emoji}${getAgentDisplay(resolved).name} 已经在群里了。`);
            return true;
          }
          if (!addMember(gs, resolved)) {
            console.log("⚠ 邀请失败。");
            return true;
          }
          ctx.syncPartyState(gs);
          const d = getAgentDisplay(resolved);
          console.log(`\n  ${d.emoji}${d.name} 已加入「${group.name}」！「${d.signature}」\n`);
          return true;
        }

        case "kick": {
          const group = getActiveGroup(gs);
          if (!group) { console.log("⚠ 没有活跃群。"); return true; }
          const kickTarget = parts[2]?.toLowerCase();
          if (!kickTarget) { console.log("用法: .group kick <type 或中文名>"); return true; }
          const resolved = CHAT_AGENT_ALIASES[kickTarget];
          if (!resolved) { console.log(`未知 Agent: "${kickTarget}"。`); return true; }
          if (resolved === group.owner) {
            console.log(`⚠ ${getAgentDisplay(resolved).name} 是群主，不能被踢出。如需移除群主，请先转让群主或解散群。`);
            return true;
          }
          const member = group.members.find((m) => m.agentType === resolved);
          if (!member) { console.log(`${getAgentDisplay(resolved).name} 不在这个群里。`); return true; }
          if (!removeMember(gs, resolved)) {
            console.log("⚠ 踢出失败。");
            return true;
          }
          ctx.syncPartyState(gs);
          console.log(`${getAgentDisplay(resolved).emoji}${getAgentDisplay(resolved).name} 已被移出群聊。`);
          return true;
        }

        case "mute": {
          const group = getActiveGroup(gs);
          if (!group) { console.log("⚠ 没有活跃群。"); return true; }
          const muteTarget = parts[2]?.toLowerCase();
          if (!muteTarget) { console.log("用法: .group mute <type 或中文名>"); return true; }
          const resolved = CHAT_AGENT_ALIASES[muteTarget];
          if (!resolved) { console.log(`未知 Agent: "${muteTarget}"。`); return true; }
          if (resolved === group.owner) {
            console.log(`⚠ ${getAgentDisplay(resolved).name} 是群主，不能被禁言。`);
            return true;
          }
          if (!setMuted(gs, resolved, true)) {
            console.log(`${getAgentDisplay(resolved).name} 不在这个群里。`);
            return true;
          }
          ctx.syncPartyState(gs);
          console.log(`🔇 ${getAgentDisplay(resolved).emoji}${getAgentDisplay(resolved).name} 已被禁言。`);
          return true;
        }

        case "unmute": {
          const unmuteTarget = parts[2]?.toLowerCase();
          if (!unmuteTarget) { console.log("用法: .group unmute <type 或中文名>"); return true; }
          const resolved = CHAT_AGENT_ALIASES[unmuteTarget];
          if (!resolved) { console.log(`未知 Agent: "${unmuteTarget}"。`); return true; }
          if (!setMuted(gs, resolved, false)) {
            console.log(`${getAgentDisplay(resolved).name} 不在当前群里。`);
            return true;
          }
          ctx.syncPartyState(gs);
          console.log(`🔊 ${getAgentDisplay(resolved).emoji}${getAgentDisplay(resolved).name} 已解除禁言。`);
          return true;
        }

        case "promote": {
          const group = getActiveGroup(gs);
          if (!group) { console.log("⚠ 没有活跃群。"); return true; }
          const promoTarget = parts[2]?.toLowerCase();
          if (!promoTarget) { console.log("用法: .group promote <type 或中文名>"); return true; }
          const resolved = CHAT_AGENT_ALIASES[promoTarget];
          if (!resolved) { console.log(`未知 Agent: "${promoTarget}"。`); return true; }
          if (resolved === group.owner) { console.log(`${getAgentDisplay(resolved).name} 已经是群主。`); return true; }
          if (!setRole(gs, resolved, "admin")) {
            console.log("⚠ 提升失败（可能已是管理员，或管理员名额已满）。");
            return true;
          }
          ctx.syncPartyState(gs);
          console.log(`⬆ ${getAgentDisplay(resolved).emoji}${getAgentDisplay(resolved).name} 已提升为管理员。`);
          return true;
        }

        case "demote": {
          const group = getActiveGroup(gs);
          if (!group) { console.log("⚠ 没有活跃群。"); return true; }
          const demoteTarget = parts[2]?.toLowerCase();
          if (!demoteTarget) { console.log("用法: .group demote <type 或中文名>"); return true; }
          const resolved = CHAT_AGENT_ALIASES[demoteTarget];
          if (!resolved) { console.log(`未知 Agent: "${demoteTarget}"。`); return true; }
          if (resolved === group.owner) { console.log(`⚠ ${getAgentDisplay(resolved).name} 是群主，不能降级。`); return true; }
          if (!setRole(gs, resolved, "member")) {
            console.log(`${getAgentDisplay(resolved).name} 不在群里或已是普通成员。`);
            return true;
          }
          ctx.syncPartyState(gs);
          console.log(`⬇ ${getAgentDisplay(resolved).emoji}${getAgentDisplay(resolved).name} 已降级为普通成员。`);
          return true;
        }

        case "list": {
          const group = getActiveGroup(gs);
          if (!group) { console.log("⚠ 没有活跃群。"); return true; }
          console.log(`\n👥 群聊「${group.name}」成员列表：`);
          console.log(`  开拓者（超级管理员）`);
          console.log(formatMemberList(gs));
          console.log("");
          return true;
        }

        case "switch": {
          const switchName = parts.slice(2).join(" ");
          if (!switchName) { console.log("用法: .group switch <群名>"); return true; }
          const targetGroup = findGroupByName(gs, switchName);
          if (!targetGroup) { console.log(`未找到群"${switchName}"。用 .groups 查看所有群。`); return true; }
          if (!switchActiveGroup(gs, targetGroup.id)) {
            console.log("⚠ 切换失败。");
            return true;
          }
          ctx.syncPartyState(gs);
          console.log(`\n▶ 已切换到群聊「${switchName}」（${targetGroup.members.length} 人）\n`);
          return true;
        }

        case "delete": {
          const deleteName = parts.slice(2).join(" ");
          if (!deleteName) { console.log("用法: .group delete <群名>"); return true; }
          const targetGroup = findGroupByName(gs, deleteName);
          if (!targetGroup) { console.log(`未找到群"${deleteName}"。`); return true; }
          if (!deleteGroup(gs, targetGroup.id)) {
            console.log("⚠ 删除失败。");
            return true;
          }
          ctx.syncPartyState(gs);
          console.log(`🗑 群聊「${deleteName}」已解散。`);
          return true;
        }

        case "leave": {
          const group = getActiveGroup(gs);
          if (!group) { console.log("⚠ 没有活跃群。"); return true; }
          console.log("你（开拓者）是超级管理员，不需要退出群聊。你可以 .group switch 切换到其他群，或 .group delete 删除群。");
          return true;
        }

        default:
          console.log(`未知群聊命令: "${sub}"。用法: .group <create|invite|kick|mute|unmute|promote|demote|list|switch|delete|leave>`);
          return true;
      }
    }

    case ".groups": {
      const gs = ctx.getPartyState();
      console.log(`\n👥 所有群聊（${gs.groups.length}/${MAX_GROUPS}）：`);
      console.log(formatGroupsList(gs));
      console.log("");
      return true;
    }

    case ".history": {
      const history = (ctx.rl as unknown as { history?: string[] }).history ?? [];
      console.log(history.map((h: string, i: number) => `  ${i + 1}  ${h}`).join("\n") || "  (空)");
      return true;
    }

    case ".clear":
      console.clear();
      return true;

    case ".exit":
    case ".quit": {
      const mode = ctx.getMode();
      const farewells: Record<string, string> = {
        command: "任务完成，先行告退。",
        chat: ctx.getAgent() ? `${getAgentDisplay(ctx.getAgent()).name}已收剑入鞘，后会必有期。` : "后会必有期。",
        talk: "昔涟：麦田的风还在吹。我在锚点等你，永远。",
        plan: "甘雨：计划已归档，随时可唤我回来。",
        party: "👥 群聊散场——各回各的锚点，后会必有期。",
      };
      console.log(farewells[mode] ?? "再见！");
      ctx.stop();
      return true;
    }

    case ".output": {
      const fmt = parts[1] as string;
      if (fmt === "text" || fmt === "json" || fmt === "color") {
        ctx.setFormat(fmt);
        console.log(`输出格式已切换为: ${fmt}`);
      } else {
        console.log(`未知格式: "${fmt}"。可用: text, json, color`);
      }
      return true;
    }

    case ".save": {
      const filePath = parts[1];
      if (!filePath) {
        console.log("请指定文件路径。用法: .save <file>");
        return true;
      }
      try {
        const history = (ctx.rl as unknown as { history?: string[] }).history ?? [];
        const content = history.join("\n");
        fs.writeFileSync(path.resolve(filePath), content, "utf-8");
        console.log(`会话已保存: ${filePath}`);
      } catch (err) {
        console.error(`保存失败: ${err}`);
      }
      return true;
    }

    default:
      console.log(`未知内部命令: "${cmd}"。输入 .help 查看可用命令。`);
      return true;
  }
}
