# 02 — 持久 Schedule 与 occurrence 恢复

**What to build:** active Push Subscription 按持久 Schedule 产生稳定 identity 的 intended occurrence；进程重启、重复 worker claim 和 missed schedule reconciliation 都能恢复且每个 occurrence 最多进入一次 delivery pipeline。

**Blocked by:** 01 — Push Subscription Candidate 与显式确认

**Status:** ready-for-agent

- [ ] Schedule 只从 active subscription 生成 occurrence，subscription pause/revoke/expiry 后不再生成新的 authority
- [ ] occurrence key、claim、completion 和 catch-up policy 都 durable，并在 fresh SQLite instance 中恢复
- [ ] 同一 occurrence 的重复 claim/retry 不会启动第二次 delivery pipeline
- [ ] fake clock 覆盖 daily 20:00、restart、missed occurrence、DST 边界和过期 subscription
- [ ] scheduler 不把 timer ownership 交给 plugin，且使用有限 schedule/fetch/item/retry budget
