# ForgeFlow AWS pilot infrastructure

This root provisions the pilot's private network, RDS PostgreSQL, Redis,
ECS/ECR foundations, CloudWatch logs, Secrets Manager placeholders, and optional
ACM/Route53 DNS validation. Issue #23 adds deployable ECS task definitions and
CI/CD; this issue intentionally does not deploy application containers.

## Before applying

1. Install Terraform 1.9+ and AWS CLI 2+.
2. Create an encrypted, versioned S3 Terraform-state bucket and a DynamoDB
   lock table as an account bootstrap step. Restrict both to the deployment
   role; do not use a shared developer bucket.
3. Create or obtain an AWS role with permissions to manage the declared VPC,
   RDS, ElastiCache, ECS, ECR, IAM, CloudWatch, Secrets Manager, ACM, and
   Route53 resources in the pilot account.
4. Choose an AWS region with two available zones, reserve VPC CIDRs, and own a
   Route53 hosted zone if TLS DNS validation is required.
5. Copy `backend.tfbackend.example` and the appropriate environment vars file
   outside the repository. Set a distinct `key` for staging and production.
6. Export strong values for `TF_VAR_database_master_password` and
   `TF_VAR_redis_auth_token`; never commit them. Use hexadecimal output for
   the RDS password because RDS rejects several characters that base64 output
   may contain:

   ```sh
   export TF_VAR_database_master_password="$(openssl rand -hex 32)"
   export TF_VAR_redis_auth_token="$(openssl rand -hex 32)"
   ```

## Validate and apply

```sh
terraform -chdir=infrastructure init -backend-config=/secure/path/staging.tfbackend
terraform -chdir=infrastructure fmt -check -recursive
terraform -chdir=infrastructure validate
terraform -chdir=infrastructure plan -var-file=/secure/path/staging.tfvars
terraform -chdir=infrastructure apply -var-file=/secure/path/staging.tfvars
```

Do not apply production until the staging plan has been reviewed. Record the
reviewed plan and smoke-test evidence in Issue #22.
