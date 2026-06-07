<?php
/**
 * REST API endpoints.
 *
 *   POST /wp-json/statchasers/v1/fpa/sync  (machine-to-machine; bearer token)
 *   GET  /wp-json/statchasers/v1/fpa        (public, read-only, cached)
 *
 * Data is pushed in by the GitHub Actions refresh job (scripts/refresh-fpa.ts),
 * which computes FPA/aFPA from nflverse and POSTs the latest JSON to /fpa/sync.
 * WordPress only stores and serves it — it never computes or pulls.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SDT_Rest {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes() {
		register_rest_route(
			SDT_REST_NAMESPACE,
			'/fpa/sync',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_sync' ),
				'permission_callback' => array( $this, 'can_sync' ),
			)
		);

		register_rest_route(
			SDT_REST_NAMESPACE,
			'/fpa',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle_public_read' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'format' => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'view'   => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
				),
			)
		);
	}

	/**
	 * Permission gate for the sync endpoint: a valid bearer token.
	 *
	 * The token must equal the plugin's stored "FPA Sync Token" setting, which in
	 * turn must match the GitHub secret STATCHASERS_FPA_SYNC_TOKEN. The comparison
	 * is timing-safe. The token is never exposed to the frontend.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool|WP_Error
	 */
	public function can_sync( WP_REST_Request $request ) {
		$expected = (string) SDT_Settings::get( 'fpa_sync_token' );
		if ( '' === $expected ) {
			return new WP_Error(
				'sdt_sync_unconfigured',
				__( 'Sync is not configured: set an FPA Sync Token in the plugin settings.', 'statchasers-data-tools' ),
				array( 'status' => 503 )
			);
		}

		$provided = $this->bearer_token( $request );
		if ( '' === $provided ) {
			return new WP_Error(
				'sdt_sync_no_token',
				__( 'Missing Authorization bearer token.', 'statchasers-data-tools' ),
				array( 'status' => 401 )
			);
		}

		if ( ! hash_equals( $expected, $provided ) ) {
			return new WP_Error(
				'sdt_sync_bad_token',
				__( 'Invalid sync token.', 'statchasers-data-tools' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Extract a bearer token from the Authorization header.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return string Token, or '' if absent/malformed.
	 */
	private function bearer_token( WP_REST_Request $request ) {
		$header = (string) $request->get_header( 'authorization' );
		if ( '' === $header ) {
			// Some servers expose it under a redirected name.
			$header = isset( $_SERVER['HTTP_AUTHORIZATION'] ) ? (string) wp_unslash( $_SERVER['HTTP_AUTHORIZATION'] ) : '';
		}
		if ( '' === $header && isset( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
			$header = (string) wp_unslash( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] );
		}
		if ( preg_match( '/^\s*Bearer\s+(.+)\s*$/i', $header, $m ) ) {
			return trim( $m[1] );
		}
		return '';
	}

	/**
	 * Handle a sync push: store the JSON payload and return the new status.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function handle_sync( WP_REST_Request $request ) {
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) ) {
			return new WP_REST_Response(
				array(
					'success' => false,
					'error'   => __( 'Request body must be a JSON object.', 'statchasers-data-tools' ),
				),
				400
			);
		}

		$result = SDT_Store::store_sync_payload( $payload );
		if ( empty( $result['ok'] ) ) {
			return new WP_REST_Response(
				array(
					'success' => false,
					'error'   => isset( $result['error'] ) ? $result['error'] : __( 'Sync failed.', 'statchasers-data-tools' ),
				),
				400
			);
		}

		return new WP_REST_Response(
			array(
				'success' => true,
				'stored'  => isset( $result['stored'] ) ? (int) $result['stored'] : 0,
				'status'  => $this->format_status( SDT_Store::get_status() ),
			),
			200
		);
	}

	/**
	 * Public read: return the latest cached combo for the requested
	 * format/view (falling back to configured defaults).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function handle_public_read( WP_REST_Request $request ) {
		$format = $request->get_param( 'format' );
		$view   = $request->get_param( 'view' );

		if ( ! in_array( $format, SDT_Store::FORMATS, true ) ) {
			$format = (string) SDT_Settings::get( 'default_format' );
		}
		if ( ! in_array( $view, SDT_Store::VIEWS, true ) ) {
			$view = 'adjusted';
		}

		$combo  = SDT_Store::get_combo( $format, $view );
		$status = SDT_Store::get_status();

		if ( null === $combo ) {
			return new WP_REST_Response(
				array(
					'rows'        => array(),
					'available'   => false,
					'message'     => __( 'No cached data yet. The scheduled refresh has not pushed data.', 'statchasers-data-tools' ),
					'format'      => $format,
					'view'        => $view,
					'lastUpdated' => (int) $status['last_updated'],
				),
				200
			);
		}

		// Attach cache metadata; the payload already has rows/dataMode/etc.
		$combo['available']   = true;
		$combo['lastUpdated'] = (int) $status['last_updated'];
		$combo['format']      = $format;
		$combo['view']        = $view;

		$response = new WP_REST_Response( $combo, 200 );

		// Let WP/CDN cache the public response for the configured duration.
		$ttl = (int) SDT_Settings::get( 'cache_duration' );
		$response->header( 'Cache-Control', 'public, max-age=' . max( 60, $ttl ) );

		return $response;
	}

	/**
	 * Shape the status for JSON output (adds a human ISO timestamp).
	 *
	 * @param array $status Status.
	 * @return array
	 */
	private function format_status( $status ) {
		$status['last_updated_iso'] = $status['last_updated']
			? gmdate( 'c', (int) $status['last_updated'] )
			: '';
		return $status;
	}
}
