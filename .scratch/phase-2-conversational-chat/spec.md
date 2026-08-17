# Phase 2: Conversational Chat Vertical Slice

Status: completed
Label: ready-for-agent

## Problem Statement

The Personal Agent Harness can currently execute a deterministic headless Run, but it cannot serve a real conversational Session. There is no production Model capability contract, DeepSeek provider validation, Agent Loop that can choose and execute tools, explicit permission or approval handling, immutable Session binding, Memory Candidate workflow, Evidence Bundle explanation, or user-facing Chat surface.

Without these boundaries, a real conversation would either bypass the durable Run lifecycle or silently accept provider features that DeepSeek does not support. External effects could also execute without an explicit permission decision, and a Session could change Agent Definition semantics while it is in progress.

## Solution

Build the smallest production-shaped conversational Product Assembly on top of the Phase 1 durable runtime. Define a provider-neutral Model capability contract and implement a DeepSeek Model Adapter that validates the supported capability subset locally and normalizes responses. Keep the deterministic fake Model as the contract-test adapter.

Add a minimal ReAct Agent Loop that persists each meaningful step through the existing Run and Agent Event boundaries. The Loop uses a Tool Registry, classifies tools as reads or external effects, evaluates a cooperative permission policy, and checkpoints an approval request instead of executing an unapproved effect. Add immutable version-bound Sessions, a durable Memory Candidate path, and Evidence Bundles with provenance. Expose the flow through a localhost Fastify API with SSE Run updates and a React Chat Surface.

The primary acceptance seam is a conversational Run service: a Session-bound Run can receive a user message, call an allowed read tool, pause for approval before an external effect, resume after approval or restart, and return a response that can explain the relevant Evidence Bundle and Agent Events. The HTTP and React layers consume this seam and do not own Agent Loop or durability rules.

## User Stories

1. As a harness maintainer, I want a provider-neutral Model capability contract, so that Agent Loops can be tested without depending on a provider SDK.
2. As a harness maintainer, I want a deterministic fake Model that can emit text, reasoning, and tool calls, so that conversational behavior remains reproducible in CI.
3. As a harness maintainer, I want a DeepSeek Model Adapter, so that the first production model provider can drive a real conversation.
4. As a harness maintainer, I want unsupported DeepSeek capabilities rejected locally, so that silently ignored provider fields cannot change Agent behavior.
5. As a harness maintainer, I want normalized text, reasoning, tool calls, finish states, errors, usage, and provider metadata, so that the Agent Loop does not depend on provider response shapes.
6. As a user, I want to send a message to a conversational Session, so that an Agent Definition can work toward my request.
7. As a harness maintainer, I want the Agent Loop to persist model and tool steps as Agent Events, so that the conversation can recover and be explained.
8. As a user, I want the Agent to call a read tool automatically when permitted, so that it can inspect authorized information without unnecessary interruption.
9. As a harness maintainer, I want tool input and output validation, so that malformed model calls do not reach capability implementations.
10. As a user, I want an external or destructive tool call to require approval, so that the Agent cannot create an external side effect without my decision.
11. As a user, I want to approve or deny a pending tool call, so that I control the side effects of a Run.
12. As a harness maintainer, I want pending approvals durable across process restart, so that a user decision is not lost when the daemon restarts.
13. As a harness maintainer, I want approved effects to use stable idempotency keys, so that resuming after a crash does not duplicate an external effect.
14. As a harness maintainer, I want denied effects recorded with a reason, so that the Agent can explain why an action did not happen.
15. As a user, I want a Session to bind to a specific Agent Definition version, so that its behavior remains stable and auditable.
16. As a harness maintainer, I want a Session to reject an incompatible Agent Definition replacement, so that an in-flight conversation cannot silently change semantics.
17. As a user, I want to resume a Session after a process restart, so that conversational continuity is durable.
18. As a harness maintainer, I want Memory Candidates separated from accepted long-term state, so that model suggestions cannot become user truth without validation.
19. As a harness maintainer, I want Memory Candidates to retain provenance, scope, confidence, and sensitivity, so that validation and later explanation have sufficient evidence.
20. As a user, I want a valid Memory Candidate to be accepted only through an explicit validation path, so that durable personal state remains controlled.
21. As a user, I want an invalid, duplicate, or conflicting Memory Candidate rejected with a reason, so that hidden model guesses do not overwrite existing state.
22. As a user, I want the Agent to return an Evidence Bundle for claims used in a response, so that I can understand why it answered that way.
23. As a harness maintainer, I want Evidence Bundle items to preserve source and applicability metadata, so that explanations are traceable rather than copied prompt text.
24. As a user, I want to receive incremental Run output over SSE, so that a long response is visible while it is being produced.
25. As a user, I want the Chat Surface to show pending approvals, tool activity, and final responses, so that the current Run state is clear.
26. As a user, I want the Chat Surface to reconnect after a transient disconnect, so that I do not lose the Run stream or submit a duplicate message.
27. As a harness maintainer, I want the HTTP API to expose only domain-level contracts, so that transport details cannot bypass permissions or durability.
28. As a harness maintainer, I want a minimal ReAct Loop baseline before adding LangGraph.js, so that any framework comparison has a measured reference implementation.
29. As a harness maintainer, I want fixed real task scenarios executed through each Agent Loop with equivalent budgets, so that comparison results are reproducible.
30. As a harness maintainer, I want at least 50 fixed tasks recorded with outcomes and event traces, so that the Phase 2 comparison is evidence rather than anecdote.
31. As a harness maintainer, I want the whole conversational slice to run without network access in contract tests, so that provider and UI guarantees are deterministic.
32. As a harness maintainer, I want Phase 1 lifecycle, replay, restart, and idempotency tests to remain green, so that Chat does not weaken the durable runtime.

