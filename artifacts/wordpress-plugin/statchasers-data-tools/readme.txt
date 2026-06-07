=== StatChasers Data Tools ===
Contributors: statchasers
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.4
License: GPLv2 or later

Cache layer and frontend display for StatChasers analytics, fed by a scheduled GitHub Actions refresh.

== Description ==

This private plugin turns your WordPress site into the cache layer and frontend
display for StatChasers Fantasy Points Allowed data. The heavy nflverse
computation runs in GitHub Actions (not on this site and not on Replit); the
resulting JSON is pushed to WordPress on a schedule.

Architecture:

* GitHub Actions = data engine. A scheduled job every 3 days computes FPA/aFPA
  from nflverse and POSTs the latest JSON to this plugin's sync endpoint.
* WordPress = cache + frontend display.

The FPA sync token is stored only in WordPress options and used server-side to
authenticate the push. It is never enqueued to or exposed in frontend JavaScript.

= Features =

* Admin menu "StatChasers Data" with a read-only "Fantasy Points Allowed" dashboard.
* Status panel: current data mode, last updated, source season, current season,
  number of teams returned, last refresh status, and last error.
* Token-authenticated sync endpoint that receives the latest JSON push and caches it.
* Public read-only endpoint that serves the cached data.
* `[statchasers_fpa]` shortcode that renders a branded, mobile-friendly table.
* Settings: FPA sync token, default season, default scoring format, cache duration.

== REST Endpoints ==

* POST /wp-json/statchasers/v1/fpa/sync
  Machine-to-machine. Requires `Authorization: Bearer <FPA Sync Token>`. Accepts
  the computed JSON payload and caches it. Called by the GitHub Actions job.
* GET  /wp-json/statchasers/v1/fpa?format=ppr&view=adjusted
  Public, read-only. Returns the latest cached snapshot for the requested combo.

== Refresh Setup (GitHub Actions) ==

The refresh runs from the repo's `.github/workflows/refresh-fpa.yml` workflow,
which executes `scripts/refresh-fpa.ts`:

1. Set two GitHub Actions secrets in the repo:
   * `STATCHASERS_FPA_SYNC_URL` — e.g. https://YOURSITE/wp-json/statchasers/v1/fpa/sync
   * `STATCHASERS_FPA_SYNC_TOKEN` — any long random string.
2. Paste the same token value into this plugin's "FPA Sync Token" setting.
3. The workflow runs every 3 days (and on manual `workflow_dispatch`), computes
   FPA/aFPA from nflverse, and POSTs the JSON to the sync endpoint above.

No Replit deployment or Replit scheduled deployment is involved.

== Changelog ==

= 1.0.4 =
* Convert the refresh pipeline to a push model: data is now computed by a GitHub Actions job and POSTed to a new token-authenticated /fpa/sync endpoint. Removed the Replit-pull client, the manual "Refresh Data Now" button, the /fpa/refresh endpoint, and the WP-Cron auto-refresh. Settings now hold a single "FPA Sync Token".

= 1.0.3 =
* Rebrand all admin/settings copy from "Replit" to "StatChasers API"; rename the stored settings keys accordingly.

= 1.0.2 =
* Swap heatmap tints for the "good" and "neutral" tiers (the yellow and white cell backgrounds are flipped).

= 1.0.1 =
* Flip matchup ranking to industry convention (Rank 1 = most points allowed = easiest matchup); heatmap colors and OFF rank updated to match.

= 1.0.0 =
* Initial release.
