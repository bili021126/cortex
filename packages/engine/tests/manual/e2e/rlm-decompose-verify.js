/**
 * RLM decompose 真实 LLM 验证
 *
 * 用法: npx tsx tests/manual/e2e/rlm-decompose-verify.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证内容:
 *   1. 复杂任务拆解——payload > 200 字的任务能否被正确拆解为原子子任务
 *   2. 简单任务回退——简短任务是否正确地回退到直接执行
 *   3. 密度标注——子任务是否自标注了合理的 density 级别
 *   4. 信心评分——LLM 是否给出了合理的 confidence
 *   5. depends_on 依赖——子任务间的依赖关系是否合理
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { LlmAdapter } from "@cortex/llm";
import { decompose, shouldDecompose, shouldExecuteDecomposition, } from "@cortex/engine";
import { resolveLlmConfig } from "../config/llm-defaults";
// ═══════════════════════════════════════════════
// 1. 环境变量
// ═══════════════════════════════════════════════
function loadEnv() {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) {
        console.error("❌ .env 文件不存在");
        process.exit(1);
    }
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
        const clean = line.replace(/\r$/, "");
        const m = clean.match(/^([^=]+)=(.*)$/);
        if (m)
            process.env[m[1]] = m[2].trim();
    }
}
const TEST_CASES = [
    {
        name: "复杂任务：多文件重构",
        expectDecompose: true,
        payload: [
            "请对 packages/engine/src/core/ 目录下的调度系统进行模块化重构：",
            "",
            "1. 将 scheduler.ts（当前 500+ 行）拆分为以下子模块：",
            "   - dispatch-engine.ts（核心分发循环）",
            "   - layer-executor.ts（拓扑分层执行）",
            "   - node-dispatcher.ts（单节点管线调度）",
            "2. 每个子模块必须有清晰的接口边界，通过 IStep 模式对外暴露",
            "3. 更新所有 imports 和 barrel 导出",
            "4. 确保所有现有测试（system-stress.test.ts, memory-store.test.ts 等）仍然通过",
            "5. 遵守 coding-standards.md：禁止空 catch {}、禁止 var、禁止裸 console.error",
            "6. 写迁移说明文档 docs/analysis/scheduler-refactor.md",
        ].join("\n"),
    },
    {
        name: "复杂任务：安全审计",
        expectDecompose: true,
        tags: ["analysis"],
        payload: [
            "对 packages/engine/src/platform/ 目录做安全审计：",
            "",
            "1. 检查所有 run_shell 调用点，确认危险命令拦截是否完整",
            "2. 审计 write_file 的路径越界保护（是否所有代码路径都有 resolveSafePath 校验）",
            "3. 检查 read_file 是否有路径遍历漏洞（../../../etc/passwd）",
            "4. 审计所有环境变量读取——是否有未过滤直接拼接到命令中的情况",
            "5. 出具安全审计报告，列出所有发现，按严重程度分级",
        ].join("\n"),
    },
    {
        name: "复杂任务：端到端测试编写",
        expectDecompose: true,
        payload: [
            "为 RLM 递归拆解系统编写端到端测试：",
            "",
            "1. 测试 decompose() 对各类任务的拆解质量",
            "2. 测试 maxDepth=3 自限机制——第 4 层递归应被拒绝",
            "3. 测试低信心回退——confidence < 0.6 时应走直接执行路径",
            "4. 测试 DENSITY 压缩——验证 light/medium/heavy 三级的压缩效果",
            "5. 测试子任务分层——验证 depends_on 关系的拓扑排序正确性",
            "6. 所有测试文件首行加 // @ci: unit 标注",
        ].join("\n"),
    },
    {
        name: "简单任务：修一个 typo",
        expectDecompose: false,
        payload: "把 src/index.ts 第 42 行的 'recieve' 改成 'receive'。",
    },
    {
        name: "简单任务：加一行日志",
        expectDecompose: false,
        payload: "在 memory-store.ts 的 write() 方法开头加一句 logger.info('Writing memory entry')。",
    },
];
// ═══════════════════════════════════════════════
// 3. 主流程
// ═══════════════════════════════════════════════
async function main() {
    loadEnv();
    const API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!API_KEY) {
        console.error("❌ DEEPSEEK_API_KEY 未设置");
        process.exit(1);
    }
    const llmCfg = resolveLlmConfig();
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║   RLM decompose 真实 LLM 验证                     ║");
    console.log("╚══════════════════════════════════════════════════╝\n");
    console.log(`   Model:  ${llmCfg.chatModel}`);
    console.log(`   Base:   ${llmCfg.baseUrl}\n`);
    const adapter = new LlmAdapter({
        apiKey: API_KEY,
        baseUrl: llmCfg.baseUrl,
        chatModel: llmCfg.chatModel,
        reasonerModel: llmCfg.reasonerModel,
        reasoningEffort: llmCfg.reasoningEffort,
    });
    let passed = 0;
    let failed = 0;
    for (const tc of TEST_CASES) {
        console.log(`\n━━━ ${tc.name} ━━━`);
        console.log(`   payload: ${tc.payload.length} 字`);
        // 检查复杂度判定
        const shouldAttempt = shouldDecompose(tc.payload, tc.tags ?? [], tc.preferredStrategy);
        console.log(`   shouldDecompose: ${shouldAttempt ? "✅ 是" : "❌ 否"}`);
        if (shouldAttempt !== tc.expectDecompose) {
            console.log(`   ⚠️ 预期 ${tc.expectDecompose ? "应拆" : "不应拆"}，实际判定相反`);
        }
        if (!shouldAttempt) {
            console.log(`   → 复杂度不足，跳过 LLM 调用\n`);
            if (!tc.expectDecompose)
                passed++;
            else
                failed++;
            continue;
        }
        // 调用 decompose
        console.log(`   🤖 调用 LLM 拆解...`);
        const t0 = Date.now();
        const result = await decompose(async (model, messages) => {
            const res = await adapter.chat(model, messages);
            return res.content ?? "";
        }, llmCfg.chatModel, tc.payload);
        const elapsed = Date.now() - t0;
        // 打印结果
        console.log(`   置信度: ${result.confidence.toFixed(2)}  |  耗时: ${elapsed}ms`);
        console.log(`   理由: ${result.rationale}`);
        console.log(`   子任务数: ${result.subTasks.length}`);
        const viable = shouldExecuteDecomposition(result);
        console.log(`   可执行拆解: ${viable ? "✅" : "❌"}`);
        if (result.subTasks.length > 0) {
            console.log(`   子任务列表:`);
            for (const st of result.subTasks) {
                const deps = st.dependsOn.length > 0 ? ` ← depends on [${st.dependsOn.join(", ")}]` : "";
                console.log(`     [${st.density}] ${st.id} (confidence=${st.confidence.toFixed(2)})${deps}`);
                console.log(`       ${st.description.slice(0, 120)}${st.description.length > 120 ? "…" : ""}`);
            }
        }
        // 判定
        if (tc.expectDecompose) {
            if (viable && result.subTasks.length > 0) {
                console.log(`   ✅ 通过：成功拆解为 ${result.subTasks.length} 个子任务`);
                passed++;
            }
            else {
                console.log(`   ❌ 失败：预期拆解但未能执行（confidence=${result.confidence.toFixed(2)}, subTasks=${result.subTasks.length}）`);
                failed++;
            }
        }
        else {
            if (!viable) {
                console.log(`   ✅ 通过：正确回退直接执行`);
                passed++;
            }
            else {
                console.log(`   ❌ 失败：不应拆解但 LLM 产出了子任务`);
                failed++;
            }
        }
    }
    // ═══════════════════════════════════════════════
    // 总结
    // ═══════════════════════════════════════════════
    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log(`║   结果: ${passed} 通过 / ${failed} 失败 / ${TEST_CASES.length} 总计`);
    console.log("╚══════════════════════════════════════════════════╝\n");
    if (failed > 0) {
        process.exit(1);
    }
}
main().catch((err) => {
    console.error("💥 E2E 崩溃:", err);
    process.exit(1);
});
//# sourceMappingURL=rlm-decompose-verify.js.map