## Problem Statement

Chat can perform a bounded task, but the Harness cannot yet keep a user-confirmed information source current and deliver useful items at the right time. A scheduled Agent must not turn a conversation, an Interaction Signal, or a model suggestion into open-ended authority. The platform needs durable Push Subscription state, source history, exposure history, ranking evidence, delivery decisions, and recovery rules so a restart or missed schedule cannot duplicate or silently broaden proactive delivery.

## Solution

Add a scheduled Push vertical slice built around an explicit Push Subscription Candidate and a user-confirmed Push Subscription. A Candidate records the parsed content scope, sources, schedule, timezone, delivery channel, item budget, filters, and validity period. Only an explicit confirmation activates it, and a version-bound confirmation is required to prevent stale UI decisions.

The platform owns persistent schedules, occurrence identity, subscription authority, Source Item versioning, exposure records, Delivery Decisions, inbox records, and linked Session references. Source Connector and delivery plugins provide replaceable capabilities through trusted in-process contracts. The first source plugin is an independently packaged `github-release-watch` plugin, with RSS and GitHub adapters exercised through injected transports.

Each intended occurrence is claimed durably and reconciled after restart. Source items are normalized and deduplicated before ranking. Ranking may use user state, evidence, novelty, exposure, and Interaction Signals, but only inside the active subscription scope. Every delivered or suppressed candidate gets a durable Delivery Decision with a reason, and each delivery channel records an idempotent receipt. Inbox entries link back to the source evidence and a Chat Session for follow-up.

The primary integration seam is the scheduled occurrence runner. It receives a clock, a subscription, source connector results, ranking inputs, delivery adapters, and a Durability-backed state boundary; it returns durable occurrence state, Delivery Decisions, and delivery receipts. API and React surfaces call domain services and never make subscription, schedule, ranking, or notification decisions themselves.

## User Stories

1. As a user, I want to describe a recurring information need in natural language, so that I do not have to fill in every scheduling field manually.
2. As a user, I want to review the parsed topic, sources, schedule, timezone, channel, filters, item budget, and validity period, so that I know exactly what proactive authority I am granting.
3. As a user, I want to explicitly confirm a Push Subscription Candidate, so that a model suggestion cannot activate proactive delivery by itself.
4. As a user, I want to reject or edit a Candidate before confirmation, so that an incorrect interpretation does not become an active subscription.
5. As a harness maintainer, I want Candidate state to remain distinct from active Push Subscription state, so that pending proposals cannot authorize delivery.
6. As a harness maintainer, I want confirmation to be bound to the Candidate version and scope fingerprint, so that stale UI decisions cannot activate changed authority.
7. As a user, I want to pause, resume, expire, and revoke a Push Subscription, so that I retain control after activation.
8. As a user, I want each active subscription to define content scope, timing, delivery channel, item budget, filters, and validity period, so that proactive delivery stays bounded.
9. As a harness maintainer, I want schedules and intended occurrences persisted, so that process restart does not lose a delivery commitment.
10. As a harness maintainer, I want each occurrence to have a stable identity and durable claim, so that retries cannot deliver the same occurrence twice.
11. As a user, I want missed schedules handled according to an explicit catch-up policy, so that a restart does not silently skip or flood me with old content.
12. As a harness maintainer, I want the scheduler to use an injectable clock, so that DST, missed windows, restart, and duplicate-claim behavior are deterministic in tests.
13. As a user, I want to subscribe to RSS information sources, so that recurring delivery can monitor feeds I choose.
14. As a user, I want to subscribe to GitHub repositories and release activity, so that repository changes can be included in my digest.
15. As a harness maintainer, I want Source Connectors to normalize source-specific responses into a common Source Item contract, so that ranking and delivery do not depend on provider payloads.
16. As a harness maintainer, I want Source Items versioned by stable identity and content fingerprint, so that edits are represented without creating duplicate items.
17. As a harness maintainer, I want source fetch failures and partial results recorded, so that a digest can explain incomplete coverage.
18. As a harness maintainer, I want a first independently packaged `github-release-watch` plugin, so that plugin loading and replacement are demonstrated by a real source capability.
19. As a user, I want new and relevant items ranked within my confirmed subscription, so that the limited daily digest is useful rather than merely recent.
20. As a harness maintainer, I want ranking inputs to include novelty, source evidence, user scope, current focus, and prior exposure, so that every score is explainable.
21. As a user, I want already delivered or repeatedly ignored items down-ranked or suppressed, so that the same information does not interrupt me repeatedly.
22. As a harness maintainer, I want Interaction Signals to affect ranking features only, so that a click, open, or dismissal cannot broaden subscription authority.
23. As a harness maintainer, I want every candidate to produce a Delivery Decision, so that both delivery and suppression are auditable.
24. As a user, I want a delivered item to show why it was selected and which source supports it, so that proactive content is evidence-backed.
25. As a user, I want suppressed items to have an inspectable reason, so that silence is distinguishable from fetch failure, budget exhaustion, duplicate suppression, and policy exclusion.
26. As a user, I want delivered items stored in an in-app inbox, so that I can review them when convenient.
27. As a user, I want Windows notification delivery for confirmed subscriptions, so that important items can reach me outside the Chat page.
28. As a harness maintainer, I want notification adapters to use idempotent delivery receipts, so that retrying a failed occurrence cannot create duplicate notifications.
29. As a user, I want an inbox item to open a linked Chat Session, so that I can ask follow-up questions without losing source and ranking evidence.
30. As a harness maintainer, I want Chat links to preserve the Agent Definition and Session identity, so that follow-up behavior is version-bound and auditable.
31. As a user, I want to pause or revoke a subscription and have future occurrences stop, so that previous Interaction Signals cannot keep delivery alive.
32. As a harness maintainer, I want Interaction Signals to retain provenance, timestamp, source scope, and signal kind, so that ranking changes can be evaluated later.
33. As a harness maintainer, I want plugin unload and replacement to preserve subscription, schedule, exposure, and Delivery Decision state, so that capability lifetime cannot erase platform commitments.
34. As a harness maintainer, I want all proactive paths to use scenario-specific budgets for fetch time, item count, model resources, retries, and external effects, so that a scheduled Run cannot grow without bound.
35. As a harness maintainer, I want all Phase 3 contract tests to run with fake clocks and injected transports, so that CI does not require network access, credentials, or Windows notification services.
36. As a harness maintainer, I want the first daily digest fixture to cover RSS and GitHub release items, duplicate exposure, ranking, suppression, restart, and inbox follow-up, so that the Phase 3 exit criteria are demonstrated end to end.

