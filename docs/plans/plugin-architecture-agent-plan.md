# EchoLog 插件化重构 Agent 规划说明

## 角色与目标

你负责调查并规划 `/Users/sc/0code/0tools/echolog` 的插件化重构，同时核对 `/Users/sc/0code/tmux-status-package` 的外部 JSON 契约。当前阶段只完成 Trellis 规划和审核材料，不实现代码。

目标是把 EchoLog 收敛为主动记录 Core，并建立可信 bundled plugins：

- `screen-time`
- `tmux-status`

第一版只支持构建期注册的内置插件，不支持从 npm、GitHub 或任意磁盘路径安装和执行代码。

## 强制工作流

1. 完整阅读：
   - `AGENTS.md`
   - `.trellis/workflow.md`
   - `.trellis/spec/backend/index.md`
   - `.trellis/spec/backend/cli-agent-contract.md`
   - `.trellis/spec/backend/error-handling.md`
   - `.trellis/spec/backend/database-guidelines.md`
   - `.trellis/spec/frontend/index.md`
   - `.trellis/spec/frontend/directory-structure.md`
   - `.trellis/spec/guides/cross-layer-thinking-guide.md`
2. 运行只读预检：

```bash
trellis --version
cat .trellis/.version
python3 .trellis/scripts/task.py current --source
python3 .trellis/scripts/task.py list
python3 .trellis/scripts/get_context.py --mode packages
git status --short --branch
```

3. 当前已知状态：
   - 全局 CLI 为 `0.6.6`，项目模板为 `0.6.5`。
   - 当前无 active task。
   - Trellis 支持 parent/child、context validate 和 channel runtime。
   - Codex 未显式配置时采用 inline dispatch。
   - 项目当前仍被识别为 single-repo。
   - `07-22-p1-actor-effort-milestones` 为 planning，已有 PRD/design/context，但缺 `implement.md`。
4. `trellis update` 会更新受管理文件。执行前必须展示版本差异并取得用户授权；更新后重新读取 `AGENTS.md` 和 `.trellis/workflow.md`。
5. 创建 Trellis task 前必须取得用户对 task tree 的明确批准。
6. 未经第二次审核批准，不得运行 `task.py start`，不得修改业务代码、schema、配置或构建脚本。
7. 不得修改、提交或删除现有未跟踪文件：
   - `HEARTBEAT.md`
   - `IDENTITY.md`
   - `SOUL.md`
   - `TOOLS.md`
   - `USER.md`

## 规划产物

获得 task 创建授权后，创建：

```text
plugin-architecture
├── core-plugin-platform
├── screen-time-plugin
├── tmux-status-observability
└── tmux-agent-effort-integration
```

建议命令形状：

```bash
python3 .trellis/scripts/task.py create \
  "EchoLog bundled plugin architecture" \
  --slug plugin-architecture \
  --priority P1

python3 .trellis/scripts/task.py create \
  "Core plugin platform" \
  --slug core-plugin-platform \
  --parent <parent-task-dir> \
  --priority P1
```

其余子任务使用同样的 `--parent` 方式创建。不要假定父子关系能够表达依赖；每个依赖必须写入 PRD 和 implement plan。

父任务必须包含：

- `prd.md`：目标、非目标、任务地图、全局验收。
- `design.md`：Plugin API v1、信任边界、生命周期、数据流、兼容与回滚。
- `implement.md`：子任务顺序、集成闸门、最终验证和文档同步。
- `implement.jsonl`、`check.jsonl`：只放 spec/research 文件，不放源代码路径；删除 `_example` 行。

四个子任务都属于复杂任务，必须各自具备 `prd.md`、`design.md`、`implement.md`。完成后执行：

```bash
python3 .trellis/scripts/task.py validate <task-dir>
python3 .trellis/scripts/task.py list-context <task-dir>
```

展示完整规划供用户审核；停在 planning 状态。

## 依赖顺序

依赖必须固定为：

```text
tmux-status/json-contract-v2
  -> tmux-status-observability

actor-effort actor/span/aggregation foundation
  -> tmux-agent-effort-integration

core-plugin-platform
  -> screen-time-plugin
  -> final compatibility review
```

现有 actor-effort 任务保持独立，不得写成依赖 tmux 第二阶段。先补齐它的 `implement.md`，把 actor/span 数据模型、Core 写入接口和区间聚合作为 tmux 集成的前置能力。

tmux-status 仓库需单独建立 `json-contract-v2` Issue/Trellis task。EchoLog 不得复制 Python 采集实现。

## Plugin API v1 决策

### 定位

