export class CapabilityRegistry {
    /** 按 AgentType 索引 */
    byType = new Map();
    /** 按标签索引 */
    byTag = new Map();
    /** 按产出索引 */
    byProduces = new Map();
    // ── 注册 ─────────────────────────────────────
    /** 注册一个 Agent 的自声明（幂等——同类型重复注册会先清理旧索引） */
    register(cap) {
        // 先清理旧索引
        const old = this.byType.get(cap.type);
        if (old) {
            for (const tag of old.tags) {
                const list = (this.byTag.get(tag) ?? []).filter((c) => c.type !== cap.type);
                if (list.length > 0)
                    this.byTag.set(tag, list);
                else
                    this.byTag.delete(tag);
            }
            for (const p of old.produces) {
                const list = (this.byProduces.get(p) ?? []).filter((c) => c.type !== cap.type);
                if (list.length > 0)
                    this.byProduces.set(p, list);
                else
                    this.byProduces.delete(p);
            }
        }
        // 写入新条目
        this.byType.set(cap.type, cap);
        for (const tag of cap.tags) {
            const list = this.byTag.get(tag) ?? [];
            list.push(cap);
            this.byTag.set(tag, list);
        }
        for (const p of cap.produces) {
            const list = this.byProduces.get(p) ?? [];
            list.push(cap);
            this.byProduces.set(p, list);
        }
    }
    /** 批量注册 */
    registerAll(caps) {
        for (const c of caps)
            this.register(c);
    }
    // ── 查询 ─────────────────────────────────────
    /** 获取所有已注册能力 */
    getAll() {
        return [...this.byType.values()];
    }
    /** 按类型精确查询 */
    getByType(type) {
        return this.byType.get(type);
    }
    /** 按标签匹配——返回匹配的 Agent 能力列表 */
    queryByTags(tags) {
        const matched = new Map();
        for (const tag of tags) {
            const caps = this.byTag.get(tag);
            if (caps) {
                for (const c of caps)
                    matched.set(c.type, c);
            }
        }
        return [...matched.values()];
    }
    /** 按产出类型查询 */
    queryByProduces(produces) {
        const matched = new Map();
        for (const p of produces) {
            const caps = this.byProduces.get(p);
            if (caps) {
                for (const c of caps)
                    matched.set(c.type, c);
            }
        }
        return [...matched.values()];
    }
    /** 按协作模式筛选 */
    filterByCollaboration(mode) {
        return this.getAll().filter((c) => c.collaborationMode === mode);
    }
    /** 输出格式筛选 */
    filterByOutputFormat(format) {
        return this.getAll().filter((c) => c.outputFormat === format);
    }
    // ── 自组装 ───────────────────────────────────
    /**
     * 根据任务需求自动组装 Agent 团队。
     *
     * @param requiredTags 任务需要的标签
     * @param includes 强制包含的 AgentType
     * @returns 组装好的 Agent 能力列表
     */
    assembleTeam(requiredTags, includes) {
        const team = new Map();
        // 强制包含
        if (includes) {
            for (const t of includes) {
                const cap = this.byType.get(t);
                if (cap)
                    team.set(t, cap);
            }
        }
        // 按标签匹配
        for (const tag of requiredTags) {
            const caps = this.byTag.get(tag);
            if (caps) {
                for (const c of caps) {
                    if (!team.has(c.type))
                        team.set(c.type, c);
                }
            }
        }
        // 如果没有 reviewer，自动补一个（按标签匹配最相关的）
        if (![...team.values()].some((c) => c.collaborationMode === "reviewer")) {
            const reviewers = this.filterByCollaboration("reviewer");
            if (reviewers.length > 0) {
                // 按与 requiredTags 的重叠度选择最匹配的 reviewer
                let best = reviewers[0];
                let bestScore = 0;
                for (const r of reviewers) {
                    const overlap = r.tags.filter((t) => requiredTags.includes(t)).length;
                    if (overlap > bestScore) {
                        bestScore = overlap;
                        best = r;
                    }
                }
                if (!team.has(best.type))
                    team.set(best.type, best);
            }
        }
        return [...team.values()];
    }
    /** 生成人类可读的能力清单（供 MetaAgent prompt 注入） */
    toPromptDescription() {
        const lines = ["## 可用 Agent 能力清单\n"];
        for (const cap of this.byType.values()) {
            lines.push(`- ${cap.emoji} **${cap.role}** (${cap.type})` +
                ` | 标签: ${cap.tags.join(", ")}` +
                ` | 输出: ${cap.outputFormat}` +
                ` | 场景: ${cap.applicableScenarios.join("; ")}`);
        }
        return lines.join("\n");
    }
}
/** 全局单例 */
export const capabilityRegistry = new CapabilityRegistry();
//# sourceMappingURL=capability-registry.js.map