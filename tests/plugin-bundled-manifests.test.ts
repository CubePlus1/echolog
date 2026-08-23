import assert from "node:assert/strict";
import test from "node:test";
import { validatePluginManifest } from "@echolog/plugin-sdk";
import { bundledPlugins } from "../src/core/plugins/registry.js";

test("every bundled plugin definition has a valid runtime manifest", () => {
  const errors = bundledPlugins.flatMap((definition) =>
    validatePluginManifest(definition.manifest).map(
      (error) => `${definition.manifest.id}: ${error}`
    )
  );

  assert.deepEqual(errors, []);
});
