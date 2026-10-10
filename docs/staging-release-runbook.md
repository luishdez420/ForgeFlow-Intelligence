# Staging release runbook

Issue #23 uses GitHub Actions OIDC to build immutable ECR images, run the
migration task, and deploy private Fargate services. It intentionally does not
use a developer's AWS access keys in CI.

## Private-bootstrap preconditions

1. Apply the current Terraform plan. It adds the ECS task role, execution-role
   permission to read only ForgeFlow runtime secrets, a private service
   discovery namespace, and the `web-auth`/`internal-api` secret placeholders.
2. Create values for the placeholders in AWS Secrets Manager. Keep the values
   out of the repository, Terraform variables file, Actions logs, and issue
   comments.
3. The Terraform plan creates the GitHub OIDC provider and a staging-only
   deployment role trusted only by
   `repo:luishdez420/ForgeFlow-Intelligence:environment:staging`. It is scoped
   to ForgeFlow ECR publication, the staging ECS cluster, the private Cloud Map
   namespace, and `iam:PassRole` for only the two ForgeFlow ECS roles. If this
   AWS account already has the GitHub OIDC provider outside this Terraform
   state, set `github_actions_oidc_provider_arn` in the ignored `staging.tfvars`
   file before planning instead of creating a duplicate.

   Some repositories use GitHub's ID-based OIDC subject customization. If AWS
   denies `AssumeRoleWithWebIdentity`, inspect the denied event's `userName` in
   CloudTrail and set `github_actions_oidc_subject` to that exact `sub` claim
   in `staging.tfvars`. This keeps the trust boundary exact rather than
   widening it with a wildcard.

4. Create the GitHub `staging` environment, restrict who can dispatch it, and
   configure the repository environment variables below.

The first private deployment does **not** require a public DNS name, TLS
certificate, or Google Workspace domain. The web task starts with
`http://localhost:3000` as a placeholder origin and an empty Workspace-domain
restriction. Its health endpoint can be checked inside ECS, but analyst
sign-in must remain disabled until the public ingress and identity work are
complete.

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

When populating the database secret from a local workstation, construct the
RDS connection URL **after** loading any local `.env` file (or in a shell that
does not load it). Local development commonly defines `DATABASE_URL` with a
Compose address such as `127.0.0.1:15432`; that value must never be uploaded to
the staging `database` secret.

The API and worker images install the official AWS RDS global trust bundle at
build time. Keep `sslmode=require` in the staging URL: it is encrypted and the
container verifies the RDS certificate chain rather than disabling certificate
verification to work around a local trust-store mismatch.

## GitHub staging environment variables

Configure these as GitHub **environment variables**, not repository files:

| Variable                          | Source                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `AWS_REGION`                      | `us-east-1`                                                                   |
| `AWS_DEPLOY_ROLE_ARN`             | Terraform `github_actions_deploy_role_arn` output                             |
| `ECS_CLUSTER`                     | Terraform `ecs_cluster_name` output                                           |
| `ECS_SUBNETS`                     | Terraform `ecs_private_subnet_ids`, comma-separated                           |
| `ECS_SECURITY_GROUP`              | Terraform `ecs_application_security_group_id` output                          |
| `ECS_TASK_EXECUTION_ROLE_ARN`     | Terraform output of the same name                                             |
| `ECS_TASK_ROLE_ARN`               | Terraform output of the same name                                             |
| `SERVICE_DISCOVERY_NAMESPACE_ARN` | Terraform output of the same name                                             |
| `DATABASE_SECRET_ARN`             | `runtime_secret_arns.database`                                                |
| `INTERNAL_API_SECRET_ARN`         | `runtime_secret_arns["internal-api"]`                                         |
| `WEB_AUTH_SECRET_ARN`             | `runtime_secret_arns["web-auth"]`                                             |
| `GOOGLE_OAUTH_SECRET_ARN`         | `runtime_secret_arns["google-oauth"]`                                         |
| `WEB_APP_ORIGIN`                  | Optional for private bootstrap; required HTTPS origin before analyst sign-in  |
| `GOOGLE_WORKSPACE_DOMAIN`         | Optional for private bootstrap; required before analyst sign-in               |
| `NEXT_PUBLIC_API_URL`             | Optional for private bootstrap; required public API origin for browser access |

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
