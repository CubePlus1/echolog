# EchoLog HTTP API

EchoLog server（默认 `http://<host>:19827`）暴露一组 REST 接口，可以从任何地方用 HTTP 请求读写自己的记录。Web 前端、CLI（`el`）和本地 stdio MCP 都走同一组 REST 接口。

## 鉴权

在 `config.yaml` 中设置 `server.apiKey` 后：

- **本机请求（127.0.0.1 / ::1）豁免** —— 本机浏览器、CLI 无需任何配置；
- **非本机请求访问 `/api/*` 必须带 key**，两种方式任选：
  - 请求头：`X-API-Key: <key>`
  - 查询参数：`?apiKey=<key>`
- `GET /api/health` 永远无需鉴权；
- 未带或带错 key 返回 `401 {"error":"Unauthorized"}`；
- 不设置 `apiKey` 则完全关闭鉴权。

```bash
# 从另一台机器获取自己最近的记录
curl -H "X-API-Key: $ECHOLOG_KEY" "http://<host>:19827/api/records?limit=20"
```

### Web 托管与跨源访问

`server.serveWeb` 默认开启，server 会同时托管静态 Web UI 与 `/api/*`。设为 `false` 后，此进程只提供 `/api` 纯 JSON 接口，不再托管静态 Web UI。

`server.corsOrigins` 是允许跨源浏览器访问的 origin 白名单数组。默认不允许跨源；同源请求和非浏览器客户端（如 CLI、curl）不受影响。

浏览器访问本 server 托管的 Web UI 属同源，仅需 `server.apiKey` 保护非本机 `/api/*`。只有当前端与 API 不同源时（例如独立开发服务器提供前端），才需要配置 `server.corsOrigins` 允许该前端 origin 发起跨源请求。

## 智能体如何使用 EchoLog

有 shell 的 agent 直接使用 `el` CLI。`el --help` 是工具说明书，子命令 help 会列出语义、取值与示例。

需要机器可读结果时，优先使用支持 `--json` 的命令（例如 `el status --json`、`el log --json`、`el start <title> --json`）。命令成功返回 0；连接失败、鉴权失败、找不到记录、唯一活跃记录存在歧义等错误场景返回非 0，错误信息写到 stderr 或 JSON 错误体。

支持 MCP 的本机 agent 可运行 `el mcp`；它是本页 HTTP API 的瘦适配层，业务逻辑仍由 REST API 与 core 承载。工具清单、Codex 注册方式和 MCP 错误契约见 [MCP Server](MCP.md)。

## 数据模型

**Record**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | nanoid |
| `title` | string | 标题 |
| `type` | string | `learning` \| `project` \| `task` |
| `tags` | string[] | 标签 |
| `project` | string \| null | 所属项目 |
| `parentId` | string \| null | 父任务记录 id；null 表示根任务 |
| `startAt` / `endAt` | ISO 时间 | 开始 / 结束（进行中为 null） |
| `status` | string | `running` \| `paused` \| `done` \| `cancelled` |
| `durationSeconds` | number | 净时长（不含暂停） |
| `result` | string \| null | 结果总结 |
| `source` | string | `cli` \| `web` \| `api` |

**Note**：`{ id, recordId, content, type: note|blocker|next, createdAt }`

## 端点

### 健康检查

```bash
curl http://localhost:19827/api/health
# {"status":"ok","timestamp":"..."}
```

### 查询记录

```bash
# 最近记录（默认按开始时间倒序，limit 默认 50）
curl "http://localhost:19827/api/records?limit=100"

# 某一天（本地日期）
curl "http://localhost:19827/api/records?date=2026-07-04"

# 某时刻之后 / 按项目 / 按类型 / 按父任务（可组合）
curl "http://localhost:19827/api/records?since=2026-07-01T00:00:00+08:00&project=eoove&type=learning"

# 直接子任务；parentId=root 查询根任务
curl "http://localhost:19827/api/records?parentId=<parent-id>"
curl "http://localhost:19827/api/records?parentId=root"

# 单条
curl "http://localhost:19827/api/records/<id>"

# 进行中（含实时时长 liveDurationSeconds、lastResumedAt）
curl "http://localhost:19827/api/records/active"
```

