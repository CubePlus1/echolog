# Error Handling

> How errors are handled in this project.

---

## Overview

域错误类定义在 core（如 `recorder.ts` 的 `RecordNotFoundError`、`InvalidStateError`），routes 不 try-catch——统一由 `app.ts` 的 `setErrorHandler` 映射为 HTTP 状态码。

---

## Error Types

- `RecordNotFoundError` → 404
- `RuleNotFoundError`（screen 分类规则）→ 404
- `InvalidStateError`（状态机不允许的操作）→ 409
- `AmbiguousActiveError`（多个活跃记录无法自动匹配）→ 409，响应体**额外携带 candidates**（见下）
- Fastify schema 校验错误（`"validation" in error`）→ 400
- 其他 → 500，`app.log.error` 记录

### 带结构化上下文的错误：AmbiguousActiveError

错误响应默认只有 `{ "error": msg }`，但当客户端需要信息才能自救时，错误类可携带结构化字段，由 errorHandler 分支展开：

```typescript
// core/recorder.ts —— 错误类携带上下文
export class AmbiguousActiveError extends Error {
  constructor(message: string, public candidates: ActiveCandidate[]) { ... }
}
// app.ts —— 映射时展开
if (error instanceof AmbiguousActiveError) {
  return reply.code(409).send({ error: error.message, candidates: error.candidates });
}
```

响应形状：`{ "error": "...", "candidates": [{ "id", "title", "status" }] }`。CLI 人类模式打印候选列表、`--json` 模式原样透传（见 [CLI Agent Contract](./cli-agent-contract.md)）。

## Error Handling Patterns

- core 函数发现问题直接 `throw` 域错误；routes 放心 await，不包 try
- 新域加错误类：在对应 core 模块定义 + 在 `app.ts` errorHandler 加一个 instanceof 分支
- 批量操作里的并发冲突可 catch-skip（见 stopAllActive）

## API Error Responses

一律 `{ "error": "<message>" }`（可附加结构化字段，如 candidates）。未知 `/api/*` 路径返回 404 `{"error":"Not found"}`——**无论 `serveWeb` 开关如何**（notFoundHandler 两种模式都注册）；其余未知路径在 `serveWeb: true` 时回 index.html（SPA 兜底），`false` 时 404。

## 能力下沉原则（Design Decision）

**Context**：曾经 MCP/CLI 各自内联"省略 id 时匹配唯一活跃记录"的推断，同一逻辑复制了 5 份且行为漂移。

**Decision**：这类便利语义一律下沉到服务端（`/api/records/active` 系列端点，resolver 在 `core/recorder.ts`）。客户端（CLI/Web/未来任何 agent 适配层）只做展示与透传，禁止在客户端复刻服务端可提供的推断/校验逻辑。

**Why**：单一实现、单一鉴权口、行为一致；新客户端零成本获得同等语义。

## Common Mistakes

- 在 route 里 try-catch 后吞错返回 200
- 忘了 setErrorHandler 分支，新域错误全变 500
