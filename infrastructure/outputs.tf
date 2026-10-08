output "ecs_cluster_name" {
  value = aws_ecs_cluster.pilot.name
}

output "ecs_private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "ecs_application_security_group_id" {
  value = aws_security_group.application.id
}

output "ecs_task_execution_role_arn" {
  value = aws_iam_role.ecs_task_execution.arn
}

output "ecs_task_role_arn" {
  value = aws_iam_role.ecs_task.arn
}

output "github_actions_deploy_role_arn" {
  value = aws_iam_role.github_actions_deploy.arn
}

output "service_discovery_namespace_arn" {
  value = aws_service_discovery_private_dns_namespace.pilot.arn
}

output "ecr_repository_urls" {
  value = {
    for name, repository in aws_ecr_repository.service : name => repository.repository_url
  }
}

output "rds_endpoint" {
  value     = aws_db_instance.pilot.address
  sensitive = true
}

output "redis_endpoint" {
  value     = aws_elasticache_replication_group.pilot.primary_endpoint_address
  sensitive = true
}

output "runtime_secret_arns" {
  value = {
    for name, secret in aws_secretsmanager_secret.runtime : name => secret.arn
  }
}
