# 实现计划

1. 将现有 screen-understanding capture/provider/Keychain 未提交实现纳入本任务范围，先确认基线测试和 native helper 构建状态。
2. 补齐 Keychain secret read、vision provider client、结构化结果 schema/store/migration、错误类型和 budget/retry 控制。
3. 接通 plugin service、手动 run/latest/history 路由和 enabled 周期 job；更新 Web 管理页面显示结果和触发入口。
4. 增加 provider 请求/响应、持久化、预算、取消、路由与调度测试；补 API/README 文档和配置说明。
5. 运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、native `swift build`/必要 smoke；处理所有失败。
6. 在实际 release daemon 上部署构建产物，先确认 PostgreSQL 与插件 ready，再重启 launchd daemon；用健康、插件状态、capture test 和 provider 可用性验证。

## 回滚点

- 不删除既有 screen-time 表和数据；新表可由迁移保留。
- `enabled` 默认保持 false；provider/识别故障只能让新功能失败，不能阻断 Core 和旧屏幕统计。
- 如果 native helper 或真实 provider 环境不可用，保留可重复的 mock/contract 验证，不伪造线上成功。
