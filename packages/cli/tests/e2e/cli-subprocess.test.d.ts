/**
 * cli-subprocess.test.ts —— Cortex CLI 子进程 E2E 测试
 *
 * 验证用户实际敲命令的端到端行为：
 *   终端输入 → process.argv → main() → stdout/stderr → process.exit(code)
 *
 * 与 handler 直调测试（cli-e2e.test.ts / cli-engine-integration.test.ts）的区别：
 *   - 本文件 spawn 真实子进程 `node dist/main.js <args>`
 *   - 验证 exit code、stdout 内容、stderr 错误信息
 *   - 测试的是 CLI 可执行文件，不是 handler 函数
 *
 * 运行: npx vitest run tests/e2e/cli-subprocess.test.ts
 */
export {};
//# sourceMappingURL=cli-subprocess.test.d.ts.map