# 06 — 暴露 Fastify/SSE conversational API

**What to build:** 一个 localhost Fastify API，能够创建 version-bound Session、提交消息、读取 Run 状态、处理 approval decision，并通过 SSE 按 cursor 推送 durable Run events；API 不绕过 conversational Run service。

**Blocked by:** 03 — 增加 Tool permission、approval 与恢复; 05 — 增加 Memory Candidate path 与 Evidence Bundle

**Status:** completed

- [x] Session、message、Run、approval 和 evidence endpoint 使用 domain-level request/response
- [x] SSE stream 按稳定 cursor 保证事件顺序并支持 reconnect
- [x] 参数校验、not found、version mismatch、pending approval 和 terminal failure 返回可诊断状态
- [x] API handler 不直接执行 tools、写 events 或修改权限状态
- [x] in-process HTTP tests 无真实 provider、网络或凭据
