// @vitest-environment node
/**
 * The publisher through a real Redis outage: callers keep getting the one
 * client while it reconnects, a command sent during a restart is answered once
 * Redis is back, one sent during a longer outage fails instead of waiting for
 * ever, and no extra connection is left behind. The outage is a proxy in
 * front of Redis that drops every connection and refuses new ones.
 */
import type { StartedRedisContainer } from "@testcontainers/redis";
import { RedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { closeRedisConnections, getPublisherClient } from "../../src/redis/client";
import { freezableProxy, REDIS_IMAGE } from "../helpers/redis";

const config = vi.hoisted(() => ({ url: "" }));

vi.mock("@norish/config/env-config-server", () => ({
  SERVER_CONFIG: {
    get REDIS_URL() {
      return config.url;
    },
  },
}));

let container: StartedRedisContainer;
let proxy: ReturnType<typeof freezableProxy>;

beforeAll(async () => {
  container = await new RedisContainer(REDIS_IMAGE).start();
  proxy = freezableProxy({ host: container.getHost(), port: container.getPort() });
  config.url = await proxy.listen();
});

afterAll(async () => {
  await closeRedisConnections();
  await proxy?.close();
  await container?.stop();
});

it("answers a command sent while Redis restarts", async () => {
  const publisher = await getPublisherClient();

  await publisher.set("session", "kept");
  await proxy.close();

  const read = publisher.get("session");

  // Down until several reconnect attempts have failed, then back, well inside
  // the command's timeout.
  await new Promise<void>((resolve) => {
    let attempts = 0;
    const onReconnecting = () => {
      if (++attempts < 3) return;

      publisher.off("reconnecting", onReconnecting);
      resolve();
    };

    publisher.on("reconnecting", onReconnecting);
  });
  await proxy.listen();

  await expect(read).resolves.toBe("kept");
}, 30_000);

it("keeps one publisher through an outage, and fails its commands meanwhile", async () => {
  const publisher = await getPublisherClient();

  await publisher.ping();
  await proxy.close();
  await expect.poll(() => publisher.status).not.toBe("ready");

  const during = await Promise.all([getPublisherClient(), getPublisherClient()]);

  expect(during[0]).toBe(publisher);
  expect(during[1]).toBe(publisher);
  await expect(publisher.get("anything")).rejects.toThrow("Command timed out");

  await proxy.listen();
  await expect.poll(() => publisher.status, { timeout: 20_000 }).toBe("ready");

  const admin = new Redis(container.getConnectionUrl());

  try {
    const ownId = await admin.client("ID");
    const clients = String(await admin.client("LIST"))
      .trim()
      .split("\n")
      .filter((line) => !line.startsWith(`id=${ownId} `));

    expect(clients).toHaveLength(1);
  } finally {
    admin.disconnect();
  }
}, 30_000);
