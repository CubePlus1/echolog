# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

无 lint/测试框架(玩具项目自担)。质量靠:`npx tsc --noEmit` 过类型、关键路径手动 curl 验证、review 注释(代码中 `C-1`/`H-6`/`W-8` 等标记对应历史 review 发现)。

---

## Forbidden Patterns

- **读-判-写状态迁移**:必须原子 UPDATE + 状态前置条件 + `.returning()`(见 recorder.ts)
- **route 里 try-catch 吞错**:域错误直接 throw,由 app.ts setErrorHandler 统一映射
- **动态展开用户输入进 UPDATE**:白名单挑字段(editRecord H-6)
- **`new Date("YYYY-MM-DD")` 做日切**:会得 UTC 半夜;须 `new Date(\`${date}T00:00:00.000\`)`(本地时区)

---

## Platform Gotchas(调试换来的)

### macOS 屏幕采样(tracker.ts)

- **`HIDIdleTime` 只统计键鼠输入**。看视频/语音通话全程无输入,单靠它判"离开"会把这些时段整段抹掉(2026-07 计时器 bug 根因)。必须并读 `pmset -g assertions`:前台应用持有 `PreventUserIdleDisplaySleep`/`PreventUserIdleSystemSleep`/`NoIdleSleepAssertion` 即视为在用。断言归属按进程名与前台 bundleId/应用名互含匹配,并排除 `caffeinate`/`powerd`/`coreaudiod`。
- idle 收尾要**回溯**到 max(最后输入时刻, 最后媒体活跃时刻),不是收在当前时刻。
- 多命令一次 exec 时用显式分隔符(`---ECHOLOG---`)分段解析,不要靠正则猜哪行是谁的输出(`pmset` 输出里也有裸数字)。
- `lsappinfo info -only name -only bundleid "$(lsappinfo front)"` 无需 TCC 权限;输出形如 `"LSDisplayName"="微信"`。

### 常驻采样器模式

- `setInterval` 回调必须防重入(`sampling` 标志)+ 整体 try-catch(单轮失败不杀循环,连败 N 次才告警)
- 超时不能只调用 `AbortController.abort()`:数据库写入等操作可能忽略 signal。必须同时 race 一个会 reject 的 timeout,确保 `running` 在 `finally` 中释放,后续轮次可以继续。
- 崩溃容忍:片段开启即 INSERT,周期 UPDATE(60s),`stopTracker` 收尾在 `lastSeenAt` 而非 `new Date()`
- 采样断档检测(`now - lastSampleAt > 3×间隔`)兜住睡眠/合盖,在最后活跃时刻收尾

### 结构化诊断端点

- doctor 类端点失败可返回 503,但响应仍须包含顶层 `error` 以及逐项 diagnostics。CLI 必须保留原始 JSON 错误体,人类模式必须展示逐项检查,两种模式都以非零退出。

### macOS 发布包可移植性

- 从隔离目录执行 `pnpm install` 后，不得直接归档完整安装树：`.modules.yaml`、`.pnpm-workspace-state-v1.json` 和 `.bin` shim 会记录 pnpm store 或临时 workspace 的绝对路径。ready-to-run 包应预编译迁移入口、裁剪为 production dependencies、删除这些本机元数据，并在归档前扫描打包机的实际 `HOME`、pnpm store、源码/临时根路径和绝对 symlink；不要用泛化的 `/Users/*` 规则误报依赖或文档中的第三方示例路径。
- Swift release executable 在 codesign 前执行 `strip -S`，移除编译路径；随后必须重新签名并复验 designated requirement、`codesign --verify --deep --strict`、架构、最低系统版本和 `status --json`。

---

## Verification Checklist

改动 server 后最小验证:

```bash
npx tsc --noEmit && pnpm build
pkill -f "node dist/server/app.js"; (nohup node dist/server/app.js > /tmp/echolog.log 2>&1 &)
curl -s localhost:19827/api/health
# 鉴权:LAN IP 无 key 应 401,带 key 200,localhost 豁免
```

计时类改动加验:间隔 45s 两次取 `/api/screen/today` 的 totalSeconds,delta 应 ≈ 墙上秒数。
