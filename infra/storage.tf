# Private buckets for draft supporting documents, one per environment. The application
# reaches them through the S3 interop API with per-environment HMAC keys (see secrets.tf), so
# no bucket leaves this project. Apply by hand before the release that first writes objects.
resource "google_storage_bucket" "attachments" {
  for_each = local.environments

  name                        = "connectsphere-is212-attachments-${each.key}"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  depends_on = [google_project_service.apis]
}

# Let each environment's runtime account read, write, and delete objects in its own bucket only.
# Bucket settings stay with the operator: this grant carries no bucket management permission.
resource "google_storage_bucket_iam_member" "attachments_runtime" {
  for_each = local.environments

  bucket = google_storage_bucket.attachments[each.key].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime[each.key].email}"
}
