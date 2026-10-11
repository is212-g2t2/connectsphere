# Localoco also uses the ciav.dev zone. Scope every resource here to a ConnectSphere hostname, not
# the whole zone.
#
# Localoco already manages the zone-wide Free Managed WAF ruleset. Cloudflare allows one ruleset
# per phase per zone, so do not manage it here.

# Keep `proxied` false until Cloud Run issues the environment's managed certificate. Cloudflare's
# proxy intercepts Google's ACME validation and leaves the certificate pending. Enable the proxy
# for each environment, starting with staging, after its mapping is live.
resource "cloudflare_record" "app" {
  for_each = local.environments

  zone_id = data.cloudflare_zone.ciav.id
  name    = each.value.hostname
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  proxied = each.value.proxied
}
