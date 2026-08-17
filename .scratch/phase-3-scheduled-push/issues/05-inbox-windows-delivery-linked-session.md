# 05 — Inbox、Windows notification 与 linked Chat Session

**What to build:** Delivery Decision 可以通过 durable in-app inbox 和 Windows notification adapter 投递；delivery receipt 具备稳定 idempotency，用户可以查看 reason/evidence 并打开保留 Agent Definition 绑定的 linked Chat Session。

**Blocked by:** 04 — Exposure、candidate ranking 与 Delivery Decision

**Status:** ready-for-agent

- [ ] inbox item 保存 occurrence、Delivery Decision、Source Item/evidence、delivery status 和 linked Session reference
- [ ] inbox delivery 和 Windows adapter 都使用 stable receipt/idempotency key，retry/reconcile 不产生重复外部 delivery
- [ ] Windows adapter 通过 injected fake transport 测试 success、failure、retry 和 already-delivered recovery
- [ ] React inbox 显示 delivered/suppressed reason、source evidence、loading/error/empty 状态
- [ ] 点击 inbox item 创建或打开 version-bound linked Chat Session，不改变 Push Subscription authority
