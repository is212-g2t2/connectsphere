output "wif_provider" {
  description = "Workload identity provider resource name (GitHub secret GCP_WIF_PROVIDER)"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_sa" {
  description = "Deploy service account email (GitHub secret GCP_SA)"
  value       = google_service_account.deploy.email
}

output "minio_endpoint" {
  description = "R2 S3 endpoint shared by both buckets (manual CORS step)"
  value       = local.minio_endpoint
}
