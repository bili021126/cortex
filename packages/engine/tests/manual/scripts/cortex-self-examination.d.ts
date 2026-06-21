/**
 * Cortex 自审视实验——甘雨召集审视委员会，对共识修复清单逐项验证
 *
 * 用法: npx tsx tests/manual/scripts/cortex-self-examination.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 场景:
 *   甘雨（MetaAgent）收到一份共识修复清单。她没有自己逐项查验——
 *   那会压垮她一个人。她做了一个秘书该做的事：把任务拆开，分给七位专家，
 *   每人只负责自己最擅长的那一块。任务结束，甘雨只做汇总，不替专家下判断。
 *
 * 硬约束（安全边界，不可突破）:
 *   - 所有 Agent 只能使用 read_file / search_code / list_files 读取项目文件
 *   - write_file 仅允许写入 test-output/self-examination/ 输出目录（审视报告）
 *   - run_shell、delete_file 被显式禁止
 *   - 不能触碰 packages/ 和 docs/ 下的任何文件
 *
 * 软约束（开放性引导）:
 *   - 不规定具体产出格式
 *   - 不规定审查范围
 *   - 由甘雨自主决定如何组织团队
 */
export {};
//# sourceMappingURL=cortex-self-examination.d.ts.map