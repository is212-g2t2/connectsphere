# One-time bootstrap for the ConnectSphere GCP project: billing, APIs, and the
# GCS state bucket Terraform cannot create for itself. Run once before the
# first `terraform init`. Idempotent.
#
#   pwsh infra/bootstrap.ps1
#
# Then, from infra/:
#   terraform init
#   terraform import google_storage_bucket.tfstate connectsphere-is212-tfstate
#   terraform apply -target=google_secret_manager_secret.app
#   # populate the 14 secret versions
#   terraform apply
param(
  [string]$Project = "connectsphere-is212",
  [string]$Bucket = "connectsphere-is212-tfstate",
  [string]$Region = "asia-southeast1",
  [string]$BillingAccount = ""
)

$ErrorActionPreference = "Stop"

function Invoke-Gcloud {
  & gcloud @args
  if ($LASTEXITCODE -ne 0) { throw "gcloud $args failed (exit $LASTEXITCODE)" }
}

if (-not (gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null)) {
  throw "gcloud is not authenticated. Run: gcloud auth login"
}

if (-not (gcloud projects describe $Project --format="value(projectId)" 2>$null)) {
  Invoke-Gcloud projects create $Project --name ConnectSphere
}

$billingEnabled = gcloud billing projects describe $Project --format="value(billingEnabled)" 2>$null
if ($billingEnabled -ne "true") {
  if (-not $BillingAccount) {
    $BillingAccount = gcloud billing accounts list --filter="open=true" --format="value(name)" 2>$null | Select-Object -First 1
  }
  if (-not $BillingAccount) { throw "No open billing account found. Pass -BillingAccount <id>." }
  Invoke-Gcloud billing projects link $Project --billing-account $BillingAccount
}

Invoke-Gcloud services enable `
  run.googleapis.com `
  secretmanager.googleapis.com `
  iam.googleapis.com `
  iamcredentials.googleapis.com `
  sts.googleapis.com `
  cloudresourcemanager.googleapis.com `
  billingbudgets.googleapis.com `
  storage.googleapis.com `
  --project $Project

$exists = gcloud storage buckets describe "gs://$Bucket" --project $Project 2>$null
if (-not $exists) {
  Invoke-Gcloud storage buckets create "gs://$Bucket" `
    --project $Project `
    --location $Region `
    --uniform-bucket-level-access `
    --pap
}

$versioning = gcloud storage buckets describe "gs://$Bucket" --project $Project --format "value(versioning.enabled)" 2>$null
if ($versioning -ne "true") {
  Invoke-Gcloud storage buckets update "gs://$Bucket" --project $Project --versioning
}

Write-Host ""
Write-Host "State bucket ready: gs://$Bucket"
Write-Host "Next steps (from infra/):"
Write-Host "  terraform init"
Write-Host "  terraform import google_storage_bucket.tfstate $Bucket"
Write-Host "  terraform apply -target=google_secret_manager_secret.app"
Write-Host "  # populate the 14 secret versions before the full apply"
Write-Host "  terraform apply"