查询参数：`date`（YYYY-MM-DD，设置后忽略其余过滤）、`since`（ISO 时间）、`project`、`type`、`parentId`（记录 id 或 `root`）、`limit`。

### 父任务与子任务

创建或补录时通过 `parentId` 把记录挂到父任务；编辑时传字符串可改挂，传 `null` 可提升为根任务。父任务必须存在且不能是已取消记录，关系不能自指或形成环。

```bash
# 创建子任务
curl -X POST http://localhost:19827/api/records \
  -H "Content-Type: application/json" \
  -d '{"title":"实现登录接口","type":"task","parentId":"<parent-id>"}'

# 改挂 / 清除父任务
curl -X PATCH http://localhost:19827/api/records/<id> \
  -H "Content-Type: application/json" -d '{"action":"edit","parentId":"<new-parent-id>"}'
curl -X PATCH http://localhost:19827/api/records/<id> \
  -H "Content-Type: application/json" -d '{"action":"edit","parentId":null}'

# 父任务、直接子任务与进度
curl http://localhost:19827/api/records/<id>/subtasks
```

`GET /api/records/<id>/subtasks` 返回：

```json
{
  "parent": { "id": "parent", "title": "大任务", "parentId": null },
  "subtasks": [
    { "id": "child", "title": "小任务", "parentId": "parent", "status": "done" }
  ],
  "progress": { "total": 1, "done": 1, "active": 0, "cancelled": 0, "percent": 100 }
}
```

`percent` 按 `done / (total - cancelled)` 计算；没有有效子任务时为 0。父任务不会因为子任务完成而自动改变状态。

### 开始 / 控制记录

```bash
# 开始一条记录（只有 title 必填；type 默认 task，source 默认 api）→ 201
curl -X POST http://localhost:19827/api/records \
  -H "Content-Type: application/json" \
  -d '{"title":"读《史记》三十页","type":"learning","tags":["读书"],"project":"修身","parentId":null}'

# 暂停 / 继续 / 停止（可附结果）/ 编辑
curl -X PATCH http://localhost:19827/api/records/<id> \
  -H "Content-Type: application/json" -d '{"action":"pause"}'

curl -X PATCH http://localhost:19827/api/records/<id> \
  -H "Content-Type: application/json" -d '{"action":"resume"}'

curl -X PATCH http://localhost:19827/api/records/<id> \
  -H "Content-Type: application/json" -d '{"action":"stop","result":"读毕，摘记三条"}'

curl -X PATCH http://localhost:19827/api/records/<id> \
  -H "Content-Type: application/json" -d '{"action":"edit","title":"改个标题","tags":["读书","史"]}'

# 对唯一活跃记录操作（省略 id）：pause/stop 匹配唯一 running，resume 匹配唯一 paused，
# edit 匹配唯一 running 或 paused。0 条返回 404，多条返回 409 candidates。
curl -X PATCH http://localhost:19827/api/records/active \
  -H "Content-Type: application/json" -d '{"action":"pause"}'

# 作废（cancel）
curl -X DELETE http://localhost:19827/api/records/<id>

# 作废唯一活跃记录（running 或 paused）
curl -X DELETE http://localhost:19827/api/records/active

# 停掉所有进行中的记录
curl -X POST http://localhost:19827/api/records/stop-all

# 补录（backfill）：startAt + durationMinutes 必填 → 201
curl -X POST http://localhost:19827/api/records/backfill \
  -H "Content-Type: application/json" \
  -d '{"title":"晨跑","startAt":"2026-07-04T07:00:00+08:00","durationMinutes":40,"result":"5km"}'
```

