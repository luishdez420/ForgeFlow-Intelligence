# ADR-004: Use provider adapters and immutable provenance

## Context

SEC EDGAR is authoritative for filing metadata, while market-data vendors may
change based on licensing, coverage, and quality.

## Decision

Use explicit provider interfaces and normalize external data into a source and
document model that records origin, retrieval time, content hash, and raw-to-
normalized links. Preserve conflicting source records.

## Consequences

Adapters can change without rewriting workflow or report logic. The system
spends additional storage and engineering effort to make claims reproducible.
