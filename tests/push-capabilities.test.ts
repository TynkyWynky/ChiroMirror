import assert from "node:assert/strict";
import { test } from "node:test";
import { pushState, type PushCapabilities } from "../src/features/app/notifications/push.ts";

const capabilities = (overrides: Partial<PushCapabilities> = {}): PushCapabilities => ({
  secureContext: true,
  notificationApi: true,
  serviceWorkerApi: true,
  pushManagerApi: true,
  serviceWorkerRegistered: true,
  serviceWorkerActive: true,
  vapidPublicKeyConfigured: true,
  ios: false,
  installed: false,
  supported: true,
  permission: "default",
  ...overrides
});

test("push capability model separates device, configuration, permission and subscription states", () => {
  assert.equal(pushState(null), "CHECKING");
  assert.equal(pushState(capabilities({ supported: false })), "DEVICE_UNSUPPORTED");
  assert.equal(pushState(capabilities({ vapidPublicKeyConfigured: false })), "PUSH_NOT_CONFIGURED");
  assert.equal(pushState(capabilities({ permission: "denied" })), "PERMISSION_DENIED");
  assert.equal(pushState(capabilities({ serviceWorkerActive: false })), "SERVICE_WORKER_ERROR");
  assert.equal(pushState(capabilities()), "PERMISSION_DEFAULT");
  assert.equal(pushState(capabilities({ permission: "granted" })), "READY_TO_SUBSCRIBE");
  assert.equal(pushState(capabilities({ permission: "granted" }), true), "SUBSCRIBED");
});