### 笔记

```bash
# 给记录添加笔记（type: note | blocker | next，默认 note）→ 201
curl -X POST http://localhost:19827/api/records/<id>/notes \
  -H "Content-Type: application/json" -d '{"content":"卡在第三章","type":"blocker"}'

# 给唯一活跃记录添加笔记（running 或 paused；0 条返回 404，多条返回 409 candidates）
curl -X POST http://localhost:19827/api/records/active/notes \
  -H "Content-Type: application/json" -d '{"content":"卡在第三章","type":"blocker"}'

# 读取记录的笔记
curl "http://localhost:19827/api/records/<id>/notes"
```

### 插件状态

```bash
# 清单：enabled/state/version/capabilities/permissions/error
curl "http://localhost:19827/api/plugins"

# 执行各插件依赖检查；任一启用插件失败时返回 503，且响应保留 error/ok/plugins
curl "http://localhost:19827/api/plugins/doctor"
```

插件 API 使用 `/api/plugins/<id>/*`。disabled/degraded 插件不会影响
`/api/health`，其自身端点返回结构化 503。doctor 失败体为
`{"error":"...","ok":false,"plugins":[...]}`，因此 CLI 在非零退出时仍可
展示每个插件的检查结果。

### screen-time（macOS 被动采样）

screen-time 内置插件默认启用。它每 5 秒采样前台应用（通过
`plugins.screen-time.config` 调参），落成连续使用片段。分类**在查询时**
按规则计算——改规则即可追溯重分历史。

```bash
# 今日屏幕使用：{ date, totalSeconds, byLabel, apps, segments }
curl "http://localhost:19827/api/screen/today"

# 指定日期
curl "http://localhost:19827/api/screen/daily/2026-07-05"

# 列出分类规则（priority 降序）
curl "http://localhost:19827/api/screen/rules"

# 立例：04:00–06:00 的微信算「工作」（priority 高者胜）
curl -X POST http://localhost:19827/api/screen/rules \
  -H "Content-Type: application/json" \
  -d '{"appMatch":"微信","label":"工作","startTime":"04:00","endTime":"06:00","priority":10}'

# 其余时间的微信算「生活」（全天例，低优先级兜底）
curl -X POST http://localhost:19827/api/screen/rules \
  -H "Content-Type: application/json" \
  -d '{"appMatch":"微信","label":"生活"}'

# 废除规则
curl -X DELETE http://localhost:19827/api/screen/rules/<id>
```

以上 `/api/screen/*` 是兼容别名；规范路径为
`/api/plugins/screen-time/*`，响应相同。插件禁用时两者均返回
`PLUGIN_DISABLED`。

规则语义：

- `appMatch`：大小写不敏感**子串**，同时匹配 bundle id（`com.tencent.xinWeChat`）与应用名（`微信`）
- `startTime`/`endTime`：本地时区半开区间 `[start, end)`，须成对出现；省略即全天；`start > end` 表示跨夜（如 `22:00`–`02:00`）
- `weekdays`：整数数组，0=周日；省略即每天
- `priority`：整数，高者胜；平局时带时段的规则胜过全天规则
- 片段会按规则时段边界自动切开，各段独立归名；无匹配规则 → `未分`

#### screen-understanding settings

screen-understanding 提供运行时设置、Provider 元数据与 Keychain 密钥管理、一次性
截图测试和真正的 opt-in vision 识别。启用后由 screen-time 插件按设置周期采集活动
显示器，调用 OpenAI-compatible provider，并保存结构化理解结果；原始截图只在单次
请求期间存在，不进入数据库或历史接口。本组端点都是 screen-time 插件 canonical
路径，没有 `/api/screen/*` 兼容别名。

