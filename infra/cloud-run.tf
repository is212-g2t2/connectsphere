# One resource block defines two services. The release pipeline replaces the placeholder image.
# The lifecycle block prevents Terraform from restoring it.

resource "google_cloud_run_v2_service" "app" {
  for_each = local.environments

  name     = each.value.service
  location = var.region
  project  = var.project_id

  # Create the secret accessor grants before the first revision reads the secrets. Otherwise,
  # service creation fails with "Permission denied on secret".
  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.runtime,
  ]

  # Set scaling at the service level. A template-level minimum applies to each revision, so a
  # tagged revision with no traffic would keep a billed instance.
  scaling {
    min_instance_count = each.value.min_instances
    max_instance_count = each.value.max_instances
  }

  template {
    service_account                  = google_service_account.runtime[each.key].email
    max_instance_request_concurrency = 80

    containers {
      image = var.origin_image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # A TCP-only check can route traffic before the process finishes starting. Wait for the health route.
      startup_probe {
        period_seconds    = 5
        failure_threshold = 10
        timeout_seconds   = 3
        http_get {
          path = "/api/health"
        }
      }

      # Use <env>-DATABASE_URL as the Secret Manager container name. The container receives it as
      # DATABASE_URL; the prefix applies only to the Secret Manager name. Add a secret version
      # before the first apply. A revision cannot become ready without one.
      dynamic "env" {
        for_each = local.app_secrets
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["${each.key}-${env.value}"].id
              version = "latest"
            }
          }
        }
      }

      # Set BETTER_AUTH_URL to the environment's public origin. Better Auth uses it for trusted
      # origins; this configuration has no `trustedOrigins` override.
      dynamic "env" {
        for_each = {
          BETTER_AUTH_URL    = "https://${each.value.hostname}"
          SERVER_URL         = "https://${each.value.hostname}"
          SENTRY_ENVIRONMENT = each.value.sentry_environment
          EMAIL_FROM         = each.value.email_from
        }
        content {
          name  = env.key
          value = env.value
        }
      }

      # R2 settings for draft supporting documents. The bucket is created by hand in the
      # Cloudflare dashboard; while `r2_account_id` is empty the deployed smoke check fails.
      dynamic "env" {
        for_each = var.r2_account_id == "" ? {} : {
          STORAGE_BUCKET   = "connectsphere-attachments-${each.key}"
          STORAGE_ENDPOINT = "https://${var.r2_account_id}.r2.cloudflarestorage.com"
          STORAGE_REGION   = "auto"
        }
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  # The release pipeline deploys images and moves traffic with gcloud. These ignores prevent an
  # unrelated apply from restoring the placeholder image or routing all traffic to LATEST. That
  # could bypass the staging and smoke checks.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      traffic,
    ]
  }

  # Keep the provider's default `deletion_protection = true`. Removing an environment from the map
  # then fails the apply instead of deleting a live service.
}

# Allow public invocation so the Cloudflare proxy can reach this service.
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = local.environments

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Serve each environment's hostname. First verify the zone in Webmaster Central as a manual setup
# step. Keep this resource disabled until then so apply succeeds.
resource "google_cloud_run_domain_mapping" "app" {
  for_each = var.enable_domain_mapping ? local.environments : {}

  name     = each.value.hostname
  location = google_cloud_run_v2_service.app[each.key].location
  project  = google_cloud_run_v2_service.app[each.key].project

  metadata {
    namespace = google_cloud_run_v2_service.app[each.key].project
  }

  spec {
    route_name = google_cloud_run_v2_service.app[each.key].name
    # The previous project still has these hostnames. Its account is inactive, so no one can delete
    # the mappings by hand.
    force_override = true
  }
}
