import assert from "node:assert/strict";
import test from "node:test";
import {
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginManifest,
} from "@echolog/plugin-sdk";

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: "sample-plugin",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    displayName: "Sample Plugin",
    description: "A plugin used by contract tests",
    entries: { server: "./dist/server.js" },
    capabilities: ["sample"],
    permissions: [],
    requires: { coreApi: "^1.0.0" },
    ...overrides,
  };
}

test("accepts a valid bundled plugin manifest", () => {
  assert.deepEqual(validatePluginManifest(manifest()), []);
});

test("rejects unstable ids, incompatible API versions, and duplicates", () => {
  const errors = validatePluginManifest(
    manifest({
      id: "Sample_Plugin",
      apiVersion: "2",
      permissions: ["process:exec", "process:exec"],
    })
  );

  assert.ok(errors.some((error) => error.includes("lowercase kebab-case")));
  assert.ok(errors.some((error) => error.includes("apiVersion")));
  assert.ok(errors.some((error) => error.includes("duplicates")));
});
