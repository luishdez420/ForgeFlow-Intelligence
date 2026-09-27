# Workflow Engine Design

## State model

Workflow runs and tasks persist `PENDING`, `RUNNING`, `WAITING`, `RETRYING`,
`SUCCEEDED`, `FAILED`, or `CANCELLED`. Tasks may be claimed only when their
dependencies succeeded and they are ready for their next attempt.

## Claiming and leasing

A worker claims a ready task in one database transaction using row-level
contention control. The claim records a worker ID, opaque lease token, lease
expiry, and new task-attempt row. Completion and heartbeat updates require the
current lease token, preventing a stale worker from committing after recovery.

## Retries and recovery

Task failures are classified as transient, rate-limited, validation,
authentication, or permanent. Only configured retryable categories receive a
persisted exponential-backoff schedule. A recovery process reclaims expired
leases; it never assumes the previous worker completed an unrecorded effect.

## Idempotency

Every task handler receives a stable task ID and attempt ID. Authoritative
effects use deterministic unique keys and transactional writes. External
providers may be called more than once after a worker crash, so adapters must
be read-only for the MVP and all output writes must be idempotent.

## DAG execution

Workflow definitions are server-owned. Their dependencies are persisted at
creation, checked for cycles, and resolved atomically after each task reaches a
terminal state. Failure blocks dependent work and yields an explainable final
workflow state rather than silently skipping work.
