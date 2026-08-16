# Phase 1: Durable Runtime Vertical Slice

Status: completed
Label: ready-for-agent

## Problem Statement

The Personal Agent Harness has proven the lifecycle behaviors required to adopt Cordis behind the Composition boundary, but it does not yet have a production-shaped runtime. The current disposable spike cannot preserve Agent Events, resume a Run after process termination, coordinate persistent work, or provide a deterministic model for repeatable execution tests.

Phase 1 needs the smallest durable runtime that carries one versioned Agent Definition through a headless Run. The runtime must preserve the last working composition when a candidate is invalid, clean up Plugin effects, record externally meaningful Agent Events, recover pending work after restart, and avoid repeating an external effect that was already committed before a crash.

## Solution

Build a pnpm workspace containing the first production-shaped Composition and Plugin SDK boundaries, a SQLite-backed Durability module, persistent jobs, and a headless Agent Execution path. Use Cordis only behind Composition. Use a deterministic fake model to drive a complete Run without network access or credentials.

The primary acceptance seam is the externally observable headless Run. Supporting Composition, Durability, and Plugin SDK contracts may have focused contract tests, but the phase is complete only when a Run can be created, checkpointed, interrupted, resumed, and replayed through the same public runtime behavior.

## User Stories

1. As a harness maintainer, I want a pnpm workspace with explicit runtime package boundaries, so that production modules can evolve without importing the disposable spike as an application contract.
2. As a Plugin author, I want a stable Plugin SDK contract for identity, dependencies, setup, and cleanup, so that a Plugin can be loaded without depending on Cordis types.
3. As a harness maintainer, I want to inspect and activate a versioned composition through a domain-level Composition interface, so that the active Agent Definition is unambiguous.
4. As a harness maintainer, I want invalid configuration to be rejected before publication, so that it cannot replace a working composition.
5. As a harness maintainer, I want a failing candidate composition to dispose all of its effects and leave the previous composition active, so that failed upgrades do not corrupt a running harness.
6. As a harness maintainer, I want Plugin effects to be disposed when a composition is unloaded or replaced, so that repeated configuration changes do not leak work.
7. As a harness maintainer, I want Agent-scope state to remain independent from Plugin lifetime, so that replacing a composition does not erase an Agent's durable continuity.
8. As a harness maintainer, I want Agent Events to have a durable envelope separate from optional sensitive payload data, so that history can be replayed and payloads can later be erased without losing the minimum audit fact.
9. As a harness maintainer, I want Agent Events to preserve Run identity and deterministic sequence ordering, so that execution history can explain and reconstruct a Run.
10. As a harness maintainer, I want a state summary to be replayable from recorded Agent Events, so that the summary does not depend on in-memory process state.
11. As a harness maintainer, I want persistent jobs to survive process termination, so that a pending Run can be discovered and resumed after restart.
12. As a harness maintainer, I want job claims and Run steps to be idempotent, so that a crash after an external effect does not duplicate that effect during recovery.
13. As a harness maintainer, I want a deterministic fake model with scripted output and controlled failure points, so that success, interruption, and recovery tests are repeatable without a model provider.
14. As a harness maintainer, I want a headless Run to checkpoint after meaningful execution steps, so that recovery can continue from the last durable boundary.
15. As a user, I want a headless Run to produce a durable result and explain its recorded events, so that completion remains inspectable after the process that executed it exits.
16. As a harness maintainer, I want the runtime to distinguish a completed Run, a resumable Run, and a terminal failure, so that recovery does not re-run work that is already finished.
17. As a harness maintainer, I want all Phase 1 tests to run without network access or credentials, so that lifecycle and durability guarantees are suitable for deterministic CI execution.
18. As a harness maintainer, I want the production-shaped runtime to retain the Phase 0 lifecycle acceptance suite, so that later Cordis upgrades cannot silently remove dependency, disposal, isolation, or rollback guarantees.

## Implementation Decisions

