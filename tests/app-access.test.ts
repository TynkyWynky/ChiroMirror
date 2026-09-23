import assert from "node:assert/strict";
import { test } from "node:test";
import { getAvailableTabs } from "../src/components/admin/navigation.ts";
import { hasPermission, type Profile } from "../src/lib/auth/access.ts";
import { hasAppPermission, emptyAppAccess } from "../src/features/app/access.ts";
import { validateMember } from "../src/features/app/data.ts";
import { handleAppInvite, type AppInviteServices } from "../src/server/app-invite.ts";
import type { AppPermission } from "../src/features/app/types.ts";

test("APP navigation requires explicit permissions and grants no SITE rights", () => {
  const profile: Profile = { user_id: "test", email: "", full_name: "", role: "none", managedGroupSlugs: [], created_at: "" };
  const permissions: AppPermission[] = ["app.access", "members.read", "members.manage", "roles.read", "roles.manage"];
  assert.deepEqual(getAvailableTabs(profile, permissions).map(tab => tab.id), ["app-home", "app-tasks", "app-members", "app-settings"]);
  assert.equal(hasPermission(profile, "site.manage"), false);
  assert.equal(hasAppPermission(["members.read"], "members.read"), false);
  assert.deepEqual(getAvailableTabs(profile, ["app.access"]).map(tab => tab.id), ["app-home", "app-tasks", "app-settings"]);
  assert.deepEqual(getAvailableTabs(null, permissions), []);
});

test("member validation trims names and rejects invalid account/status/name", () => {
  const input = { first_name: " Ada ", last_name: " Test ", active: true, user_id: null };
  assert.deepEqual(validateMember(input), { ...input, first_name: "Ada", last_name: "Test" });
  for (const bad of [{ first_name: " " }, { last_name: "x".repeat(101) }, { user_id: "wrong" }, { active: null }]) {
    assert.throws(() => validateMember({ ...input, ...bad } as typeof input));
  }
});

test("APP invitations authenticate and authorize before any privileged side effect", async () => {
  let sent = 0;
  let completed = 0;
  const services: AppInviteServices = {
    getActor: async () => "actor", getAccess: async () => emptyAppAccess,
    invite: async () => { sent++; return { userId: "new-account", error: null }; },
    getMember: async () => ({ user_id: null }),
    complete: async (_token, _memberId, userId, roles) => {
      assert.equal(userId, "new-account"); assert.deepEqual(roles, ["MEMBER"]); completed++;
    }
  };
  const request = (body: unknown, token = "token") => new Request("https://example.test/api/app/invite", {
    method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body)
  });
  assert.equal((await handleAppInvite(request({}, ""), services)).status, 401);
  assert.equal((await handleAppInvite(request({}), { ...services, getActor: async () => null })).status, 401);
  assert.equal((await handleAppInvite(request({}), services)).status, 403);
  assert.equal(sent, 0);
  services.getAccess = async () => ({ ...emptyAppAccess, permissions: ["app.access", "members.manage", "roles.manage"] });
  assert.equal((await handleAppInvite(request({ email: "a@example.test", role: "admin" }), services)).status, 400);
  assert.equal(sent, 0);
  const payload = { email: "a@example.test", fullName: "A", memberId: "00000000-0000-0000-0000-000000000001", roles: ["MEMBER"] };
  assert.equal((await handleAppInvite(request({ ...payload, roles: ["INVALID"] }), services)).status, 400);
  assert.equal((await handleAppInvite(request(payload), { ...services, getMember: async () => ({ user_id: "existing" }) })).status, 409);
  assert.equal(sent, 0);
  const response = await handleAppInvite(request(payload), services);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).userId, "new-account");
  assert.equal(sent, 1);
  assert.equal(completed, 1);
  const partial = await handleAppInvite(request(payload), { ...services, complete: async () => { throw new Error("conflict"); } });
  assert.equal(partial.status, 409);
  assert.equal((await partial.json()).userId, "new-account");
  assert.equal((await handleAppInvite(request({}), { ...services, getAccess: async () => { throw new Error("offline"); } })).status, 503);
});
