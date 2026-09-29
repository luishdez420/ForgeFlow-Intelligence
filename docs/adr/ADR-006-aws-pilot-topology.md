# ADR-006: Run the invite-only pilot on AWS managed services

## Context

The completed local MVP needs a controlled environment for internal analysts.
The pilot must retain durable workflow semantics without requiring Kubernetes or
operationally managed database infrastructure.

## Decision

Provision staging and production through Terraform. Run web, API, worker, and
migration workloads as separate ECS Fargate task definitions. Use RDS
PostgreSQL as authoritative state, ElastiCache Redis for coordination, ECR for
immutable images, Secrets Manager for runtime secrets, and CloudWatch for logs
and metrics.

RDS and Redis reside in private subnets. The HTTPS load balancer is the only
public ingress. Workers and migrations have no public addresses. GitHub Actions
uses narrowly scoped AWS roles through OIDC, never long-lived AWS keys.

## Consequences

Terraform state and AWS account access become production-sensitive assets. This
is a smaller operational footprint than Kubernetes while retaining managed
database, backup, and network controls.
