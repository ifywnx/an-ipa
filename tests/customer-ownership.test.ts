import {test} from "node:test";
import assert from "node:assert/strict";
import {
  listAccountDevices, attachManualRequest, attachGuestEnrollment,
  linkSelfProfileRequest, claimBrowserDevices, requestUdidDataDeletion,
  openDeletionRequest, listAdminUdidQueue, type AccountDbClient,
} from "../src/modules/accounts/ownership";

const USER_A = "11111111-2222-3333-4444-555555555555";
const USER_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const HASH = "b".repeat(64);

interface Call {kind: "select" | "rpc"; path: string; body?: Record<string, unknown>}
function fakeClient(handlers: {
  select?: (path: string) => unknown[];
  rpc?: (name: string, body: Record<string, unknown>) => unknown;
} = {}): {client: AccountDbClient; calls: Call[]} {
  const calls: Call[] = [];
  const client: AccountDbClient = {
    async select(path: string) {
      calls.push({kind: "select", path});
      return handlers.select ? handlers.select(path) : [];
    },
    async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
      calls.push({kind: "rpc", path: name, body});
      return (handlers.rpc ? handlers.rpc(name, body) : null) as T;
    },
  };
  return {client, calls};
}

const ROW = {
  id: "99999999-8888-7777-6666-555555555555", status: "pending_unverified",
  udid_suffix: "AB12", device_label: "iPhone của tôi", source: "self_profile",
  created_at: "2026-11-05T00:00:00Z", expires_at: "2026-12-05T00:00:00Z",
};

test("account device list is scoped to the verified user id and mapped safely", async () => {
  const {client, calls} = fakeClient({select: () => [ROW, {bogus: true}]});
  const devices = await listAccountDevices(client, USER_A);
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, new RegExp(`user_id=eq\\.${USER_A}`));
  assert.ok(!calls[0].path.includes("udid_ciphertext"), "list never selects the encrypted UDID");
  assert.equal(devices.length, 1);
  assert.equal(devices[0].udidSuffix, "AB12");
  assert.equal(devices[0].source, "self_profile");
  // Another account id scopes to that account only — there is no unscoped read.
  const other = fakeClient({select: () => []});
  await listAccountDevices(other.client, USER_B);
  assert.match(other.calls[0].path, new RegExp(`user_id=eq\\.${USER_B}`));
  // A malformed user id never reaches the database at all.
  const bad = fakeClient();
  assert.deepEqual(await listAccountDevices(bad.client, "not-a-uuid"), []);
  assert.equal(bad.calls.length, 0);
});

test("attach passes only ids from the verified session, never client data", async () => {
  const {client, calls} = fakeClient({rpc: () => true});
  assert.equal(await attachManualRequest(client, ROW.id, USER_A), true);
  assert.deepEqual(calls[0].body, {p_request_id: ROW.id, p_user_id: USER_A});
  assert.equal(await attachGuestEnrollment(client, HASH, USER_A), true);
  assert.deepEqual(calls[1].body, {p_browser_hash: HASH, p_user_id: USER_A});
  assert.equal(await linkSelfProfileRequest(client, HASH), true);
  assert.deepEqual(calls[2].body, {p_challenge_hash: HASH},
    "link supplies no user id — SQL reads the owner from the session row");
  const bad = fakeClient();
  assert.equal(await attachManualRequest(bad.client, "nope", USER_A), false);
  assert.equal(bad.calls.length, 0);
});

test("claim uses only credential hashes and sums what the RPCs grant", async () => {
  const {client, calls} = fakeClient({
    rpc: (name) => name === "claim_guest_enrollment_owner" ? true
      : name === "claim_manual_udid_requests" ? 1 : 2,
  });
  const result = await claimBrowserDevices(client,
    {manualTokenHash: HASH, enrollmentBrowserHash: HASH}, USER_A);
  assert.deepEqual(result, {manualRequests: 1, enrollments: 1, selfProfileRequests: 2, total: 3});
  assert.deepEqual(calls.map(c => c.path), [
    "claim_manual_udid_requests", "claim_guest_enrollment_owner", "claim_self_profile_udid_requests",
  ]);
  for (const call of calls) {
    for (const value of Object.values(call.body ?? {})) {
      if (typeof value === "string" && value !== USER_A)
        assert.match(value, /^[a-f0-9]{64}$/, "only hashes are ever presented");
    }
  }
});

test("claim without browser credentials is a no-op with zero database calls", async () => {
  const {client, calls} = fakeClient();
  const result = await claimBrowserDevices(client, {}, USER_A);
  assert.equal(result.total, 0);
  assert.equal(calls.length, 0);
});

test("deletion request raises and reads back the flag for this account only", async () => {
  const {client, calls} = fakeClient({
    rpc: () => ROW.id,
    select: () => [{id: ROW.id, user_id: USER_A, created_at: ROW.created_at}],
  });
  assert.equal(await requestUdidDataDeletion(client, USER_A), ROW.id);
  assert.deepEqual(calls[0].body, {p_user_id: USER_A});
  const open = await openDeletionRequest(client, USER_A);
  assert.equal(open?.id, ROW.id);
  assert.match(calls[1].path, new RegExp(`user_id=eq\\.${USER_A}`));
  assert.match(calls[1].path, /status=eq\.pending/);
});

test("admin queue maps owners and keeps guests ownerless", async () => {
  const {client} = fakeClient({
    select: () => [{...ROW, user_id: USER_A}, {...ROW, id: "88888888-7777-6666-5555-444444444444", user_id: null}],
  });
  const rows = await listAdminUdidQueue(client);
  assert.equal(rows[0].userId, USER_A);
  assert.equal(rows[1].userId, null);
});
