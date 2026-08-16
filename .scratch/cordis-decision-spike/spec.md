# Phase 0: Cordis Decision Spike

Status: ready-for-agent
Label: ready-for-agent

## Problem Statement

The Personal Agent Harness needs a composition runtime that can load versioned Plugins, reconcile dependencies and configuration, isolate Agent scopes, and dispose all runtime effects. Cordis is a possible implementation for the Composition module, but adopting it without evidence could leak Cordis types into Agent-domain interfaces, leave effects active after replacement, mix state between Agent scopes, or replace a working composition with a failed configuration.

The project needs a disposable, repeatable decision spike before production workspace scaffolding. The spike must establish whether Cordis can satisfy the required lifecycle and rollback guarantees, including observable failure modes, rather than relying on API familiarity or a happy-path demo.

## Solution

Build a minimal disposable prototype around the Composition module boundary. The prototype will exercise four behaviors through the highest existing seam:

1. dependency pending and resume;
2. complete effect disposal during unload or replacement;
3. Agent-scope isolation;
4. failed configuration rollback that preserves the last working composition.

Each behavior will have automated success and failure-path tests and repeatable measurements. The prototype may use Cordis directly inside the Composition implementation, but Agent-domain records and capability interfaces must remain independent of Cordis types. The outcome will be recorded as an ADR choosing one of: adopt Cordis, adopt it with explicit constraints, or replace it with a minimal internal composition runtime.

## User Stories

1. As a harness maintainer, I want to load a minimal Plugin composition, so that I can evaluate the candidate runtime with realistic lifecycle behavior.
2. As a harness maintainer, I want a Plugin with an unresolved dependency to enter a pending state, so that activation does not fail spuriously while required inputs are unavailable.
3. As a harness maintainer, I want the pending Plugin to resume when its dependency becomes available, so that dependency resolution is observable and recoverable.
4. As a harness maintainer, I want a missing dependency failure to remain diagnosable, so that the runtime does not silently claim a composition is active.
5. As a harness maintainer, I want every registered effect to be disposed when a Plugin is unloaded, so that replacement does not accumulate timers, listeners, subscriptions, or handlers.
6. As a harness maintainer, I want disposal to run on both successful unload and failed activation cleanup, so that partial setup cannot survive an error.
7. As a harness maintainer, I want repeated load and unload cycles to leave zero registered effects, so that lifecycle behavior is stable over time.
8. As an Agent Definition owner, I want each Agent scope to receive only its own scoped state and effects, so that one Agent cannot observe another Agent's state.
9. As an Agent Definition owner, I want two simultaneous Agent scopes to remain isolated during updates, so that concurrent execution does not cause cross-Agent contamination.
10. As an Agent Definition owner, I want scope teardown to dispose only that scope's effects, so that stopping one Agent does not interrupt another.
11. As a harness maintainer, I want invalid configuration to be rejected before activation, so that unsafe or incomplete compositions cannot become current.
12. As a harness maintainer, I want a failed replacement to preserve the last working composition, so that a configuration mistake does not take down the running harness.
13. As a harness maintainer, I want rollback to clean up all effects created by the failed candidate, so that the preserved composition is the only active one.
14. As a harness maintainer, I want repeated failed replacements to be deterministic, so that rollback behavior can be trusted in automation.
15. As a developer, I want the Composition boundary to expose domain-level lifecycle results rather than Cordis types, so that Cordis can be replaced without changing Agent-domain code.
16. As a developer, I want the prototype to report activation, pending, resume, disposal, isolation, and rollback facts, so that the adoption decision is based on evidence.
17. As a maintainer, I want the same tests to run without network access or production credentials, so that the decision spike is reproducible locally and in CI.
18. As a maintainer, I want the spike to remain disposable, so that an unfavorable Cordis decision does not constrain the production package structure.
19. As a project owner, I want an explicit adopt, adopt-with-constraints, or reject decision, so that Phase 1 can begin without an implicit dependency choice.
20. As a project owner, I want the decision ADR to document observed failure modes and constraints, so that future changes can be evaluated against the original evidence.

## Implementation Decisions

- The prototype is owned by the Composition module and is tested through one composition-level seam wherever possible.
- Cordis is permitted only behind that boundary. Agent-domain records, capability contracts, and public Composition results do not expose Cordis-specific types.
- The prototype uses small test Plugins that declare dependencies, register observable effects, create Agent-scoped state, and accept valid or invalid configuration.
- Dependency tests cover both a pending composition that resumes after dependency registration and a permanently unresolved dependency that reports failure without partial activation.
- Lifecycle tests count active effects and verify cleanup after normal unload, replacement, and activation failure. Repeated cycles are part of the measurement.
- Scope tests activate at least two Agent scopes, write distinct values, and verify that reads, updates, and disposal remain scope-local.
- Configuration replacement is transactional from the caller's perspective: validate and prepare the candidate, activate it, and publish it only after success. A failed candidate leaves the previous working composition active.
- Failed activation must dispose candidate effects and must not mutate the working composition's state or registrations.
- The spike records enough structured results to compare repeatability, cleanup, isolation, and rollback; it does not introduce production persistence, networking, model adapters, or UI.
- The decision ADR will choose adopt, adopt with constraints, or reject. Constraints must name the exact boundary or lifecycle rule required for later phases.

## Testing Decisions

- Tests assert externally observable Composition behavior: lifecycle state, pending/resumed activation, active effect counts, scope visibility, cleanup, and current-composition identity. They do not assert Cordis internals or implementation-specific call order.
- The primary test seam is the Composition interface; test Plugins and a deterministic effect registry provide controllable observations beneath it.
- Every behavior has a successful path and a failure path. Failure tests must prove the resulting state, not only that an exception was thrown.
- Dependency tests prove pending-to-resumed activation and unresolved-dependency reporting.
- Disposal tests run normal unload, replacement, failed activation cleanup, and a repeatable load/unload cycle measurement; the target is zero remaining registered effects after cleanup.
- Isolation tests run multiple Agent scopes concurrently and verify no state or effect visibility crosses scope boundaries.
- Rollback tests activate a known-good composition, attempt invalid and activation-failing replacements, and verify the known-good composition remains active and unchanged.
- Tests run deterministically without external services, credentials, or network access and should be suitable for repeated CI execution.
- The spike must demonstrate both success and failure modes in automated output, and record measurements sufficient to support the follow-up ADR.

## Out of Scope

- Production pnpm workspace or package structure.
- Durable SQLite storage, Agent Events, persistent tasks, model adapters, Agent Loops, Chat, Push, Evaluation Runner, UI, or daemon APIs.
- Multi-Agent coordination, plugin marketplace behavior, hostile-plugin sandboxing, multi-tenant operation, distributed runtime, or PostgreSQL support.
- Choosing a production Plugin SDK shape beyond the minimum Composition boundary needed for the experiment.
- Performance targets for startup, idle memory, or dispatch overhead; these are recorded only as optional baselines if inexpensive.

## Further Notes

- The spike should be deleted or clearly isolated after the decision; its tests and measurements are evidence, not the production architecture.
- If Cordis is adopted, the ADR must preserve the rule that Cordis types stop at Composition. If it is adopted with constraints, those constraints become Phase 1 exit criteria. If it is rejected, the ADR should retain the behavioral contract for an internal replacement.
- No secrets or personal data may appear in prototype configuration, events, measurements, or artifacts.
