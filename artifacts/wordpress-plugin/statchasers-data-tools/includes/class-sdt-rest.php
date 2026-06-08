<?php
/**
 * REST API endpoint.
 *
 *   GET /wp-json/statchasers/v1/fpa  (public, read-only, cached)
 *
 * Data comes from the snapshot bundled inside the plugin (data/fpa-data.json).
 * WordPress only reads and serves it — it never computes, pulls, or accepts a
 * push. To update the numbers, re-upload the plugin with a new data file.
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
	 * Public read: return the bundled combo for the requested format/view
	 * (falling back to configured defaults).
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
					'message'     => __( 'No FPA data is bundled with this plugin build.', 'statchasers-data-tools' ),
					'format'      => $format,
					'view'        => $view,
					'lastUpdated' => (int) $status['last_updated'],
				),
				200
			);
		}

		// Attach metadata; the bundled combo already has rows/dataMode/etc.
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
}
