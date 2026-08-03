// ============================================================
// Cyrene-Agent RAG 系统 — Worldbook Manager（适配版）
//
// 从 Cyrene-Agent src/main/rag/worldbook.ts 提取。
// 适配：移除 Electron/IPC 依赖。路径改为构造注入。
// ============================================================

import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { WORLDBOOK_CONSTANTS } from "./worldbook-constants.js"

export interface WorldbookEntry {
  id: string
  keywords: string[]
  content: string
  priority: number
  permanent: boolean
  enabled: boolean
  intrinsicValue: number
  linkTriggers: string[]
}

export interface EntryState {
  activation: number
  userSilence: number
  modelSilence: number
}

export type DmaeState = "Active" | "Dormant" | "Archived"

export interface DmaeParams {
  maxScore: number
  promptThreshold: number
  userRewardBase: number
  wakeGamma: number
  modelRewardBase: number
  wakeLambda: number
  decayAlpha: number
  decayBeta: number
}

export const DEFAULT_DMAE_PARAMS: DmaeParams = {
  maxScore: 100,
  promptThreshold: 30,
  userRewardBase: 20,
  wakeGamma: 0.5,
  modelRewardBase: 8,
  wakeLambda: 0.3,
  decayAlpha: 1.5,
  decayBeta: 0.3,
};

export interface RewardContext {
  entry: WorldbookEntry;
  snap: { activation: number; userSilence: number; modelSilence: number };
  params: DmaeParams;
}
export interface DecayContext {
  entry: WorldbookEntry;
  snap: { userSilence: number; modelSilence: number };
  params: DmaeParams;
}

export interface RewardStrategy {
  userReward(ctx: RewardContext): number;
  modelReward(ctx: RewardContext): number;
}

export interface DecayStrategy {
  compute(ctx: DecayContext): number;
}

export class DefaultRewardStrategy implements RewardStrategy {
  userReward(ctx: RewardContext): number {
    const { snap, params } = ctx;
    return params.userRewardBase * (1 + params.wakeGamma * Math.log(1 + snap.userSilence));
  }
  modelReward(ctx: RewardContext): number {
    const { snap, params } = ctx;
    return params.modelRewardBase * Math.exp(-params.wakeLambda * snap.userSilence);
  }
}

export class QuadraticResistanceDecay implements DecayStrategy {
  compute(ctx: DecayContext): number {
    const { entry, snap, params } = ctx;
    const I = Math.max(WORLDBOOK_CONSTANTS.MIN_INTRINSIC_VALUE, entry.intrinsicValue);
    const resistance = 1 / Math.sqrt(I);
    const raw = params.decayAlpha * snap.userSilence * snap.userSilence
              + params.decayBeta * snap.modelSilence * snap.modelSilence;
    return raw * resistance;
  }
}

export function deriveState(activation: number, threshold: number): DmaeState {
  if (activation <= 0) return "Archived";
  if (activation >= threshold) return "Active";
  return "Dormant";
}

export interface WorldbookManagerOptions {
  params?: Partial<DmaeParams>;
  rewardStrategy?: RewardStrategy;
  decayStrategy?: DecayStrategy;
  stateFile?: string;
  debug?: boolean;
}

export class WorldbookManager {
  private entries: WorldbookEntry[] = [];
  private worldbookDir: string;
  private state = new Map<string, EntryState>();
  private lastCascadeEntries: WorldbookEntry[] = [];
  private params: DmaeParams;
  private rewardStrategy: RewardStrategy;
  private decayStrategy: DecayStrategy;
  private stateFile?: string;
  private debug: boolean;

  private static readonly MAX_ACTIVE = WORLDBOOK_CONSTANTS.MAX_ACTIVE;
  private static readonly DEFAULT_INTRINSIC_VALUE = WORLDBOOK_CONSTANTS.DEFAULT_INTRINSIC_VALUE;

