import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageApp, canManageDevice, canPublish, isStoreRole } from "../src/modules/auth/policy";
test("roles are constrained", () => {assert.equal(isStoreRole("admin"),true);assert.equal(isStoreRole("owner"),false);});
test("publisher may only manage own apps", () => {
 assert.equal(canManageApp("publisher","owner-a","owner-a"),true);
 assert.equal(canManageApp("publisher","owner-a","other"),false);
 assert.equal(canManageApp("user","owner-a","owner-a"),false);
});
test("publishing and device approval require admin", () => {
 for(const role of ["user","publisher"] as const){assert.equal(canPublish(role),false);assert.equal(canManageDevice(role),false);}
 assert.equal(canPublish("admin"),true);
});