```bash
# 读取当前完整设置对象
curl "http://localhost:19827/api/plugins/screen-time/understanding/settings"

# 全量替换可变设置；expectedVersion 必须等于当前 version
curl -X PUT http://localhost:19827/api/plugins/screen-time/understanding/settings \
  -H "Content-Type: application/json" \
  -d '{
    "expectedVersion": 1,
    "enabled": false,
    "captureIntervalSeconds": 60,
    "captureDisplay": "active",
    "skipWhenIdle": true,
    "providerProfileId": null,
    "requestTimeoutMs": 30000,
    "maxConcurrency": 1,
    "maxAttempts": 3,
    "dailyRequestBudget": 480,
    "dailyCostBudgetMicros": 0,
    "remoteConsentOrigin": null
  }'
```

`GET /api/plugins/screen-time/understanding/settings` 返回 `200` 和完整对象：

```json
{
  "id": "default",
  "version": 1,
  "enabled": false,
  "captureIntervalSeconds": 60,
  "captureDisplay": "active",
  "skipWhenIdle": true,
  "providerProfileId": null,
  "requestTimeoutMs": 30000,
  "maxConcurrency": 1,
  "maxAttempts": 3,
  "dailyRequestBudget": 480,
  "dailyCostBudgetMicros": 0,
  "remoteConsentOrigin": null,
  "updatedAt": "2026-08-06T00:00:00.000Z"
}
```

`PUT` 是全量更新：除 `expectedVersion` 外必须提供下表中的每个字段，不能
携带未知字段。成功返回 `200` 和同样的完整对象；服务器原子地检查
`expectedVersion`，成功后将 `version` 加一。

| 字段 | 类型 / 范围 | 说明 |
|---|---|---|
| `expectedVersion` | integer `1`–`2147483647` | 乐观并发前置版本；不包含在返回对象中 |
| `enabled` | boolean | 是否启用周期 screen-understanding 工作；关闭时不会自动截图或调用模型 |
| `captureIntervalSeconds` | integer `60`–`3600` | 周期识别间隔 |
| `captureDisplay` | string，固定为 `active` | 当前唯一支持的显示器选择 |
| `skipWhenIdle` | boolean | 是否跳过空闲时段 |
| `providerProfileId` | `null` 或 1–100 个字符 | 可含 ASCII 字母、数字、`.`、`_`、`:`、`-`；首字符必须是字母或数字；首尾空白会被去除 |
| `requestTimeoutMs` | integer `1000`–`120000` | 单次请求超时毫秒数 |
| `maxConcurrency` | integer `1`–`8` | 最大并发数 |
| `maxAttempts` | integer `1`–`10` | 最大尝试次数 |
| `dailyRequestBudget` | integer `1`–`1440` | 每日请求预算 |
| `dailyCostBudgetMicros` | integer `0`–`2000000000` | 每日成本预算，单位为 micro-units |
| `remoteConsentOrigin` | `null`、HTTPS origin 或 HTTP loopback origin | 只能是 origin；不得含凭据、路径、query 或 fragment。HTTP 仅允许 `localhost`、`127.0.0.1`、`[::1]`；成功值按 URL origin 规范化 |

`PUT` 成功时返回 `200`，例如：

```json
{
  "id": "default",
  "version": 2,
  "enabled": true,
  "captureIntervalSeconds": 120,
  "captureDisplay": "active",
  "skipWhenIdle": true,
  "providerProfileId": "vision-primary",
  "requestTimeoutMs": 30000,
  "maxConcurrency": 2,
  "maxAttempts": 3,
  "dailyRequestBudget": 480,
  "dailyCostBudgetMicros": 0,
  "remoteConsentOrigin": "https://vision.example.com",
  "updatedAt": "2026-08-06T00:01:00.000Z"
}
```

校验失败返回 `400`，响应至少包含 `error`；例如缺少全量字段、携带未知
字段、数值越界、`captureDisplay` 不是 `active`、非法 provider profile id，
或使用不安全的 consent origin：

