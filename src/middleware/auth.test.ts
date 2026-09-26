import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { unguardedDb } from "../utils/db";
import { signToken } from "../utils/auth";
import { authGate } from "./auth";

const MARK = "__authgate_test__";
let activeId = 0;
let inactiveId = 0;

/** Just enough of Express to see which way the gate went. */
const run = async (token: string | undefined, path = "/payments", method = "GET") => {
  const req: any = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    method,
    path,
    get: () => undefined,
  };
  const result: any = { status: null, body: null, passed: false, error: null };
  const res: any = {
    status(code: number) { result.status = code; return res; },
    json(body: any) { result.body = body; return res; },
  };
  await authGate(req, res, (err?: any) => { result.passed = !err; result.error = err ?? null; });
  result.user = req.user;
  return result;
};

before(async () => {
  await unguardedDb("users").where("email", "like", `${MARK}%`).del();
  [activeId] = await unguardedDb("users").insert({
    name: `${MARK} Active`, email: `${MARK}-active@test.local`,
    password_hash: "x", role: "staff", is_active: true,
  });
  [inactiveId] = await unguardedDb("users").insert({
    name: `${MARK} Gone`, email: `${MARK}-gone@test.local`,
    password_hash: "x", role: "admin", is_active: false,
  });
});

after(async () => {
  await unguardedDb("users").where("email", "like", `${MARK}%`).del();
  await unguardedDb.destroy();
});

test("a valid token for a live account passes", async () => {
  const r = await run(signToken({ id: activeId, email: `${MARK}-active@test.local`, role: "staff" } as any));
  assert.equal(r.passed, true);
  assert.equal(r.user.id, activeId);
});

// A signed token outlives the account it names. This is the bug that showed up
// as "Reference check failed" deep inside a write: the gate waved through a
// token for a user who no longer existed.
test("a token naming a deleted account is refused at the gate", async () => {
  const ghost = signToken({ id: 99999999, email: "ghost@test.local", role: "admin" } as any);
  const r = await run(ghost);
  assert.equal(r.passed, false);
  assert.equal(r.status, 401);
  assert.match(r.body.message, /sign in again/i);
});

// Deactivating is how access is taken away -- it has to actually take it away.
test("a deactivated user's token stops working immediately", async () => {
  const r = await run(signToken({ id: inactiveId, email: `${MARK}-gone@test.local`, role: "admin" } as any));
  assert.equal(r.passed, false);
  assert.equal(r.status, 401);
});

// The role comes from the account, so a demotion does not wait for a new login.
test("the role is read from the account, not the token", async () => {
  const stale = signToken({ id: activeId, email: `${MARK}-active@test.local`, role: "admin" } as any);
  const r = await run(stale);
  assert.equal(r.passed, true);
  assert.equal(r.user.role, "staff", "the token claimed admin; the account says staff");
});

test("a dead token still browses the public storefront as a guest", async () => {
  const ghost = signToken({ id: 99999999, email: "ghost@test.local", role: "admin" } as any);
  const r = await run(ghost, "/jewelries");
  assert.equal(r.passed, true);
  assert.equal(r.user, undefined, "a guest carries no identity");
});

test("no token is refused on a private route", async () => {
  const r = await run(undefined);
  assert.equal(r.status, 401);
});
