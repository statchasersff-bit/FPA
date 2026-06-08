<?php
/**
 * Plugin Name:       StatChasers Data Tools
 * Description:        Frontend display for StatChasers analytics. Renders a branded Fantasy Points Allowed table from a data snapshot bundled inside the plugin.
 * Version:           1.1.0
 * Author:            StatChasers
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * Text Domain:       statchasers-data-tools
 *
 * Architecture:
 *   - The FPA snapshot ships INSIDE the plugin at data/fpa-data.json. To update
 *     the numbers, edit/regenerate that file in the repo, rebuild the plugin
 *     zip, and re-upload it in WordPress. (See scripts/refresh-fpa.ts, which
 *     regenerates data/fpa-data.json from nflverse.)
 *   - WordPress = read-only display layer ([statchasers_fpa] + public endpoint).
 *     There is no push/sync endpoint and nothing is fetched at runtime.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'SDT_VERSION', '1.1.0' );
define( 'SDT_FILE', __FILE__ );
define( 'SDT_DIR', plugin_dir_path( __FILE__ ) );
define( 'SDT_URL', plugin_dir_url( __FILE__ ) );
define( 'SDT_REST_NAMESPACE', 'statchasers/v1' );

// Bundled data snapshot — the single source of truth for the FPA table.
define( 'SDT_DATA_FILE', SDT_DIR . 'data/fpa-data.json' );

// Option keys.
define( 'SDT_OPT_SETTINGS', 'sdt_settings' );

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