  constructor(worldbookDir: string, options?: WorldbookManagerOptions) {
    this.worldbookDir = worldbookDir;
    this.params = { ...DEFAULT_DMAE_PARAMS, ...(options?.params ?? {}) };
    this.rewardStrategy = options?.rewardStrategy ?? new DefaultRewardStrategy();
    this.decayStrategy = options?.decayStrategy ?? new QuadraticResistanceDecay();
    this.stateFile = options?.stateFile;
    this.debug = options?.debug ?? true;
  }

  async loadFromDirectory(): Promise<void> {
    if (!fs.existsSync(this.worldbookDir)) {
      console.warn("[Worldbook] directory not found:", this.worldbookDir);
      return;
    }

    const files = fs.readdirSync(this.worldbookDir).filter((f) => f.endsWith(".md"));
    if (files.length === 0) {
      console.warn("[Worldbook] no .md files found in:", this.worldbookDir);
      return;
    }

    const allEntries: WorldbookEntry[] = [];
    for (const file of files) {
      const filePath = path.join(this.worldbookDir, file);
      const content = fs.readFileSync(filePath, "utf8");
      const entries = this.parseMarkdown(content, file);
      allEntries.push(...entries);
    }

    this.entries = allEntries;
    this.state.clear();
    for (const e of this.entries) {
      if (e.enabled && !e.permanent) this.state.set(e.id, { activation: 0, userSilence: 0, modelSilence: 0 });
    }

    // eslint-disable-next-line no-console
    console.log(`[Worldbook] loaded ${allEntries.length} entries from ${files.length} files`);
  }

  loadFromEntries(entries: WorldbookEntry[]): void {
    this.entries = entries;
    this.state.clear();
    for (const e of this.entries) {
      if (e.enabled && !e.permanent) this.state.set(e.id, { activation: 0, userSilence: 0, modelSilence: 0 });
    }
  }

