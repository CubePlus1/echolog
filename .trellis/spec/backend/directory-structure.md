# Directory Structure

> How backend code is organized in this project.

---

## Overview

EchoLog 是 local-first 的个人活动记录器：Fastify HTTP server + CLI（`el`）+ MCP server 共用一套 core。ESM 项目（`"type": "module"`），pnpm 管理，tsup 打包三个入口（server/cli/mcp）。

---

## Directory Layout

```
src/
├── core/          # 业务核心，全部无 HTTP 依赖
│   ├── config.ts     # config.yaml 加载（缓存单例）+ getDbUrl()
│   ├── db.ts         # drizzle + postgres 连接单例 getDb()
│   ├── schema.ts     # drizzle pg-core 表定义 + $inferSelect 类型导出
│   ├── recorder.ts   # 记录领域逻辑（start/stop/pause/...），域错误类也在这
│   ├── tracker.ts    # 屏幕前台应用采样器（macOS lsappinfo/ioreg）
│   ├── scheduler.ts  # 60s 轮询的提醒调度器 start/stopScheduler()
│   ├── reporter.ts   # 日报 markdown 生成
│   ├── syncer.ts     # 日报落盘同步
│   ├── notifier.ts   # mac 通知 / ntfy
│   └── utils.ts      # localDateStr() 等纯函数
├── server/
│   ├── app.ts        # buildApp()：鉴权钩子、错误映射、静态托管、启动/优雅退出
│   └── routes/       # 一域一文件：records.ts / notes.ts / summary.ts / reports.ts / screen.ts
├── cli/           # commander CLI，经 HTTP 调 server（cli/api.ts 封装 fetch）
├── mcp/           # MCP server，直接 import core（不走 HTTP）
└── migrate.ts     # 顺序执行的原生 SQL 迁移数组（pnpm migrate）
web/               # 零构建原生三件套前端（index.html/styles.css/app.js），Fastify 静态托管
dist/              # tsup 产物
```

---

## Module Organization

- 业务逻辑一律放 `core/`，routes 只做参数解析 + 调 core + 状态码
- 新 API 域 = `server/routes/<domain>.ts` 导出 `async function xxxRoutes(app: FastifyInstance)`，在 `app.ts` 里 `await app.register()` 注册
- 静态路由必须注册在参数路由之前（Fastify 按注册序匹配，见 records.ts 的 W-8 注释）
- 后台常驻器（scheduler、tracker）暴露 `startXxx()/stopXxx()`，在 `app.ts` 的 `main()` 与 shutdown 里对称接线

## Naming Conventions

- 文件小写单词（`recorder.ts`），无连字符
- 相对导入必须写 `.js` 后缀（ESM）
- id 用 `nanoid(12)`；DB 列蛇形，TS 侧驼峰（drizzle 映射）

## Examples

- 领域模块范本：`src/core/recorder.ts`（域错误类 + 原子状态迁移 + enriched 查询）
- 路由范本：`src/server/routes/records.ts`（JSON schema 校验 + 静态先于参数路由）
