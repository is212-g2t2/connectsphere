# Create empty Secret Manager containers. Do not store values in Terraform. Before the first apply,
# operators add secret versions with `gcloud secrets versions add`.

locals {
  app_secrets = [
    "DATABASE_URL",       # Supabase transaction-pooler connection string
    "BETTER_AUTH_SECRET", # >= 32 chars, distinct per environment
    "SMOKE_TOKEN",
    "CRON_TOKEN", # bearer the notification email worker is called with (PTR-55)
    "VITE_SENTRY_DSN",
    "RESEND_API_KEY",
  ]

  # { "prod-DATABASE_URL" = { env = "prod", name = "DATABASE_URL" }, ... }
  env_secrets = merge([
    for envname, _ in local.environments : {
      for s in local.app_secrets : "${envname}-${s}" => { env = envname, name = s }
    }
  ]...)
}

resource "google_secret_manager_secret" "app" {
  for_each   = local.env_secrets
  project    = var.project_id
  secret_id  = each.key
  depends_on = [google_project_service.apis]

  replication {
    auto {}
  }
}

# Give each environment's runtime service account access to only its six secrets. For example,
# cs-staging-run cannot read prod-DATABASE_URL, even though both use one project. This grant keeps
# the environments isolated.
resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = local.env_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.env].email}"
}
