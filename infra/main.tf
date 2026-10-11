provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

# Read credentials from CLOUDFLARE_API_TOKEN. Do not store the token in variables, tfvars, or state.
provider "cloudflare" {}

data "google_project" "current" {
  project_id = var.project_id
}

data "cloudflare_zone" "ciav" {
  name = var.zone_name
}

# Secrets, Cloud Run services, runtime service accounts, and DNS records use this map. Edit the map
# to add or resize an environment.
locals {
  environments = {
    prod = {
      service  = "connectsphere"
      hostname = "connectsphere.ciav.dev"
      # Scale to zero. Accept cold starts; startup CPU boost reduces their effect.
      min_instances      = 0
      max_instances      = 5
      sentry_environment = "production"
      # Enabled after staging worked through the proxy.
      proxied = true
      # Use an email address without a display name. `src/env.ts` validates EMAIL_FROM with
      # `z.email()`, so a display name would stop the container at startup. Use noreply@ciav.dev
      # after Resend verifies the domain (SPF and DKIM).
      email_from = "onboarding@resend.dev"
    }
    staging = {
      service            = "connectsphere-staging"
      hostname           = "connectsphere-staging.ciav.dev"
      min_instances      = 0
      max_instances      = 2
      sentry_environment = "staging"
      # Enabled after the staging managed certificate was active and before production.
      proxied    = true
      email_from = "onboarding@resend.dev"
    }
  }
}
