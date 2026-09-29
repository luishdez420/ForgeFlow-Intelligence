locals {
  name          = "forgeflow-${var.environment}"
  public_cidrs  = [cidrsubnet(var.vpc_cidr, 4, 0), cidrsubnet(var.vpc_cidr, 4, 1)]
  private_cidrs = [cidrsubnet(var.vpc_cidr, 4, 8), cidrsubnet(var.vpc_cidr, 4, 9)]
}

resource "aws_vpc" "pilot" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "pilot" {
  vpc_id = aws_vpc.pilot.id
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.pilot.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-${count.index + 1}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.pilot.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]
  tags              = { Name = "${local.name}-private-${count.index + 1}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.pilot.id
}
resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.pilot.id
}
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  domain = "vpc"
}
resource "aws_nat_gateway" "pilot" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.pilot]
}
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.pilot.id
}
resource "aws_route" "private_egress" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.pilot.id
}
resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "application" {
  name        = "${local.name}-application"
  description = "Private ForgeFlow application tasks"
  vpc_id      = aws_vpc.pilot.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_security_group" "database" {
  name   = "${local.name}-database"
  vpc_id = aws_vpc.pilot.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.application.id]
  }
}
resource "aws_security_group" "redis" {
  name   = "${local.name}-redis"
  vpc_id = aws_vpc.pilot.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.application.id]
  }
}

resource "aws_db_subnet_group" "pilot" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}
resource "aws_db_instance" "pilot" {
  identifier                 = local.name
  engine                     = "postgres"
  engine_version             = "17"
  instance_class             = "db.t4g.medium"
  allocated_storage          = 50
  max_allocated_storage      = 200
  storage_encrypted          = true
  db_name                    = var.database_name
  username                   = var.database_master_username
  password                   = var.database_master_password
  db_subnet_group_name       = aws_db_subnet_group.pilot.name
  vpc_security_group_ids     = [aws_security_group.database.id]
  backup_retention_period    = 14
  deletion_protection        = var.deletion_protection
  skip_final_snapshot        = !var.deletion_protection
  publicly_accessible        = false
  multi_az                   = var.environment == "production"
  auto_minor_version_upgrade = true
  lifecycle { prevent_destroy = true }
}

resource "aws_elasticache_subnet_group" "pilot" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}
resource "aws_elasticache_replication_group" "pilot" {
  replication_group_id       = local.name
  description                = "ForgeFlow coordination Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t4g.small"
  num_cache_clusters         = 1
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token
  subnet_group_name          = aws_elasticache_subnet_group.pilot.name
  security_group_ids         = [aws_security_group.redis.id]
  automatic_failover_enabled = false
}

resource "aws_ecs_cluster" "pilot" {
  name = local.name
}
resource "aws_ecr_repository" "service" {
  for_each             = toset(["web", "api", "worker"])
  name                 = "${local.name}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}
resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(["web", "api", "worker", "migration"])
  name              = "/forgeflow/${var.environment}/${each.key}"
  retention_in_days = 30
}
resource "aws_secretsmanager_secret" "runtime" {
  for_each = toset(["database", "redis", "google-oauth", "openai", "sec-edgar"])
  name     = "forgeflow/${var.environment}/${each.key}"
}
resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name}-ecs-task-execution"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_acm_certificate" "pilot" {
  count             = var.domain_name == null ? 0 : 1
  domain_name       = var.domain_name
  validation_method = "DNS"
}
resource "aws_route53_record" "certificate" {
  for_each = var.domain_name == null || var.route53_zone_id == null ? {} : { for option in aws_acm_certificate.pilot[0].domain_validation_options : option.domain_name => option }
  zone_id  = var.route53_zone_id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  records  = [each.value.resource_record_value]
  ttl      = 60
}
