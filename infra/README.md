# Infrastructure

Terraform for the two Cloud Run environments of ConnectSphere. One Google Cloud project (`connectsphere-is212`, region `asia-southeast1`), one state file for both environments, applied by hand from a workstation. The release pipeline deploys images and moves traffic, but it never runs `terraform apply`.

State lives in `gs://connectsphere-is212-tfstate` (`prefix = terraform/state`). Set the `CLOUDFLARE_API_TOKEN` environment variable before any plan or apply. The token is never a variable, a tfvars entry, or a state value.

## What Terraform owns

| File              | Resources                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `state-bucket.tf` | The state bucket (imported, see below) and the project API enablement                                             |
| `cloud-run.tf`    | Both Cloud Run services, their public invoker, the startup probe, and the domain mappings                         |
| `secrets.tf`      | Sixteen Secret Manager containers and the per-environment runtime `secretAccessor` grants                         |
| `iam.tf`          | The WIF pool and provider, the deploy service account, its ref- and ref_type-scoped binding, the runtime accounts |
| `cloudflare.tf`   | One CNAME per environment, pointing at `ghs.googlehosted.com`                                                     |
| `r2.tf`           | One private R2 bucket per environment                                                                             |
| `scheduler.tf`    | One Cloud Scheduler job per environment: the every-minute notification email worker (PTR-55)                      |
| `budget.tf`       | A monthly SGD 10 budget with alerts at 50%, 90% and 100%                                                          |

The per-environment settings (service name, hostname, instance bounds, bucket, Sentry environment, proxy flag, sender address) are one map in `main.tf`.

## Bootstrap order

Before the first run, authenticate. Run `gcloud auth login` for the bootstrap script. Run `gcloud auth application-default login` for Terraform and the Google Cloud Storage (GCS) backend. The script's authentication check does not cover application default credentials (ADC).

1. **Run the one-time script.** It enables billing and the required APIs, and it creates the versioned, uniform-access, public-access-prevention state bucket. It is idempotent.

   ```powershell
   pwsh infra/bootstrap.ps1
   ```

2. **Initialize and import.** From `infra/`:

   ```bash
   terraform init
   terraform import google_storage_bucket.tfstate connectsphere-is212-tfstate
   ```

3. **Apply the secret containers and R2 buckets on their own.** This split is not optional. `cloud-run.tf` mounts every secret as an environment reference, and a revision that references a secret with no version never becomes ready. A full apply fails halfway and leaves partial state. The buckets come along because step 5 creates per-bucket API tokens against them.

   ```bash
   terraform apply \
     -target=google_secret_manager_secret.app \
     -target=cloudflare_r2_bucket.uploads
   ```

4. **Create the two Supabase projects**, one per environment. From each project, take the **transaction pooler** URL (`:6543`) for the application's `DATABASE_URL` secret. Take the **session pooler** URL (`:5432`) for the GitHub Environment's `DATABASE_URL_SESSION`. Do not use the direct connection: on Supabase Free it is IPv6-only, and GitHub-hosted runners cannot reach it.

5. **Create the R2 API tokens and the cross-origin resource sharing (CORS) rules** (see below).

6. **Populate all sixteen secret versions** (see below). Create `staging-CRON_TOKEN` and `prod-CRON_TOKEN` before the full apply. The Cloud Run template mounts every secret. A revision that references a versionless secret never becomes ready.

7. **Now the full apply.** Both services come up on the `hello` placeholder with every secret resolvable.

   ```bash
   terraform apply
   ```

8. **Verify `ciav.dev` for this project** in Webmaster Central (done for `connectsphere-is212`), then enable the domain mappings. In the gitignored `infra/terraform.tfvars`, set `enable_domain_mapping = true`. Keep the environment's `proxied = false` in the `main.tf` map for the first apply. The Cloudflare proxy intercepts Google's ACME validation, and the managed certificate stays pending. After the certificate is Active, set `proxied = true` (staging first) and apply again. Every other variable in `variables.tf` has a working default.