  private parseMarkdown(content: string, fileName: string): WorldbookEntry[] {
    const entries: WorldbookEntry[] = [];
    const lines = content.split("\n");
    let i = 0;

    while (i < lines.length) {
       
      const line = lines[i]!.trim();
      if (!line.startsWith("## ")) { i++; continue }

      const title = line.replace(/^## /, "").trim();
      i++;

      let keywords: string[] = [];
      let priority = 5;
      let permanent = false;
      let intrinsicValue = WorldbookManager.DEFAULT_INTRINSIC_VALUE;
      let linkTriggers: string[] = [];

      while (i < lines.length) {
         
        const metaLine = lines[i]!.trim();

        if (metaLine.startsWith("- 触发词:") || metaLine.startsWith("- 触发词：")) {
          const val = metaLine.replace(/^-\s*触发词[：:]/, "").trim();
          keywords = val.split(/[,，、]/).map((k) => k.trim()).filter(Boolean);
          i++;
        } else if (metaLine.startsWith("- 常驻:")) {
          const val = metaLine.replace(/^-\s*常驻:/, "").trim();
          permanent = val === "是" || val === "yes" || val === "true";
          i++;
        } else if (metaLine.startsWith("- 优先级:")) {
          const val = metaLine.replace(/^-\s*优先级:/, "").trim();
          priority = parseInt(val) || 5;
          i++;
        } else if (
          metaLine.startsWith("- 初始分:") || metaLine.startsWith("- 初始分：") ||
          metaLine.startsWith("- initial_score:") || metaLine.startsWith("- initial_score：") ||
          metaLine.startsWith("- 内在价值:") || metaLine.startsWith("- 内在价值：") ||
          metaLine.startsWith("- intrinsic_value:") || metaLine.startsWith("- intrinsic_value：")
        ) {
          const val = metaLine.replace(/^-\s*(初始分|initial_score|内在价值|intrinsic_value)[：:]/, "").trim();
          const parsed = parseFloat(val);
          intrinsicValue = Number.isFinite(parsed) ? parsed : WorldbookManager.DEFAULT_INTRINSIC_VALUE;
          i++;
        } else if (metaLine.startsWith("- 连带触发词:") || metaLine.startsWith("- 连带触发词：") ||
                   metaLine.startsWith("- 连带触发:") || metaLine.startsWith("- 连带触发：") ||
                   metaLine.startsWith("- link_triggers:") || metaLine.startsWith("- link_triggers：")) {
          const val = metaLine.replace(/^-\s*(连带触发词|连带触发|link_triggers)[：:]/, "").trim();
          if (val && val !== "无" && val !== "none" && val !== "-") {
            linkTriggers = val.split(/[,，、]/).map((k) => k.trim()).filter(Boolean);
          }
          i++;
        } else if (metaLine.startsWith("---")) { i++; break; }
        else if (metaLine === "" || metaLine.startsWith("# ")) break;
        else if (metaLine.startsWith("- ")) i++;
        else break;
      }

      const contentLines: string[] = [];
      while (i < lines.length) {
        const cl = lines[i];
         
        if (cl!.trim().startsWith("## ") || cl!.trim() === "---") break;
        contentLines.push(cl ?? "");
        i++;
      }

      const entryContent = contentLines.join("\n").trim();
      if (entryContent) {
        // R11-22：稳定 ID——内容哈希（此前从文件名+标题派生——重命名文件/标题静默孤立激活/DMAE 状态）
        const hash = createHash("sha256")
          .update(`${entryContent}|${keywords.join(",")}|${priority ?? ""}|${permanent ? "1" : "0"}`)
          .digest("hex")
          .slice(0, 12)
        entries.push({
          id: `wb_${hash}`,
          keywords, content: entryContent, priority, permanent, enabled: true,
          intrinsicValue, linkTriggers,
        });
      }
    }
    return entries;
  }

  updateActivation(userText: string, modelText: string): void {
    const user = userText ?? "";
    const model = modelText ?? "";
    const params = this.params;
    const max = params.maxScore;
    const changed: Array<{ id: string; aOld: number; aNew: number; reason: string }> = [];

    const userHitEntryIds = new Set<string>();
    for (const entry of this.entries) {
      if (!entry.enabled || entry.permanent) continue;
      if (entry.keywords.length === 0) continue;
      if (entry.keywords.some((kw) => user.includes(kw))) userHitEntryIds.add(entry.id);
    }

    for (const entry of this.entries) {
      if (!entry.enabled || entry.permanent || entry.keywords.length === 0) continue;
      const st = this.state.get(entry.id);
      if (!st) continue;

      const aOld = st.activation;
      const usOld = st.userSilence;
      const msOld = st.modelSilence;
      const userHit = entry.keywords.some((kw) => user.includes(kw));
      const modelHit = entry.keywords.some((kw) => model.includes(kw));
      const usNew = userHit ? 0 : usOld + 1;
      const msNew = (userHit || modelHit) ? 0 : msOld + 1;

      const userReward = userHit
        ? this.rewardStrategy.userReward({ entry, snap: { activation: aOld, userSilence: usOld, modelSilence: msOld }, params })
        : 0;

      const decay = this.decayStrategy.compute({
        entry, snap: { userSilence: usNew, modelSilence: msNew }, params,
      });

      let modelReward = 0;
      if (modelHit && deriveState(aOld, params.promptThreshold) === WORLDBOOK_CONSTANTS.STATES.ACTIVE) {
        const rawRm = this.rewardStrategy.modelReward({ entry, snap: { activation: aOld, userSilence: usOld, modelSilence: msOld }, params });
        modelReward = Math.max(0, Math.min(rawRm, decay - WORLDBOOK_CONSTANTS.EPSILON));
      }

      let aNew = aOld + userReward + modelReward - decay;
      aNew = Math.max(0, aNew);
      if (userHit && deriveState(aOld, params.promptThreshold) === WORLDBOOK_CONSTANTS.FLOOR_TRIGGER_STATE) {
        aNew = Math.max(aNew, entry.intrinsicValue);
      }
      aNew = Math.min(max, aNew);

      st.activation = aNew;
      st.userSilence = usNew;
      st.modelSilence = msNew;

      if (this.debug && (userHit || modelHit || Math.abs(aNew - aOld) >= 0.05)) {
        const reasons: string[] = [];
        if (userHit) reasons.push(`U+${userReward.toFixed(2)}`);
        if (modelHit) reasons.push(`M+${modelReward.toFixed(2)}`);
        if (decay > 0) reasons.push(`D-${decay.toFixed(2)}`);
        if (userHit && deriveState(aOld, params.promptThreshold) === WORLDBOOK_CONSTANTS.FLOOR_TRIGGER_STATE) reasons.push(`floor→${entry.intrinsicValue}`);
        changed.push({ id: entry.id, aOld, aNew, reason: reasons.join(" ") });
      }
    }

    this.lastCascadeEntries = [];
    const cascadeInjected = new Set<string>();
    for (const entry of this.entries) {
      if (!userHitEntryIds.has(entry.id) || entry.linkTriggers.length === 0 || entry.permanent || !entry.enabled) continue;
      const targets = this.entries.filter(e =>
        e.enabled && !e.permanent && e.keywords.some(kw => entry.linkTriggers.includes(kw))
      );
      for (const target of targets) {
        if (userHitEntryIds.has(target.id) || cascadeInjected.has(target.id)) continue;
        cascadeInjected.add(target.id);
        this.lastCascadeEntries.push(target);
      }
    }

    if (this.debug && changed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[Worldbook/DMAE] update: ${changed.length} entries changed`);
      for (const c of changed.slice(0, 12)) {
        // eslint-disable-next-line no-console
        console.log(`  ${c.id}: ${c.aOld.toFixed(1)} → ${c.aNew.toFixed(1)}  (${c.reason})`);
      }
    }
  }

  getCascadeEntries(): WorldbookEntry[] {
    return [...this.lastCascadeEntries];
  }

  getActiveEntries(promptThreshold?: number): string[] {
    const th = promptThreshold ?? this.params.promptThreshold;
    const active = this.entries
      .filter((e) => {
        if (!e.enabled || e.permanent) return false;
        const st = this.state.get(e.id);
        if (!st) return false;
        return deriveState(st.activation, th) === WORLDBOOK_CONSTANTS.STATES.ACTIVE;
      })
      .sort((a, b) => {
        const sa = this.state.get(a.id);
        const sb = this.state.get(b.id);
        const va = sa?.activation ?? 0
        const vb = sb?.activation ?? 0
        if (vb !== va) return vb - va;
        return b.priority - a.priority;
      })
      .slice(0, WorldbookManager.MAX_ACTIVE);
    return active.map((e) => {
      // R12-A2：标题提取兼容新 ID（wb_<hash> 无标题段）——旧格式保留文件名_标题，新格式 fallback 首关键词
      const title = e.id.includes("_", 3)
        ? e.id.replace(/^wb_[^_]+_/, "").replace(/_/g, " ")
        : (e.keywords[0] ?? "世界书");
      return `【${title}】\n${e.content}`;
    });
  }

  getPermanentEntries(): string[] {
    return this.entries
      .filter((e) => e.enabled && e.permanent)
      .sort((a, b) => b.priority - a.priority)
      .map((e) => e.content);
  }

  getAllTriggerWords(): string[] {
    const words = new Set<string>();
    for (const entry of this.entries) {
      for (const kw of entry.keywords) words.add(kw);
    }
    return [...words];
  }

  get entriesCount(): number { return this.entries.length; }
  getEntries(): readonly WorldbookEntry[] { return this.entries; }
  getState(id: string): EntryState | undefined { return this.state.get(id); }
}
