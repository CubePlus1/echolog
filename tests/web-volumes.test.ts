import assert from "node:assert/strict";
import test from "node:test";
import { currentPeriod, periodBounds, volumeKey } from "../web/volumes.js";

test("current month uses four fixed local calendar periods", () => {
  assert.equal(currentPeriod(new Date(2026, 7, 1)), 1);
  assert.equal(currentPeriod(new Date(2026, 7, 7)), 1);
  assert.equal(currentPeriod(new Date(2026, 7, 8)), 2);
  assert.equal(currentPeriod(new Date(2026, 7, 14)), 2);
  assert.equal(currentPeriod(new Date(2026, 7, 15)), 3);
  assert.equal(currentPeriod(new Date(2026, 7, 21)), 3);
  assert.equal(currentPeriod(new Date(2026, 7, 22)), 4);
  assert.equal(currentPeriod(new Date(2026, 7, 31)), 4);
});

test("period bounds keep the last bucket open through month end", () => {
  const third = periodBounds(2026, 8, 3);
  assert.equal(third.start.getDate(), 15);
  assert.equal(third.end.getDate(), 22);
  const fourth = periodBounds(2026, 8, 4);
  assert.equal(fourth.start.getDate(), 22);
  assert.equal(fourth.end.getMonth(), 8);
  assert.equal(fourth.end.getDate(), 1);
});

test("volume keys distinguish current periods from historical months", () => {
  assert.equal(volumeKey(2026, 8, 3), "period:2026-08:3");
  assert.equal(volumeKey(2026, 7), "month:2026-07");
});
