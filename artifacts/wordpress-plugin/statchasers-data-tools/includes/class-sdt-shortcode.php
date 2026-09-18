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

	/** Whether the bundled snapshot has been inlined into the page this request. */
	private static $data_injected = false;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Substrings identifying this plugin's frontend script, used to opt it out of
	 * third-party "delay JavaScript until interaction" optimizations.
	 */
	const DELAY_EXCLUSIONS = array( 'sdt-fpa', 'statchasers-data-tools', 'SDT_FPA', 'SDT_FPA_DATA' );

	private function __construct() {
		add_shortcode( 'statchasers_fpa', array( $this, 'render' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );

		// The widget renders synchronously as soon as its script runs. Several
		// perf/caching stacks defer scripts until the first user interaction
		// ("Delay JavaScript Execution"), which leaves the tool stuck on its
		// loading message until the visitor clicks/scrolls. Opt our own script
		// out of the common ones so it boots on load. (Optimizers not covered
		// here still need a manual exclusion of "sdt-fpa.js" — see readme.)

		// Cloudflare Rocket Loader honors data-cfasync="false"; several other
		// optimizers honor data-no-optimize / data-no-defer / data-no-minify.
		add_filter( 'script_loader_tag', array( $this, 'harden_script_tag' ), 10, 2 );

		// WP Rocket + Perfmatters expose filterable exclusion lists (substring
		// match against the script URL / inline contents).
		add_filter( 'rocket_delay_js_exclusions', array( $this, 'add_delay_exclusions' ) );
		add_filter( 'perfmatters_delay_js_exclusions', array( $this, 'add_delay_exclusions' ) );
	}

	/**
	 * Append this plugin's identifiers to a perf plugin's JS-delay exclusion list.
	 *
	 * @param array $exclusions Existing exclusion substrings.
	 * @return array
	 */
	public function add_delay_exclusions( $exclusions ) {
		if ( ! is_array( $exclusions ) ) {
			$exclusions = array();
		}
		return array_merge( $exclusions, self::DELAY_EXCLUSIONS );
	}

	/**
	 * Add opt-out attributes to our own <script> tag so interaction-delay /
	 * async-rewriting optimizers (e.g. Cloudflare Rocket Loader) leave it alone.
	 *
	 * @param string $tag    The full <script> HTML for the enqueued handle.
	 * @param string $handle The script's registered handle.
	 * @return string
	 */
	public function harden_script_tag( $tag, $handle ) {
		if ( 'sdt-fpa' !== $handle ) {
			return $tag;
		}
		return str_replace(
			'<script ',
			'<script data-cfasync="false" data-no-optimize="1" data-no-defer="1" data-no-minify="1" ',
			$tag
		);
	}

	/**
	 * Cache-busting version for a bundled asset: its file modification time,
	 * so browsers/CDNs reload it whenever the file content actually changes —
	 * even if the plugin version wasn't bumped. Falls back to SDT_VERSION.
	 *
	 * @param string $rel_path Path relative to the plugin directory.
	 * @return string
	 */
	private static function asset_version( $rel_path ) {
		$file = SDT_DIR . $rel_path;
		$mtime = @filemtime( $file );
		return $mtime ? (string) $mtime : SDT_VERSION;
	}

	/**
	 * The widget stylesheet's raw contents, for inlining into the Shadow DOM so
	 * the table can be styled and revealed with no network round-trip. Returns an
	 * empty string if the file can't be read (the JS then falls back to cssUrl).
	 *
	 * @return string
	 */
	private static function asset_css() {
		$css = @file_get_contents( SDT_DIR . 'assets/css/sdt-fpa.css' );
		return is_string( $css ) ? $css : '';
	}

	/**
	 * Register (but do not force-enqueue) the frontend assets.
	 */
	public function register_assets() {
		wp_register_style(
			'sdt-fpa',
			SDT_URL . 'assets/css/sdt-fpa.css',
			array(),
			self::asset_version( 'assets/css/sdt-fpa.css' )
		);

		wp_register_script(
			'sdt-fpa',
			SDT_URL . 'assets/js/sdt-fpa.js',
			array(),
			self::asset_version( 'assets/js/sdt-fpa.js' ),
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
				// The widget renders inside a Shadow DOM, so its stylesheet must be
				// applied INSIDE the shadow root by JS. We ship the CSS as inline
				// text so the JS can adopt it synchronously — the table reveals with
				// ZERO network round-trip. Previously the shadow root linked the
				// stylesheet over the network and stayed hidden until that <link>
				// loaded (up to a 1.5s fallback on a cold/slow cache), which is what
				// made the tool feel slow to appear. `cssUrl` is kept only as a
				// last-resort fallback if the inline text is somehow unavailable.
				'cssText'       => self::asset_css(),
				'cssUrl'        => esc_url_raw(
					add_query_arg(
						'ver',
						self::asset_version( 'assets/css/sdt-fpa.css' ),
						SDT_URL . 'assets/css/sdt-fpa.css'
					)
				),
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

		// Only the script is enqueued. The stylesheet is delivered as inline text
		// (see cssText in register_assets) and applied inside the Shadow DOM by JS,
		// so we deliberately do NOT enqueue the light-DOM <link> — it would be a
		// render-blocking head request that styles nothing outside the shadow root.
		// The style stays registered so the JS cssUrl fallback URL remains valid.
		wp_enqueue_script( 'sdt-fpa' );

		// Inline the full bundled snapshot (all format/view combos) directly into
		// the page so the widget renders with ZERO network round-trips. Without
		// this the widget fetches each combo from the REST endpoint, and every
		// such call boots the entire WordPress stack — the main reason the tool
		// felt slow to load on each page view. The REST endpoint is kept as a
		// fallback and for external consumers. Injected once per request even if
		// the shortcode appears multiple times.
		if ( ! self::$data_injected ) {
			$data = SDT_Store::get_data();
			if ( ! empty( $data ) ) {
				// JSON_HEX_TAG escapes < and > so a value can never contain a
				// literal </script> that would break out of the inline tag.
				wp_add_inline_script(
					'sdt-fpa',
					'window.SDT_FPA_DATA = ' . wp_json_encode( $data, JSON_HEX_TAG ) . ';',
					'before'
				);
				self::$data_injected = true;
			}
		}

		$format = in_array( $atts['format'], SDT_Store::FORMATS, true ) ? $atts['format'] : '';
		$view   = in_array( $atts['view'], SDT_Store::VIEWS, true ) ? $atts['view'] : '';

		ob_start();
		?>
		<div
			class="fpa-app-host"
			data-fpa-app
			<?php echo $format ? 'data-format="' . esc_attr( $format ) . '"' : ''; ?>
			<?php echo $view ? 'data-view="' . esc_attr( $view ) . '"' : ''; ?>
		>
			<div class="fpa-app-loading"><?php esc_html_e( 'Loading Fantasy Points Allowed…', 'statchasers-data-tools' ); ?></div>
		</div>
		<?php
		return (string) ob_get_clean();
	}
}
