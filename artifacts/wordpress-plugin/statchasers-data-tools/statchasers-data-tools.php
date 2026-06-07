<?php
/**
 * Plugin Name:       StatChasers Data Tools
 * Description:        Cache layer and frontend display for StatChasers analytics. Receives Fantasy Points Allowed data pushed from a scheduled GitHub Actions refresh and serves a cached, branded frontend table.
 * Version:           1.0.4
 * Author:            StatChasers
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * Text Domain:       statchasers-data-tools
 *
 * Architecture:
 *   - GitHub Actions = data engine. A scheduled job (every 3 days) computes
 *     FPA/aFPA from nflverse and POSTs the latest JSON to this plugin's
 *     /fpa/sync endpoint. (See scripts/refresh-fpa.ts in the repo.)
 *   - WordPress = cache layer (stores the latest pushed JSON) and frontend
 *     display layer ([statchasers_fpa]).
 *
 *   The FPA sync token lives ONLY in WordPress options + the server-side REST
 *   permission check. It is never enqueued or exposed to frontend JavaScript.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'SDT_VERSION', '1.0.4' );
define( 'SDT_FILE', __FILE__ );
define( 'SDT_DIR', plugin_dir_path( __FILE__ ) );
define( 'SDT_URL', plugin_dir_url( __FILE__ ) );
define( 'SDT_REST_NAMESPACE', 'statchasers/v1' );

// Option keys.
define( 'SDT_OPT_SETTINGS', 'sdt_settings' );
define( 'SDT_OPT_CACHE', 'sdt_fpa_cache' );
define( 'SDT_OPT_STATUS', 'sdt_fpa_status' );

require_once SDT_DIR . 'includes/class-sdt-settings.php';
require_once SDT_DIR . 'includes/class-sdt-store.php';
require_once SDT_DIR . 'includes/class-sdt-rest.php';
require_once SDT_DIR . 'includes/class-sdt-admin.php';
require_once SDT_DIR . 'includes/class-sdt-shortcode.php';

/**
 * Boot the plugin once WordPress is ready.
 */
function sdt_bootstrap() {
	SDT_Settings::instance();
	SDT_Rest::instance();
	SDT_Admin::instance();
	SDT_Shortcode::instance();
}
add_action( 'plugins_loaded', 'sdt_bootstrap' );

// Clear any leftover cron event from pre-1.0.4 (auto-refresh) on deactivation.
register_deactivation_hook(
	__FILE__,
	function () {
		wp_clear_scheduled_hook( 'sdt_fpa_auto_refresh' );
	}
);
