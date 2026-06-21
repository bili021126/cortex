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
import { preloadModel, isModelLoaded } from "../src/memory/embedding.js";
const TIMEOUT_MS = 120_000; // 2 分钟超时（足够下载 80MB）
async function main() {
    console.log("[onnx-warmup] 开始预加载 ONNX 模型 (all-MiniLM-L6-v2)…");
    if (isModelLoaded()) {
        console.log("[onnx-warmup] 模型已在内存中，跳过。");
        process.exit(0);
    }
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
        console.error("[onnx-warmup] 超时（%ds），中断下载。", TIMEOUT_MS / 1000);
        controller.abort();
    }, TIMEOUT_MS);
    try {
        await preloadModel(controller.signal);
        console.log("[onnx-warmup] ✅ 模型预热完成。");
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[onnx-warmup] ❌ 模型预热失败:", msg);
        process.exit(1);
    }
    finally {
        clearTimeout(timeoutHandle);
    }
}
main();
//# sourceMappingURL=onnx-warmup.js.map