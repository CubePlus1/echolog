import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { resolveConfigPath } from "../src/core/config.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginRoot = join(repoRoot, "integrations/codex/echolog");

interface SkillOpenAiMetadata {
  policy?: { allow_implicit_invocation?: boolean };
}

interface PluginInterface {
  defaultPrompt?: unknown;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function readSkill(name: string): Promise<{
  metadata: Record<string, unknown>;
  body: string;
  openai: SkillOpenAiMetadata;
}> {
  const skillRoot = join(pluginRoot, "skills", name);
  const source = await readFile(join(skillRoot, "SKILL.md"), "utf8");
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, `${name} must have YAML frontmatter`);
  return {
    metadata: parse(frontmatter[1]) as Record<string, unknown>,
    body: source.slice(frontmatter[0].length),
    openai: parse(
      await readFile(join(skillRoot, "agents/openai.yaml"), "utf8")
    ) as SkillOpenAiMetadata,
  };
}

function commandExamples(body: string): string[] {
  return [...body.matchAll(/^el .+$/gm)].map((match) => match[0]);
}

test("skills-only Codex Plugin manifest does not declare deferred capabilities", async () => {
  const manifest = await readJson(join(pluginRoot, ".codex-plugin/plugin.json"));

  assert.equal(manifest.name, "echolog");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, undefined);
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.apps, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /TODO/);

  const pluginInterface = manifest.interface as PluginInterface;
  assert.deepEqual(pluginInterface.defaultPrompt, [
    "Use $track-work to start recording my current task in EchoLog.",
    "Use $track-work to add a blocker to my active EchoLog record.",
    "Use $review-work to summarize today's EchoLog activity.",
  ]);
});

test("EchoLog config resolution is independent of the Codex workspace", () => {
  assert.equal(resolveConfigPath(""), join(repoRoot, "config.yaml"));
  assert.equal(
    resolveConfigPath("fixtures/echolog-config.yaml"),
    join(process.cwd(), "fixtures/echolog-config.yaml")
  );
});

test("track-work is explicit-only and all EchoLog examples use JSON output", async () => {
  const skill = await readSkill("track-work");

  assert.equal(skill.metadata.name, "track-work");
  assert.match(String(skill.metadata.description), /never trigger it implicitly/i);
  assert.equal(skill.openai.policy?.allow_implicit_invocation, false);
  assert.match(skill.body, /Never guess/);
  assert.match(skill.body, /Do not access the EchoLog database/);
  assert.match(skill.body, /command -v el/);
  assert.match(skill.body, /el daemon status --json/);
  assert.match(skill.body, /do not start Docker or the daemon automatically/i);

  const examples = commandExamples(skill.body);
  assert.ok(examples.length >= 8);
  for (const command of examples) assert.match(command, /--json(?:\s|$)/);
  assert.ok(examples.every((command) => !/\b(cancel|edit|add|sync)\b/.test(command)));
});

test("review-work uses only documented read-oriented JSON commands", async () => {
  const skill = await readSkill("review-work");

  assert.equal(skill.metadata.name, "review-work");
  assert.equal(skill.openai.policy?.allow_implicit_invocation, true);
  assert.match(skill.body, /must not change records/i);
  assert.match(skill.body, /do not recalculate a different completion definition/i);
  assert.match(skill.body, /el daemon status --json/);
  assert.match(skill.body, /Do not start or reconfigure services automatically/);

  const examples = commandExamples(skill.body);
  assert.ok(examples.length >= 10);
  for (const command of examples) assert.match(command, /--json(?:\s|$)/);
  assert.ok(examples.every((command) =>
    !/^el (start|stop|pause|resume|note|cancel|edit|add|sync)\b/.test(command)
  ));
});
