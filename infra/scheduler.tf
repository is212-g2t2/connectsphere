# PTR-55: run the notification email worker every minute. Cloud Scheduler calls the token-guarded
# route on each environment's Cloud Run URL. The direct run.app address skips the Cloudflare edge
# and its timeout.
#
# Do not store the bearer token in Terraform state. Create the job with a placeholder header, then
# use `ignore_changes` to keep Terraform from replacing the real token. An operator sets the token
# once per environment with `gcloud scheduler jobs update http` (see README.md, "Notification email
# worker"). The route returns 401 until then.

resource "google_cloud_scheduler_job" "notification_emails" {
  for_each = local.environments

  project   = var.project_id
  region    = var.region
  name      = "${each.key}-notification-emails"
  schedule  = "* * * * *"
  time_zone = "UTC"

  # A retry in the same minute repeats work that the next tick will cover. The worker is
  # idempotent per notification, so the next minute can retry it.
  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.app[each.key].uri}/api/cron/notifications"
    headers = {
      Authorization = "Bearer replace-with-${each.key}-CRON_TOKEN"
    }
  }

  lifecycle {
    ignore_changes = [http_target]
  }

  depends_on = [google_project_service.apis]
}
