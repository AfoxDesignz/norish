/**
 * Redis Client Singleton
 *
 * The only module that opens a Redis connection for pub/sub. The publisher is
 * a process-wide singleton; subscribers are duplicated from it because a Redis
 * client in subscribe mode cannot run other commands.
 */

import type { RedisOptions } from "ioredis";
import Redis from "ioredis";

import { SERVER_CONFIG } from "@norish/config/env-config-server";
import { createLogger, redactUrl } from "@norish/shared-server/logger";
import { withTimeout } from "@norish/shared/lib/with-timeout";

import { parseRedisUrl } from "./url";

const log = createLogger("redis");

// Read on every access, never copied into a module-local — see the note on
// `globalForRegistry` in packages/queue/src/registry.ts for why this module is
// evaluated more than once per process. Here the cost of getting it wrong is
// one connection per instance, of which shutdown closes only the one it can see.
const globalForRedis = globalThis as unknown as {
  publisherClient: Redis | null | undefined;
};

/**
 * A socket that has received nothing for this long after a command went out is
 * taken for dead and reconnected. Without it, a connection left half-open by a
 * Redis restart is only noticed once the operating system's keep-alive gives
 * up, minutes later.
 */
export const REDIS_SOCKET_TIMEOUT_MS = 10_000;

/**
 * Connection options every Redis client in Norish starts from: the publisher,
 * each subscriber and BullMQ's connections. ioredis 6's defaults do the rest:
 * RESP3, reconnecting with capped exponential backoff for as long as the
 * process lives, and a 30-second keep-alive.
 */
export function getRedisConnectionOptions(url = SERVER_CONFIG.REDIS_URL): RedisOptions {
  return {
    ...parseRedisUrl(url),
    lazyConnect: true,
    maxRetriesPerRequest: null,
    // How long a deliberate disconnect waits for the far end to close before
    // destroying the socket. Shutdown waits this long for every connection a
    // Redis restart left unanswered; ioredis's two seconds overran its budget.
    disconnectTimeout: 200,
  };
}

/**
 * The publisher, for PUBLISH and every non-subscribe command. Created once per
 * process: while Redis is down it reconnects, and callers keep getting it.
 */
export async function getPublisherClient(): Promise<Redis> {
  return (globalForRedis.publisherClient ??= createPublisher());
}

function createPublisher(): Redis {
  log.info({ url: redactUrl(SERVER_CONFIG.REDIS_URL) }, "Connecting to Redis");

  const client = new Redis({
    ...getRedisConnectionOptions(),
    // A command fails when Redis has not answered it within five seconds, so
    // an outage cannot hold a request for ever, while a restart that takes a
    // second or two is waited out: a session read failed then reads as signed out.
    commandTimeout: 5_000,
    socketTimeout: REDIS_SOCKET_TIMEOUT_MS,
    connectionName: `norish:${process.pid}:publisher`,
  });

  client.on("error", (err) => {
    log.error({ err }, "Redis client error");
  });

  client.on("reconnecting", () => {
    log.warn("Redis client reconnecting");
  });

  client.on("ready", () => {
    log.info("Redis publisher connected");
  });

  return client;
}

const REDIS_HEALTH_TIMEOUT_MS = 2_000;

/** PING through the publisher. A ping unanswered after two seconds counts as down. */
export async function getRedisHealth() {
  try {
    const redis = await getPublisherClient();

    await withTimeout(() => redis.ping(), REDIS_HEALTH_TIMEOUT_MS, "Redis PING");

    return { status: "ok" as const };
  } catch {
    return { status: "error" as const };
  }
}

/**
 * Create the Realtime Hub's subscriber client, duplicated from the publisher
 * with its socket timeout. It needs its own connection because a Redis client
 * in subscribe mode serves nothing else.
 */
export async function createSubscriberClient(): Promise<Redis> {
  const publisher = await getPublisherClient();
  // A SUBSCRIBE waits out an outage rather than failing like a publisher's command.
  const subscriber = publisher.duplicate({
    commandTimeout: undefined,
    connectionName: `norish:${process.pid}:realtime-hub`,
  });

  subscriber.on("error", (err) => {
    log.error({ err }, "Redis subscriber error");
  });

  log.trace("Redis subscriber connected");

  return subscriber;
}

/**
 * Close the publisher. Shutdown calls this after every consumer has stopped,
 * so nothing is in flight: it disconnects rather than sending a QUIT that a
 * dead socket would never answer.
 */
export async function closeRedisConnections(): Promise<void> {
  const publisherClient = globalForRedis.publisherClient;

  if (publisherClient && publisherClient.status !== "end") {
    log.info("Closing Redis connections");
    publisherClient.disconnect();
    globalForRedis.publisherClient = null;
  }
}
