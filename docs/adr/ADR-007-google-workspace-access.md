# ADR-007: Use Google Workspace SSO with invite allow-list roles

## Context

The pilot is for a bounded internal analyst team. The local MVP has no user
identity, ownership, or access-control model.

## Decision

Use Auth.js with Google OAuth and require an email in the configured Google
Workspace domain. Persist a Postgres-backed user and invitation allow-list.
Users without a valid invitation are denied after domain verification. Roles
are `ANALYST` and `ADMIN`; analysts access only owned analyses and reports,
while admins manage membership and review redacted audit events.

## Consequences

Google OAuth client credentials and Workspace domain configuration are runtime
secrets. Authorization must be enforced by API ownership checks, not the web
interface alone. This is a single-organization pilot, not multi-tenancy.
