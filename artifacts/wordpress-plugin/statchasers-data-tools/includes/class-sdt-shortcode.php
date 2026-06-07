<?php
/**
 * [statchasers_fpa] shortcode — renders the public frontend table.
 *
 * The markup is a lightweight container; the table is hydrated by JS that
 * fetches the cached data from the WordPress REST endpoint (never the StatChasers API).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SDT_Shortcode {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_shortcode( 'statchasers_fpa', array( $this, 'render' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );
	}

	/**
	 * Register (but do not force-enqueue) the frontend assets.
	 */
	public function register_assets() {
		wp_register_style(
			'sdt-fpa',
			SDT_URL . 'assets/css/sdt-fpa.css',
			array(),
			SDT_VERSION
		);

		wp_register_script(
			'sdt-fpa',
			SDT_URL . 'assets/js/sdt-fpa.js',
			array(),
			SDT_VERSION,
			true
		);

		// Only the PUBLIC read endpoint + display defaults are exposed here.
		wp_localize_script(
			'sdt-fpa',
			'SDT_FPA',
			array(
				'endpoint'      => esc_url_raw( rest_url( SDT_REST_NAMESPACE . '/fpa' ) ),
				'defaultFormat' => (string) SDT_Settings::get( 'default_format' ),
				'defaultView'   => 'adjusted',
			)
		);
	}

	/**
	 * Render the shortcode container and enqueue assets on demand.
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string
	 */
	public function render( $atts ) {
		$atts = shortcode_atts(
			array(
				'format' => '',
				'view'   => '',
			),
			$atts,
			'statchasers_fpa'
		);

		wp_enqueue_style( 'sdt-fpa' );
		wp_enqueue_script( 'sdt-fpa' );

		$format = in_array( $atts['format'], SDT_Store::FORMATS, true ) ? $atts['format'] : '';
		$view   = in_array( $atts['view'], SDT_Store::VIEWS, true ) ? $atts['view'] : '';

		ob_start();
		?>
		<div
			class="sdt-fpa"
			data-sdt-fpa
			<?php echo $format ? 'data-format="' . esc_attr( $format ) . '"' : ''; ?>
			<?php echo $view ? 'data-view="' . esc_attr( $view ) . '"' : ''; ?>
		>
			<div class="sdt-fpa__loading"><?php esc_html_e( 'Loading Fantasy Points Allowed…', 'statchasers-data-tools' ); ?></div>
		</div>
		<?php
		return (string) ob_get_clean();
	}
}
