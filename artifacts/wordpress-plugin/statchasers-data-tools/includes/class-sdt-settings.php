<?php
/**
 * Plugin settings: registration, defaults, and accessors.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SDT_Settings {

	const GROUP = 'sdt_settings_group';

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_init', array( $this, 'register' ) );
	}

	/**
	 * Default settings.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'fpa_sync_token' => '',
			'default_season' => 2026,
			'default_format' => 'ppr',
			'cache_duration' => 3600,   // seconds (used for public Cache-Control + staleness display).
		);
	}

	/**
	 * Get all settings merged with defaults.
	 *
	 * @return array
	 */
	public static function all() {
		$saved = get_option( SDT_OPT_SETTINGS, array() );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}
		return wp_parse_args( $saved, self::defaults() );
	}

	/**
	 * Get a single setting.
	 *
	 * @param string $key Setting key.
	 * @return mixed
	 */
	public static function get( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/**
	 * Whether the plugin can accept pushed data (i.e. a sync token is set).
	 *
	 * @return bool
	 */
	public static function is_configured() {
		$all = self::all();
		return ! empty( $all['fpa_sync_token'] );
	}

	public function register() {
		register_setting(
			self::GROUP,
			SDT_OPT_SETTINGS,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize' ),
				'default'           => self::defaults(),
			)
		);
	}

	/**
	 * Sanitize the settings array on save.
	 *
	 * @param array $input Raw input.
	 * @return array
	 */
	public function sanitize( $input ) {
		$defaults = self::defaults();
		$existing = self::all();
		$out      = array();

		// Allow leaving the token field blank to keep the stored value.
		if ( isset( $input['fpa_sync_token'] ) && '' !== trim( $input['fpa_sync_token'] ) ) {
			$out['fpa_sync_token'] = trim( wp_unslash( $input['fpa_sync_token'] ) );
		} else {
			$out['fpa_sync_token'] = $existing['fpa_sync_token'];
		}

		$season                 = isset( $input['default_season'] ) ? absint( $input['default_season'] ) : $defaults['default_season'];
		$out['default_season']  = ( $season >= 2000 && $season <= 2100 ) ? $season : $defaults['default_season'];

		$format                = isset( $input['default_format'] ) ? sanitize_text_field( $input['default_format'] ) : $defaults['default_format'];
		$out['default_format'] = in_array( $format, array( 'standard', 'half', 'ppr' ), true ) ? $format : $defaults['default_format'];

		$cache                 = isset( $input['cache_duration'] ) ? absint( $input['cache_duration'] ) : $defaults['cache_duration'];
		$out['cache_duration'] = max( 60, $cache ); // never below 1 minute.

		return $out;
	}
}