- Establish a pnpm workspace with a small set of production-shaped modules: Plugin SDK and Composition, Durability and Agent Events, and Agent Execution. Keep the disposable Cordis spike available as evidence but do not make application code depend on its internal types.
- Keep Cordis behind the Composition interface. Candidate compositions are preflighted and staged before publication, use explicit versioned identity, namespace candidate services, and dispose candidate effects on every failed activation or replacement. Preserve Agent-scope state while detaching and reattaching scope effects according to ADR 0013.
- Define the Plugin SDK in domain terms. A Plugin declares identity, required services, setup behavior, and reversible effects. The SDK exposes only the context and lifecycle results needed by the Composition module; it does not expose `Context`, `Fiber`, or `FiberState`.
- Use SQLite in WAL mode as the first durable store, with real temporary databases in tests. Durability owns transaction boundaries, sequence allocation, persistent jobs, and recovery queries.
- Store Agent Event envelopes and payloads as separable records. The envelope includes the Run identity, stable event identity, monotonic sequence, event type, occurrence time, and payload reference or redaction state. The event API does not require callers to dual-write a log and a projection.
- Make replay a public Durability behavior: loading a Run's ordered events into the same state reducer must produce the same state summary as the live execution path. Missing or erased payloads remain explicit in the replay result.
- Model persistent jobs as durable work records with an idempotency key, resumable status, attempt metadata, and lease/claim information. Recovery reclaims interrupted work according to deterministic rules and never treats an in-flight process as proof of completion.
- Model a headless Run as a durable state machine driven by a deterministic fake model and a finite scenario-specific ExecutionBudget. Each scripted model step produces a durable Agent Event before the next checkpoint. A side effect has a stable idempotency key and is executed through an idempotent effect executor before its receipt is recorded, so an interruption in that window can be retried without duplicating the external effect.
- Persist the serializable model script, configuration, composition identity, and ExecutionBudget in the Run job. A fresh runtime discovers recoverable jobs from SQLite and resumes using the persisted execution input plus the installed Composition definition; a changed definition is rejected rather than silently changing the Run.
- Validate configuration before composition publication and before Run execution. Configuration failure is reported as a domain result and does not mutate the last working composition or durable Run state.
- Use one highest-level integration seam around the headless Run. Lower-level tests cover Composition lifecycle, SQLite transaction/replay behavior, and job claiming only where those behaviors cannot be observed clearly through the Run.

## Testing Decisions

- Tests assert public runtime behavior: composition identity and lifecycle result, effect counts, scope continuity, durable event ordering, replayed state summary, job status, Run outcome, restart recovery, and effect idempotency. They do not assert Cordis internals, SQL query shape, or private call order.
- The Composition contract tests retain the Phase 0 success and failure paths: pending/resume, unresolved dependency, complete disposal, scope isolation, and configuration rollback.
- Durability tests use temporary SQLite databases and exercise transaction boundaries, ordered event reads, payload separation, replay, job claim/recovery, and duplicate idempotency keys.
- Deterministic fake model tests cover a normal scripted completion, a controlled model failure, and an interruption at each recoverable checkpoint.
- The primary integration test creates a composition, starts a headless Run, simulates process termination, opens a fresh runtime against the same database, resumes the Run, and verifies one final result, one event history, and no duplicated external effect.
- Budget tests use finite step/effect limits and verify a `budget_exhausted` checkpoint is resumable and explicit in the replay summary.
- The final suite must run deterministically with no network, credentials, wall-clock-sensitive assertions, or dependence on test execution order. Any timing or lease behavior uses injected clocks or bounded deterministic test controls.
- Typechecking and focused tests run while each ticket is implemented. The complete test suite and typecheck run before the phase is marked complete.

## Out of Scope

- DeepSeek or any production model provider, streaming model output, ReAct or LangGraph Agent Loops.
- Chat, Session, Fastify/SSE, React, PWA, Push, Source Connectors, notifications, and the control plane.
- Memory Candidates, Claims, Evidence Bundles, benchmark adapters, OpenTelemetry, backup/restore, export, and erasure workflows beyond keeping event payload storage separable.
- Multi-node execution, PostgreSQL, untrusted-plugin sandboxing, a plugin marketplace, multi-user tenancy, and distributed scheduling.
- Production performance targets beyond deterministic correctness and a basic repeatable lifecycle baseline.

## Further Notes

- Phase 0 ADR 0013 is binding. Cordis upgrades require rerunning the lifecycle acceptance suite and reviewing the constraints.
- The implementation may replace or relocate the disposable spike behind the new Composition boundary, but it must preserve the spike's behavioral evidence and avoid exposing a temporary API as a long-term domain contract.
- Phase 1 exit requires all roadmap criteria: invalid composition cannot replace the last working one; a deterministic Run survives simulated process termination and resumes without duplicated effects; Plugin load/unload tests detect leaked effects; and Run events replay into the same state summary.
