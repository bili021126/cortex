// ============================================================
// Cyrene-Agent 记忆系统 — 简易实体关系图谱（适配版）
//
// 从 Cyrene-Agent src/main/memory/entity-graph.ts 提取。
// 适配：移除 Electron/IPC 依赖。路径改为构造注入。
// 移除 jieba 依赖（Cortex 用不同的分词方案）。
// ============================================================

import * as fs from "fs"
import * as path from "path"

// ── 类型 ──

export interface EntityNode {
  id: string
  name: string
  type: "person" | "place" | "concept" | "preference" | "organization"
  aliases: string[]
  mentionCount: number
  firstMentionedAt: number
  lastMentionedAt: number
}

export interface EntityRelation {
  id: string
  sourceId: string
  targetId: string
  relation: string
  confidence: number
  strength: number
}

interface EntityGraphData {
  entities: EntityNode[]
  relations: EntityRelation[]
}

// ── 简单解析器（不依赖 LLM，用正则启发式提取） ──

const ENTITY_PATTERNS: Array<{ type: EntityNode["type"]; patterns: RegExp[] }> = [
  {
    type: "person",
    patterns: [
      /我的朋友(.{1,6})/g,
      /我认识(.{1,6})/g,
      /同事(.{1,6})/g,
      /叫(.{1,4})(?:的人|的朋友|的同事|的老板)/g,
      /有.{0,4}朋友.{0,4}(.{1,6})/g,
      /(.{1,4})是我的朋友/g,
    ],
  },
  {
    type: "place",
    patterns: [
      /住在(.{1,10})/g,
      /在(.{1,10})(?:工作|学习|生活|住|上班|上学)/g,
      /去了(.{1,10})/g,
      /在(.{1,10})出差/g,
    ],
  },
  {
    type: "organization",
    patterns: [
      /在(.{1,10})(?:公司|单位|工作室|团队|学校|大学|学院)/g,
      /(.{1,10})公司/g,
    ],
  },
  {
    type: "preference",
    patterns: [
      /喜欢(.{1,10})(?:的东西|的活动|的食物|的音乐|的运动|的游戏|的动画|的漫画)/g,
      /最爱(.{1,10})/g,
      /讨厌(.{1,10})(?:的东西|的事情)/g,
    ],
  },
]

/** 从文本中启发式提取实体名，返回 [type, name] 列表 */
export function extractEntitiesFromText(text: string): Array<{ type: EntityNode["type"]; name: string }> {
  const results: Array<{ type: EntityNode["type"]; name: string }> = []
  const seen = new Set<string>()

  for (const { type, patterns } of ENTITY_PATTERNS) {
    for (const regex of patterns) {
      const matches = text.matchAll(regex)
      for (const m of matches) {
        const name = m[1]?.trim()
        if (name && name.length >= 2 && name.length <= 10 && !seen.has(`${type}:${name}`)) {
          seen.add(`${type}:${name}`)
          results.push({ type, name })
        }
      }
    }
  }

  return results
}

// ── 实体图谱管理器 ──

export class EntityGraph {
  private dataDir: string
  private cache: EntityGraphData | null = null

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? path.join(process.cwd(), "data")
  }

  private getPath(): string {
    return path.join(this.dataDir, "entity-graph.json")
  }

  load(): EntityGraphData {
    if (this.cache) return this.cache
    const filePath = this.getPath()
    if (!fs.existsSync(filePath)) {
      this.cache = { entities: [], relations: [] }
      return this.cache
    }
    try {
      const raw = fs.readFileSync(filePath, "utf8")
      const parsed = JSON.parse(raw) as EntityGraphData
      // 结构校验：防损坏文件被当作合法空图谱
      if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.relations)) {
        throw new Error("invalid entity-graph shape")
      }
      this.cache = parsed
    } catch (err) {
      // P2: 损坏时备份 .corrupt 并告警，不静默清空
      try {
        const corruptPath = filePath + ".corrupt"
        fs.copyFileSync(filePath, corruptPath)
        console.error(`[EntityGraph] 图谱文件损坏，已备份到 ${corruptPath}`, err)
      } catch {
        console.error(`[EntityGraph] 图谱文件损坏且备份失败: ${err instanceof Error ? err.message : String(err)}`)
      }
      this.cache = { entities: [], relations: [] }
    }
    return this.cache
  }

  save(): void {
    if (!this.cache) return
    const filePath = this.getPath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // P2: tmp + rename 原子写，防止写一半崩溃损坏图谱文件
    const tmpPath = filePath + ".tmp"
    fs.writeFileSync(tmpPath, JSON.stringify(this.cache, null, 2), "utf8")
    fs.renameSync(tmpPath, filePath)
  }

  /** 从一条对话文本中提取实体并入库 */
  ingest(text: string): void {
    const data = this.load()
    const extracted = extractEntitiesFromText(text)
    const now = Date.now()

    for (const { type, name } of extracted) {
      const existing = data.entities.find(
        (e) => e.name === name || e.aliases.includes(name),
      )
      if (existing) {
        existing.mentionCount++
        existing.lastMentionedAt = now
      } else {
        data.entities.push({
          id: `ent_${now}_${Math.random().toString(36).slice(2, 8)}`,
          name,
          type,
          aliases: [],
          mentionCount: 1,
          firstMentionedAt: now,
          lastMentionedAt: now,
        })
      }
    }

    if (extracted.length > 0) this.save()
  }

  /** 搜索与 query 相关的实体和关系，返回可读文本 */
  search(query: string): string {
    const data = this.load()
    if (data.entities.length === 0) return ""

    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const matchedEntities = data.entities.filter((e) =>
      queryTokens.some((t) => e.name.includes(t) || e.aliases.some((a) => a.includes(t))),
    )

    if (matchedEntities.length === 0) return ""

    const lines: string[] = []
    for (const entity of matchedEntities) {
      const mentions = entity.mentionCount > 1 ? `（提及${entity.mentionCount}次）` : ""
      lines.push(`· ${entity.name}（${typeLabel(entity.type)}）${mentions}`)

      const outgoing = data.relations.filter((r) => r.sourceId === entity.id)
      for (const rel of outgoing) {
        const target = data.entities.find((e) => e.id === rel.targetId)
        if (target) lines.push(`  → ${rel.relation} ${target.name}`)
      }

      const incoming = data.relations.filter((r) => r.targetId === entity.id)
      for (const rel of incoming) {
        const source = data.entities.find((e) => e.id === rel.sourceId)
        if (source) lines.push(`  ← ${source.name} ${rel.relation}`)
      }
    }

    return lines.length > 0 ? lines.join("\n") : ""
  }

  /** 清空图谱 */
  reset(): void {
    this.cache = { entities: [], relations: [] }
    this.save()
  }
}

function typeLabel(type: EntityNode["type"]): string {
  switch (type) {
    case "person": return "人物"
    case "place": return "地点"
    case "organization": return "组织"
    case "preference": return "偏好"
    case "concept": return "概念"
  }
}

export const entityGraph = new EntityGraph()
