variable "project_id" {
  type        = string
  default     = "connectsphere-is212"
  description = "GCP project holding both environments."
}

variable "billing_account_id" {
  type        = string
  default     = "011935-9B816A-3A8E39"
  description = "Billing account the monthly budget is attached to."
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "zone_name" {
  type    = string
  default = "ciav.dev"
}

# The service uses this placeholder image on first apply. The release pipeline replaces it, and
# cloud-run.tf ignores image changes so later applies do not restore the placeholder.
variable "origin_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

# Verify ciav.dev in Webmaster Central for this project. Then set this to true to create the Cloud
# Run domain mappings.
variable "enable_domain_mapping" {
  type    = bool
  default = false
}

# Cloudflare account id for the R2 S3 endpoint. Set it in the git-ignored terraform.tfvars before
# a release deploy. While it is empty, attachments are unavailable and the deployed smoke check
# fails, so that release cannot ship without storage.
variable "r2_account_id" {
  type        = string
  default     = ""
  description = "Cloudflare account id used to build the R2 endpoint."
}
