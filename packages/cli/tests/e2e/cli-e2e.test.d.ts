/**
 * cli-e2e.test.ts —— @cortex/cli E2E 冒烟测试套件
 *
 * 覆盖 14 个命令的核心路径。直接调用 handler 函数，不依赖子进程。
 * 从源文件导入以避免 @cortex/cli barrel 导入触发 main.ts 的 process.exit 副作用。
 *
 * 测试分层：
 *   L1 冒烟 —— 每个命令的 help 文本结构、子命令路由、未知子命令错误
 *   L2 集成 —— Agent 纯函数、命令注册表完整度、格式器
 *   L3 边界 —— 缺失参数、错误提示内容
 */
export {};
//# sourceMappingURL=cli-e2e.test.d.ts.map