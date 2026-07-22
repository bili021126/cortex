/**
 * @cortex/server — Memory Handler (HTTP)
 *
 * Handles GET/POST/DELETE /api/v1/memory endpoints.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { EngineHost } from "../engine-host.js";
import type { MemoryWriteRequest } from "@cortex/protocol";
import { readBody, sendJson, sendProblem } from "./router.js";

/**
 * Handle GET /api/v1/memory?query=...&kind=...&limit=...
 */
export async function handleMemoryGet(
  req: IncomingMessage,
  res: ServerResponse,
  engine: EngineHost,
): Promise<void> {
  try {
    const memory = engine.memory;
    if (!memory) {
      sendProblem(res, 503, "Service Unavailable", "Memory store not initialized");
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const query = url.searchParams.get("query") ?? "";
    const kind = url.searchParams.get("kind") ?? undefined;
    const limit = Number(url.searchParams.get("limit")) || 20;

    // Build MemoryQuery from request params
    const keywords = query ? query.split(/\s+/).filter(Boolean) : undefined;
    const results = await memory.read({
      keywords,
      kind: kind as never,
      limit,
    });

    sendJson(res, 200, {
      data: results.map((entry) => ({
        id: entry.id,
        summary: entry.summary,
        kind: entry.kind,
        domain: entry.domain ?? "general",
        semanticState: entry.semantic_state,
        agentType: entry.source.agentType,
        createdAt: entry.createdAt,
        weight: entry.weight,
        accessCount: entry.accessCount,
      })),
      pagination: {
        limit,
        total: results.length,
      },
    });
  } catch (err) {
    sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Handle POST /api/v1/memory
 */
export async function handleMemoryPost(
  req: IncomingMessage,
  res: ServerResponse,
  engine: EngineHost,
): Promise<void> {
  try {
    const memory = engine.memory;
    if (!memory) {
      sendProblem(res, 503, "Service Unavailable", "Memory store not initialized");
      return;
    }

    const body = await readBody(req);
    let parsed: MemoryWriteRequest;
    try {
      parsed = JSON.parse(body) as MemoryWriteRequest;
    } catch {
      sendProblem(res, 400, "Bad Request", "Invalid JSON body");
      return;
    }

    if (!parsed.content || typeof parsed.content !== "string") {
      sendProblem(res, 422, "Validation Error", "Field 'content' is required");
      return;
    }

    // Map REST DTO → MemoryWriteInput (v3 schema)
    const memoryId = await memory.write({
      source: {
        agentType: (parsed.metadata?.agentType as string ?? "cyrene") as never,
        taskId: (parsed.metadata?.taskId as string ?? "api-write") as string,
      },
      kind: (parsed.kind ?? "Insight") as never,
      summary: parsed.content.slice(0, 200),
      semantic_gist: parsed.content.slice(0, 200),
      content_blob: { content: parsed.content, ...(parsed.metadata ?? {}) },
      domain: parsed.metadata?.domain as string | undefined,
    });

    sendJson(res, 201, {
      data: {
        id: memoryId,
        content: parsed.content,
        kind: parsed.kind ?? "Insight",
        createdAt: Date.now(),
      },
    });
  } catch (err) {
    sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Handle DELETE /api/v1/memory/:id
 */
export async function handleMemoryDelete(
  res: ServerResponse,
  engine: EngineHost,
  id: string,
): Promise<void> {
  try {
    const memory = engine.memory;
    if (!memory) {
      sendProblem(res, 503, "Service Unavailable", "Memory store not initialized");
      return;
    }

    if (!id) {
      sendProblem(res, 400, "Bad Request", "Memory ID is required");
      return;
    }

    // Attempt deletion — IMemoryStore may or may not support delete
    let deleted = false;
    if (typeof (memory as unknown as Record<string, unknown>).delete === "function") {
      await (memory as unknown as { delete(id: string): Promise<boolean> }).delete(id);
      deleted = true;
    } else if (typeof (memory as unknown as Record<string, unknown>).remove === "function") {
      await (memory as unknown as { remove(id: string): Promise<boolean> }).remove(id);
      deleted = true;
    }

    sendJson(res, 200, { deleted });
  } catch (err) {
    sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
  }
}
