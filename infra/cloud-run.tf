# One resource block, two services. The placeholder image is replaced by the
# release pipeline; Terraform never reverts it (see the lifecycle block).

resource "google_cloud_run_v2_service" "app" {
  for_each = local.environments

  name     = each.value.service
  location = var.region
  project  = var.project_id

  # The secret accessor grants must exist before the first revision tries to
  # read them, or the service create fails with "Permission denied on secret".
  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.runtime,
  ]

  # Service-level scaling, not template-level: a template-level minimum applies
  # per revision, so a tagged 0%-traffic revision would hold a billed instance.
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

      # A TCP-only check routes traffic to a process that has not finished
      # booting; wait for the health route instead.
      startup_probe {
        period_seconds    = 5
        failure_threshold = 10
        timeout_seconds   = 3
        http_get {
          path = "/api/health"
        }
      }

      # <env>-DATABASE_URL is the Secret Manager container name; the container
      # sees it as plain DATABASE_URL, because the prefix is a Secret Manager
      # naming concern. Versions must exist before the first apply: a revision
      # referencing a secret with no version never goes ready.
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

      # BETTER_AUTH_URL must equal the environment's public origin: Better Auth
      # derives trusted origins from it and there is no trustedOrigins override.
      dynamic "env" {
        for_each = {
          BETTER_AUTH_URL    = "https://${each.value.hostname}"
          SERVER_URL         = "https://${each.value.hostname}"
          SENTRY_ENVIRONMENT = each.value.sentry_environment
          EMAIL_FROM         = each.value.email_from
          MINIO_ENDPOINT     = local.minio_endpoint
          MINIO_BUCKET       = each.value.bucket
        }
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  # The release pipeline deploys images and moves traffic with gcloud; without
  # these ignores, an unrelated apply would restore the placeholder image and
  # reset traffic to 100% LATEST, bypassing the stage/smoke gate.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      traffic,
    ]
  }

  # deletion_protection keeps the provider default of true: dropping an
  # environment from the map fails the apply instead of deleting a live service.
}

# Public invoker so the proxied Cloudflare edge can reach the origin.
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = local.environments

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Serves each environment's hostname. Requires the zone verified in Webmaster
# Central for this project (manual bootstrap step); gated off until then so
# apply stays green.
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
    # The previous project still holds these hostnames; the deactivated
    # account means its mappings cannot be deleted by hand.
    force_override = true
  }
}
