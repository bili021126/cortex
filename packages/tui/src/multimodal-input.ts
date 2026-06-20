/**
 * tui/multimodal-input.ts — 多模态输入支持
 *
 * Claude Code 对标：图片路径粘贴和拖入支持。
 * 检测用户输入中的图片路径，读取文件并转 base64，构造多模态 LLM 消息。
 *
 * @module tui/multimodal-input
 * @since v3 — Claude Code 对标：多模态输入
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

/** 支持的图片格式 */
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** 文件大小上限（20MB） */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** MIME type 映射 */
const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** 图片附件 */
interface ImageAttachment {
  path: string;
  base64: string;
  mimeType: string;
}

// ═══════════════════════════════════════════════════════════
// §2 解析与检测
// ═══════════════════════════════════════════════════════════

/** 从用户输入中提取图片路径（@path 或 /absolute/path） */
function extractImagePaths(input: string): string[] {
  const paths: string[] = [];
  // 匹配 @path/to/image.png 或 /absolute/path/to/image.png
  const regex = /(?<!\w)@?(\/[^\s]+?\.(?:png|jpg|jpeg|webp|gif))/gi;
  let match;
  while ((match = regex.exec(input)) !== null) {
    const p = match[1].replace(/^@/, "").trim();
    // 去除末尾可能粘连的标点
    const cleaned = p.replace(/[,;!?。，；！？]+$/, "");
    if (SUPPORTED_EXTENSIONS.has(path.extname(cleaned).toLowerCase())) {
      paths.push(cleaned);
    }
  }
  return [...new Set(paths)]; // 去重
}

/** 从输入中移除图片路径引用，返回纯文本 */
function stripImagePaths(input: string): string {
  return input.replace(/(?<!\w)@?\/[^\s]+?\.(?:png|jpg|jpeg|webp|gif)/gi, "").trim();
}

// ═══════════════════════════════════════════════════════════
// §3 文件读取与编码
// ═══════════════════════════════════════════════════════════

/** 读取图片文件并转 base64 data URI */
function readImageToBase64(filePath: string): ImageAttachment | null {
  try {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) return null;

    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_SIZE) return null;
    if (stat.size === 0) return null;

    const ext = path.extname(absPath).toLowerCase();
    const mimeType = MIME_MAP[ext];
    if (!mimeType) return null;

    const buffer = fs.readFileSync(absPath);
    const base64 = buffer.toString("base64");

    return { path: absPath, base64, mimeType };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// §4 多模态消息构造
// ═══════════════════════════════════════════════════════════

/**
 * 将用户输入中的图片路径替换为多模态 content。
 *
 * @param input 用户原始输入
 * @returns 处理后的纯文本和多模态 content 数组，
 *          如果无图片则为 undefined
 */
export function processMultimodalInput(input: string): {
  text: string;
  multimodalContent?: { type: string; text?: string; image_url?: { url: string } }[];
} | null {
  const imagePaths = extractImagePaths(input);
  if (imagePaths.length === 0) return null;

  const text = stripImagePaths(input) || input;
  const images: ImageAttachment[] = [];

  for (const p of imagePaths) {
    const img = readImageToBase64(p);
    if (img) images.push(img);
  }

  if (images.length === 0) return { text };

  // 构造多模态 content
  const content: { type: string; text?: string; image_url?: { url: string } }[] = [{ type: "text", text }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${img.mimeType};base64,${img.base64}`,
      },
    });
  }

  return { text, multimodalContent: content };
}

/**
 * 检测输入是否含图片路径（用于前端提示）。
 */
export function hasImagePaths(input: string): boolean {
  return extractImagePaths(input).length > 0;
}
