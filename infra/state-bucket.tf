# The state bucket cannot be created by Terraform (backend must exist before
# init). bootstrap.ps1 creates it once with identical settings; this resource
# is then imported so the bucket stays in IaC from then on.

resource "google_storage_bucket" "tfstate" {
  name                        = "connectsphere-is212-tfstate"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "billingbudgets.googleapis.com",
    "iam.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}
