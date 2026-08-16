# Delivery Roadmap

## Phase 0: Cordis decision spike (week 1)

Build the smallest disposable prototype that tests dependency pending/resume, complete effect disposal, Agent-scope isolation, and failed configuration rollback. Record measurements and create an ADR to adopt Cordis, adopt it with constraints, or replace it with a minimal internal composition runtime.

Exit criteria:

- Each behavior has a repeatable automated test.
- The prototype demonstrates the failure mode as well as the successful path.
- No production package structure is committed to the result before the decision.

## Phase 1: Durable runtime vertical slice (weeks 2-3)

Create the pnpm workspace, Plugin SDK, Composition interface, SQLite Durability module, Agent Event envelope/payload storage, persistent jobs, deterministic fake model, configuration validation, and one end-to-end headless Run.

Exit criteria:

- Invalid composition cannot replace the last working one.
- A deterministic Run survives process termination and resumes without duplicated effects.
- Plugin load/unload contract tests detect leaked registered effects.
- Run events can be replayed into the same state summary.

## Phase 2: Conversational Chat vertical slice (weeks 4-5)

Add the DeepSeek Model Adapter, minimal ReAct Agent Loop, tool registry and permissions, version-bound Session, Memory Candidate path, Evidence Bundle, Fastify/SSE API, and React Chat Surface. Add LangGraph.js only after the minimal loop becomes a measured baseline.

Exit criteria:

- A real conversation can call a read tool, request approval for an external effect, recover after restart, and explain evidence.
- DeepSeek capability mismatches fail locally instead of being silently ignored by the provider.
- At least 50 fixed real tasks can be executed and compared across Agent Loops.

## Phase 3: Scheduled Push vertical slice (weeks 6-7)

Add Push Subscription Candidates, persistent schedules, RSS and GitHub Source Connectors, Source Item versioning/deduplication, exposure tracking, candidate ranking, Delivery Decisions, in-app inbox, Windows notifications, linked Chat Sessions, and Interaction Signals. Publish `github-release-watch` as the first independently packaged plugin.

Exit criteria:

- A natural-language subscription requires explicit confirmation before activation.
- Restart and missed schedules produce at most one delivery per intended occurrence.
- Interaction Signals affect ranking but cannot change subscription authority.
- Every delivered and suppressed candidate has a recorded reason.

## Phase 4: Evaluation and hardening (week 8)

Finish the Harness Resilience suite, external Python benchmark adapters, LongMemEval-V2 small-tier integration, a pinned tau3-bench sample, ProactiveEval split tooling, run manifests, report generation, OpenTelemetry instrumentation, backup, restore, export, and erasure paths.

Exit criteria:

- The runtime targets in `docs/benchmarks/strategy.md` run automatically.
- All paid evaluations enforce a budget and record immutable raw artifacts.
- Backup restoration and sensitive-payload erasure are tested end to end.
- Public and private datasets cannot be mixed accidentally.

## Phase 5: 30-day personal validation (weeks 9-12)

Use Chat and the daily Agent/LLM digest continuously. Triage failures by frequency and user cost, rerun frozen evaluations after fixes, and publish the full report rather than only the best run.

Exit criteria:

- Thirty days of longitudinal metrics and a documented denominator for each metric.
- Published failure taxonomy, representative traces, regressions, and fixes.
- Controlled Agent Loop and Memory comparisons with fixed models and budgets.
- Architecture, setup, demo fixtures, evaluation commands, third-party notices, and limitations are reproducible by another developer.

## Public release evidence

The release should support only claims demonstrated by artifacts:

- two working Product Assemblies plus the Evaluation Runner;
- one production model provider, one deterministic fake, and multiple measured Agent Loop or Memory adapters;
- durable restart and plugin-replacement continuity;
- an independently packaged plugin;
- public benchmark results, private holdout methodology, and 30-day personal-use outcomes;
- explicit limitations: single user, single node, trusted in-process plugins, DeepSeek-only production model support, and no plugin marketplace.
