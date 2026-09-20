# Infrastructure

Terraform for the two Cloud Run environments of ConnectSphere. One GCP project (`connectsphere-is212`, region `asia-southeast1`), one state file covering both environments, applied by hand from a workstation. The release pipeline deploys images and moves traffic, but never runs `terraform apply`.

State lives in `gs://connectsphere-is212-tfstate` (`prefix = terraform/state`). The `CLOUDFLARE_API_TOKEN` environment variable must be set before any plan or apply; the token is never a variable, a tfvars entry, or a state value.

## What Terraform owns

| File              | Resources                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `state-bucket.tf` | The state bucket (imported, see below) and the project API enablement                                             |
| `cloud-run.tf`    | Both Cloud Run services, their public invoker, the startup probe, and the domain mappings                         |
| `secrets.tf`      | Fourteen Secret Manager containers and the per-environment runtime `secretAccessor` grants                        |
| `iam.tf`          | The WIF pool and provider, the deploy service account, its ref- and ref_type-scoped binding, the runtime accounts |
| `cloudflare.tf`   | One CNAME per environment, pointing at `ghs.googlehosted.com`                                                     |
| `r2.tf`           | One private R2 bucket per environment                                                                             |
| `budget.tf`       | A monthly SGD 10 budget with alerts at 50%, 90% and 100%                                                          |

The per-environment settings (service name, hostname, instance bounds, bucket, Sentry environment, proxy flag, sender address) are one map in `main.tf`.

## Bootstrap order

Before the first run, authenticate: `gcloud auth login` for the bootstrap script, and `gcloud auth application-default login` for Terraform and the GCS backend (the script's auth check does not cover ADC).

1. **Run the one-time script.** It enables billing, enables the required APIs, and creates the versioned, uniform-access, public-access-prevention state bucket. It is idempotent.

   ```powershell
   pwsh infra/bootstrap.ps1
   ```

2. **Initialise and import.** From `infra/`:

   ```bash
   terraform init
   terraform import google_storage_bucket.tfstate connectsphere-is212-tfstate
   ```

3. **Apply the secret containers and R2 buckets on their own.** This split is not optional: `cloud-run.tf` mounts every secret as an environment reference, and a revision referencing a secret with no version never becomes ready, so a full apply would fail halfway and leave partial state. The buckets come along because step 5 creates per-bucket API tokens against them.

   ```bash
   terraform apply \
     -target=google_secret_manager_secret.app \
     -target=cloudflare_r2_bucket.uploads
   ```

4. **Create the two Supabase projects**, one per environment. From each, take the **transaction pooler** URL (`:6543`) for the app's `DATABASE_URL` secret and the **session pooler** URL (`:5432`) for the GitHub Environment's `DATABASE_URL_SESSION`. Do not use the direct connection: on Supabase Free it is IPv6-only and GitHub-hosted runners cannot reach it.

5. **Create the R2 API tokens and CORS rules** (see below).

6. **Populate all fourteen secret versions** (see below).

7. **Now the full apply.** Both services come up on the `hello` placeholder with every secret resolvable.

   ```bash
   terraform apply
   ```

8. **Verify `ciav.dev` for this project** in Webmaster Central (done for `connectsphere-is212`), then enable the domain mappings. In the gitignored `infra/terraform.tfvars` set `enable_domain_mapping = true`, and keep the environment's `proxied = false` in the `main.tf` map for the first apply: Cloudflare's proxy intercepts Google's ACME validation and the managed certificate stays pending. Once the certificate is Active, flip `proxied = true` (staging first) and apply again. Every other variable in `variables.tf` has a working default.

9. **Set the GitHub side up.** Create the `staging` and `production` Environments, each with a `DATABASE_URL_SESSION` secret; add the repo secrets and variables listed in [DEPLOYMENT.md](../docs/DEPLOYMENT.md#configuration). If you add required reviewers to `production`, note the rule also pauses every production release on its `migrate` job. Make the GHCR package public (see below).

10. **Push to `main` first.** Let the staging deploy run, fix anything it flushes out, then merge the release-please PR to publish the first release and deploy production.

## Manual steps Terraform cannot do

### Secret versions

The containers exist after step 3; the versions do not. The command, the value formats and the per-environment requirements are in [DEPLOYMENT.md](../docs/DEPLOYMENT.md#secrets).

### Webmaster Central

`ciav.dev` must be verified _for `connectsphere-is212`_ before the domain mappings exist: a one-time project step, already completed, that Terraform cannot do.

### GHCR package visibility

Cloud Run has no `imagePullSecret` equivalent, so `ghcr.io/is212-g2t2/connectsphere` must be a public package. A package published by `GITHUB_TOKEN` defaults to private even from a public repository. After the first `publish` run: org **Packages** → `connectsphere` → **Package settings** → **Change visibility** → **Public**, and under **Manage Actions access** confirm the repository has Write. Until this is done, `deploy-stage` fails on an image pull against a revision that never becomes ready.

### R2 API tokens and CORS

The provider has no R2 CORS resource, so both are dashboard/API steps, **per bucket**:

1. Create an R2 API token scoped to that bucket with Object Read & Write; store the pair as that environment's `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` secret versions.
2. CORS is mandatory, not optional: the upload widget `PUT`s straight from the browser to a presigned URL. Allow that environment's hostname:

   ```bash
   # From infra/, with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set.
   # cors-prod.json: {"rules":[{"allowed":{"origins":["https://connectsphere.ciav.dev"],"methods":["PUT","GET"],"headers":["content-type"]},"maxAgeSeconds":3600}]}
   bunx wrangler r2 bucket cors set connectsphere-uploads --file cors-prod.json -y
   bunx wrangler r2 bucket cors list connectsphere-uploads   # verify
   ```

   Repeat with `cors-staging.json`, `connectsphere-staging-uploads` and `https://connectsphere-staging.ciav.dev`. Do not put both origins on one bucket; separate buckets are what keep staging uploads out of production.

### Resend

Verify `ciav.dev` (SPF + DKIM) before using it as a sender. Until then `EMAIL_FROM` stays on `onboarding@resend.dev`: sign-up sends a verification email synchronously, so a misconfigured sender breaks registration outright.

### Cloudflare zone TLS

The zone's TLS mode must be **Full (strict)** so the proxied edge verifies the Cloud Run origin certificate. That is a dashboard setting because the bootstrap API token has no Zone Settings permission. The zone's Free managed WAF ruleset is zone-wide, so it is deliberately not managed here.

> [!WARNING]
> `var.origin_image` defaults to the `hello` placeholder container. The release pipeline replaces the running image, and `cloud-run.tf` ignores image changes, so a bare `terraform apply` never reverts a deployed service. A service that has never had a pipeline deploy will serve the placeholder until the first release reaches it.
