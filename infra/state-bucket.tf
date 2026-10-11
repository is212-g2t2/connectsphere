# Terraform cannot create the state bucket because the backend must exist before init.
# `bootstrap.ps1` creates the bucket with these settings. Import it so Terraform manages it after
# setup.

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
    # PTR-55: the every-minute notification email worker.
    "cloudscheduler.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}
