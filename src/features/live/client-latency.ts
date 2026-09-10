"use client";

import type { ClientLatencySample, ClientLatencyStage } from "@/lib/schema";

const MAX_PENDING = 24;

/** Small transcript-free queue. Samples ride on the next interpretation turn. */
export class ClientLatencyQueue {
  private pending: ClientLatencySample[] = [];
  private counter = 0;

  constructor(private readonly prefix = `c${Date.now().toString(36)}`) {}

  add(stage: ClientLatencyStage, ms: number, provider?: string, model?: string): ClientLatencySample | null {
    if (!Number.isFinite(ms) || ms < 0) return null;
    const sample: ClientLatencySample = {
      id: `${this.prefix}-${(this.counter += 1).toString(36)}`,
      stage,
      ms: Math.min(120_000, Math.round(ms)),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    };
    this.pending.push(sample);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return sample;
  }

  batch(limit = MAX_PENDING): ClientLatencySample[] {
    return this.pending.slice(0, Math.max(0, Math.min(MAX_PENDING, limit)));
  }

  acknowledge(ids: Iterable<string>): void {
    const accepted = new Set(ids);
    if (accepted.size === 0) return;
    this.pending = this.pending.filter((sample) => !accepted.has(sample.id));
  }

  get size(): number { return this.pending.length; }
}
