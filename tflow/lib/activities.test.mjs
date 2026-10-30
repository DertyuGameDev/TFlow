import test from "node:test";
import assert from "node:assert/strict";
import { activityAvailability } from "./activities.ts";

const activity = (changes = {}) => ({ id:"a", event_id:"one", starts_at:1000, ends_at:2000, capacity:3, taken:1, registered:0, ...changes });

test("programme exposes actual free seats and allows registration", () => {
  const state = activityAvailability(activity(), [], 0);
  assert.equal(state.free, 2);
  assert.equal(state.blocked, false);
});
test("full activities block new registration without negative free seats", () => {
  for (const taken of [3,4]) {
    const state = activityAvailability(activity({taken}), [], 0);
    assert.equal(state.free, 0);
    assert.equal(state.blocked, true);
  }
});
test("participant sees the conflicting activity across different events", () => {
  const other = activity({id:"b",event_id:"two",starts_at:1500,ends_at:2500});
  const state = activityAvailability(activity(), [other], 0);
  assert.equal(state.conflict.id, "b");
  assert.equal(state.blocked, true);
});
test("UI recognizes identical, contained and surrounding intervals", () => {
  for (const [starts_at,ends_at] of [[1000,2000],[1200,1800],[500,2500],[500,1500]]) {
    assert.equal(activityAvailability(activity(), [activity({id:"b",starts_at,ends_at})], 0).blocked, true);
  }
});
test("UI allows adjacent activities in either direction", () => {
  for (const [starts_at,ends_at] of [[0,1000],[2000,3000]]) {
    assert.equal(activityAvailability(activity(), [activity({id:"b",starts_at,ends_at})], 0).blocked, false);
  }
});
test("an activity is not considered a conflict with itself", () => {
  assert.equal(activityAvailability(activity(), [activity()], 0).blocked, false);
});
test("registered participant can always reach cancellation even when full or started", () => {
  const state = activityAvailability(activity({registered:1,taken:3}), [activity({id:"b"})], 3000);
  assert.equal(state.blocked, false);
  assert.equal(state.registered, true);
  assert.equal(state.conflict, undefined);
});
test("registration closes exactly when the activity starts", () => {
  assert.equal(activityAvailability(activity(), [], 999).closed, false);
  assert.equal(activityAvailability(activity(), [], 1000).closed, true);
  assert.equal(activityAvailability(activity(), [], 1000).blocked, true);
});
