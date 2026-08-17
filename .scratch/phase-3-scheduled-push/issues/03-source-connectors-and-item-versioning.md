# 03 — RSS/GitHub Source Connector 与 Source Item versioning

**What to build:** 用户确认的 source scope 可以通过 RSS 和 GitHub Connector 获取 normalized Source Items；重复 fetch 被 deduplicate，内容变化形成同一 logical item 的新版本，provider failure 和 partial result 可解释地进入 delivery pipeline。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Source Connector capability 返回稳定 source identity、cursor/conditional metadata、normalized Source Items 和 source evidence
- [ ] RSS 与 GitHub fixtures 覆盖成功、malformed payload、conditional fetch、partial response 和 provider failure
- [ ] Source Item logical identity、content fingerprint、version 和 fetchedAt durable，重复 fingerprint 不生成新版本
- [ ] connector error 不泄露 credentials，并保留可用于 Delivery Decision 的 fetch outcome
- [ ] connector 是可替换 capability，plugin unload/reload 不删除 Source Item history
