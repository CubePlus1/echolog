# EchoLog HTTP API

EchoLog server（默认 `http://<host>:19827`）暴露一组 REST 接口，可以从任何地方用 HTTP 请求读写自己的记录。Web 前端、CLI（`el`）、MCP 都走同一组接口。

## 鉴权

在 `config.yaml` 中设置 `server.apiKey` 后：

- **本机请求（127.0.0.1 / ::1）豁免** —— 本机浏览器、CLI、MCP 无需任何配置；
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

如果要从另一台机器的浏览器访问 Web UI，需要同时配置 `server.apiKey` 和 `server.corsOrigins`：前者保护非本机 `/api/*`，后者允许该浏览器所在 origin 发起跨源请求。

## 数据模型

**Record**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | nanoid |
| `title` | string | 标题 |
| `type` | string | `learning` \| `project` \| `task` |
| `tags` | string[] | 标签 |
| `project` | string \| null | 所属项目 |
| `startAt` / `endAt` | ISO 时间 | 开始 / 结束（进行中为 null） |
| `status` | string | `running` \| `paused` \| `done` \| `cancelled` |
| `durationSeconds` | number | 净时长（不含暂停） |
| `result` | string \| null | 结果总结 |
| `source` | string | `cli` \| `mcp` \| `web` \| `api` |

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

# 某时刻之后 / 按项目 / 按类型（可组合）
curl "http://localhost:19827/api/records?since=2026-07-01T00:00:00+08:00&project=eoove&type=learning"

# 单条
curl "http://localhost:19827/api/records/<id>"

# 进行中（含实时时长 liveDurationSeconds、lastResumedAt）
curl "http://localhost:19827/api/records/active"
```

查询参数：`date`（YYYY-MM-DD，设置后忽略其余过滤）、`since`（ISO 时间）、`project`、`type`、`limit`。

### 开始 / 控制记录

```bash
# 开始一条记录（只有 title 必填；type 默认 task，source 默认 api）→ 201
curl -X POST http://localhost:19827/api/records \
  -H "Content-Type: application/json" \
  -d '{"title":"读《史记》三十页","type":"learning","tags":["读书"],"project":"修身"}'

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

### 屏幕使用（macOS 被动采样）

daemon 每 5 秒采样前台应用（可在 `config.yaml` 的 `tracker` 段关闭/调参），落成连续使用片段。分类**在查询时**按规则计算——改规则即可追溯重分历史。

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

规则语义：

- `appMatch`：大小写不敏感**子串**，同时匹配 bundle id（`com.tencent.xinWeChat`）与应用名（`微信`）
- `startTime`/`endTime`：本地时区半开区间 `[start, end)`，须成对出现；省略即全天；`start > end` 表示跨夜（如 `22:00`–`02:00`）
- `weekdays`：整数数组，0=周日；省略即每天
- `priority`：整数，高者胜；平局时带时段的规则胜过全天规则
- 片段会按规则时段边界自动切开，各段独立归名；无匹配规则 → `未分`

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