## Implementation Decisions

- Introduce explicit domain types for Push Subscription Candidate, Push Subscription, Schedule, Schedule Occurrence, Source, Source Item, Exposure, Interaction Signal, Delivery Decision, Delivery Receipt, Inbox Item, and linked Chat Session reference. Candidate and active subscription are separate state types and tables.
- A Candidate has a monotonic revision and a scope fingerprint derived from its parsed fields. Confirmation accepts only a pending Candidate revision and creates an active subscription in one durable transaction. Activation, pause, resume, expiry, and revoke are explicit platform decisions.
- The subscription contract contains content scope, source references, schedule expression, timezone, channel, item budget, filters, and validity bounds. No Interaction Signal or model output can mutate these fields.
- The scheduler uses a persistent occurrence key derived from subscription identity, schedule revision, and intended local occurrence. Occurrence claiming, completion, missed-occurrence reconciliation, and delivery receipts use SQLite transactions and unique keys.
- The scheduler remains a single deep platform module. It does not expose timer ownership to plugins; plugins receive a bounded invocation for one occurrence and return normalized results.
- Define a Source Connector capability with source identity, fetch cursor/conditional request metadata, normalized Source Items, content fingerprints, source evidence, and recoverable failure information. RSS and GitHub connectors use injected HTTP transports in tests.
- Source Item storage preserves stable identity and versions. A repeated fetch with the same fingerprint is a no-op; a changed item creates a new version linked to the same logical source item.
- Ranking is a deterministic domain seam for Phase 3. It receives only active-subscription scope, normalized Source Items, user/Agent evidence, exposure history, and Interaction Signals. It returns ordered candidates, score components, and an explanation; it cannot return an authority mutation.
- Delivery Decision is created for every considered candidate, including delivered, suppressed, duplicate, out-of-scope, stale, budget-exhausted, fetch-incomplete, and policy-blocked outcomes. The reason and evidence references are durable before delivery starts.
- Delivery adapters expose send/reconcile behavior and stable idempotency keys. The first in-app inbox adapter is durable and synchronous; the Windows notification adapter is an independently testable side-effect adapter with a fake transport and reconciliation result.
- Inbox Items contain source/evidence references, Delivery Decision identity, occurrence identity, delivery status, and a linked Chat Session reference. Creating the link does not create or broaden a Push Subscription.
- Interaction Signals are append-only evidence records. Ranking may read them, while subscription authority checks ignore them. A signal cannot activate, widen, accelerate, extend, or renew a subscription.
- Publish `github-release-watch` as the first independently packaged plugin. Its package declares the Source Connector capability and lifecycle contract, while schedules, subscription authority, exposures, and Delivery Decisions stay in platform modules.
- Preserve existing Composition and Durability boundaries. Plugin replacement cannot remove platform state, and Agent Events remain separate from transient Runtime Events and telemetry.
- Use the existing Session service for linked follow-up Chat Sessions. A link stores the source and Delivery Decision context needed to explain the item without copying sensitive source payload into authority state.

