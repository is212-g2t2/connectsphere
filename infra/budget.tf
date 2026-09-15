# Monthly spend cap. Attached to the billing account and filtered to this
# project, so it follows the project even if the number changes. Alert
# thresholds fire at 50%, 90% and 100% of 10 SGD.
resource "google_billing_budget" "connectsphere" {
  billing_account = var.billing_account_id
  display_name    = "ConnectSphere monthly (SGD 10)"

  depends_on = [google_project_service.apis]

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      currency_code = "SGD"
      units         = 10
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  threshold_rules {
    threshold_percent = 1.0
  }
}
