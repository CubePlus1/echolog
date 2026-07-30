# EchoLog 插件化重构摘要

## 结论

插件化方向成立，但第一版应定位为 **Bundled Plugin API v1**：

- EchoLog Core 只保留主动记录、笔记、子任务、历史、日报、同步和记录提醒。
- screen-time 与 tmux-status 作为随 EchoLog 构建的可信内置插件。
- 第一版不安装或加载任意 npm、GitHub、磁盘插件，不承诺安全沙箱或第三方二进制兼容。
- SDK 通过版本号、manifest schema、自动化契约测试保持稳定，为以后开放第三方插件留边界。

借鉴 CLIProxyAPI 的重点是显式 capability、版本化协议、Host 保留安全策略和明确的进程内信任边界；借鉴 Wiki.js 的重点是声明式模块定义、配置 schema、启用状态与运行状态分离。不要在第一版照搬动态库、插件商店或通用扩展总线。

## 架构边界

### Core

Core 继续拥有：

- records、notes、subtasks、pauses、actor/span、milestones
- 主动记录统计口径和区间聚合算法
- 日报主结构、同步、鉴权、统一错误响应
- 插件注册表、配置校验、生命周期、迁移账本和健康状态

插件不能直接修改 Core 统计口径，也不能直接写 Core 表。需要写 Agent 工时的插件只能调用 Core 提供的窄接口。

### Plugin API v1

每个内置插件包含 `echolog.plugin.json`，至少声明：

- `manifestVersion`、`id`、`version`、`apiVersion`
- `displayName`、`description`
- `entries.server|cli|web`
- `capabilities`
- `permissions`
- `requires.coreApi|platforms|executables`
- `configSchema`

构建期注册表显式 import 插件；运行时不扫描任意代码。插件生命周期固定为：

```text
disabled
  -> validating
  -> migrating
  -> starting
  -> ready | degraded
  -> stopping
```

`PluginContext` 只暴露子 logger、插件配置、受限路由、非重入 job、插件迁移、日报 section、外部命令 runner 和必要的 Core service。首版不提供原始 Fastify、Core DB 句柄或宽泛事件总线。

插件权限是审计声明，不是假装存在的进程级沙箱。故障隔离依靠事务、超时、AbortSignal、能力边界和逐插件错误捕获。

## 运行协议

- `GET /api/plugins` 返回版本、配置状态、运行状态、capabilities、依赖检查、最近错误和失败次数。
- disabled 或 degraded 插件端点返回 HTTP 503：

```json
{
  "error": "Plugin screen-time is disabled",
  "code": "PLUGIN_DISABLED",
  "pluginId": "screen-time",
  "state": "disabled"
}
```

- Core `/api/health` 始终只反映 Core 健康，可兼容增加 degraded 插件数量。
- 插件 migration 使用 `plugin_migrations(plugin_id, name, checksum, applied_at)`；每条迁移独立事务。
- “独立 schema”指独立 Drizzle 定义和迁移所有权，不创建 PostgreSQL namespace。
- screen-time 继续使用 `app_usage`、`app_rules`，不搬表、不改名、不复制历史数据。

## Web 与 CLI

- Web Shell 保持无框架，但改为原生 ESM。
- bundled Web 模块通过受限 `WebContribution` 注册导航、加载、渲染、mount 和 unmount。
- 只加载 enabled 且 ready 的模块；插件 Web 失败不能破坏 Core 页面。
- `el screen`、`el tmux` 始终存在于 CLI help；执行时只经 HTTP 调 daemon。
- `--json` 继续透传 API JSON。`el tmux watch --json` 明确定义为一行一个 snapshot 的 JSONL。

## screen-time

- `plugins.screen-time.config` 优先于旧 `tracker`。
- 只有旧配置时自动映射并输出一次弃用警告。
- 新配置显式 `enabled: false` 不得被旧配置覆盖。
- 默认继续启用，保留 `/api/screen/*` 和 `el screen`。
- 禁用时兼容端点返回结构化 503，而不是普通 404。

## tmux-status

EchoLog 只做适配，不复制 Python 采集逻辑。调用方式固定为：

```text
execFile(configuredExecutable, ["status", "--json"])
```

必须设置超时、stdout 上限和严格 JSON schema 校验，不启用 shell。

tmux-status 需要先发布 JSON contract v2，补充：

- `schema_version`
- `tool_version`
- `server_instance_id`
- `pane_instance_id`
- 不含 prompt、回复或 pane 内容的工具进程实例元数据

`pane_instance_id` 在同一 pane 实例的连续快照间稳定，在 tmux server、pane 或根进程实例变化时改变。

无 tmux server 是成功空结果。缺少 executable、超时、损坏 JSON、版本不兼容和非零退出必须区分错误码，且不能拖垮 Core。

## Agent 工时

- `link` 只建立 pane 与根记录的归属，不开始计时。
- linked pane 仍需显式 `mark active` 才能打开 Agent 工时区间。
- `inactive`、`auto`、`unlink` 或 pane 实例消失关闭区间。
- CPU、selected、进程存活和自动 activity 只能作为观测数据，永远不能直接生成有效工时。
- link 绑定 `pane_instance_id`；实例变化后 link 进入 stale，不能自动转移。
- daemon 重启时旧区间收在 `lastObservedAt`；恢复后从首次新观测开新区间，不补算停机空档。
- 重复 snapshot 必须幂等；未 link 或只有自动推断的 pane 永不写主动记录。

actor-effort 的依赖方向应调整为：

```text
actor/span 数据模型与聚合
  -> tmux-status observability
  -> tmux Agent 工时适配
  -> 里程碑快照与跨层呈现
```

现有 actor-effort 任务不能反向依赖 tmux 第二阶段，否则形成循环。

## 任务拆分

EchoLog 使用一个 Trellis 父任务和四个子任务：

1. `plugin-architecture`
2. `core-plugin-platform`
3. `screen-time-plugin`
4. `tmux-status-observability`
5. `tmux-agent-effort-integration`

tmux-status 仓库另建 `json-contract-v2` 任务，作为 observability 的前置条件。现有 `p1-actor-effort-milestones` 保持独立，但先完成 actor/span/聚合能力，再由 tmux 集成消费。

## 验收重点

- 所有插件关闭时，Core 主动记录链路完整可用。
- 插件 validate、migration、start、job、report、Web 失败不影响 Core health。
- screen 拆分前后历史查询与分类 golden fixture 一致，数据库行零迁移、零丢失。
- tmux fixture 覆盖无 server、Codex、Grok、多工具歧义、超时、损坏 JSON、pane/PID 重用和 server 重启。
- Agent 工时覆盖 link、manual active/inactive、stale、unlink、重复快照、daemon 重启、并行 Agent 和未关联不落库。
- 最终执行 `pnpm test`、`pnpm build` 和 CLI/API 冒烟测试。

## Trellis 当前状态

- 全局 Trellis CLI 已安装：`0.6.6`。
- 仓库模板版本：`0.6.5`，建议在创建插件任务前审核并运行 `trellis update`。
- 父子任务、context 校验和 channel runtime 可用。
- 当前没有本会话 active task。
- Codex 默认是 inline dispatch；仓库没有 `.agents/` 或 `.codex/`，但已有 `.claude/` helpers 和 `.trellis/agents/` channel role cards。
- 当前 Trellis 仍识别为 single-repo；创建 pnpm workspace 后应同步 `.trellis/config.yaml` packages。
- `p1-actor-effort-milestones` 仍在 planning，context 校验通过，但缺少复杂任务应有的 `implement.md`。

