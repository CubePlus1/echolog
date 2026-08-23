import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PLUGIN_API_VERSION,
  SUPPORTED_PLUGIN_PERMISSIONS,
  validatePluginManifest,
  type PluginManifest,
  type PluginPermission,
} from "@echolog/plugin-sdk";

interface ManifestSchema {
  properties: {
    permissions: {
      items: {
        enum: string[];
      };
    };
  };
}

const manifestSchema = JSON.parse(
  readFileSync(
    new URL("../packages/plugin-sdk/echolog-plugin.schema.json", import.meta.url),
    "utf8"
  )
) as ManifestSchema;

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

test("accepts every supported plugin permission", () => {
  assert.deepEqual(
    validatePluginManifest(
      manifest({ permissions: [...SUPPORTED_PLUGIN_PERMISSIONS] })
    ),
    []
  );
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

test("runtime validation rejects unknown plugin permissions", () => {
  const errors = validatePluginManifest(
    manifest({ permissions: ["notifications:read" as PluginPermission] })
  );

  assert.ok(
    errors.some(
      (error) =>
        error === "permissions contains unsupported values: notifications:read"
    )
  );
});

test("manifest schema enumerates the exact supported permission vocabulary", () => {
  assert.deepEqual(
    manifestSchema.properties.permissions.items.enum,
    [...SUPPORTED_PLUGIN_PERMISSIONS]
  );
  assert.ok(
    !manifestSchema.properties.permissions.items.enum.includes(
      "notifications:read"
    )
  );
});
