// @vitest-environment node
/**
 * An idle worker against a real Redis: BullMQ reads `drainDelay` in seconds and
 * blocks on Redis that long per wait. Each wait shows up as a BZPOPMIN, so a
 * second one within a few seconds proves the first one ended.
 */
import type { StartedRedisContainer } from "@testcontainers/redis";
import { RedisContainer } from "@testcontainers/redis";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { afterAll, beforeAll, expect, it } from "vitest";

import { REDIS_IMAGE } from "../../../shared-server/__tests__/helpers/redis";
import { baseWorkerOptions } from "../../src/config";
import { getBullConnectionOptions } from "../../src/redis/bullmq";

let redis: StartedRedisContainer;

beforeAll(async () => {
  redis = await new RedisContainer(REDIS_IMAGE).start();
});

afterAll(async () => {
  await redis?.stop();
});

it("ends an idle worker's blocking wait within seconds", async () => {
  const connection = getBullConnectionOptions(redis.getConnectionUrl());
  const monitor = await new Redis(connection).monitor();
  const waits: number[] = [];

  monitor.on("monitor", (_time: string, args: string[]) => {
    if (args[0]?.toLowerCase() === "bzpopmin") waits.push(Date.now());
  });

  const worker = new Worker("drain-delay-redis-test", async () => {}, {
    ...baseWorkerOptions,
    connection,
  });

  try {
    await expect.poll(() => waits.length, { timeout: 10_000, interval: 100 }).toBeGreaterThan(1);
    expect(waits[1]! - waits[0]!).toBeLessThan(7_000);
  } finally {
    await worker.close();
    monitor.disconnect();
  }
}, 30_000);
