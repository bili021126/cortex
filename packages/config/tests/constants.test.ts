// @ci: unit

import { describe, it, expect } from "vitest";
import {
  EMBEDDING_DIM,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  CLOCK_SKEW_TOLERANCE,
  VALID_TIERS,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  MAINTENANCE_WEIGHT_THRESHOLD,
  SCHEMA_VERSION,
  RETRIEVAL_ALPHA,
  RETRIEVAL_BETA,
  DEFAULT_MAX_TOTAL_MEMORIES,
} from "@cortex/config";

describe("@cortex/config — memory constants", () => {
  it("EMBEDDING_DIM 应为 384", () => {
    expect(EMBEDDING_DIM).toBe(384);
  });

  it("STALE_FREEZE_DAYS 应为正数", () => {
    expect(STALE_FREEZE_DAYS).toBeGreaterThan(0);
  });

  it("FROZEN_OBLITERATE_DAYS 应小于 STALE_FREEZE_DAYS", () => {
    expect(FROZEN_OBLITERATE_DAYS).toBeLessThan(STALE_FREEZE_DAYS);
  });

  it("VECTOR_DEDUP_THRESHOLD 应在 0~1 之间", () => {
    expect(VECTOR_DEDUP_THRESHOLD).toBeGreaterThan(0);
    expect(VECTOR_DEDUP_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it("WEIGHT_AGING_FACTOR 应在 0~1 之间", () => {
    expect(WEIGHT_AGING_FACTOR).toBeGreaterThan(0);
    expect(WEIGHT_AGING_FACTOR).toBeLessThanOrEqual(1);
  });

  it("MAINTENANCE_WEIGHT_THRESHOLD 应为正数", () => {
    expect(MAINTENANCE_WEIGHT_THRESHOLD).toBeGreaterThan(0);
  });

  it("SCHEMA_VERSION 应为正整数", () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
  });

  it("DEFAULT_MAX_TOTAL_MEMORIES 应为正数", () => {
    expect(DEFAULT_MAX_TOTAL_MEMORIES).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_MAX_TOTAL_MEMORIES)).toBe(true);
  });
});

describe("@cortex/config — scheduling constants", () => {
  it("CLOCK_SKEW_TOLERANCE 应在 0~10000ms 范围内", () => {
    expect(CLOCK_SKEW_TOLERANCE).toBeGreaterThanOrEqual(0);
    expect(CLOCK_SKEW_TOLERANCE).toBeLessThanOrEqual(10_000);
  });
});

describe("@cortex/config — tier constants", () => {
  it("VALID_TIERS 应包含 fast/standard/thinking", () => {
    expect(VALID_TIERS.has("fast")).toBe(true);
    expect(VALID_TIERS.has("standard")).toBe(true);
    expect(VALID_TIERS.has("thinking")).toBe(true);
  });

  it("VALID_TIERS 包含预期值且无意外值", () => {
    expect(VALID_TIERS.has("fast")).toBe(true);
    expect(VALID_TIERS.has("standard")).toBe(true);
    expect(VALID_TIERS.has("thinking")).toBe(true);
    expect(VALID_TIERS.has("slow")).toBe(false);
    expect(VALID_TIERS.has("ultra")).toBe(false);
  });
});

describe("@cortex/config — retrieval constants consistency", () => {
  it("RETRIEVAL_ALPHA + RETRIEVAL_BETA 应等于 1.0", () => {
    expect(RETRIEVAL_ALPHA + RETRIEVAL_BETA).toBeCloseTo(1.0, 10);
  });

  it("RETRIEVAL_ALPHA 应在 0~1 之间", () => {
    expect(RETRIEVAL_ALPHA).toBeGreaterThan(0);
    expect(RETRIEVAL_ALPHA).toBeLessThan(1);
  });

  it("RETRIEVAL_BETA 应在 0~1 之间", () => {
    expect(RETRIEVAL_BETA).toBeGreaterThan(0);
    expect(RETRIEVAL_BETA).toBeLessThan(1);
  });
});
