terraform {
  required_version = ">= 1.9.0"

  # Backend settings are intentionally supplied at init time from a local,
  # uncommitted .tfbackend file. State must never be kept on an engineer's
  # machine for a shared pilot environment.
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "forgeflow-intelligence"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
