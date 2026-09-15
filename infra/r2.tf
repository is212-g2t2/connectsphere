# Private object storage, one bucket per environment. R2 buckets are private
# by default; the app reads and writes only through server-issued presigned
# URLs. API tokens and per-bucket CORS are manual steps.

data "cloudflare_accounts" "ciav" {}

locals {
  minio_endpoint = "https://${data.cloudflare_accounts.ciav.accounts[0].id}.r2.cloudflarestorage.com"
}

resource "cloudflare_r2_bucket" "uploads" {
  for_each = local.environments

  account_id = data.cloudflare_accounts.ciav.accounts[0].id
  name       = each.value.bucket
  location   = "APAC"
}
