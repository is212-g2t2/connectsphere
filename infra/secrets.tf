# Empty Secret Manager containers. Values are never in Terraform; operators
# populate versions via `gcloud secrets versions add` before the first apply.

locals {
  app_secrets = [
    "DATABASE_URL",       # Supabase transaction-pooler connection string
    "BETTER_AUTH_SECRET", # >= 32 chars, distinct per environment
    "SMOKE_TOKEN",
    "VITE_SENTRY_DSN",
    "RESEND_API_KEY",
    "MINIO_ACCESS_KEY", # R2 API token Access Key ID
    "MINIO_SECRET_KEY", # R2 API token secret
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

# Each environment's runtime service account can read only its own seven
# secrets, so cs-staging-run cannot read prod-DATABASE_URL even though both
# live in one project. This grant is what makes the single-project design safe.
resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = local.env_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.env].email}"
}
