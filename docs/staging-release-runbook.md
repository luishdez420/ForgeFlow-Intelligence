# Staging release runbook

Issue #23 uses GitHub Actions OIDC to build immutable ECR images, run the
migration task, and deploy private Fargate services. It intentionally does not
use a developer's AWS access keys in CI.

## Preconditions

1. Apply the current Terraform plan. It adds the ECS task role, execution-role
   permission to read only ForgeFlow runtime secrets, a private service
   discovery namespace, and the `web-auth`/`internal-api` secret placeholders.
2. Create values for the placeholders in AWS Secrets Manager. Keep the values
   out of the repository, Terraform variables file, Actions logs, and issue
   comments.
3. Register a GitHub OIDC provider and a staging-only deployment role trusted
   by `repo:luishdez420/ForgeFlow-Intelligence:environment:staging`. Scope that
   role to the staging ECR repositories, ECS cluster/services/task definitions,
   Cloud Map namespace, and `iam:PassRole` for only the two ForgeFlow ECS
   roles.
4. Create the GitHub `staging` environment, restrict who can dispatch it, and
   configure the repository environment variables below.

## Runtime-secret contract

| Secret name                      | Required representation                                                                                                    | Consumers              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `forgeflow/staging/database`     | One `postgresql://` connection URL using the RDS hostname, migration user, password, database name, and `sslmode=require`. | API, worker, migration |
| `forgeflow/staging/internal-api` | One high-entropy random string.                                                                                            | API and web            |
| `forgeflow/staging/web-auth`     | One high-entropy Auth.js secret.                                                                                           | Web                    |
| `forgeflow/staging/google-oauth` | JSON with `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` keys.                                                                  | Web                    |

Use a password manager or other approved secret channel to retain the database
password and generated values. The database is private; this URL is intended
only for ECS tasks inside the VPC.

## GitHub staging environment variables

Configure these as GitHub **environment variables**, not repository files:

| Variable                          | Source                                                |
| --------------------------------- | ----------------------------------------------------- |
| `AWS_REGION`                      | `us-east-1`                                           |
| `AWS_DEPLOY_ROLE_ARN`             | Staging-only GitHub OIDC deployment role              |
| `ECS_CLUSTER`                     | Terraform `ecs_cluster_name` output                   |
| `ECS_SUBNETS`                     | Terraform `ecs_private_subnet_ids`, comma-separated   |
| `ECS_SECURITY_GROUP`              | Terraform `ecs_application_security_group_id` output  |
| `ECS_TASK_EXECUTION_ROLE_ARN`     | Terraform output of the same name                     |
| `ECS_TASK_ROLE_ARN`               | Terraform output of the same name                     |
| `SERVICE_DISCOVERY_NAMESPACE_ARN` | Terraform output of the same name                     |
| `DATABASE_SECRET_ARN`             | `runtime_secret_arns.database`                        |
| `INTERNAL_API_SECRET_ARN`         | `runtime_secret_arns["internal-api"]`                 |
| `WEB_AUTH_SECRET_ARN`             | `runtime_secret_arns["web-auth"]`                     |
| `GOOGLE_OAUTH_SECRET_ARN`         | `runtime_secret_arns["google-oauth"]`                 |
| `WEB_APP_ORIGIN`                  | The staging HTTPS origin after DNS/TLS is configured  |
| `GOOGLE_WORKSPACE_DOMAIN`         | Approved analyst Workspace domain                     |
| `NEXT_PUBLIC_API_URL`             | Staging public API origin after DNS/TLS is configured |

## Release and verification

1. Dispatch **Pilot release** for `staging` and type `DEPLOY` exactly.
2. Confirm each ECR image is referenced by its digest in the registered task
   definitions, not a mutable tag.
3. Confirm the migration task stops with exit code zero before the services
   update.
4. Confirm `forgeflow-staging-api`, `forgeflow-staging-web`, and
   `forgeflow-staging-worker` reach ECS stable state. The API is registered in
   the private `api` Service Connect namespace; web calls it at
   `http://api:3001` without public task addresses.
5. For the controlled failure drill, dispatch a deliberately invalid migration
   revision in an isolated staging change. Verify the migration task fails and
   no service task definition changes.
6. For the rollback drill, deploy a deliberately unhealthy service revision in
   isolated staging. Verify the workflow restores the prior task definition and
   service stability. Do not use production for either drill.

## Notes

The Terraform foundation currently has no public load balancer or approved
staging domain. Fargate service deployment can therefore be verified privately
first; the HTTPS ingress and Google OAuth callback validation remain a later
pilot-access gate. Do not expose a task directly with a public IP.
