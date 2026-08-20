# 恢复并实现 AI 屏幕识别

## Goal

TBD.

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# 恢复并实现 AI 屏幕识别

## 目标

在现有 `screen-time` 插件的设置、Provider/Keychain 管理和 macOS 截图助手基础上，恢复真正可运行的 AI 屏幕识别链路：采集当前活动显示器截图，调用用户配置的 OpenAI-compatible vision provider，校验并保存结构化理解结果，并支持手动触发与按设置周期运行。

## 范围

- 复用既有 macOS ScreenCaptureKit helper；不把截图永久落盘，不把 API key 写入数据库、命令行参数或日志。
- 复用既有 provider profile 与 macOS Keychain 管理；Provider 请求使用 HTTPS，HTTP 仅允许 loopback。
- 为识别结果建立追加式历史存储，保存结构化文本/元数据，不保存原始截图和 API key。
- 增加本机手动触发、最新结果/历史结果读取接口，以及启用后的周期任务。
- 识别结果面向用户展示时统一使用简体中文；应用标签也使用中文通用称呼，不输出英文描述。
- `enabled=false` 时不得采集截图或调用 provider；手动测试接口只验证截图，不调用模型。
- provider 返回失败、超时、非法 JSON 或超出预算时返回结构化错误，不使 Core 或 screen-time 插件崩溃。
- 保持既有 `app_usage`、`app_rules`、`/api/screen/*` 兼容接口和插件降级隔离语义。

## 验收标准

- [ ] 未配置或未启用识别时，周期任务不会捕获屏幕或发起网络请求。
- [ ] 配置有效 Provider 与 Keychain 密钥后，手动运行能完成 capture → vision request → schema validation → persistence，并返回结果。
- [ ] 新的模型识别结果的 `summary`、`activity` 和 `apps` 字段值均使用简体中文，不输出英文描述。
- [ ] provider 请求采用 bounded timeout、有限重试、并发/每日请求预算；失败不暴露密钥或完整远端响应。
- [ ] 结果接口只返回结构化理解结果和安全元数据；响应中不包含图片 base64、密钥、提示词或远端原始响应。
- [ ] DB migration 幂等，结果历史可在服务重启后读取，写入不破坏既有屏幕统计数据。
- [ ] 单元测试覆盖请求构造、响应校验、预算/重试、取消、路由错误映射；现有测试继续通过。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm build` 通过；macOS helper 可构建并完成可执行文件 smoke check（若系统权限允许再做真实截图）。
- [ ] 构建并重启实际 EchoLog daemon 后，health、插件状态、手动识别接口均按实际环境给出可验证结果。
