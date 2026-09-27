# ADR-003: Provide at-least-once tasks and effectively-once persistence

## Context

Workers can crash after an external call succeeds but before completion is
recorded. Exactly-once execution cannot be honestly guaranteed across that
boundary.

## Decision

Use transactional claims, leases, heartbeats, retries, task attempts, and
idempotent effect keys. Document at-least-once task execution and limit the MVP
to read-only external providers.

## Consequences

Handlers must tolerate duplicates. A recovered task may re-fetch a provider,
but it must not duplicate authoritative persisted data.