- 名称：Bundled Plugin API v1。
- 兼容承诺：内置插件源码接口和 wire contract 由自动化测试锁定。
- 非目标：动态安装、热卸载第三方代码、二进制 ABI、安全沙箱、插件商店。
- bundled 插件是可信进程内代码； permissions 只用于审计和 Host API 授权说明。

### Manifest

每个插件必须有 `echolog.plugin.json`，由 SDK 提供的 JSON Schema 验证：

```json
{
  "manifestVersion": 1,
  "id": "screen-time",
  "version": "1.0.0",
  "apiVersion": "1",
  "displayName": "Screen Time",
  "description": "Passive foreground application tracking",
  "entries": {
    "server": "./dist/server.js",
    "cli": "./dist/cli.js",
    "web": "./web/index.js"
  },
  "capabilities": [],
  "permissions": [],
  "requires": {
    "coreApi": "^1.0.0",
    "platforms": ["darwin"],
    "executables": []
  },
  "configSchema": "./config.schema.json"
}
```

插件 ID 使用稳定小写 kebab-case。`id` 一经发布不得更改。

### Registry 与 Loader

- `src/plugins/bundled.ts` 或等价文件显式 import 插件定义。
- manifest entry 是构建和审计元数据，不允许运行时从任意路径 dynamic import。
- loader 按 manifest validate、config validate、migrate、register、start 的顺序执行。
- disabled 插件不运行 migration、start 或 job，但兼容端点仍由 Core gateway 返回结构化 disabled 错误。
- 单插件失败进入 degraded；后续插件继续启动。
- shutdown 使用逆序、带 timeout 的 stop。

### PluginContext

首版只允许：

- `logger`
- 已校验且只读的 `config`
- namespaced route registrar
- non-overlapping job registrar
- plugin migration runner
- daily report section registrar
- bounded external command runner
- 明确列出的 Core services

禁止在 SDK 中暴露：

- 原始 Fastify 实例
- Core Drizzle DB 句柄
- 任意字符串事件总线
- 任意 shell command
- 修改 Core 汇总结果的 hook

所有 timer/job 必须支持 AbortSignal、防重入、超时、连续失败计数和停止清理。

### 状态与错误

状态机：

```text
disabled -> validating -> migrating -> starting -> ready|degraded -> stopping
```

固定错误码：

- `PLUGIN_DISABLED`
- `PLUGIN_DEGRADED`
- `PLUGIN_API_INCOMPATIBLE`
- `PLUGIN_DEPENDENCY_MISSING`
- `PLUGIN_EXEC_FAILED`
- `PLUGIN_TIMEOUT`
- `PLUGIN_OUTPUT_INVALID`

错误响应继续兼容 EchoLog 现有顶层字符串 `error`：

```json
{
  "error": "Plugin tmux-status output is invalid",
  "code": "PLUGIN_OUTPUT_INVALID",
  "pluginId": "tmux-status",
  "state": "degraded"
}
```

disabled/degraded 为 HTTP 503，外部进程超时为 504，损坏上游输出为 502，客户端参数错误为 400。

## Migration 决策

- 新增 Core 表 `plugin_migrations(plugin_id, name, checksum, applied_at)`。
- 每条插件 migration 独立事务；失败不得登记 applied。
- checksum 与已应用值不同视为 migration drift，插件 degraded。
- “插件独立 schema”仅表示独立 Drizzle schema 文件、表所有权和迁移序列。
- 不创建 PostgreSQL namespace。
- screen-time 认领既有 `app_usage`、`app_rules`，把全局 `002_screen_tracking` 视为 baseline；不得复制、重命名或重写历史数据。
- 新 tmux 表统一使用 `tmux_` 前缀。
- 插件不得直接写 Core records；Agent span 通过 Core service 创建。

## Web 决策

- 保持零框架，现有 Shell 改为原生 ESM。
- 定义 `WebContribution`：`nav`、`load`、`render`、`mount`、`unmount`。
- Shell 从 `/api/plugins` 读取 enabled/ready 状态，再 dynamic import 构建期已知的 bundled Web module。
- 插件只能通过 host API 获取 API client、escape helpers、navigation 和 cleanup hooks。
- 插件加载或 render 失败只影响自身导航和页面，不销毁 Core 书页状态。
- 禁用插件后不显示导航，但深链访问必须显示明确的 unavailable 状态。

## screen-time 子任务

- 移动 tracker、screen domain、Drizzle 定义、routes、CLI 命令和 Web 页面到插件所有权。
- 保留 `app_usage`、`app_rules` 和 `/api/screen/*`。
- `el screen` 仍为 HTTP 瘦客户端。
- 配置优先级：

```text
plugins.screen-time.enabled/config
  > legacy tracker
  > built-in defaults
```