```json
{
  "error": "captureIntervalSeconds must be an integer from 60 to 3600"
}
```

如果 `expectedVersion` 已过期，服务器不写入请求值，返回 `409` 及当前版本：

```json
{
  "error": "screen understanding settings version conflict",
  "currentVersion": 2
}
```

#### screen-understanding providers 与 Keychain

Provider metadata 存在 PostgreSQL；API Key 只存在当前 macOS 用户的 Keychain，
API 永不返回原文或掩码片段。支持的 provider kind 当前固定为
`openai-compatible`。

```bash
curl http://localhost:19827/api/plugins/screen-time/understanding/providers

curl -X POST http://localhost:19827/api/plugins/screen-time/understanding/providers \
  -H 'Content-Type: application/json' \
  -d '{"id":"vision-primary","displayName":"Primary vision","providerKind":"openai-compatible","baseUrl":"https://api.openai.com/v1","model":"vision-model"}'

curl -X PUT http://localhost:19827/api/plugins/screen-time/understanding/providers/vision-primary \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":1,"displayName":"Primary vision","providerKind":"openai-compatible","baseUrl":"https://api.openai.com/v1","model":"vision-model"}'

curl -X DELETE http://localhost:19827/api/plugins/screen-time/understanding/providers/vision-primary \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":2}'

# 本机录入/替换 Keychain 密钥
curl -X PUT http://localhost:19827/api/plugins/screen-time/understanding/providers/vision-primary/key \
  -H 'Content-Type: application/json' \
  -d '{"apiKey":"REPLACE_LOCALLY"}'

curl -X DELETE http://localhost:19827/api/plugins/screen-time/understanding/providers/vision-primary/key
```

`GET /providers` 返回 `{ "providers": [...] }`。单个 profile 形状为：

```json
{
  "id": "vision-primary",
  "version": 1,
  "displayName": "Primary vision",
  "providerKind": "openai-compatible",
  "baseUrl": "https://api.openai.com/v1",
  "model": "vision-model",
  "hasApiKey": true,
  "createdAt": "2026-08-11T00:00:00.000Z",
  "updatedAt": "2026-08-11T00:00:00.000Z"
}
```

字段约束：

- `id`：1–100 字符，匹配 `[A-Za-z0-9][A-Za-z0-9._:-]*`，创建后不可改；最多 20 个 profile。
- `displayName`：trim 后 1–80 字符。
- `providerKind`：当前必须为 `openai-compatible`。
- `baseUrl`：HTTPS，或 loopback 主机上的 HTTP；不得含凭据、query 或 fragment，尾部 `/` 会归一化。
- `model`：trim 后 1–200 字符，不得含控制字符。
- `expectedVersion`：1–2147483647 的整数；PUT/DELETE 均使用乐观并发。
- `apiKey`：UTF-8 1–4096 bytes，不得有首尾空白、换行或 NUL。

Keychain 状态正常时 `hasApiKey` 为 boolean；helper/Keychain 暂时不可用时为
`null`，metadata 仍可读取和编辑，Web 显示“密钥状态不可用”。

新建成功为 `201`；更新成功为 `200` 且 version 加一；删除 metadata 成功为
`204`。非法字段/URL/key 返回 `400`；不存在返回 `404`；版本过期、profile
仍被 settings 选择、启用时删除 key，或启用设置却没有可用 key，返回 `409`。
Keychain helper 不可用/失败/超时分别返回脱敏的 `503`/`502`/`504`。
Key 的 PUT/DELETE 仅接受 loopback 请求，远端请求返回 `403 PLUGIN_LOCAL_ONLY`。

Key PUT/DELETE 成功响应分别为：

```json
{ "id": "vision-primary", "hasApiKey": true }
```

```json
{ "id": "vision-primary", "hasApiKey": false }
```

典型结构化错误（响应绝不包含 key 原文）：

```json
{ "error": "provider profile vision-primary not found", "code": "PROVIDER_PROFILE_NOT_FOUND" }
```