## Implementation Decisions

- Add a provider-neutral Model capability contract with request messages, declared tools, normalized response items, finish reasons, usage, and provider metadata. The contract supports non-streaming and streaming consumption without exposing DeepSeek or OpenAI SDK types.
- Implement `DeepSeekModelAdapter` as the first production provider. It accepts an injected HTTP transport for tests, validates the project-supported capability subset before making a request, uses client-managed conversation state, and normalizes text, reasoning, function tool calls, finish states, usage, and provider identifiers. Unsupported request features fail locally.
- Keep the deterministic fake Model as a first-class test adapter. Scripts can return text, tool calls, model failures, and controlled interruptions; the fake must use the same Model contract as DeepSeek.
- Add a minimal ReAct Agent Loop behind a domain-level execution service. The Loop alternates Model turns and Tool calls, records model output and tool results as Agent Events, honors scenario-specific `ExecutionBudget`, and delegates all durable checkpointing to Durability.
- Define tools with stable identity, input/output validation, effect class, required permission, idempotency-key construction, and execution. The Tool Registry is the only route from a Model tool call to a capability implementation.
- Define permission decisions as allow, deny, or requires approval. Reads may be auto-allowed by policy; external effects require an explicit approval unless a narrow matching Permission Grant exists. Approval requests, decisions, denials, and execution receipts are durable and replayable.
- Bind each Session to an immutable Agent Definition identity and version fingerprint. Session messages and Run references are durable, and a resumed Run rejects a changed definition rather than silently migrating.
- Add a Memory Candidate module that validates schema, provenance, scope, sensitivity, duplicate, and conflict rules before accepting a candidate. Accepted Claims remain distinct from candidates and are represented in Evidence Bundles with source metadata.
- Make Evidence Bundles structured domain results containing claim or event references, source, applicability, and confidence. The Agent Loop may attach an Evidence Bundle to a response; it may not replace the bundle with an opaque prompt string.
- Add a localhost Fastify API with endpoints for Session creation, message submission, Run state, approval decisions, and SSE event streaming. API handlers call the conversational execution seam and never execute tools directly.
- Add a React Chat Surface that renders Session messages, streamed Run events, tool activity, approval controls, evidence references, reconnect state, and terminal outcomes. It uses the API and keeps no authoritative Run or permission state.
- Add a fixed task corpus and comparison runner for the minimal ReAct Loop and LangGraph.js only after the minimal Loop baseline is measured. Both runners use equivalent Model scripts and Execution Budgets, and raw Run manifests and event traces are retained.
- Preserve the Phase 0 and Phase 1 Composition constraints. Cordis types remain behind Composition; plugin replacement cannot erase Agent or Session state; all durable facts go through Durability; and in-process plugins remain trusted code.

