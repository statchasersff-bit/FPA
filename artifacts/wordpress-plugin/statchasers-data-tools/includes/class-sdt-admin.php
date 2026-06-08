<?php
/**
 * Admin UI: menu, Fantasy Points Allowed dashboard, and settings page.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SDT_Admin {

	const MENU_SLUG     = 'statchasers-data';
	const FPA_SLUG      = 'statchasers-data'; // dashboard lives on the top-level page.
	const SETTINGS_SLUG = 'statchasers-data-settings';

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
		add_filter(
			'plugin_action_links_' . plugin_basename( SDT_FILE ),
			array( $this, 'action_links' )
		);
	}

	public function register_menu() {
		add_menu_page(
			__( 'StatChasers Data', 'statchasers-data-tools' ),
			__( 'StatChasers Data', 'statchasers-data-tools' ),
			'manage_options',
			self::MENU_SLUG,
			array( $this, 'render_fpa_page' ),
			'dashicons-chart-area',
			58
		);

		add_submenu_page(
			self::MENU_SLUG,
			__( 'Fantasy Points Allowed', 'statchasers-data-tools' ),
			__( 'Fantasy Points Allowed', 'statchasers-data-tools' ),
			'manage_options',
			self::FPA_SLUG,
			array( $this, 'render_fpa_page' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			__( 'Settings', 'statchasers-data-tools' ),
			__( 'Settings', 'statchasers-data-tools' ),
			'manage_options',
			self::SETTINGS_SLUG,
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Enqueue admin assets only on our screens.
	 *
	 * @param string $hook Current admin page hook.
	 */
	public function enqueue( $hook ) {
		if ( false === strpos( $hook, self::MENU_SLUG ) && false === strpos( $hook, self::SETTINGS_SLUG ) ) {
			return;
		}

		// Data ships inside the plugin, so the admin screens are read-only status
		// views — only the stylesheet is needed (no refresh JS, no token).
		wp_enqueue_style(
			'sdt-admin',
			SDT_URL . 'assets/css/sdt-admin.css',
			array(),
			SDT_VERSION
		);
	}

	/**
	 * Add a quick "Settings" link on the Plugins screen.
	 *
	 * @param array $links Existing links.
	 * @return array
	 */
	public function action_links( $links ) {
		$url      = admin_url( 'admin.php?page=' . self::SETTINGS_SLUG );
		$settings = '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'statchasers-data-tools' ) . '</a>';
		array_unshift( $links, $settings );
		return $links;
	}

	// ─── Pages ────────────────────────────────────────────────────────────────

	public function render_fpa_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$status   = SDT_Store::get_status();
		$settings = SDT_Settings::all();

		$has_data = ! empty( $status['has_data'] );

		$last_updated = (int) $status['last_updated']
			? sprintf(
				/* translators: %s: human-readable time difference. */
				__( '%s ago', 'statchasers-data-tools' ),
				human_time_diff( (int) $status['last_updated'], time() )
			) . ' (' . esc_html( wp_date( 'Y-m-d H:i', (int) $status['last_updated'] ) ) . ')'
			: __( '—', 'statchasers-data-tools' );

		$preseason = $status['is_preseason'];
		?>
		<div class="wrap sdt-admin-wrap">
			<h1><?php esc_html_e( 'Fantasy Points Allowed', 'statchasers-data-tools' ); ?></h1>

			<?php if ( ! $has_data ) : ?>
				<div class="notice notice-warning">
					<p>
						<?php esc_html_e( 'No FPA data is bundled with this plugin build. Add data/fpa-data.json to the plugin and re-upload it.', 'statchasers-data-tools' ); ?>
					</p>
				</div>
			<?php endif; ?>

			<div class="notice notice-info inline">
				<p>
					<?php esc_html_e( 'The FPA numbers ship inside this plugin (data/fpa-data.json). To update them, regenerate or edit that file in the repo, rebuild the plugin zip, and re-upload it here. Nothing is fetched at runtime.', 'statchasers-data-tools' ); ?>
				</p>
			</div>

			<div class="sdt-card">
				<div class="sdt-card__head">
					<h2><?php esc_html_e( 'Current Snapshot', 'statchasers-data-tools' ); ?></h2>
				</div>

				<table class="sdt-status-table widefat striped" id="sdt-status-table">
					<tbody>
						<tr>
							<th scope="row"><?php esc_html_e( 'Current data mode', 'statchasers-data-tools' ); ?></th>
							<td data-field="data_mode"><?php echo esc_html( $status['data_mode'] ? $status['data_mode'] : '—' ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Snapshot generated', 'statchasers-data-tools' ); ?></th>
							<td data-field="last_updated"><?php echo esc_html( $last_updated ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Source season', 'statchasers-data-tools' ); ?></th>
							<td data-field="source_season"><?php echo esc_html( $status['source_season'] ? $status['source_season'] : '—' ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Current season', 'statchasers-data-tools' ); ?></th>
							<td data-field="current_season"><?php echo esc_html( $status['current_season'] ? $status['current_season'] : (int) $settings['default_season'] ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Teams returned', 'statchasers-data-tools' ); ?></th>
							<td data-field="team_count"><?php echo esc_html( $status['team_count'] ? $status['team_count'] : '—' ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Data status', 'statchasers-data-tools' ); ?></th>
							<td data-field="data_status">
								<span class="sdt-badge sdt-badge--<?php echo $has_data ? 'success' : 'error'; ?>">
									<?php echo $has_data ? esc_html__( 'Bundled', 'statchasers-data-tools' ) : esc_html__( 'Missing', 'statchasers-data-tools' ); ?>
								</span>
								<?php if ( null !== $preseason ) : ?>
									<span class="sdt-badge sdt-badge--info">
										<?php echo $preseason ? esc_html__( 'Preseason', 'statchasers-data-tools' ) : esc_html__( 'In-Season', 'statchasers-data-tools' ); ?>
									</span>
								<?php endif; ?>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div class="sdt-card">
				<h2><?php esc_html_e( 'Frontend Shortcode', 'statchasers-data-tools' ); ?></h2>
				<p><?php esc_html_e( 'Place this shortcode on any page or post to render the public Fantasy Points Allowed table. It reads from the data bundled inside the plugin — never from an external service.', 'statchasers-data-tools' ); ?></p>
				<code class="sdt-shortcode">[statchasers_fpa]</code>
			</div>
		</div>
		<?php
	}

	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$settings = SDT_Settings::all();
		?>
		<div class="wrap sdt-admin-wrap">
			<h1><?php esc_html_e( 'StatChasers Data — Settings', 'statchasers-data-tools' ); ?></h1>
			<form method="post" action="options.php">
				<?php settings_fields( SDT_Settings::GROUP ); ?>
				<table class="form-table" role="presentation">
					<tbody>
						<tr>
							<th scope="row">
								<label for="sdt_default_season"><?php esc_html_e( 'Default Season', 'statchasers-data-tools' ); ?></label>
							</th>
							<td>
								<input
									type="number"
									id="sdt_default_season"
									name="<?php echo esc_attr( SDT_OPT_SETTINGS ); ?>[default_season]"
									value="<?php echo esc_attr( $settings['default_season'] ); ?>"
									min="2000" max="2100" step="1"
								/>
							</td>
						</tr>
						<tr>
							<th scope="row">
								<label for="sdt_default_format"><?php esc_html_e( 'Default Scoring Format', 'statchasers-data-tools' ); ?></label>
							</th>
							<td>
								<select id="sdt_default_format" name="<?php echo esc_attr( SDT_OPT_SETTINGS ); ?>[default_format]">
									<?php
									$formats = array(
										'standard' => __( 'Standard', 'statchasers-data-tools' ),
										'half'     => __( 'Half PPR', 'statchasers-data-tools' ),
										'ppr'      => __( 'PPR', 'statchasers-data-tools' ),
									);
									foreach ( $formats as $value => $label ) {
										printf(
											'<option value="%s" %s>%s</option>',
											esc_attr( $value ),
											selected( $settings['default_format'], $value, false ),
											esc_html( $label )
										);
									}
									?>
								</select>
							</td>
						</tr>
						<tr>
							<th scope="row">
								<label for="sdt_cache_duration"><?php esc_html_e( 'Cache Duration (seconds)', 'statchasers-data-tools' ); ?></label>
							</th>
							<td>
								<input
									type="number"
									id="sdt_cache_duration"
									name="<?php echo esc_attr( SDT_OPT_SETTINGS ); ?>[cache_duration]"
									value="<?php echo esc_attr( $settings['cache_duration'] ); ?>"
									min="60" step="60"
								/>
								<p class="description"><?php esc_html_e( 'How long browsers/CDNs may cache the public endpoint response.', 'statchasers-data-tools' ); ?></p>
							</td>
						</tr>
					</tbody>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
