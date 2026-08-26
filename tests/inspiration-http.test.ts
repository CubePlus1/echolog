import assert from "node:assert/strict";
import test from "node:test";
import type { PluginHttpRequest, PluginRoute } from "@echolog/plugin-sdk";
import type { FlowService } from "../plugins/inspiration/src/flow.js";
import { createFlowRoutes } from "../plugins/inspiration/src/flow-routes.js";
import { parseOffsetAwareIso } from "../plugins/inspiration/src/http-validation.js";
import {
  decodeDeliveryCursor,
  encodeDeliveryCursor,
  type DeliveryCursor,
} from "../plugins/inspiration/src/pagination.js";

function deliveryRoute(): PluginRoute {
  const found = createFlowRoutes(() => service).find(
    (candidate) =>
      candidate.method === "GET" &&
      candidate.path === "/api/plugins/inspiration/flow/deliveries"
  );
  assert.ok(found);
  return found;
}

let receivedCursor: DeliveryCursor | undefined;
const service = {
  async listDeliveries(_limit: number, cursor?: DeliveryCursor) {
    receivedCursor = cursor;
    return {
      deliveries: [{ id: "delivery_same_b", surfacedAt: cursor?.surfacedAt }],
      nextCursor: {
        surfacedAt: new Date("2026-08-24T05:00:00.000Z"),
        id: "delivery_same_a",
      },
    };
  },
} as unknown as FlowService;

async function call(query: unknown): Promise<any> {
  return deliveryRoute().handler({
    params: {},
    query,
    body: undefined,
    headers: {},
  } as PluginHttpRequest, new AbortController().signal);
}

test("offset-aware ISO validation rejects local and malformed timestamps", () => {
  assert.equal(
    parseOffsetAwareIso("2026-11-01T01:30:00-04:00")?.toISOString(),
    "2026-11-01T05:30:00.000Z"
  );
  assert.equal(
    parseOffsetAwareIso("2026-11-01T01:30:00-05:00")?.toISOString(),
    "2026-11-01T06:30:00.000Z"
  );
  assert.equal(parseOffsetAwareIso("2026-11-01T01:30:00"), null);
  assert.equal(parseOffsetAwareIso("2026-11-01T01:30:00+24:00"), null);
  assert.equal(parseOffsetAwareIso("2026-02-30T01:30:00Z"), null);
  assert.equal(parseOffsetAwareIso("0000-01-01T00:00:00Z"), null);
  assert.equal(
    parseOffsetAwareIso("2000-02-29T00:00:00Z")?.toISOString(),
    "2000-02-29T00:00:00.000Z"
  );
  assert.equal(parseOffsetAwareIso("1900-02-29T00:00:00Z"), null);
});

test("delivery cursor is opaque, composite, and offset-aware", () => {
  const surfacedAt = new Date("2026-08-24T05:00:00.000Z");
  const encoded = encodeDeliveryCursor({ surfacedAt, id: "delivery_same_b" });
  assert.equal(encoded.includes("2026-08-24"), false);
  assert.deepEqual(decodeDeliveryCursor(encoded), {
    surfacedAt,
    id: "delivery_same_b",
  });

  const localTime = Buffer.from(JSON.stringify({
    surfacedAt: "2026-08-24T05:00:00",
    id: "delivery_same_b",
  })).toString("base64url");
  assert.equal(decodeDeliveryCursor(localTime), null);

  const unknownField = Buffer.from(JSON.stringify({
    surfacedAt: "2026-08-24T05:00:00Z",
    id: "delivery_same_b",
    before: "legacy",
  })).toString("base64url");
  assert.equal(decodeDeliveryCursor(unknownField), null);
});

test("delivery API passes the composite cursor and returns only an opaque next cursor", async () => {
  const cursor = encodeDeliveryCursor({
    surfacedAt: new Date("2026-08-24T05:00:00.000Z"),
    id: "delivery_same_b",
  });
  const result = await call({ limit: "1", cursor });
  assert.equal(receivedCursor?.surfacedAt.toISOString(), "2026-08-24T05:00:00.000Z");
  assert.equal(receivedCursor?.id, "delivery_same_b");
  assert.equal(result.deliveries[0].id, "delivery_same_b");
  assert.deepEqual(decodeDeliveryCursor(result.nextCursor), {
    surfacedAt: new Date("2026-08-24T05:00:00.000Z"),
    id: "delivery_same_a",
  });

  for (const query of [
    { before: "2026-08-24T05:00:00Z" },
    { cursor: [cursor, cursor] },
    { cursor: "not-a-cursor" },
  ]) {
    const rejected = await call(query);
    assert.equal(rejected.statusCode, 400);
  }
});
