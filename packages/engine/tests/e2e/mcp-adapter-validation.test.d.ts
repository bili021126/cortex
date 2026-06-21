/**
 * mcp-adapter-validation.test.ts —— MCP 工具适配器真实验证
 *
 * 遍历 5 个开源无鉴权 MCP Server，验证：
 *   1. McpClient 启动 → initialize → tools/list 握手
 *   2. McpToolAdapter 将每个 MCP Tool 包装为统一 Tool 接口
 *   3. Tool 字段完整性（name / description / parameters / category / level）
 *   4. Tool.execute() 实际调用 MCP Server
 *   5. 各种 MCP 格式变体下的健壮性（空 Schema、复杂 Schema、社区脏数据）
 *
 * 每个 Server 独立测试——一个挂不影响其他。npx 安装耗时不计入超时。
 */
export {};
//# sourceMappingURL=mcp-adapter-validation.test.d.ts.map