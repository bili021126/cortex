/**
 * onnx-warmup.ts — ONNX 模型预下载/预热脚本。
 *
 * 用法：
 *   node scripts/onnx-warmup.ts               # 默认 HuggingFace
 *   HF_ENDPOINT=https://hf-mirror.com node scripts/onnx-warmup.ts  # 使用镜像
 *
 * 可在 CI 构建阶段运行，将模型缓存到本地，避免启动时首次下载。
 * 模型缓存路径由 @xenova/transformers 自动管理（默认 ~/.cache/huggingface）。
 * 可通过 HF_HOME 或 TRANSFORMERS_CACHE 环境变量自定义。
 */
export {};
//# sourceMappingURL=onnx-warmup.d.ts.map