```json
{ "error": "provider profile vision-primary version conflict", "code": "PROVIDER_PROFILE_CONFLICT", "currentVersion": 3 }
```

其他稳定冲突 code 包括 `PROVIDER_PROFILE_IN_USE`、`PROVIDER_PROFILE_LIMIT`、
`PROVIDER_KEY_REQUIRED`；平台/helper code 包括 `KEYCHAIN_UNAVAILABLE`、
`KEYCHAIN_OPERATION_FAILED` 和 `PLUGIN_TIMEOUT`。

#### 显式测试截图

`POST /api/plugins/screen-time/understanding/capture/test` 仅接受 loopback 请求和
空 JSON 对象。调用方不能指定输出路径。daemon 在 mode `0700` 的私有临时目录
以 exclusive create 预建 mode `0600` 的结果 JSON 与 stderr log，并生成 PNG
固定路径，再通过
`/usr/bin/open -W -n -o <result> --stderr <log> <EchoLogScreenCapture.app> --args ...`
交给 macOS
LaunchServices 启动固定 bundle identity。daemon 不解析 `open` 的 stdout/stderr
（`open` 成功时也可能输出 benign diagnostic），只读取并验证私有目录内 mode
`0600` 的 helper 结果文件、精确 PNG 路径、regular PNG、像素与 8 MiB 大小上限，
读取预览后在 `finally` 删除整个临时目录。
原生 one-shot helper 另有 12 秒进程级 watchdog，早于 daemon 的 15 秒超时，
避免 ScreenCaptureKit 卡住后遗留后台 helper 或绕过 single-flight 门禁。

```bash
curl -X POST http://localhost:19827/api/plugins/screen-time/understanding/capture/test \
  -H 'Content-Type: application/json' -d '{}'
```

成功返回 `200`；`preview.base64` 只供当前 Web 页面内存预览，不是截图历史：

```json
{
  "format": "png",
  "displayId": 1,
  "widthPixels": 2560,
  "heightPixels": 1440,
  "bytes": 868605,
  "capturedAt": "2026-08-11T12:34:56.789Z",
  "preview": { "mediaType": "image/png", "base64": "iVBORw0KGgo..." }
}
```

缺少屏幕录制权限返回 `409 CAPTURE_PERMISSION_REQUIRED`；无 capture source 或
不支持的 OS 返回 `503`；helper 执行、输出、截图和超时失败返回对应的脱敏
`502`/`504`。已有测试正在运行时返回 `409 CAPTURE_BUSY`。这些失败不会禁用
原有 foreground tracking，也不会触发权限请求。

#### AI 屏幕识别

`POST /api/plugins/screen-time/understanding/run` 是 loopback-only 的显式识别入口，
只接受空 JSON 对象。它要求 settings 中 `enabled=true`、选中了有 Keychain 密钥的
Provider；服务会采集活动显示器、调用 `${baseUrl}/chat/completions`，并只接受包含
`summary`、`activity`、`confidence`、`sensitive`、`apps` 的 JSON 结果。失败不会返回
远端响应正文或 API key。

```bash
curl -X POST http://localhost:19827/api/plugins/screen-time/understanding/run \
  -H 'Content-Type: application/json' -d '{}'
curl http://localhost:19827/api/plugins/screen-time/understanding/latest
curl 'http://localhost:19827/api/plugins/screen-time/understanding/history?limit=20'
curl -X DELETE http://localhost:19827/api/plugins/screen-time/understanding/history/<observation-id>
```

成功响应形状为：

```json
{
  "id": "abc123",
  "capturedAt": "2026-08-20T10:00:00.000Z",
  "completedAt": "2026-08-20T10:00:04.000Z",
  "providerProfileId": "vision-primary",
  "model": "vision-model",
  "summary": "正在编辑 EchoLog 的 TypeScript 代码",
  "activity": "编写屏幕识别功能",
  "confidence": 0.92,
  "sensitive": false,
  "apps": ["Codex"],
  "latencyMs": 3200,
  "costMicros": null
}
```

