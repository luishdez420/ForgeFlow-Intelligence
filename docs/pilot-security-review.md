# Pilot architecture and security review

Issue #21 review checklist. A reviewer records evidence for each item before
Issue #22 infrastructure provisioning begins.

## Architecture

- [ ] Terraform declares separate staging and production environments.
- [ ] ECS web/API is HTTPS-only; workers and migrations have no public ingress.
- [ ] RDS is authoritative, encrypted, private, backed up, and separated from
      runtime/migration database roles.
- [ ] Redis is private coordination/cache infrastructure, never workflow truth.
- [ ] ECR image digests and GitHub OIDC roles support immutable deployments.

## Access and secrets

- [ ] Google OAuth accepts only the configured Workspace domain and invitations.
- [ ] API authorization checks analyst ownership; admins have audited actions.
- [ ] Secrets Manager holds OAuth, OpenAI, and SEC contact configuration.
- [ ] Logs, audit events, prompts, browser responses, and Terraform state do
      not contain secrets, tokens, or provider authorization headers.

## Data and AI boundary

- [ ] SEC sources retain URL, retrieval time, hash, and document context.
- [ ] Market data remains explicitly unavailable without approved licensing.
- [ ] AI receives approved bounded evidence only and cannot create facts or
      metrics.
- [ ] Retention, backup, restoration, and access-revocation procedures have
      named owners before pilot invitations are sent.
