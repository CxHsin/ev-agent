# 07 — 独立 packaged `github-release-watch` plugin

**What to build:** 发布第一个 independently packaged plugin `github-release-watch`，它在现有 trusted in-process Composition boundary 中提供 GitHub release Source Connector，并能被 active subscription 的 occurrence runner 使用而不拥有 schedule、subscription、exposure 或 Delivery Decision state。

**Blocked by:** 03 — RSS/GitHub Source Connector 与 Source Item versioning

**Status:** ready-for-agent

- [ ] plugin manifest 声明稳定 identity、版本、Source Connector capability 和依赖，并通过 Composition lifecycle contract
- [ ] plugin 返回 release normalized Source Items、source evidence、版本/fingerprint，并处理 GitHub provider failure
- [ ] plugin unload/reload 保留 platform-owned subscription、occurrence、Source Item、exposure 和 Delivery Decision history
- [ ] package 可独立构建、测试和加载，GitHub credential 只通过 SecretRef/注入 transport 使用
- [ ] plugin fixture 至少支撑一个 confirmed daily release-watch digest occurrence
