<?php
/**
 * Uninstall cleanup for StatChasers Data Tools.
 *
 * Removes plugin options and any scheduled cron event.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'sdt_settings' );
delete_option( 'sdt_fpa_cache' );
delete_option( 'sdt_fpa_status' );

wp_clear_scheduled_hook( 'sdt_fpa_auto_refresh' );