## Testing Decisions

- Tests observe public Model, Tool Registry, permission, Session, Memory Candidate, Evidence Bundle, conversational Run, API, and Chat Surface behavior. They do not assert provider SDK objects, Cordis internals, SQL statement shape, React component internals, or private call order.
- The primary integration seam is the conversational Run service. It must cover a successful read-tool conversation, an external-effect approval pause, approval denial, restart and resume, duplicate-effect prevention, evidence explanation, and immutable Session version binding.
- Model contract tests use the deterministic fake for scripted success, tool calls, malformed output, provider failure, streaming, and controlled interruption. DeepSeek adapter tests use an injected transport and include unsupported capability rejection and normalized response/error cases.
- Tool and permission tests use public tool definitions and policy decisions, including invalid inputs, automatic reads, pending approvals, denial, matching grants, non-matching grants, and stable idempotency keys.
- Durability tests use real temporary SQLite databases and verify Session records, approval recovery, Agent Event ordering, payload separation, effect receipts, and replayed summaries after reopening the database.
- Memory and evidence tests use independent examples for accepted, rejected, duplicate, conflicting, scoped, sensitive, and provenance-incomplete candidates, and verify structured evidence output.
- API tests use an in-process Fastify server and a fake conversational Run service. They verify status codes, validation, SSE event ordering, reconnect/cursor behavior, and that approval routes do not execute effects themselves.
- Chat Surface tests observe rendered messages and user-visible state transitions through a browser-level component seam. They cover streamed text, tool activity, approval controls, reconnect, error, and completed states.
- The comparison harness runs a pinned fixed corpus of at least 50 deterministic task scenarios with equivalent budgets and records manifests, outcomes, and event traces. Network-backed DeepSeek smoke tests are opt-in and never required for CI.
- Run `pnpm typecheck`, focused tests for each ticket, and the complete test suite before marking Phase 2 complete. Existing Phase 0 and Phase 1 acceptance tests must remain green.

## Out of Scope

- Multi-user tenancy, remote authentication, public deployment, plugin sandboxing, and a plugin marketplace.
- Provider support other than DeepSeek and the deterministic fake. A generic OpenAI-compatible adapter is not extracted yet.
- Server-side DeepSeek conversation state, image/file inputs, unsupported built-in tools, background responses, or provider-managed context management.
- Autonomous permission escalation, implicit external side effects, or automatic creation or broadening of Push Subscriptions.
- Full memory retrieval, embedding/vector infrastructure, long-term Claim conflict resolution beyond the Phase 2 candidate path, and the Phase 3 source/push workflows.
- LangGraph.js production dependence before the minimal loop baseline is measured.
- Production deployment, TLS, account management, and polished design-system work beyond a usable local React Chat Surface.
- Phase 3 scheduled Push, RSS/GitHub connectors, Windows notifications, and inbox delivery.

## Further Notes

- Phase 2 is complete only when a real provider-compatible conversation path exists in addition to deterministic tests, even though the CI suite must not require credentials or network access.
- A real conversation means the API can create a version-bound Session, submit a message, call a read tool, pause before an external effect, resume after approval and restart, and expose evidence and durable Agent Events.
- The Phase 1 headless Run remains the recovery substrate. New conversational behavior should deepen that module's public seam instead of introducing a second durability or job system.
- The first provider and Loop comparison artifacts should record resolved model identity, capability validation, budget, tool decisions, approval decisions, and raw normalized outcomes.
