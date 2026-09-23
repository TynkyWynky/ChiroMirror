import assert from "node:assert/strict";
import { test } from "node:test";
import { canManageFinanceGroup, hasPermission, parseSiteRole, type Profile } from "../src/lib/auth/access.ts";
import { validateInviteInput } from "../src/lib/auth/invite.ts";
import { getAvailableTabs, getNavigationGroups, resolveTab } from "../src/components/admin/navigation.ts";

function profile(role: Profile["role"], groups: string[] = []): Profile {
  return { user_id: "test-user", email: "user@example.com", full_name: "Test", role, managedGroupSlugs: groups, created_at: "" };
}

test("anonymous and neutral identities cannot manage SITE, profiles or legacy finance", () => {
  for (const actor of [null, profile("none"), profile("none", ["rakwi"])]) {
    for (const permission of ["site.manage", "site.team.manage", "site.finance.manage"] as const) {
      assert.equal(hasPermission(actor, permission), false);
    }
    assert.equal(canManageFinanceGroup(actor, "rakwi"), false);
  }
  assert.deepEqual(getAvailableTabs(null), []);
  assert.equal(resolveTab("team", null), null);
  assert.deepEqual(getAvailableTabs(profile("none")), []);
  assert.equal(resolveTab("posts", profile("none")), null);
});

test("existing editors keep SITE access and only their assigned group finances", () => {
  const editor = profile("editor", ["rakwi"]);
  assert.equal(hasPermission(editor, "site.manage"), true);
  assert.equal(hasPermission(editor, "site.team.manage"), false);
  assert.equal(canManageFinanceGroup(editor, "rakwi"), true);
  assert.equal(canManageFinanceGroup(editor, "tito"), false);
  assert.equal(canManageFinanceGroup(editor, ""), false);
  assert.equal(getAvailableTabs(profile("editor")).some(tab => tab.id === "finance"), false);
  assert.equal(resolveTab("finance", editor), "finance");
  assert.equal(resolveTab("team", editor), "overview");
});

test("all legacy admin sections remain under SITE, separate from the APP welcome", () => {
  const admin = profile("admin");
  const groups = getNavigationGroups(admin);
  assert.deepEqual(groups.map(group => group.label), ["SITE"]);
  assert.deepEqual(groups[0].tabs.map(tab => tab.id), [
    "overview", "posts", "messages", "finance", "home", "groups", "registration", "camp", "contact", "songs", "pages", "site", "team"
  ]);
  assert.equal(getAvailableTabs(admin).some(tab => tab.domain === "app"), false);
  for (const tab of getAvailableTabs(admin)) assert.equal(resolveTab(tab.id, admin), tab.id);
  assert.equal(canManageFinanceGroup(admin, ""), true);
  assert.equal(canManageFinanceGroup(admin, "rakwi"), true);
  assert.equal(hasPermission(admin, "site.team.manage"), true);
});

test("unknown roles fail closed instead of becoming editors", () => {
  for (const input of [null, undefined, "owner", "ADMIN", {}, 1]) assert.equal(parseSiteRole(input), "none");
  assert.equal(parseSiteRole("editor"), "editor");
  assert.equal(parseSiteRole("admin"), "admin");
});

test("invites require structured values and default to no editorial access", () => {
  assert.deepEqual(validateInviteInput({ email: " USER@example.com ", fullName: " Name " }), {
    success: true, data: { email: "user@example.com", fullName: "Name", role: "none" }
  });
  for (const role of ["none", "editor", "admin"] as const) {
    const result = validateInviteInput({ email: "user@example.com", role });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.role, role);
  }
  for (const input of [null, [], "x", { email: 1 }, { email: "invalid" },
    { email: "x@example.com", role: "owner" }, { email: "x@example.com", role: null },
    { email: "x@example.com", fullName: {} }, { email: "x@example.com", fullName: "x".repeat(121) }]) {
    assert.equal(validateInviteInput(input).success, false);
  }
});
