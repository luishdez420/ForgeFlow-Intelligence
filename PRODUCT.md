# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: Next.js/TypeScript serves the internal operator interface and control
plane; Python owns worker and deterministic financial-engine code; PostgreSQL
and Redis provide local durable execution foundations.

## Users

The primary MVP users are internal analysts performing repeatable public-company
research. They need to launch a company analysis, inspect its execution and
evidence, and distinguish retrieved facts from calculations and AI analysis.

## Product Purpose

ForgeFlow produces durable, evidence-backed company intelligence reports for a
single US public-company ticker. Success means an analyst can audit both a
report claim and the workflow that produced it.

## Positioning

ForgeFlow pairs a durable workflow record with provenance-first financial
research: each report item explicitly identifies whether it is a fact, a
deterministic calculation, AI analysis, or unavailable information.

## Operating Context

Analysts submit a ticker, review asynchronous workflow progress, inspect source
and calculation provenance, and use the resulting report for research. Initial
sources are SEC EDGAR and a replaceable market-data provider.

## Capabilities and Constraints

- The MVP is single-tenant and internal-team oriented.
- Financial and market calculations are deterministic Python code, not LLM
  output.
- AI analysis is structured and source-grounded; it cannot author authoritative
  financial records.
- Authentication, portfolio/trading workflows, company comparison, and cloud
  infrastructure are deferred.

## Brand Commitments

The working name is ForgeFlow Intelligence. The interface should prioritize
analyst scanability, provenance, operational state, and transparent uncertainty
over consumer-investing cues.

## Evidence on Hand

The repository contains the agreed architecture, ADRs, contracts, and initial
database migration. No production data, market-data license, customer proof, or
brand assets are available; future UI must not invent them.

## Product Principles

1. Evidence is inspectable before it is persuasive.
2. Durable state and explicit failure are preferable to hidden automation.
3. Deterministic calculations own financial values; AI owns bounded synthesis.
4. Unavailable or conflicting information remains visible.

## Accessibility & Inclusion

The internal web application will target WCAG 2.2 AA contrast, keyboard access,
and semantic workflow/report structure.
