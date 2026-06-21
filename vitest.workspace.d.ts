/**
 * vitest workspace 根配置。
 *
 * 所有包独立并行执行（vitest 2.1.x 无 dependsOn，升级到 3.x 后可加拓扑约束）。
 * 需要有序执行时使用: vitest --workspace --project=@cortex/shared && vitest --workspace
 *
 * 使用:
 *   vitest --workspace               并行跑所有项目
 */
declare const _default: import("vitest/config.js").WorkspaceProjectConfiguration[];
export default _default;
//# sourceMappingURL=vitest.workspace.d.ts.map