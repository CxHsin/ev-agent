# Adopt Cordis with Composition constraints

Date: 2026-08-16
Status: accepted

## Context

The Composition module needs dependency reconciliation, reversible effects, Agent-scope isolation, and transactional replacement. Cordis is a candidate runtime, but the project must verify these behaviors before committing to a production package structure or exposing Cordis types to Agent-domain code.

## Decision

Adopt Cordis behind the Composition boundary, with explicit constraints. The Phase 0 prototype uses the published `cordis` `4.0.0-rc.8` package and a disposable TypeScript/Vitest harness. The public Composition contract returns domain-level lifecycle results and does not expose Cordis `Context`, `Fiber`, or `FiberState` types.

The following constraints are mandatory for Phase 1:

- Candidate compositions are staged in a dedicated Cordis Fiber group and become current only after every required Plugin is active.
- Candidate service names are namespaced per composition candidate so a sibling composition cannot satisfy or mutate another candidate's dependencies.
- Composition identity includes an explicit version; replacement publication must preserve the versioned identity of the active candidate.
- Pending candidates are preflighted before Plugin Fibers are started, so independent Plugin effects do not run before the candidate is publishable.
- A missing dependency is either explicitly deferred or reported as a failed activation; indefinite pending is not silently treated as a successful composition.
- Failed activation and replacement must dispose all candidate effects before the last working composition is retained or resumed.
- Agent state survives composition replacement and is detached, not erased, when a composition is deactivated. Scope effects are reattached to a new current composition or rejected while detached.
- Agent scope state and effects are owned by the Agent scope and must be isolated from sibling scopes; disposing one scope must not dispose another. State is resolved through a Cordis-isolated scope service rather than an implementation-only side map.
- The Cordis package version and the lifecycle acceptance suite are pinned together. Upstream upgrades require rerunning the decision behaviors and reviewing the resulting ADR constraints.
- Cordis-specific types remain local to Composition implementation code and cannot appear in Agent-domain records, capability contracts, or Product Assembly interfaces.

## Evidence

The decision spike was exercised through the Composition seam with six deterministic automated tests and no network or credentials:

- A minimal composition activated and unloaded through the domain boundary.
- A consumer remained pending when `clock` was absent and resumed after the service was provided.
- A permanently unresolved `never` dependency failed with the missing dependency named, without becoming current or leaving an effect.
- A pending candidate with an independent Plugin did not run that Plugin's effect before its sibling dependency was supplied, and a candidate did not resolve a service from a sibling composition.
- Normal unload, replacement, activation failure, and 1,000 load/unload cycles left zero tracked effects after cleanup.
- Two Agent scopes maintained independent state and effects through Cordis-isolated services under concurrent updates; disposing one left the other active, and operations on the disposed scope failed explicitly. State survived replacement, while detached scope effects were rejected and left no tracked residue.
- Invalid configuration and a Plugin setup exception preserved the baseline composition and its effect count.

The full suite and typecheck passed in the Phase 0 workspace. The repeated disposal test completed 1,000 cycles in under one second on the development machine; this is a baseline, not a production performance target.

## Alternatives considered

### Reject Cordis and build an internal composition runtime

This would reduce dependency and API risk, but would immediately require reproducing dependency reconciliation, reversible effects, scope behavior, and lifecycle rollback. The spike did not show a behavioral gap that justifies that duplication now.

### Adopt Cordis without constraints

This was rejected because Cordis is an RC release and its types and lifecycle semantics must not become the project's domain contract. Unbounded pending and non-transactional composition publication would also make failures operationally ambiguous.

## Consequences

Phase 1 may use Cordis to implement Composition and can build on its dependency and effect machinery. The project must retain a deep Composition seam, keep the acceptance suite as a compatibility contract, and treat Cordis upgrades as decision-relevant changes. A future rejection or replacement remains possible without changing Agent-domain interfaces.
