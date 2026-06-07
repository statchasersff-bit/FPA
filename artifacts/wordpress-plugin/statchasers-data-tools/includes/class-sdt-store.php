<?php
/**
 * Cache + status storage.
 *
 * The cache holds the latest FPA JSON snapshot fetched from the StatChasers API,
 * keyed by "{format}:{view}" so the frontend can switch scoring/view without ever
 * hitting the API again. The status holds metadata shown on the admin page.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SDT_Store {

	const FORMATS = array( 'standard', 'half', 'ppr' );
	const VIEWS   = array( 'raw', 'adjusted' );

	/** Build the cache map key. */
	public static function key( $format, $view ) {
		return $format . ':' . $view;
	}

	/**
	 * Get the full cache map.
	 *
	 * @return array
	 */
	public static function get_cache() {
		$cache = get_option( SDT_OPT_CACHE, array() );
		return is_array( $cache ) ? $cache : array();
	}

	/**
	 * Persist the full cache map (autoload off — it can be large).
	 *
	 * @param array $map Cache map.
	 */
	public static function set_cache( $map ) {
		update_option( SDT_OPT_CACHE, $map, false );
	}

	/**
	 * Get a single cached combo, falling back to the requested defaults.
	 *
	 * @param string $format Scoring format.
	 * @param string $view   raw|adjusted.
	 * @return array|null
	 */
	public static function get_combo( $format, $view ) {
		$cache = self::get_cache();
		$key   = self::key( $format, $view );
		return isset( $cache[ $key ] ) ? $cache[ $key ] : null;
	}

	/**
	 * Get the status array (with safe defaults).
	 *
	 * @return array
	 */
	public static function get_status() {
		$status = get_option( SDT_OPT_STATUS, array() );
		if ( ! is_array( $status ) ) {
			$status = array();
		}
		return wp_parse_args(
			$status,
			array(
				'last_refresh_status' => 'never', // never|success|error.
				'last_updated'        => 0,        // unix timestamp.
				'last_error'          => '',
				'data_mode'           => '',
				'source_season'       => 0,        // season the engine read from (baseline).
				'current_season'      => 0,        // season being projected.
				'team_count'          => 0,
				'is_preseason'        => null,
			)
		);
	}

	/**
	 * Persist the status array.
	 *
	 * @param array $status Status fields to merge over existing.
	 */
	public static function set_status( $status ) {
		$merged = wp_parse_args( $status, self::get_status() );
		update_option( SDT_OPT_STATUS, $merged, true );
	}

	/**
	 * Ingest a payload pushed by the GitHub Actions refresh job.
	 *
	 * The payload carries one entry per "{format}:{view}" combo plus top-level
	 * metadata. Each combo is stored verbatim (it already has rows/dataMode/etc.)
	 * so the public read endpoint can serve it without transformation.
	 *
	 * @param array $payload Decoded JSON body.
	 * @return array{ok:bool,error?:string,stored?:int}
	 */
	public static function store_sync_payload( $payload ) {
		if ( ! is_array( $payload ) ) {
			return array( 'ok' => false, 'error' => 'Payload was not a JSON object.' );
		}

		$combos = isset( $payload['combos'] ) && is_array( $payload['combos'] ) ? $payload['combos'] : array();
		if ( empty( $combos ) ) {
			return array( 'ok' => false, 'error' => 'Payload contained no combos.' );
		}

		// Accept only known "{format}:{view}" keys whose value carries a rows array.
		$cache = array();
		foreach ( self::FORMATS as $format ) {
			foreach ( self::VIEWS as $view ) {
				$key = self::key( $format, $view );
				if ( isset( $combos[ $key ] ) && is_array( $combos[ $key ] ) && isset( $combos[ $key ]['rows'] ) && is_array( $combos[ $key ]['rows'] ) ) {
					$cache[ $key ] = $combos[ $key ];
				}
			}
		}

		if ( empty( $cache ) ) {
			return array( 'ok' => false, 'error' => 'Payload had no valid format/view combos with rows.' );
		}

		self::set_cache( $cache );

		// Derive the status summary, preferring the default-format adjusted combo.
		$primary_fmt = (string) SDT_Settings::get( 'default_format' );
		$primary     = isset( $cache[ self::key( $primary_fmt, 'adjusted' ) ] )
			? $cache[ self::key( $primary_fmt, 'adjusted' ) ]
			: reset( $cache );

		$rows         = isset( $primary['rows'] ) && is_array( $primary['rows'] ) ? $primary['rows'] : array();
		$is_preseason = isset( $payload['isPreseason'] )
			? (bool) $payload['isPreseason']
			: ( isset( $primary['isPreseason'] ) ? (bool) $primary['isPreseason'] : null );

		self::set_status(
			array(
				'last_refresh_status' => 'success',
				'last_updated'        => time(),
				'last_error'          => '',
				'data_mode'           => isset( $payload['dataMode'] ) ? (string) $payload['dataMode'] : ( isset( $primary['dataMode'] ) ? (string) $primary['dataMode'] : '' ),
				'source_season'       => isset( $payload['baselineSeason'] ) ? (int) $payload['baselineSeason'] : 0,
				'current_season'      => isset( $payload['currentSeason'] ) ? (int) $payload['currentSeason'] : (int) SDT_Settings::get( 'default_season' ),
				'team_count'          => isset( $payload['teamCount'] ) ? (int) $payload['teamCount'] : count( $rows ),
				'is_preseason'        => $is_preseason,
			)
		);

		return array( 'ok' => true, 'stored' => count( $cache ) );
	}
}
