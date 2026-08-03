# CLI Agent Contract

> `el` CLI 是 EchoLog 面向智能体的第一等接口。本文是它对 agent 的可执行契约；改 CLI 时必须维持这些不变量。

---

## Scenario: CLI 作为 agent 工具面

### 1. Scope / Trigger

- 任何对 `src/cli/` 的改动（新命令、改参数、改输出）都触发本契约检查。
- 背景：旧的直连 Core MCP 已于 2026-07-08 移除；当前 `el mcp` 是本地 stdio 到 HTTP API 的瘦适配层。有 shell 的 agent 仍可直接通过 CLI 使用 EchoLog，`el --help` 即工具说明书。

### 2. Signatures

- CLI 与 MCP 共用 HTTP 瘦客户端（`src/client/api.ts`；`src/cli/api.ts` 保留兼容 re-export），**不 import core 业务模块**（读 config 拿 port/apiKey 除外）。
- CLI 默认只读 EchoLog 安装根的 `config.yaml`；不得因当前工作目录存在其他项目的同名文件而切换配置。替代配置必须显式通过 `ECHOLOG_CONFIG_PATH` 指定。
- 全局 `--json` 选项：program 级注册，子命令 action 内经 `program.opts()` 读取。
- 省略 id 的命令（stop/pause/resume/note/cancel）走 `/api/records/active` 系列端点，客户端不做推断（见 error-handling.md 能力下沉原则）。

### 3. Contracts

- `--json` 成功输出 = API 原始响应（对象或数组），**不二次包装**。
- `--json` 错误输出 = API 错误体原样（`{"error", ...候选等结构化字段}`）或本地错误 `{"error": msg}`。
- 人类模式输出可读格式（`✓/⏸/▶/✗` 前缀等），既有格式是兼容面，只增不破坏。
- help 即工具说明：program description 写工具定位 + agent 使用建议（--json、退出码、省略 id 语义）；每个子命令 description 写语义、参数取值枚举（type: learning|project|task）、时间格式（YYYY-MM-DD / HH:mm / 90m|2h / ISO 带时区）；`addHelpText("after")` 附示例。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| 成功 | exit 0，stdout 输出结果 |
| API 4xx/5xx | exit 非 0，人类模式 stderr 打印消息（409 歧义额外打印候选 id/title/status 列表）；`--json` 输出错误体 JSON |
| 连接失败 | exit 非 0，提示 `el daemon start`；`--json` 输出 `{"error": ...}` |
| 本地参数校验失败 | exit 非 0，stderr 提示 |

禁止：打印提示后静默 `return`（exit 0）——错误路径必须 `process.exitCode = 1`。

### 5. Good/Base/Bad Cases

- Good：`el stop --json`（无活跃）→ stderr/`{"error":"没有可操作的活跃记录"}`，exit 1。
- Base：`el status --json | python3 -m json.tool` 永远是合法 JSON。
- Bad：新命令只有人类输出没有 `--json`；错误走 stdout；409 丢弃 candidates。

### 6. Tests Required

改 CLI 后至少验证（daemon 不可达时用 `node dist/cli/index.js` + 连接失败路径）：

```bash
el status --json | python3 -m json.tool   # 合法 JSON
el stop; echo $?                           # 无活跃 → 非 0
el --help && el <改动的子命令> --help       # help 契约完整
```

### 7. Wrong vs Correct

#### Wrong

```typescript
if (!id) {
  const active = await api("/api/records/active");   // 客户端推断
  if (active.length === 1) id = active[0].id;
  else { console.log("请指定任务 id"); return; }      // exit 0 假成功
}
```

#### Correct

```typescript
const path = id ? `/api/records/${id}` : "/api/records/active";  // 服务端推断
const record = await patch(path, { action: "stop" });            // 409 由统一错误处理展开 candidates 并置非 0 退出码
```

### 8. Codex Skill 与 MCP Client

`integrations/codex/echolog` 是 EchoLog 的外部 Codex Plugin 包，不属于 Core 的 Bundled Plugin API v1。Skills 必须维持以下边界：

- `$track-work` 的写操作只允许显式调用或用户明确要求修改 EchoLog 记录，禁止因普通编码任务隐式开始/停止记录。
- `$review-work` 只调用 status、today、log、subtasks、notes、report、screen 等读向命令，不得调用记录、规则、插件或 daemon 写操作。
- 两个 Skill 都先检查 `el` 与 `el daemon status --json`，所有业务命令都使用 `--json`。
- 已知 record id 时必须显式传 id；收到 409 `candidates` 时展示候选并请求选择，禁止客户端猜测。
- Skill 不读取 `config.yaml`、不直连 PostgreSQL、不 import Core，也不自动启动 Docker/daemon。
- 自动化契约由 `tests/codex-plugin.test.ts` 覆盖；结构另用官方 Skill/Plugin validators 验证。

`el mcp` 同样只调用 HTTP API，不得 import recorder、reporter、数据库、插件 host 或 routes。成功调用使用匹配 `outputSchema` 的 `structuredContent`；错误使用 `isError: true` 和保留原始 API 字段的 JSON text content，避免 SDK 客户端按成功 schema 校验错误体。MCP 不以适配协议为由复制服务端逻辑。