9. **Set up the GitHub side.** Create the `staging` and `production` Environments, each with a `DATABASE_URL_SESSION` secret. Add the repository secrets and variables in [DEPLOYMENT.md](../docs/DEPLOYMENT.md#configuration). If you add required reviewers to `production`, note that the rule also pauses every production release on its `migrate` job. Make the GitHub Container Registry (GHCR) package public (see below).

10. **Push to `main` first.** Let the staging deploy run, and fix anything that it finds. Then merge the release-please PR to publish the first release and deploy production.

## Manual steps Terraform cannot do

### Secret versions

The containers exist after step 3, but the versions do not. The command, the value formats, and the per-environment requirements are in [DEPLOYMENT.md](../docs/DEPLOYMENT.md#secrets).

### Notification email worker

`scheduler.tf` creates one Cloud Scheduler job per environment. It uses a placeholder `Authorization` header and `ignore_changes`. The real `CRON_TOKEN` never enters the Terraform state. After the first apply creates the jobs, install the real header once per environment. Take the values from Secret Manager. Never write them down:

```bash
# Staging
token="$(gcloud secrets versions access latest --secret=staging-CRON_TOKEN --project=connectsphere-is212)"
gcloud scheduler jobs update http staging-notification-emails \
  --project=connectsphere-is212 --location=asia-southeast1 \
  --update-headers="Authorization=Bearer ${token}"

# Production
token="$(gcloud secrets versions access latest --secret=prod-CRON_TOKEN --project=connectsphere-is212)"
gcloud scheduler jobs update http prod-notification-emails \
  --project=connectsphere-is212 --location=asia-southeast1 \
  --update-headers="Authorization=Bearer ${token}"
```

Until you set the header, the route answers 401 and delivers nothing. Confirm the job after the update:

```bash
gcloud scheduler jobs describe staging-notification-emails \
  --project=connectsphere-is212 --location=asia-southeast1
```

Observe delivery from the job result and from the application. The response holds `{sent, failed, pending}`. Failures appear in Sentry. The dead-letter query is in [DEPLOYMENT.md](../docs/DEPLOYMENT.md#notification-email-worker).

### Webmaster Central

`ciav.dev` must be verified _for `connectsphere-is212`_ before the domain mappings exist. This one-time project step is already complete, and Terraform cannot do it.

### GHCR package visibility

Cloud Run has no `imagePullSecret` equivalent, so `ghcr.io/is212-g2t2/connectsphere` must be a public package. A package that `GITHUB_TOKEN` publishes is private by default, even from a public repository. After the first `publish` run, use org **Packages** → `connectsphere` → **Package settings** → **Change visibility** → **Public**. Under **Manage Actions access**, confirm that the repository has Write. Until this step is complete, `deploy-stage` fails on an image pull against a revision that never becomes ready.

### R2 API tokens and CORS

The provider has no R2 CORS resource, so both are dashboard or API steps, **per bucket**:

1. Create an R2 API token scoped to that bucket with Object Read & Write. Store the pair as that environment's `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` secret versions.
2. CORS is mandatory, not optional: the upload widget sends a `PUT` straight from the browser to a presigned URL. Allow that environment's hostname:

   ```bash
   # From infra/, with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set.
   # cors-prod.json: {"rules":[{"allowed":{"origins":["https://connectsphere.ciav.dev"],"methods":["PUT","GET"],"headers":["content-type"]},"maxAgeSeconds":3600}]}
   bunx wrangler r2 bucket cors set connectsphere-uploads --file cors-prod.json -y
   bunx wrangler r2 bucket cors list connectsphere-uploads   # Verify
   ```

   Repeat with `cors-staging.json`, `connectsphere-staging-uploads`, and `https://connectsphere-staging.ciav.dev`. Do not put both origins on one bucket: separate buckets keep staging uploads out of production.

### Resend

Verify `ciav.dev` (Sender Policy Framework (SPF) and DomainKeys Identified Mail (DKIM)) before you use it as a sender. Until then, `EMAIL_FROM` stays on `onboarding@resend.dev`. Sign-up sends a verification email synchronously, so a misconfigured sender breaks registration outright.

### Cloudflare zone TLS

The zone's TLS mode must be **Full (strict)**, so the proxied edge verifies the Cloud Run origin certificate. That is a dashboard setting because the bootstrap API token has no Zone Settings permission. The zone's Free managed WAF ruleset is zone-wide, so the team deliberately does not manage it here.

> [!WARNING]
> `var.origin_image` defaults to the `hello` placeholder container. The release pipeline replaces the running image, and `cloud-run.tf` ignores image changes, so a bare `terraform apply` never reverts a deployed service. A service that has never had a pipeline deploy serves the placeholder until the first release reaches it.
