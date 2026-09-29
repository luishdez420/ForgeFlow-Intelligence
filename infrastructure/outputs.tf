output "ecs_cluster_name" {
  value = aws_ecs_cluster.pilot.name
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
