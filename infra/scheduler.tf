# PTR-55: the every-minute notification email worker. Cloud Scheduler calls the app's
# token-guarded route on each environment's own Cloud Run URL (the direct run.app address, so the
# request skips the Cloudflare edge and its timeout).
#
# The bearer value is never in Terraform state: the job is created with a placeholder header and
# `ignore_changes` keeps Terraform from reverting the real token, which an operator installs once
# per environment with `gcloud scheduler jobs update http` (see README.md, "Notification email
# worker"). The route answers 401 until that step runs.

resource "google_cloud_scheduler_job" "notification_emails" {
  for_each = local.environments

  project   = var.project_id
  region    = var.region
  name      = "${each.key}-notification-emails"
  schedule  = "* * * * *"
  time_zone = "UTC"

  # A retry inside the same minute only repeats work the next tick already covers; the worker is
  # idempotent per notification, but the next minute is the retry.
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
