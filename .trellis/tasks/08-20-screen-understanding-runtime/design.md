# 技术设计

## 数据流

`POST /api/plugins/screen-time/understanding/run`（local-only）
→ 读取 settings/provider metadata
→ 从 macOS Keychain 取密钥
→ ScreenCaptureKit helper 生成短生命周期 PNG
→ OpenAI-compatible `POST {baseUrl}/chat/completions`
→ 严格解析模型返回的 JSON
→ 删除临时 PNG
→ 将结构化结果写入 `screen_understanding_observations`
→ 返回脱敏后的 observation。

周期 job 使用相同的 service，但由 `enabled`、`skipWhenIdle`、`captureIntervalSeconds` 和预算判断是否执行；job 失败只记录结构化日志并保留下一轮机会。

## Provider 契约

只支持已有 `providerKind=openai-compatible`。请求体使用 Chat Completions vision content：system message 要求只返回约定 JSON，user message 同时包含简短任务说明和 `data:image/png;base64,...`。响应只接受 `choices[0].message.content` 中的 JSON 对象，字段做白名单和长度/枚举校验；不保存原始模型响应。

## 结果模型

`screen_understanding_observations` 以 nanoid 为主键，保存 `captured_at`、`completed_at`、provider/model、summary、activity、confidence、sensitive、apps JSON 和 request latency。图片不进入数据库。读取端点按时间倒序并限制数量。

## 安全与故障隔离

- Keychain 新增受控读取命令，stdout 只在内存中短暂存在；helper/daemon 不打印密钥。
- provider URL 继续执行现有白名单；不允许用户提供任意 `http` 远端地址。
- 每次 capture 使用 0700 临时目录和 0600 文件，finally 清理。
- API key 仅放在 Authorization header；错误映射为稳定 code，不回显 provider body。
- 手动 run 复用单飞锁，周期任务与手动任务不能并发；AbortSignal 同时取消 helper 和 HTTP 请求。

## 兼容性

既有 settings/provider/capture-test 路由不改语义；新增路由仅使用 canonical `/api/plugins/screen-time/understanding/*`，local-only 操作不提供 `/api/screen/*` 别名。旧 screen-time 采样和分类数据表不迁移、不重命名。
