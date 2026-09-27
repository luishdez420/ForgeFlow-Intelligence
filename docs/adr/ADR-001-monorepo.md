# ADR-001: Use a polyglot monorepo

## Context

The MVP needs a TypeScript web/control plane and Python worker/financial layer
that evolve together around shared contracts.

## Decision

Use one repository with `apps/`, `services/`, and `packages/`. Shared API and
domain schemas are versioned in-repository; language-specific generated or
parallel representations remain explicitly tested.

## Alternatives

Separate repositories would isolate tooling but add versioning and coordination
cost before independent deployment is needed. A TypeScript-only or Python-only
stack would weaken the desired frontend/control-plane and financial-engine
boundaries.

## Consequences

Local tooling must support both ecosystems. Independent deployment remains
possible later without an early multi-repository tax.
