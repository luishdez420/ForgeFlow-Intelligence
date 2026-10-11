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
`http://localhost:3000` as a placeholder origin and omits the Workspace-domain
setting entirely. Its health endpoint can be checked inside ECS, but analyst
sign-in must remain disabled until the public ingress and identity work are
complete.

## Enable HTTPS analyst access and Google Workspace SSO

Issue #25 adds an **optional** public application load balancer (ALB). It is
the only public component: the web, API, worker, RDS, and Redis tasks remain
in private subnets. The ALB redirects HTTP to HTTPS, terminates an ACM
certificate, and forwards only HTTPS traffic to the web task on port 3000.

Before changing AWS, choose a domain that is hosted in Route53 in this AWS
account, for example `staging.example.com`. Do not use the ALB's generated DNS
name as a Google OAuth callback: Google requires a registered HTTPS callback
whose hostname remains stable.

1. In the ignored staging tfvars file, set these three values together:

   ```hcl
   domain_name               = "staging.example.com"
   route53_zone_id           = "Z0123456789EXAMPLE"
   enable_public_web_ingress = true
   ```

2. Review and apply the Terraform plan. It creates the public ALB, an ACM
   certificate and Route53 DNS-validation record, the HTTPS listener, a web
   target group, and a Route53 alias record. Wait for ACM validation to finish
   before dispatching the release.

3. Set these additional GitHub **staging environment variables** from
   Terraform outputs. They are configuration, not secrets:

   | Variable | Value |
   | --- | --- |
   | `PUBLIC_WEB_INGRESS_ENABLED` | `true` |
   | `WEB_TARGET_GROUP_ARN` | `web_target_group_arn` |
   | `WEB_APP_ORIGIN` | `web_public_url` (for example `https://staging.example.com`) |
   | `GOOGLE_WORKSPACE_DOMAIN` | Your approved Workspace domain only, such as `example.com` |

   Leave `NEXT_PUBLIC_API_URL` empty: browser requests use same-origin web
   routes, which call the private API through Service Connect.

4. In Google Cloud Console, open the OAuth client used in
   `forgeflow/staging/google-oauth` and add exactly this Authorized redirect
   URI:

   ```text
   https://staging.example.com/api/auth/callback/google
   ```

   Replace the example hostname with `web_public_url`. Do not add a wildcard,
   an HTTP URL, or the private ECS/ALB address.

5. Dispatch a normal staging release. The deployment script refuses to attach
   the public target group unless the origin is HTTPS and the Workspace domain
   is set. It registers the private web task with the ALB; it never assigns a
   public IP to an ECS task.

6. Browser acceptance from a private/incognito window:

   - Opening the analyst URL while signed out redirects to `/sign-in`.
   - A verified account outside the configured Workspace domain is rejected.
   - A verified approved account reaches the analyst console and receives an
     HTTPS-only expiring Auth.js session.
   - After sign-out, the analyst URL again redirects to `/sign-in`. For expiry,
     use the session expiry shown by Auth.js or a short-lived test session; do
     not lower production cookie protections merely to demonstrate expiration.

## Runtime-secret contract

| Secret name                          | Required representation                                                                                                    | Consumers                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `forgeflow/staging/database`         | One `postgresql://` connection URL using the RDS hostname, migration user, password, database name, and `sslmode=require`. | Migration/bootstrap only |
| `forgeflow/staging/database-runtime` | One `postgresql://` connection URL using the `forgeflow_runtime` login and the same private RDS endpoint.                  | API and worker           |
| `forgeflow/staging/internal-api`     | One high-entropy random string.                                                                                            | API and web              |
| `forgeflow/staging/web-auth`         | One high-entropy Auth.js secret.                                                                                           | Web                      |
| `forgeflow/staging/google-oauth`     | JSON with `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` keys.                                                                  | Web                      |

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
| `DATABASE_RUNTIME_SECRET_ARN`     | `runtime_secret_arns["database-runtime"]`                                     |
| `INTERNAL_API_SECRET_ARN`         | `runtime_secret_arns["internal-api"]`                                         |
| `WEB_AUTH_SECRET_ARN`             | `runtime_secret_arns["web-auth"]`                                             |
| `GOOGLE_OAUTH_SECRET_ARN`         | `runtime_secret_arns["google-oauth"]`                                         |
| `WEB_APP_ORIGIN`                  | Optional for private bootstrap; required HTTPS origin before analyst sign-in  |
| `GOOGLE_WORKSPACE_DOMAIN`         | Optional for private bootstrap; required before analyst sign-in               |
| `NEXT_PUBLIC_API_URL`             | Leave empty unless intentionally exposing a separate browser API origin        |
| `PUBLIC_WEB_INGRESS_ENABLED`      | `true` only after the optional Terraform HTTPS ingress has been applied       |
| `WEB_TARGET_GROUP_ARN`             | Terraform `web_target_group_arn`; required when public web ingress is enabled |

## Release and verification

1. Dispatch **Pilot release** for `staging` and type `DEPLOY` exactly.
2. Confirm each ECR image is referenced by its digest in the registered task
   definitions, not a mutable tag. Build tags include the GitHub run ID and
   attempt, so a re-dispatched release never overwrites an immutable ECR tag.
3. Confirm the migration, constrained-role bootstrap, and transaction-scoped
   runtime read/write smoke tasks each stop with exit code zero before the
   services update.
4. Confirm `forgeflow-staging-api`, `forgeflow-staging-web`, and
   `forgeflow-staging-worker` reach ECS stable state. The API is registered in
   the private `api` Service Connect namespace; web calls it at
   `http://api:3001` without public task addresses.
5. For the controlled migration-failure drill, dispatch **Pilot release** with
   `environment=staging`, `confirmation=DEPLOY`, and
   `migration_failure_drill=true`. It runs a task that intentionally exits 42
   before the service-deployment step. The workflow is expected to fail; keep
   its task diagnostics as evidence and verify no service task definition
   changed.
6. For the controlled rollback drill, dispatch **Pilot release** with
   `environment=staging`, `confirmation=DEPLOY`, and `rollback_drill=true`.
   It performs the ordinary migration, updates only the existing API service,
   immediately restores its recorded prior task definition, waits for the
   service to stabilize, and prints `Rollback drill passed`. This workflow is
   expected to succeed. Do not enable both drill inputs or use either on
   production.

## Notes

Keep `enable_public_web_ingress = false` until a reviewed Route53-hosted domain
is available. Do not expose a task directly with a public IP.
