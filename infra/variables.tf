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

# The placeholder the service comes up on at first apply. The release pipeline
# replaces it and cloud-run.tf ignores image changes, so a later bare apply
# never reverts it.
variable "origin_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

# Requires ciav.dev verified in Webmaster Central for this project.
# Verify, then set to true to create the Cloud Run domain mappings.
variable "enable_domain_mapping" {
  type    = bool
  default = false
}
