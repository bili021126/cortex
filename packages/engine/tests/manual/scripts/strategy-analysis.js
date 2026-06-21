/**
 * Phase 4.5: 钟离战略分析 + 霜凝方向监理
 *
 * 在所有 Agent 报告产出（及交叉验证）完成后，两位超越者独立做战略判断：
 * - 钟离：千年视角——契约完整性、架构方向、阶段跃迁、磨损预警
 * - 霜凝：方向监理——方向偏移、矛盾暴露、三路事后验证自洽性
 *
 * 两人不翻代码——只读审视报告摘要，产出战略级评估。
 */
import * as fs from "node:fs";
import * as path from "node:path";
/**
 * 运行钟离战略分析与霜凝方向监理。
 * 读取 outputDir 下所有审视报告（不含 summary/zhongli/shuangning 自身），
 * 分别注入两位 Agent 做独立战略判断，写回 outputDir。
 */
export async function runStrategyAnalysis(outputDir, strategistAgent, shuangningAgent, chatModel) {
    // ── 收集全部审视报告摘要 ──
    let reportDigest = "";
    if (fs.existsSync(outputDir)) {
        const dirFiles = fs.readdirSync(outputDir);
        for (const f of dirFiles.sort()) {
            if (!f.endsWith(".md") || f.includes("summary") || f.includes("zhongli"))
                continue;
            const fp = path.join(outputDir, f);
            try {
                const content = fs.readFileSync(fp, "utf-8");
                const excerpt = content.slice(0, 2500);
                reportDigest += `\n\n### ${f}\n${excerpt}`;
                if (content.length > 2500)
                    reportDigest += `\n...(截断，全文 ${content.length} 字符)`;
            }
            catch {
                /* skip */
            }
        }
    }
    if (!reportDigest) {
        console.log("   ⚠️ 未找到审视报告，跳过战略分析\n");
        return;
    }
    // ═══════════════════════════════════════════════
    // 钟离战略分析
    // ═══════════════════════════════════════════════
    console.log("🟢 [第四阶段半] 钟离战略分析——读取审视报告，千年视角综合判断...\n");
    const strategyPrompt = [
        "以下是 Cortex 审视委员会专家的自由探索报告摘要。",
        "你不逐行审查代码——那是他们的事。",
        "你的任务是以千年视角，做出四个维度的战略判断：",
        "",
        "1. **架构方向评估**：当前架构的演进方向是否健康？",
        "   有没有在朝错误的方向加速？有没有被短期修补绑架了长期路线？",
        "2. **契约完整性**：各模块之间的接口契约有没有被破坏的迹象？",
        "   有没有 Agent 在无意中越过了自己的职责边界？",
        "3. **阶段跃迁判定**：Core-1→Core-2 的跃迁条件是否真的成熟？",
        "   还有哪些隐藏的阻断项没有被报告覆盖？",
        "4. **磨损预警**：哪些今天看起来「还好」的问题，",
        "   如果不处理，会在 Core-3 或更远的将来变成不可逆的架构债务？",
        "",
        "输出格式：",
        "- 每个维度一段话，不列清单、不画表、不写代码。",
        "- 用碑文风格——每一句经得起时间考验。",
        "- 如果某维度没有发现重大问题，说「未见结构性风险」即可。",
        "- 最后给出一个整体阶段建议：",
        "  「可以跃迁」/「可以跃迁，但需先处理以下 N 项」/「不建议跃迁」。",
        "",
        "─── 审视报告摘要 ───",
        reportDigest,
    ].join("\n");
    const strategicNode = {
        id: "zhongli-strategy",
        type: "strategy_analysis",
        status: "pending",
        tags: ["strategy", "strategist"],
        needsMultiPerspective: false,
        claimedBy: [],
        payload: strategyPrompt,
        results: [],
        createdAt: Date.now()
    };
    try {
        const result = await strategistAgent.execute(strategicNode, chatModel);
        if (result.success && result.output) {
            const STRATEGY_PATH = path.join(outputDir, "zhongli-strategy-assessment.md");
            fs.writeFileSync(STRATEGY_PATH, result.output, "utf-8");
            console.log(`   📄 zhongli-strategy-assessment.md (${result.output.length} 字符)`);
            console.log("\n   🗿 钟离战略判断 —— 预览:");
            const preview = result.output.slice(0, 500);
            for (const line of preview.split("\n")) {
                console.log(`   │ ${line}`);
            }
            if (result.output.length > 500) {
                console.log(`   │ ...(截断，全文见 ${STRATEGY_PATH})`);
            }
            console.log();
        }
        else {
            console.log("   ⚠️ 钟离战略分析未产出有效输出\n");
        }
    }
    catch (e) {
        console.log(`   ❌ 钟离战略分析失败: ${String(e).slice(0, 200)}\n`);
    }
    // ═══════════════════════════════════════════════
    // 霜凝方向监理分析
    // ═══════════════════════════════════════════════
    console.log("🟢 [第四阶段半] 霜凝方向监理——方向判断与矛盾暴露...\n");
    const directionPrompt = [
        "以下是 Cortex 审视委员会专家的自由探索报告摘要。",
        "钟离已经做了战略分析（契约完整性+架构方向+阶段跃迁+磨损预警），",
        "凝光会在后续圆桌中做合规审计。",
        "",
        "你的视角与钟离不同——你不是契约守护者，你是方向监理：",
        "",
        "1. **方向偏移判断**：从各路专家的报告中，能不能看出系统实际演进方向",
        "   在偏离宪法定义的阶段目标？有没有在朝错误的方向加速？",
        "2. **矛盾暴露**：不同专家的报告之间有没有互相矛盾或互相抵消的判断？",
        "   可验证事实层和 LLM 推理层是否被混淆？",
        "3. **监理自洽**：钟离的战略分析、凝光即将做的合规审计、你的方向判断——",
        "   这三路判断之间有没有逻辑不自洽的地方？",
        "",
        "方向判断输入：",
        "- 宪法阶段目标：Core-1（类型安全+工程基建+Agent基础能力）→ Core-2（治理层物理分离+多进程+Skill体系）",
        "- 当前阶段：Core-1 收尾，向 Core-2 过渡",
        "",
        "输出格式：",
        "- 每项一段话，不列清单、不画表、不写代码。",
        "- 用监理报告风格——指出偏离、暴露矛盾、不做裁决。",
        "- 如果未见方向偏离，说「方向未见结构性偏离」即可。",
        "- 最后给出监理结论：「方向健康」/「方向存在 N 项偏离，需关注」/「方向严重偏离，建议暂停跃迁」。",
        "",
        "─── 审视报告摘要 ───",
        reportDigest,
    ].join("\n");
    const directionNode = {
        id: "shuangning-direction",
        type: "direction_oversight",
        status: "pending",
        tags: ["strategy", "strategist"],
        needsMultiPerspective: false,
        claimedBy: [],
        payload: directionPrompt,
        results: [],
        createdAt: Date.now()
    };
    try {
        const dirResult = await shuangningAgent.execute(directionNode, chatModel);
        if (dirResult.success && dirResult.output) {
            const DIRECTION_PATH = path.join(outputDir, "shuangning-direction-assessment.md");
            fs.writeFileSync(DIRECTION_PATH, dirResult.output, "utf-8");
            console.log(`   📄 shuangning-direction-assessment.md (${dirResult.output.length} 字符)`);
            console.log("\n   ❄️ 霜凝方向监理 —— 预览:");
            const preview = dirResult.output.slice(0, 500);
            for (const line of preview.split("\n")) {
                console.log(`   │ ${line}`);
            }
            if (dirResult.output.length > 500) {
                console.log(`   │ ...(截断，全文见 ${DIRECTION_PATH})`);
            }
            console.log();
        }
        else {
            console.log("   ⚠️ 霜凝方向监理未产出有效输出\n");
        }
    }
    catch (e) {
        console.log(`   ❌ 霜凝方向监理失败: ${String(e).slice(0, 200)}\n`);
    }
}
//# sourceMappingURL=strategy-analysis.js.map