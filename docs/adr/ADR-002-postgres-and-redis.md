# ADR-002: PostgreSQL is authoritative; Redis is coordination only

## Context

Workflow state must survive restarts, worker failures, and Redis outages.

## Decision

Persist workflows, tasks, leases, retries, attempts, and reports in PostgreSQL.
Use Redis only for wakeups, short-lived coordination, and caching. Workers can
poll PostgreSQL when a Redis notification is lost.

## Alternatives

An in-memory queue alone cannot meet the durability requirement. A full
workflow platform or Kafka adds operational complexity before measured need.

## Consequences

Database schema and indexes are core reliability work. Redis outages can harm
latency but cannot erase the authoritative execution state.
