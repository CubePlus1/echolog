import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { resolveConfigPath } from "../src/core/config.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginRoot = join(repoRoot, "integrations/codex/echolog");

interface SkillOpenAiMetadata {
  interface?: { default_prompt?: string };
  policy?: { allow_implicit_invocation?: boolean };
}

interface PluginInterface {
  defaultPrompt?: unknown;
  composerIcon?: unknown;
  logo?: unknown;
}

interface McpManifest {
  mcpServers?: Record<string, {
    command?: unknown;
    args?: unknown;
  }>;
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

async function packageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await packageFiles(path));
    else files.push(path);
  }
  return files;
}

test("Codex Plugin packages Skills and the local stdio MCP server", async () => {
  const manifest = await readJson(join(pluginRoot, ".codex-plugin/plugin.json"));
  const mcp = await readJson(join(pluginRoot, ".mcp.json")) as McpManifest;

  assert.equal(manifest.name, "echolog");
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.apps, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /TODO/);

  const pluginInterface = manifest.interface as PluginInterface;
  assert.deepEqual(pluginInterface.defaultPrompt, [
    "Use $echolog:track-work to record my current task in EchoLog.",
    "Use $echolog:track-work to add a blocker to my active EchoLog record.",
    "Use $echolog:review-work to summarize today's EchoLog activity.",
  ]);
  assert.ok((pluginInterface.defaultPrompt as string[]).length <= 3);
  assert.ok((pluginInterface.defaultPrompt as string[]).every((prompt) => prompt.length <= 128));
  assert.equal(pluginInterface.composerIcon, "./assets/echolog.svg");
  assert.equal(pluginInterface.logo, "./assets/echolog.svg");
  await readFile(join(pluginRoot, "assets/echolog.svg"), "utf8");

  assert.deepEqual(Object.keys(mcp.mcpServers ?? {}), ["echolog"]);
  assert.equal(mcp.mcpServers?.echolog?.command, "./scripts/echolog-mcp");
  assert.deepEqual(mcp.mcpServers?.echolog?.args, []);
  assert.deepEqual(
    (mcp.mcpServers?.echolog as Record<string, unknown>).env_vars,
    ["PATH"]
  );
  const launcher = await readFile(join(pluginRoot, "scripts/echolog-mcp"), "utf8");
  assert.match(launcher, /exec .*el.* mcp/);
  assert.notEqual((await stat(join(pluginRoot, "scripts/echolog-mcp"))).mode & 0o111, 0);
  assert.doesNotMatch(JSON.stringify(mcp), /\/Users\/|postgres(?:ql)?:\/\//i);
});

test("Plugin package excludes secrets, personal state, and machine absolute paths", async () => {
  const textFiles = await packageFiles(pluginRoot);
  assert.ok(textFiles.length >= 8);
  for (const path of textFiles) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /\/Users\/[^\s"']+/);
    assert.doesNotMatch(source, /[A-Z]:\\Users\\/i);
    assert.doesNotMatch(source, /postgres(?:ql)?:\/\/[^\s"']+/i);
    assert.doesNotMatch(source, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    assert.doesNotMatch(source, /\bsk-[A-Za-z0-9_-]{20,}\b/);
  }
});

test("missing el fails the bundled MCP launcher explicitly", async () => {
  const mcp = await readJson(join(pluginRoot, ".mcp.json")) as McpManifest;
  const server = mcp.mcpServers?.echolog;
  assert.equal(server?.command, "./scripts/echolog-mcp");
  const result = spawnSync(String(server.command), server.args as string[], {
    cwd: pluginRoot,
    env: { PATH: "" },
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 127);
  assert.match(result.stderr, /EchoLog CLI not found/);
});

test("Plugin docs use the discovered marketplace and namespaced Skills", async () => {
  const pluginReadme = await readFile(join(pluginRoot, "README.md"), "utf8");
  const codexDocs = await readFile(join(repoRoot, "docs/CODEX.md"), "utf8");

  assert.match(pluginReadme, /read_marketplace_name\.py/);
  assert.match(pluginReadme, /echolog@\$\{echolog_marketplace\}/);
  assert.doesNotMatch(pluginReadme, /echolog@personal/);
  assert.match(codexDocs, /\$echolog:track-work/);
  assert.match(codexDocs, /\$echolog:review-work/);
  assert.match(codexDocs, /installed standalone[\s\S]*\$track-work[\s\S]*\$review-work/);
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
  assert.match(skill.openai.interface?.default_prompt ?? "", /\$echolog:track-work/);
  assert.match(skill.body, /Never guess/);
  assert.match(skill.body, /Do not access the EchoLog database/);
  assert.match(skill.body, /command -v el/);
  assert.match(skill.body, /el daemon status --json/);
  assert.match(skill.body, /do not start Docker or the daemon automatically/i);
  assert.match(skill.body, /Prefer the bundled `echolog` MCP tools/);
  for (const tool of ["get_status", "start_record", "control_record", "add_note", "get_subtasks"]) {
    assert.match(skill.body, new RegExp(`\\b${tool}\\b`));
  }

  const examples = commandExamples(skill.body);
  assert.ok(examples.length >= 8);
  for (const command of examples) assert.match(command, /--json(?:\s|$)/);
  assert.ok(examples.every((command) => !/\b(cancel|edit|add|sync)\b/.test(command)));
});

test("review-work uses only documented read-oriented JSON commands", async () => {
  const skill = await readSkill("review-work");

  assert.equal(skill.metadata.name, "review-work");
  assert.equal(skill.openai.policy?.allow_implicit_invocation, true);
  assert.match(skill.openai.interface?.default_prompt ?? "", /\$echolog:review-work/);
  assert.match(skill.body, /must not change records/i);
  assert.match(skill.body, /do not recalculate a different completion definition/i);
  assert.match(skill.body, /el daemon status --json/);
  assert.match(skill.body, /Do not start or reconfigure services automatically/);
  assert.match(skill.body, /Prefer the bundled `echolog` MCP tools/);
  for (const tool of ["get_status", "list_records", "get_subtasks", "generate_report", "get_screen_time"]) {
    assert.match(skill.body, new RegExp(`\\b${tool}\\b`));
  }
  assert.match(skill.body, /does not expose record notes/);

  const examples = commandExamples(skill.body);
  assert.ok(examples.length >= 10);
  for (const command of examples) assert.match(command, /--json(?:\s|$)/);
  assert.ok(examples.every((command) =>
    !/^el (start|stop|pause|resume|note|cancel|edit|add|sync)\b/.test(command)
  ));
});
