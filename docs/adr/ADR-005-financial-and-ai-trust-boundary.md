# ADR-005: Python computes financial values; AI explains approved evidence

## Context

LLMs can produce plausible but unsupported text and unreliable arithmetic.

## Decision

Implement financial and market calculations in deterministic Python with
versioned formulas and persisted inputs. AI uses structured output constrained
to workflow-approved sources and cannot write facts or financial metrics.

## Consequences

Reports transparently separate facts, calculations, AI analysis, and missing
information. Unsupported AI citations or malformed output fail validation
instead of becoming report content.
