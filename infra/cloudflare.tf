# The ciav.dev zone is shared with localoco; every resource here is scoped to a
# connectsphere hostname, never zone-wide.
#
# The zone's Free Managed WAF ruleset is zone-wide and already claimed by the
# localoco config; Cloudflare allows one ruleset per phase per zone, so it is
# not managed here.

# proxied stays false until that environment's Cloud Run managed certificate
# is issued: Cloudflare's proxy intercepts Google's ACME validation and the
# certificate stays pending. Flip each environment's entry (staging first)
# once its mapping is live.
resource "cloudflare_record" "app" {
  for_each = local.environments

  zone_id = data.cloudflare_zone.ciav.id
  name    = each.value.hostname
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  proxied = each.value.proxied
}
