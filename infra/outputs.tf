output "wif_provider" {
  description = "Workload identity provider resource name (GitHub secret GCP_WIF_PROVIDER)"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_sa" {
  description = "Deploy service account email (GitHub secret GCP_SA)"
  value       = google_service_account.deploy.email
}
