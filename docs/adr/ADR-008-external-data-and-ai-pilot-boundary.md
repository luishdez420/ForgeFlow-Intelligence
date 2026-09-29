# ADR-008: Use live SEC EDGAR and constrained OpenAI explanation only

## Context

The pilot needs useful real evidence but must preserve the MVP trust boundary.
No licensed market-data vendor has been selected.

## Decision

Enable live SEC EDGAR only when a contactable User-Agent, rate limit, timeout,
and bounded cache are configured. Store immutable source/document metadata and
hashes, not response headers or credentials. Market-derived work stays
explicitly unavailable until vendor and license approval.

Use OpenAI Responses API only for structured explanatory output. The model
receives allow-listed, bounded source context; it cannot write facts or
metrics. API keys come from Secrets Manager. Prompts, provider headers, and
secrets are never persisted; audit records hold redacted metadata, structured
output, token counts, and estimated cost.

## Consequences

Pilot reports may have unavailable market sections. SEC and OpenAI calls remain
at-least-once external operations; authoritative persistence remains
idempotent and source validation mandatory.
