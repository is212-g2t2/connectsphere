provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

# Credentials come from the CLOUDFLARE_API_TOKEN environment variable; the
# token is never stored in variables, tfvars, or state.
provider "cloudflare" {}

data "google_project" "current" {
  project_id = var.project_id
}

data "cloudflare_zone" "ciav" {
  name = var.zone_name
}

# Every per-environment resource keys off this map: secrets, Cloud Run
# services, runtime service accounts, R2 buckets, and DNS records. Adding or
# resizing an environment is one edit here.
locals {
  environments = {
    prod = {
      service  = "connectsphere"
      hostname = "connectsphere.ciav.dev"
      # Scale to zero: cold start accepted, startup CPU boost softens it.
      min_instances      = 0
      max_instances      = 5
      bucket             = "connectsphere-uploads"
      sentry_environment = "production"
      # Flipped after staging was confirmed through the proxy.
      proxied = true
      # Bare address: src/env.ts validates EMAIL_FROM with z.email(), so a
      # display-name form would crash the container at boot. Switch to
      # noreply@ciav.dev once the domain is verified in Resend (SPF + DKIM).
      email_from = "onboarding@resend.dev"
    }
    staging = {
      service            = "connectsphere-staging"
      hostname           = "connectsphere-staging.ciav.dev"
      min_instances      = 0
      max_instances      = 2
      bucket             = "connectsphere-staging-uploads"
      sentry_environment = "staging"
      # Flipped once the staging managed certificate was active, before prod.
      proxied    = true
      email_from = "onboarding@resend.dev"
    }
  }
}
