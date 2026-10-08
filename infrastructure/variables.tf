variable "aws_region" {
  type = string
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}
variable "vpc_cidr" {
  type = string
}

variable "availability_zones" {
  type = list(string)

  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "availability_zones must include exactly two zones."
  }
}

variable "database_name" {
  type    = string
  default = "forgeflow"
}

variable "database_master_username" {
  type    = string
  default = "forgeflow_migrator"
}

variable "database_master_password" {
  type      = string
  sensitive = true
}

variable "redis_auth_token" {
  type      = string
  sensitive = true
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "backup_retention_days" {
  type = number

  validation {
    condition = (
      (var.environment == "staging" && var.backup_retention_days >= 1 && var.backup_retention_days <= 35) ||
      (var.environment == "production" && var.backup_retention_days >= 7 && var.backup_retention_days <= 35)
    )
    error_message = "backup_retention_days must be 1-35 for staging and 7-35 for production."
  }
}

variable "backup_window" {
  type = string
}

variable "maintenance_window" {
  type = string
}

variable "domain_name" {
  type    = string
  default = null
}

variable "route53_zone_id" {
  type    = string
  default = null
}

variable "alarm_email" {
  type      = string
  default   = null
  sensitive = true
}
