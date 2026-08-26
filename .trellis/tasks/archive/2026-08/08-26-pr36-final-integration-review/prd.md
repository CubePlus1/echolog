# PR #36 最终集成与 Codex 复审

## Goal

将已经完成独立验证的 Plugin Notification、Schedule 与 Inspiration 审阅修复
安全整合到 PR #36 的 `codex/plugins-integration` 分支，推送最新提交并针对最新
head 重新触发 Codex Code Review。

## Requirements

- 保留 PR #36 当前历史；只追加 commit/merge commit，不 amend、rebase 或强推。
- 先将 Inspiration worktree 已暂存且验证通过的改动提交到
  `codex/inspiration-plugin`，不得丢失或混入无关用户改动。
- 整合 Schedule commits `f91b8c7`、`058c1ba`；保留已经进入集成分支的
  notification review fixes `fdd22d9` 及其 Trellis 收尾提交。
- Inspiration 的旧任务在集成分支保持归档形态，不重新制造同名 active task；
  必须保留其 PR review/spec/测试更新。
- 解决整合冲突时保持 Plugin API v1、权限、Abort、notification result、live
  refresh、timezone、disabled/degraded 隔离和 CLI/Web 契约不回退。
- 推送前运行 root `pnpm test`、`pnpm typecheck`、`pnpm build`、相关 PostgreSQL
  integration 及 `git diff --check`。
- 推送后确认 PR #36 head 与本地一致、CI 已触发，并在 PR 评论中精确发送
  `@codex review`；不得合并 PR 或 main。

## Acceptance Criteria

- [x] Inspiration 修复存在独立追加 commit，原 worktree 干净。
- [x] `codex/plugins-integration` 包含 notification、Schedule 和 Inspiration 的
      全部已验证修复，且 Trellis active/archive 路径无重复漂移。
- [x] 全量与定向验证通过，无未解决的本地 P0/P1/P2 审查发现。
- [x] 集成分支工作树干净并成功 push 到 PR #36 的远端 head。
- [x] PR 最新 head 已触发 CI，并已精确评论 `@codex review`。
- [x] 不 merge PR/main，不重写历史，不覆盖其他 worktree 的用户改动。

## Notes

- GitHub PR: https://github.com/CubePlus1/echolog/pull/36
- 开始时远端 PR head 为 `d384adb`；本地集成分支 head 为 `fde7b17`。
