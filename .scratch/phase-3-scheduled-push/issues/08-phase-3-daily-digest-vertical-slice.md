# 08 — Phase 3 daily digest end-to-end evidence

**What to build:** 通过一个 daily 20:00 local-time Product Assembly 运行 RSS 与 `github-release-watch` source，完成 confirmation、schedule occurrence、fetch/version/dedup、ranking/exposure、Delivery Decision、inbox/Windows delivery、linked Chat 和 Interaction Signal 全链路，并记录 restart/missed schedule evidence。

**Blocked by:** 02 — 持久 Schedule 与 occurrence 恢复; 04 — Exposure、candidate ranking 与 Delivery Decision; 05 — Inbox、Windows notification 与 linked Chat Session; 06 — Interaction Signal 与 ranking-only policy; 07 — 独立 packaged `github-release-watch` plugin

**Status:** ready-for-agent

- [ ] natural-language request 经过显式 confirmation 后才产生 active Push Subscription 和 daily schedule
- [ ] restart、missed occurrence、duplicate source version 和 retry 场景每个 intended occurrence 最多一次 delivery
- [ ] digest 最多五个 item，所有 delivered/suppressed candidate 都有 reason、source evidence 和 Delivery Decision
- [ ] Interaction Signal 改变 ranking evidence 但不能改变 authority，pause/revoke 后未来 occurrence 不投递
- [ ] API、React inbox、Windows fake adapter、linked Chat Session 和 plugin reload 的 acceptance test 全部通过
