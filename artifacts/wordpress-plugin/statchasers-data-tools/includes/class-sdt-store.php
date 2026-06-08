<?php
/**
 * Bundled-data reader.
 *
 * The FPA snapshot ships inside the plugin at data/fpa-data.json (see
 * SDT_DATA_FILE). It carries one entry per "{format}:{view}" combo plus
 * top-level metadata. To update the numbers, edit/regenerate that file, rebuild
 * the plugin zip, and re-upload it — nothing is fetched or stored at runtime.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SDT_Store {

	const FORMATS = array( 'standard', 'half', 'ppr' );
	const VIEWS   = array( 'raw', 'adjusted' );

	/** In-request memo of the decoded data file. */
	private static $data = null;

	/** Build the combo map key. */
	public static function key( $format, $view ) {
		return $format . ':' . $view;
	}

	/**
	 * Read and decode the bundled data file (memoized for the request).
	 *
	 * @return array Decoded snapshot, or array() if missing/unreadable.
	 */
	public static function get_data() {
		if ( null !== self::$data ) {
			return self::$data;
		}

		self::$data = array();

		if ( ! is_readable( SDT_DATA_FILE ) ) {
			return self::$data;
		}

		$raw = file_get_contents( SDT_DATA_FILE );
		if ( false === $raw || '' === $raw ) {
			return self::$data;
		}

		$decoded = json_decode( $raw, true );
		if ( is_array( $decoded ) ) {
			self::$data = $decoded;
		}

		return self::$data;
	}

	/**
	 * Get the full combo map from the bundled file, keyed "{format}:{view}".
	 *
	 * @return array
	 */
	public static function get_cache() {
		$data   = self::get_data();
		$combos = isset( $data['combos'] ) && is_array( $data['combos'] ) ? $data['combos'] : array();

		$map = array();
		foreach ( self::FORMATS as $format ) {
			foreach ( self::VIEWS as $view ) {
				$key = self::key( $format, $view );
				if ( isset( $combos[ $key ] ) && is_array( $combos[ $key ] ) && isset( $combos[ $key ]['rows'] ) && is_array( $combos[ $key ]['rows'] ) ) {
					$map[ $key ] = $combos[ $key ];
				}
			}
		}
		return $map;
	}

	/**
	 * Get a single combo from the bundled file.
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
	 * Derive the status summary from the bundled file's metadata.
	 *
	 * "Last updated" reflects when the snapshot was generated (the file's
	 * generatedAt, falling back to its modification time).
	 *
	 * @return array
	 */
	public static function get_status() {
		$data  = self::get_data();
		$cache = self::get_cache();

		$has_data = ! empty( $cache );

		// Prefer the default-format adjusted combo for the summary numbers.
		$primary_fmt = (string) SDT_Settings::get( 'default_format' );
		$primary     = isset( $cache[ self::key( $primary_fmt, 'adjusted' ) ] )
			? $cache[ self::key( $primary_fmt, 'adjusted' ) ]
			: ( $has_data ? reset( $cache ) : array() );

		$rows = isset( $primary['rows'] ) && is_array( $primary['rows'] ) ? $primary['rows'] : array();

		$last_updated = 0;
		if ( isset( $data['generatedAt'] ) ) {
			$ts = strtotime( (string) $data['generatedAt'] );
			if ( false !== $ts ) {
				$last_updated = $ts;
			}
		}
		if ( 0 === $last_updated && is_readable( SDT_DATA_FILE ) ) {
			$mtime = filemtime( SDT_DATA_FILE );
			$last_updated = false !== $mtime ? $mtime : 0;
		}

		$is_preseason = isset( $data['isPreseason'] )
			? (bool) $data['isPreseason']
			: ( isset( $primary['isPreseason'] ) ? (bool) $primary['isPreseason'] : null );

		return array(
			'has_data'      => $has_data,
			'last_updated'  => $last_updated,
			'data_mode'     => isset( $data['dataMode'] ) ? (string) $data['dataMode'] : ( isset( $primary['dataMode'] ) ? (string) $primary['dataMode'] : '' ),
			'source_season' => isset( $data['baselineSeason'] ) ? (int) $data['baselineSeason'] : 0,
			'current_season' => isset( $data['currentSeason'] ) ? (int) $data['currentSeason'] : (int) SDT_Settings::get( 'default_season' ),
			'team_count'    => isset( $data['teamCount'] ) ? (int) $data['teamCount'] : count( $rows ),
			'is_preseason'  => $is_preseason,
		);
	}
}
