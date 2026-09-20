# Workload Identity Federation: GitHub Actions authenticates as the deploy
# service account with no long-lived key. The provider accepts only tokens from
# this repository, and the binding below accepts only its main branch and tag
# refs; a pull-request workflow cannot assume the deploy identity.

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
  # Branch refs always pass; a tag ref must be a release-please v* tag, so a
  # pushed tag cannot assume the deploy identity.
  attribute_condition = "assertion.repository == \"is212-g2t2/connectsphere\" && (assertion.ref_type != \"tag\" || assertion.ref.startsWith(\"refs/tags/v\"))"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# The deploy identity. Terraform itself runs by hand from a workstation, so
# this account carries only what the release pipeline needs: deploy and move
# traffic, read the smoke token, and act as the runtime service accounts.
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
    # A release publishes a tag, so the production deploy authenticates from a
    # tag ref. Principal sets match attribute values exactly; there is no
    # wildcard, which is why the tag case is identified by ref_type and the
    # provider condition narrows it to v* tags.
    "principalSet://iam.googleapis.com/projects/${data.google_project.current.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/attribute.ref_type/tag",
  ]
}

resource "google_project_iam_member" "deploy_run" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

# The smoke job reads <env>-SMOKE_TOKEN from Secret Manager. Only the two smoke
# tokens are readable, so the staging deploy cannot reach prod-DATABASE_URL.
resource "google_secret_manager_secret_iam_member" "deploy_smoke" {
  for_each = { for k, v in local.env_secrets : k => v if v.name == "SMOKE_TOKEN" }

  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.deploy.email}"
}

# Per-environment runtime identities: the isolation that makes one project safe.
resource "google_service_account" "runtime" {
  for_each = local.environments

  project      = var.project_id
  account_id   = "cs-${each.key}-run"
  display_name = "ConnectSphere ${each.key} runtime"
}

# `gcloud run deploy` needs actAs on the runtime identity; none of the
# project-level roles grant it.
resource "google_service_account_iam_member" "deploy_actas_runtime" {
  for_each = local.environments

  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}