成功结果只保存上述结构化字段，不保存 PNG、完整 prompt、模型原始响应或密钥。
历史删除接口只接受 loopback 请求，删除指定 observation 后返回 `204`；不存在的
observation 返回 `404`。它不会删除 request budget ledger。
周期任务每分钟检查一次 settings，并按 `captureIntervalSeconds`、`skipWhenIdle`、
`dailyRequestBudget` 和可选的 `dailyCostBudgetMicros` 约束执行。一次进程内同时只
允许一个识别任务；临时网络错误按 `maxAttempts` 有界重试。

识别关闭返回 `409 UNDERSTANDING_DISABLED`；未配置 Provider 返回
`409 UNDERSTANDING_PROVIDER_REQUIRED`；请求/成本预算耗尽返回 `429`；模型认证、
超时、限流、不可达和非法响应分别返回脱敏的 `PROVIDER_AUTH`、
`PROVIDER_TIMEOUT`、`PROVIDER_RATE_LIMITED`、`PROVIDER_UNAVAILABLE` 或
`UNDERSTANDING_RESPONSE_INVALID`。原始截图测试和识别入口均不提供
`/api/screen/*` 兼容别名。

### tmux-status

tmux-status 插件默认禁用，只通过无 shell 的 `execFile` 适配外部
`tmux-status` 可执行程序。

```bash
# 已校验但未包装的上游 JSON snapshot
curl "http://localhost:19827/api/plugins/tmux-status/status"

# 显式手动标记；state: active | inactive | auto
curl -X POST http://localhost:19827/api/plugins/tmux-status/mark \
  -H "Content-Type: application/json" \
  -d '{"target":"%3","state":"active","note":"release task"}'

# executable 版本和真实 status JSON contract 诊断
curl "http://localhost:19827/api/plugins/tmux-status/doctor"
```

无 tmux server 是成功空结果。缺 executable、非零退出、超时、损坏 JSON
和不支持的 schema version 会分别返回插件错误。观测不会自动创建 Agent
工时；CPU、selected pane、进程存活和 `activity_source=auto` 都不是有效工时
判据。

### 汇总与日报

```bash
# 今日汇总：{ totalSeconds, recordCount, byType, active }
curl "http://localhost:19827/api/summary/today"

# 指定日期汇总：{ date, totalSeconds, recordCount, byType, records }
curl "http://localhost:19827/api/summary/daily/2026-07-04"

# 生成日报 Markdown：{ date, markdown }（date 可省，默认今天）
curl -X POST http://localhost:19827/api/reports/daily \
  -H "Content-Type: application/json" -d '{"date":"2026-07-04"}'

# 同步日报到 config.sync.target
curl -X POST http://localhost:19827/api/sync \
  -H "Content-Type: application/json" -d '{}'
```

## 错误码

| 状态码 | 含义 |
|---|---|
| 400 | 请求体校验失败 |
| 401 | 缺少或错误的 API key（仅非本机请求） |
| 404 | 记录不存在 / 未知 API 路径 |
| 409 | 状态不允许该操作（如停止一条已完成的记录） |
| 502 | 插件外部命令失败或输出损坏 |
| 503 | 插件禁用、degraded 或缺少依赖 |
| 504 | 插件外部命令超时 |
| 500 | 服务端错误 |

错误响应至少包含 `{"error": "<message>"}`。

唯一活跃记录操作遇到多条候选时返回 `409`，并附带候选列表：

```json
{
  "error": "多个活跃记录，需指定 id",
  "candidates": [
    { "id": "rec_a", "title": "写接口文档", "status": "running" },
    { "id": "rec_b", "title": "整理笔记", "status": "paused" }
  ]
}
```