- `plugins.screen-time.enabled: false` 永远优先。
- 只存在 legacy tracker 时自动映射并警告一次。
- screen-time 默认启用。
- 使用同一组 golden fixtures 比较拆分前后分类边界、跨夜规则、实时 segment 和历史结果。

## tmux-status 子任务

### 外部 contract v2

先在 tmux-status 增加：

- `schema_version`
- `tool_version`
- `server_instance_id`
- `pane_instance_id`
- 工具进程实例：tool、pid、started_at、instance_id

不得增加 prompt、回复、pane 内容、命令完整参数或私有 Agent API 数据。

`pane_instance_id` 必须：

- 对同一 pane 实例跨 snapshot 稳定。
- 在 server、pane 或根进程实例替换时变化。
- 作为不透明字符串消费，EchoLog 不自行重新计算。

### Adapter

- 只使用 `execFile(executable, ["status", "--json"])`。
- 禁止 shell。
- timeout、maxBuffer、环境变量白名单和 schema version 必须配置/测试。
- 无 tmux server返回成功空数组。
- `doctor` 检查 executable、版本和一次 status schema，不解析外部 doctor 文本。
- `mark` 执行后通过 `marks --json` 回读验证。
- `watch` 由 `el` 轮询 EchoLog API，不直接执行外部无限 watch。
- `watch --json` 为 JSONL；Ctrl-C 正常退出 0。

## Agent 工时子任务

- `link` 只建立 `pane_instance_id -> root_record_id` 关联。
- link 不打开计时区间。
- linked pane 只有显式 manual active 才打开 `actorType=agent` span。
- inactive、auto、unlink、pane stale 关闭 span。
- CPU、selected、tool alive 和自动 activity 永不直接写入工时。
- 检测到 pane instance 变化时：
  - 旧 link 标记 stale。
  - 开放 span 收在 `lastObservedAt`。
  - 不把 link 自动迁移到新 pane。
- daemon 重启：
  - 恢复时关闭遗留 open span 到最后持久化 observation。
  - 新 interval 从首次新 observation 开始。
  - 不补算 daemon 离线时间。
- snapshot 使用 pane/tool instance 与 observation timestamp 做幂等。
- 多工具歧义时要求用户明确 actor/tool，不猜测。

## 测试与验收

规划中必须指定使用 `node:test`、Fastify `inject`、fake clock、临时 PostgreSQL schema/database 和可注入 exec runner。

至少覆盖：

- manifest/config/schema/API version 校验
- disabled、validate、migration、start、job、report、Web failure isolation
- migration rollback、checksum drift、重复启动
- 所有插件关闭时 Core start/stop/pause/note/subtasks/status/log/report/sync
- screen 历史查询、分类和实时片段 parity
- legacy tracker 配置映射与新配置优先级
- tmux 无 server、Codex、Grok、多工具、超时、损坏 JSON、非零退出
- tmux server 重启、pane/PID 重用、tool process 重启
- link-only 不计时、manual active/inactive、stale、unlink
- 重复 snapshot、daemon 重启、并行 Agent、未关联不落库
- CLI `--json` 合法 JSON、watch JSONL、错误非零退出

最终集成命令：

```bash
pnpm test
pnpm build
el plugins list --json
el plugins doctor --json
el screen --json
el tmux status --json
curl -s http://localhost:19827/api/health
curl -s http://localhost:19827/api/plugins
```

构建成功后才按现有 launchd 流程重启 daemon。

## 文档要求

规划必须包含以下交付物：

- `docs/plugins/architecture.md`
- `docs/plugins/manifest.md`
- `docs/plugins/sdk.md`
- `docs/plugins/bundled/screen-time.md`
- `docs/plugins/bundled/tmux-status.md`
- `docs/API.md`
- `README.md`
- `config.yaml.example`

协议文档使用 MUST、SHOULD、MAY 表达规范性要求，并包含：

- API/manifest version 兼容矩阵
- lifecycle 和失败状态
- capabilities 与 permissions
- JSON schema 和完整示例
- HTTP/CLI 错误矩阵
- migration 规则
- 信任与隐私边界
- bundled plugin 开发、测试和排障步骤

## 审核输出

完成规划后只向用户展示：

1. Trellis 安装/版本检查结果。
2. 父子任务树和跨仓库依赖。
3. 每个 task 的 PRD/design/implement 摘要。
4. Plugin API v1 的公开类型、manifest 和错误契约。
5. 尚未解决且会改变产品语义的问题。
6. `task.py validate` 结果。

明确说明所有任务仍为 planning。不要询问“是否开始实现”；等待用户主动批准后再执行 `task.py start`。
