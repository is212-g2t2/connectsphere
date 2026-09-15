terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    # v4 has no R2 CORS resource, so CORS is a manual step. Bump only once it
    # can be automated.
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "gcs" {
    bucket = "connectsphere-is212-tfstate"
    prefix = "terraform/state"
  }
}