## Testing Decisions

- Test the scheduled occurrence runner as the highest seam. A good test advances a fake clock, invokes one occurrence, and observes durable subscription, occurrence, Source Item, Exposure, Delivery Decision, receipt, inbox, and linked Session behavior.
- Candidate tests cover parsing, invalid scope, revision-bound confirmation, explicit activation, rejection, pause/resume/revoke, expiration, and the invariant that signals cannot activate or broaden a subscription.
- Durability tests use temporary SQLite databases and fresh store instances to cover unique occurrence claims, missed schedule reconciliation, source version deduplication, exposure uniqueness, Delivery Decision persistence, receipt idempotency, and plugin replacement continuity.
- Connector tests use injected transports and fixed RSS/GitHub payloads. They cover conditional fetch, malformed/partial responses, provider failure, stable identity, changed version, duplicate fetch, and redacted error metadata.
- Ranking tests use fixed user state, evidence, exposure, and Interaction Signal fixtures. They assert score explanations and ordering, plus the negative property that ranking output cannot alter subscription scope or timing.
- Delivery tests use fake inbox and Windows adapters. They cover delivered, suppressed, retry, reconcile, duplicate receipt, channel failure, and reason persistence.
- API tests use in-process Fastify handlers and verify Candidate review/confirmation, subscription controls, inbox reads, linked Session creation, cursor/event behavior, and authorization boundaries.
- React tests use the existing happy-dom component seam and cover Candidate review, confirmation, active/paused states, inbox item reason/evidence display, notification failure, and linked Chat navigation.
- The end-to-end fixture runs RSS plus `github-release-watch` through a confirmed daily schedule, restarts between claim and delivery, verifies at-most-once behavior, and checks that every considered item has a Delivery Decision.
- Existing Phase 0, Phase 1, and Phase 2 tests remain mandatory. All network, GitHub credentials, RSS services, and Windows APIs are replaced by injected fakes in CI.

## Out of Scope

- Autonomous Push Subscription activation, subscription widening, or authority changes caused by model output, Chat behavior, or Interaction Signals.
- Multi-user tenancy, remote authentication, distributed schedulers, PostgreSQL, plugin sandboxing, and a plugin marketplace.
- General-purpose cron language, arbitrary timezone policy UI, and broad calendar integration beyond the first daily digest fixture.
- Source providers beyond RSS and GitHub, and GitHub capabilities beyond the first release-watch plugin.
- Embeddings, vector retrieval, autonomous long-term Claim resolution, or replacing the existing Memory Candidate validation path.
- Rich multi-channel delivery beyond in-app inbox and the Windows notification adapter.
- Production cloud notification credentials, public deployment, and guaranteed delivery when the operating system or provider is unavailable.
- Full recommendation model training, paid benchmark integration, OpenTelemetry, backup/restore, export, and erasure work scheduled for Phase 4.

## Further Notes

- The first demonstrable Product Assembly is a daily 20:00 local-time digest limited to five Agent/LLM engineering items from selected RSS feeds and GitHub repositories, with novelty, personal relevance, evidence, and suggested action.
- Every phase-level demo must be able to answer: which active Push Subscription authorized this item, which occurrence produced it, which source version supports it, what exposure and Interaction Signal evidence affected ranking, and why it was delivered or suppressed.
- The `github-release-watch` plugin is independently packaged but remains trusted in-process code under the existing single-node limitation.
