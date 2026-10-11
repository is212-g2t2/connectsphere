# Workload Identity Federation lets GitHub Actions use the deploy service account without a
# long-lived key. The provider accepts tokens only from this repository. The binding accepts only
# its main branch and tag refs, so pull-request workflows cannot use the deploy identity.

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "OIDC federation for github.com/is212-g2t2/connectsphere"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
    "attribute.ref_type"   = "assertion.ref_type"
  }
  # Allow branch refs. Allow tag refs only when release-please created the v* tag.
  attribute_condition = "assertion.repository == \"is212-g2t2/connectsphere\" && (assertion.ref_type != \"tag\" || assertion.ref.startsWith(\"refs/tags/v\"))"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# The deploy identity. Run Terraform by hand from a workstation. Give this account only the access
# the release pipeline needs: deploy services, move traffic, read the smoke token, and act as the
# runtime service accounts.
resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "terraform"
  display_name = "ConnectSphere deploy"
}

resource "google_service_account_iam_binding" "github_deploy" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  members = [
    "principalSet://iam.googleapis.com/projects/${data.google_project.current.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/attribute.ref/refs/heads/main",
    # A release publishes a tag, so production deploys use a tag ref. Principal sets require exact
    # attribute values. Match tag refs by `ref_type`, then restrict them to v* tags in the provider
    # condition.
    "principalSet://iam.googleapis.com/projects/${data.google_project.current.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/attribute.ref_type/tag",
  ]
}

resource "google_project_iam_member" "deploy_run" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

# The smoke job reads <env>-SMOKE_TOKEN from Secret Manager. It can read only the two smoke tokens,
# so the staging deploy cannot read prod-DATABASE_URL.
resource "google_secret_manager_secret_iam_member" "deploy_smoke" {
  for_each = { for k, v in local.env_secrets : k => v if v.name == "SMOKE_TOKEN" }

  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.deploy.email}"
}

# Give each environment its own runtime identity. This keeps environments isolated in one project.
resource "google_service_account" "runtime" {
  for_each = local.environments

  project      = var.project_id
  account_id   = "cs-${each.key}-run"
  display_name = "ConnectSphere ${each.key} runtime"
}

# `gcloud run deploy` needs `actAs` on the runtime identity. The project-level roles do not grant it.
resource "google_service_account_iam_member" "deploy_actas_runtime" {
  for_each = local.environments

  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}
