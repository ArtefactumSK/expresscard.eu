<?php
/**
 * expressCARD lightweight public renderer (no WordPress).
 */

declare(strict_types=1);

/**
 * @param string $path Path.
 * @return string
 */
function ex_public_normalize_path( $path ) {
	$path = str_replace( '\\', '/', (string) $path );
	return (string) preg_replace( '|(?<=.)/+|', '/', $path );
}

/**
 * @param string $key Query key.
 * @return string|null Scalar value or null when missing / non-scalar.
 */
function ex_public_scalar_query( $key ) {
	if ( ! isset( $_GET[ $key ] ) ) {
		return null;
	}
	$value = $_GET[ $key ];
	if ( ! is_scalar( $value ) ) {
		return null;
	}
	$text = trim( (string) $value );
	if ( '' === $text || false !== strpos( $text, "\0" ) ) {
		return null;
	}
	return $text;
}

/**
 * @param string $public_id Candidate id.
 * @return bool
 */
function ex_public_valid_id( $public_id ) {
	return is_string( $public_id ) && (bool) preg_match( '/^[a-f0-9]{16}$/', $public_id );
}

/** Must match Expressar_Core_Expresscard_Modular_Renderer::PUBLIC_BRAND_URL_PLACEHOLDER */
const EX_PUBLIC_BRAND_URL_PLACEHOLDER = 'https://expresscard-config.invalid/brand';

/** Must match Expressar_Core_Expresscard_Modular_Renderer::PUBLIC_BRAND_LINK_ATTR */
const EX_PUBLIC_BRAND_LINK_ATTR = 'data-ex-mcard-brand-link';

/**
 * @param string $segment Path segment (no slashes).
 * @return bool
 */
function ex_public_valid_slug_segment( $segment ) {
	$segment = strtolower( trim( (string) $segment ) );
	if ( '' === $segment || strlen( $segment ) > 191 ) {
		return false;
	}
	if ( ex_public_valid_id( $segment ) ) {
		return false;
	}
	if ( ex_public_is_reserved_slug_segment( $segment ) ) {
		return false;
	}

	return (bool) preg_match( '/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $segment );
}

/**
 * @param string $segment Path segment.
 * @return bool
 */
function ex_public_is_reserved_slug_segment( $segment ) {
	$segment = strtolower( trim( (string) $segment ) );
	$reserved = array(
		'assets',
		'images',
		'prototype',
		'index',
		'index.php',
		'favicon.ico',
		'asset',
		'vcf',
		'contact',
		'card',
		'owner',
	);

	return in_array( $segment, $reserved, true );
}

/**
 * @param array<string, mixed> $manifest Manifest.
 * @return string Normalized public_slug or empty.
 */
function ex_public_manifest_public_slug( array $manifest ) {
	if ( ! isset( $manifest['public_slug'] ) ) {
		return '';
	}
	$slug = strtolower( trim( (string) $manifest['public_slug'] ) );
	if ( '' === $slug || ! ex_public_valid_slug_segment( $slug ) ) {
		return '';
	}

	return $slug;
}

/**
 * Linear manifest scan for friendly slug (performance limit: O(n) cards).
 *
 * @param string $cards_root Configured cards root.
 * @param string $slug       Requested slug.
 * @return string|false public_id, false when not found, 'ambiguous' on duplicate.
 */
function ex_public_resolve_public_id_by_slug( $cards_root, $slug ) {
	$slug = strtolower( trim( (string) $slug ) );
	if ( ! ex_public_valid_slug_segment( $slug ) ) {
		return false;
	}
	$root_real = ex_public_realpath_root( $cards_root );
	if ( false === $root_real ) {
		return false;
	}
	$entries = @scandir( $root_real ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
	if ( ! is_array( $entries ) ) {
		return false;
	}
	$matches = array();
	foreach ( $entries as $entry ) {
		if ( '.' === $entry || '..' === $entry ) {
			continue;
		}
		if ( ! ex_public_valid_id( $entry ) ) {
			continue;
		}
		$card_dir = ex_public_normalize_path( $root_real . '/' . $entry );
		if ( ! ex_public_path_within_root( $card_dir, $root_real ) || ! is_dir( $card_dir ) ) {
			continue;
		}
		$resolved = ex_public_resolve_current_dir( $cards_root, $entry );
		if ( false === $resolved ) {
			continue;
		}
		list( , $current_real ) = $resolved;
		$manifest_path = $current_real . '/manifest.json';
		if ( ! is_readable( $manifest_path ) ) {
			continue;
		}
		$raw = file_get_contents( $manifest_path );
		$manifest = is_string( $raw ) ? json_decode( $raw, true ) : null;
		if ( ! is_array( $manifest ) || ! ex_public_manifest_is_valid( $manifest, $entry ) ) {
			continue;
		}
		$manifest_slug = ex_public_manifest_public_slug( $manifest );
		if ( $slug === $manifest_slug ) {
			$matches[] = (string) $entry;
		}
	}
	if ( count( $matches ) > 1 ) {
		return 'ambiguous';
	}
	if ( 1 !== count( $matches ) ) {
		return false;
	}

	return $matches[0];
}

/**
 * @param array<string, mixed> $config Publication config.
 * @return string Valid absolute http(s) brand URL or empty.
 */
function ex_public_config_brand_url( array $config ) {
	$url = isset( $config['brand_url'] ) ? trim( (string) $config['brand_url'] ) : '';
	if ( '' === $url ) {
		return '';
	}
	if ( preg_match( '#^(javascript|data|vbscript):#i', $url ) ) {
		return '';
	}
	if ( ! preg_match( '#^https?://#i', $url ) ) {
		return '';
	}
	if ( false !== strpos( $url, '@' ) ) {
		return '';
	}
	$parts = parse_url( $url );
	if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return '';
	}
	$scheme = strtolower( (string) $parts['scheme'] );
	if ( 'http' !== $scheme && 'https' !== $scheme ) {
		return '';
	}
	if ( ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
		return '';
	}

	return $url;
}

/**
 * @param string $attrs Opening tag attributes (without element name).
 * @return string Attributes without href.
 */
function ex_public_brand_link_attrs_without_href( $attrs ) {
	return preg_replace( '/\s*href\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', (string) $attrs );
}

/**
 * Apply or deactivate brand watermark links marked with data-ex-mcard-brand-link.
 *
 * @param string               $html   Published card HTML snapshot.
 * @param array<string, mixed> $config Publication config.
 * @return string
 */
function ex_public_apply_brand_url( $html, array $config ) {
	$html    = (string) $html;
	$pattern = '/<a\b([^>]*\b' . preg_quote( EX_PUBLIC_BRAND_LINK_ATTR, '/' ) . '\s*=\s*"1"[^>]*)>(.*?)<\/a>/is';

	$brand_url = ex_public_config_brand_url( $config );
	if ( '' !== $brand_url ) {
		$escaped = htmlspecialchars( $brand_url, ENT_QUOTES, 'UTF-8' );

		return (string) preg_replace_callback(
			$pattern,
			static function ( $matches ) use ( $escaped ) {
				$attrs = ex_public_brand_link_attrs_without_href( $matches[1] );

				return '<a href="' . $escaped . '"' . $attrs . '>' . $matches[2] . '</a>';
			},
			$html
		);
	}

	return (string) preg_replace_callback(
		$pattern,
		static function ( $matches ) {
			$attrs = ex_public_brand_link_attrs_without_href( $matches[1] );

			return '<span' . $attrs . '>' . $matches[2] . '</span>';
		},
		$html
	);
}

/**
 * @param string $contact_id Secondary contact id.
 * @return bool
 */
function ex_public_valid_secondary_contact_id( $contact_id ) {
	return is_string( $contact_id ) && (bool) preg_match( '/^sc_[a-f0-9]{12}$/', $contact_id );
}

/**
 * @param int    $code    HTTP status.
 * @param string $message Safe message.
 * @return void
 */
function ex_public_fail( $code, $message ) {
	http_response_code( (int) $code );
	header( 'Content-Type: text/html; charset=UTF-8' );
	header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
	header( 'Pragma: no-cache' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	echo '<!DOCTYPE html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>expressCARD</title><link rel="stylesheet" href="/assets/css/expresscard-public.css"></head><body class="ex-public-body"><main class="ex-public-error">' . htmlspecialchars( $message, ENT_QUOTES, 'UTF-8' ) . '</main></body></html>';
	exit;
}

/**
 * @param string $root_dir Absolute directory that must exist.
 * @return string|false realpath of root.
 */
function ex_public_realpath_root( $root_dir ) {
	$root_dir = ex_public_normalize_path( (string) $root_dir );
	if ( '' === $root_dir || false !== strpos( $root_dir, "\0" ) ) {
		return false;
	}
	$real = realpath( $root_dir );
	if ( false === $real || ! is_dir( $real ) ) {
		return false;
	}
	return ex_public_normalize_path( $real );
}

/**
 * @param string $path     Candidate path (need not exist).
 * @param string $root_real Normalized realpath of allowed root (with no trailing slash).
 * @return bool
 */
function ex_public_path_within_root( $path, $root_real ) {
	$path = ex_public_normalize_path( (string) $path );
	$root_real = ex_public_normalize_path( (string) $root_real );
	if ( '' === $path || '' === $root_real || false !== strpos( $path, "\0" ) ) {
		return false;
	}
	if ( $path === $root_real ) {
		return true;
	}
	$prefix = $root_real . '/';
	return 0 === strpos( $path, $prefix );
}

/**
 * @param string $file_path Absolute file path.
 * @param string $root_real Normalized realpath of allowed root.
 * @return string|false Normalized realpath of file when inside root.
 */
function ex_public_realpath_file_in_root( $file_path, $root_real ) {
	$file_path = ex_public_normalize_path( (string) $file_path );
	if ( '' === $file_path || false !== strpos( $file_path, "\0" ) ) {
		return false;
	}
	if ( ! ex_public_path_within_root( $file_path, $root_real ) ) {
		return false;
	}
	if ( ! is_file( $file_path ) || ! is_readable( $file_path ) ) {
		return false;
	}
	$file_real = realpath( $file_path );
	if ( false === $file_real ) {
		return false;
	}
	$file_real = ex_public_normalize_path( $file_real );
	if ( ! ex_public_path_within_root( $file_real, $root_real ) ) {
		return false;
	}
	return $file_real;
}

/**
 * @param string $cards_root Configured cards root.
 * @param string $public_id  Public id.
 * @return array{0:string,1:string}|false Current dir real root prefix and current path.
 */
function ex_public_resolve_current_dir( $cards_root, $public_id ) {
	$root_real = ex_public_realpath_root( $cards_root );
	if ( false === $root_real ) {
		return false;
	}
	$card_dir = ex_public_normalize_path( $root_real . '/' . $public_id );
	if ( ! ex_public_path_within_root( $card_dir, $root_real ) ) {
		return false;
	}
	$current_dir = ex_public_normalize_path( $card_dir . '/current' );
	if ( ! ex_public_path_within_root( $current_dir, $root_real ) ) {
		return false;
	}
	if ( ! is_dir( $current_dir ) ) {
		return false;
	}
	$current_real = realpath( $current_dir );
	if ( false === $current_real ) {
		return false;
	}
	$current_real = ex_public_normalize_path( $current_real );
	if ( ! ex_public_path_within_root( $current_real, $root_real ) ) {
		return false;
	}
	$card_dir_real = realpath( $card_dir );
	if ( false === $card_dir_real ) {
		return false;
	}
	$card_dir_real = ex_public_normalize_path( $card_dir_real );
	if ( basename( $card_dir_real ) !== (string) $public_id ) {
		return false;
	}
	if ( basename( $current_real ) !== 'current' ) {
		return false;
	}
	if ( ex_public_normalize_path( dirname( $current_real ) ) !== $card_dir_real ) {
		return false;
	}
	return array( $root_real, $current_real );
}

/**
 * @param array<string, mixed> $access Access payload from access.json.
 * @return bool
 */
function ex_public_parse_utc_datetime( $value ) {
	if ( ! is_string( $value ) ) {
		return false;
	}
	$value = trim( $value );
	if ( '' === $value || '0000-00-00 00:00:00' === $value ) {
		return false;
	}
	if ( ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value ) ) {
		return false;
	}
	$dt = DateTimeImmutable::createFromFormat( 'Y-m-d H:i:s', $value, new DateTimeZone( 'UTC' ) );
	if ( ! $dt instanceof DateTimeImmutable ) {
		return false;
	}
	$errors = DateTimeImmutable::getLastErrors();
	if ( is_array( $errors ) && ( ! empty( $errors['warning_count'] ) || ! empty( $errors['error_count'] ) ) ) {
		return false;
	}
	return $dt;
}

/**
 * @param array<string, mixed> $access Access payload from access.json.
 * @return bool
 */
function ex_public_access_allowed_now( array $access ) {
	if ( ! array_key_exists( 'public_access_allowed', $access ) || true !== $access['public_access_allowed'] ) {
		return false;
	}
	$lifecycle = isset( $access['entitlement_lifecycle'] ) ? trim( (string) $access['entitlement_lifecycle'] ) : '';
	if ( '' === $lifecycle || 'active' !== $lifecycle ) {
		return false;
	}
	$publication = isset( $access['publication_status'] ) ? trim( (string) $access['publication_status'] ) : '';
	if ( 'published' !== $publication ) {
		return false;
	}
	$until = isset( $access['valid_until'] ) ? trim( (string) $access['valid_until'] ) : '';
	$until_dt = ex_public_parse_utc_datetime( $until );
	if ( false === $until_dt ) {
		return false;
	}
	if ( $until_dt->getTimestamp() < time() ) {
		return false;
	}
	return true;
}

/**
 * @param array<string, mixed> $manifest Manifest.
 * @param string               $public_id Expected public id.
 * @return bool
 */
function ex_public_manifest_is_valid( array $manifest, $public_id ) {
	if ( ! isset( $manifest['format_version'] ) || 1 !== (int) $manifest['format_version'] ) {
		return false;
	}
	$mid = isset( $manifest['public_id'] ) ? (string) $manifest['public_id'] : '';
	if ( $mid !== (string) $public_id ) {
		return false;
	}
	$visibility = isset( $manifest['visibility'] ) ? trim( (string) $manifest['visibility'] ) : '';
	if ( 'public' !== $visibility && 'unlisted' !== $visibility ) {
		return false;
	}
	return true;
}

/**
 * Read validated marketing translations from the document root only.
 *
 * @param string $language Supported route language.
 * @return array<string,string>|false
 */
function ex_public_landing_texts( $language ) {
	$files = array( 'sk' => 'languages/sk.json', 'cz' => 'languages/cz.json', 'en' => 'languages/en.json', 'de' => 'languages/de.json' );
	$langs = array( 'sk' => 'sk', 'cz' => 'cs', 'en' => 'en', 'de' => 'de' );
	if ( ! isset( $files[ $language ] ) ) {
		return false;
	}
	$root = ex_public_realpath_root( __DIR__ );
	if ( false === $root ) {
		return false;
	}
	$file = ex_public_realpath_file_in_root( $root . '/' . $files[ $language ], $root );
	if ( false === $file ) {
		return false;
	}
	$raw = file_get_contents( $file );
	$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
	if ( ! is_array( $data ) ) {
		return false;
	}
	$keys = array( 'html_lang', 'meta_title', 'meta_description', 'product_label', 'headline', 'description', 'cta_label', 'language_nav_label' );
	foreach ( $keys as $key ) {
		if ( ! isset( $data[ $key ] ) || ! is_string( $data[ $key ] ) || '' === trim( $data[ $key ] ) ) {
			return false;
		}
	}
	if ( $langs[ $language ] !== $data['html_lang'] ) {
		return false;
	}
	return $data;
}

/**
 * Resolve optional marketing media without requesting missing files.
 * Called with fixed internal relative paths only, never request input.
 *
 * @param string $relative Fixed internal file path.
 * @return string Public URL or empty when unavailable.
 */
function ex_public_landing_asset_url( $relative ) {
	$allowed = array(
		'images/expressar_icon.svg',
		'assets/video/expresscard-mobile.mp4',
		'assets/video/expresscard-desktop.mp4',
		'images/expresscard-landing-mobile.webp',
		'images/expresscard-landing-desktop.webp',
	);
	if ( ! in_array( $relative, $allowed, true ) ) {
		return '';
	}
	$root = ex_public_realpath_root( __DIR__ );
	if ( false === $root || false === ex_public_realpath_file_in_root( $root . '/' . $relative, $root ) ) {
		return '';
	}
	return '/' . $relative;
}

/**
 * Shared marketing template. Independent of publication storage and WordPress.
 *
 * @param string $language Supported route language.
 * @return void
 */
function ex_public_serve_product_page( $language = 'sk' ) {
	$languages = array( 'sk' => 'sk', 'cz' => 'cs', 'en' => 'en', 'de' => 'de' );
	if ( ! isset( $languages[ $language ] ) ) {
		ex_public_fail( 404, 'Stránka nebola nájdená.' );
	}
	$texts = ex_public_landing_texts( $language );
	$is_fallback = false;
	if ( false === $texts && 'sk' !== $language ) {
		$texts = ex_public_landing_texts( 'sk' );
		$is_fallback = true;
	}
	if ( false === $texts ) {
		ex_public_fail( 503, 'Úvodná stránka momentálne nie je dostupná.' );
	}
	$display_language = $is_fallback ? 'sk' : $language;
	$cta_urls = array(
		'sk' => 'https://expressar.eu/sk/expresscards/',
		'cz' => 'https://expressar.eu/cz/expresscards/',
		'en' => 'https://expressar.eu/en/expresscards/',
		'de' => 'https://expressar.eu/de/expresscards/',
	);
	$escape = static function ( $value ) {
		return htmlspecialchars( (string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
	};
	$icon = ex_public_landing_asset_url( 'images/expressar_icon.svg' );
	$mobile_video = ex_public_landing_asset_url( 'assets/video/expresscard-mobile.mp4' );
	$desktop_video = ex_public_landing_asset_url( 'assets/video/expresscard-desktop.mp4' );
	$mobile_poster = ex_public_landing_asset_url( 'images/expresscard-landing-mobile.webp' );
	$desktop_poster = ex_public_landing_asset_url( 'images/expresscard-landing-desktop.webp' );
	$poster = '' !== $desktop_poster ? $desktop_poster : $mobile_poster;
	$has_video = '' !== $mobile_video || '' !== $desktop_video;
	$canonical = 'https://expresscard.eu/' . $language . '/';
	http_response_code( 200 );
	header( 'Content-Type: text/html; charset=UTF-8' );
	header( 'Cache-Control: public, max-age=300' );
	if ( $is_fallback ) {
		header( 'X-Robots-Tag: noindex, follow' );
	}
	?><!DOCTYPE html>
<html lang="<?php echo $escape( $texts['html_lang'] ); ?>">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<title><?php echo $escape( $texts['meta_title'] ); ?></title>
	<meta name="description" content="<?php echo $escape( $texts['meta_description'] ); ?>">
	<?php if ( $is_fallback ) : ?><meta name="robots" content="noindex, follow"><?php endif; ?>
	<link rel="canonical" href="<?php echo $escape( $canonical ); ?>">
	<?php foreach ( $languages as $route => $html_language ) : ?>
	<link rel="alternate" hreflang="<?php echo $escape( $html_language ); ?>" href="<?php echo $escape( 'https://expresscard.eu/' . $route . '/' ); ?>">
	<?php endforeach; ?>
	<link rel="alternate" hreflang="x-default" href="https://expresscard.eu/">
	<link rel="stylesheet" href="/assets/css/expresscard-landing.css">
	<?php if ( $has_video ) : ?><script src="/assets/js/expresscard-landing.js" defer></script><?php endif; ?>
</head>
<body class="ex-landing">
<div class="ex-landing__frame">
	<?php if ( '' !== $poster || $has_video ) : ?>
	<div class="ex-landing__media" aria-hidden="true">
		<?php if ( '' !== $poster ) : ?>
		<picture class="ex-landing__poster">
			<?php if ( '' !== $mobile_poster && '' !== $desktop_poster ) : ?><source media="(max-width: 767px)" srcset="<?php echo $escape( $mobile_poster ); ?>"><?php endif; ?>
			<img src="<?php echo $escape( $poster ); ?>" alt="" decoding="async" fetchpriority="high">
		</picture>
		<?php endif; ?>
		<?php if ( $has_video ) : ?>
		<video class="ex-landing__video" data-ex-landing-video data-mobile-src="<?php echo $escape( $mobile_video ); ?>" data-desktop-src="<?php echo $escape( $desktop_video ); ?>" muted autoplay loop playsinline preload="none" tabindex="-1" aria-hidden="true"></video>
		<?php endif; ?>
	</div>
	<?php endif; ?>
	<div class="ex-landing__shade" aria-hidden="true"></div>
	<header class="ex-landing__header">
		<a class="ex-landing__brand" href="<?php echo $escape( '/' . $language . '/' ); ?>" aria-label="expressCARD">
			<?php if ( '' !== $icon ) : ?><span class="ex-landing__icon" aria-hidden="true"></span><?php endif; ?>
			<span class="ex-landing__brand-word"><i>express</i>CARD<sup>™</sup></span>
		</a>
		<nav class="ex-landing__languages" aria-label="<?php echo $escape( $texts['language_nav_label'] ); ?>">
			<?php $first_language = true; foreach ( $languages as $route => $html_language ) : ?>
			<?php if ( ! $first_language ) : ?><span class="ex-landing__separator" aria-hidden="true">·</span><?php endif; ?>
			<a class="ex-landing__language" href="<?php echo $escape( '/' . $route . '/' ); ?>" lang="<?php echo $escape( $html_language ); ?>" hreflang="<?php echo $escape( $html_language ); ?>"<?php if ( $language === $route ) : ?> aria-current="page"<?php endif; ?>><?php echo $escape( strtoupper( $route ) ); ?></a>
			<?php $first_language = false; endforeach; ?>
		</nav>
	</header>
	<main class="ex-landing__main">
		<p class="ex-landing__label"><?php echo $escape( $texts['product_label'] ); ?></p>
		<h1 class="ex-landing__headline"><?php echo $escape( $texts['headline'] ); ?></h1>
		<p class="ex-landing__description"><?php echo $escape( $texts['description'] ); ?></p>
		<a class="ex-landing__cta" href="<?php echo $escape( $cta_urls[ $display_language ] ); ?>" target="_blank"><?php echo $escape( $texts['cta_label'] ); ?>&nbsp;<i>express</i>CARD™</a>
	</main>
	<footer class="ex-landing__footer">© <?php echo $escape( gmdate( 'Y' ) ); ?> <i>express</i>CARD™ by <a href="https://www.artefactum.sk/" target="_blank" rel="noopener noreferrer"><img src="/images/Artefactum.svg" alt="Artefactum" class="ex-landing__artefactum-logo"></a></footer>
</div>
</body>
</html>
	<?php
	exit;
}

/**
 * @param string $value VCF field value.
 * @return string
 */
function ex_public_vcf_escape( $value ) {
	$value = str_replace( array( '\\', ';', ',', "\n", "\r" ), array( '\\\\', '\\;', '\\,', '\\n', '' ), (string) $value );
	return $value;
}

/**
 * @param string $line Property line without folding.
 * @return string
 */
function ex_public_utf8_safe_byte_prefix( $text, $max_bytes ) {
	$text = (string) $text;
	if ( strlen( $text ) <= $max_bytes ) {
		return $text;
	}
	$slice = substr( $text, 0, $max_bytes );
	while ( '' !== $slice && ! preg_match( '//u', $slice ) ) {
		$slice = substr( $slice, 0, -1 );
	}
	return $slice;
}

/**
 * @param string $line Property line without folding.
 * @return string
 */
function ex_public_vcf_fold_line( $line ) {
	$line = (string) $line;
	if ( strlen( $line ) <= 75 ) {
		return $line;
	}
	$out  = ex_public_utf8_safe_byte_prefix( $line, 75 );
	$rest = substr( $line, strlen( $out ) );
	while ( '' !== $rest ) {
		$chunk = ex_public_utf8_safe_byte_prefix( $rest, 74 );
		$out  .= "\r\n " . $chunk;
		$rest  = substr( $rest, strlen( $chunk ) );
	}
	return $out;
}

/**
 * @param array<string, mixed> $address Address model.
 * @return string ADR value (escaped components joined with semicolons).
 */
function ex_public_vcf_adr_value( array $address ) {
	if ( empty( $address['include_in_vcf'] ) ) {
		return '';
	}
	$parts = array(
		ex_public_vcf_escape( trim( (string) ( $address['street'] ?? '' ) ) ),
		ex_public_vcf_escape( trim( (string) ( $address['city'] ?? '' ) ) ),
		ex_public_vcf_escape( trim( (string) ( $address['region'] ?? '' ) ) ),
		ex_public_vcf_escape( trim( (string) ( $address['postal_code'] ?? '' ) ) ),
		ex_public_vcf_escape( trim( (string) ( $address['country'] ?? '' ) ) ),
	);
	$joined = implode( ';', $parts );
	if ( '' === str_replace( ';', '', $joined ) ) {
		return '';
	}
	return ';;' . $joined;
}

/**
 * @param array<string, mixed> $contact Contact block from vcf-data.json.
 * @param string               $photo_path Absolute path to photo or empty.
 * @return string
 */
function ex_public_build_vcard_body( array $contact, $photo_path = '' ) {
	$lines   = array( 'BEGIN:VCARD', 'VERSION:3.0' );
	$contact_id = isset( $contact['id'] ) ? strtolower( trim( (string) $contact['id'] ) ) : '';
	$is_secondary = '' !== $contact_id && ex_public_valid_secondary_contact_id( $contact_id );
	if ( $is_secondary ) {
		$fn = trim( (string) ( $contact['fn'] ?? $contact['label'] ?? '' ) );
	} else {
		$fn = trim( (string) ( $contact['display_name'] ?? $contact['fn'] ?? '' ) );
	}
	$company = trim( (string) ( $contact['company'] ?? $contact['org'] ?? '' ) );
	if ( ! $is_secondary && '' === $fn && '' !== $company ) {
		$fn = $company;
	}
	if ( '' !== $fn ) {
		$lines[] = ex_public_vcf_fold_line( 'FN:' . ex_public_vcf_escape( $fn ) );
	}
	if ( '' !== $company ) {
		$lines[] = ex_public_vcf_fold_line( 'ORG:' . ex_public_vcf_escape( $company ) );
	}
	$role = trim( (string) ( $contact['role'] ?? $contact['title'] ?? '' ) );
	if ( '' !== $role ) {
		$lines[] = ex_public_vcf_fold_line( 'TITLE:' . ex_public_vcf_escape( $role ) );
	}
	$phone = trim( (string) ( $contact['phone'] ?? '' ) );
	if ( '' !== $phone ) {
		$lines[] = ex_public_vcf_fold_line( 'TEL;TYPE=CELL:' . ex_public_vcf_escape( $phone ) );
	}
	$email = trim( (string) ( $contact['email'] ?? '' ) );
	if ( '' !== $email && filter_var( $email, FILTER_VALIDATE_EMAIL ) ) {
		$lines[] = ex_public_vcf_fold_line( 'EMAIL;TYPE=INTERNET:' . ex_public_vcf_escape( $email ) );
	}
	$website = trim( (string) ( $contact['website'] ?? '' ) );
	if ( '' !== $website && filter_var( $website, FILTER_VALIDATE_URL ) ) {
		$lines[] = ex_public_vcf_fold_line( 'URL:' . ex_public_vcf_escape( $website ) );
	}
	$address = isset( $contact['address'] ) && is_array( $contact['address'] ) ? $contact['address'] : array();
	$adr     = ex_public_vcf_adr_value( $address );
	if ( '' !== $adr ) {
		$lines[] = ex_public_vcf_fold_line( 'ADR;TYPE=WORK:' . $adr );
	}
	if ( '' !== $photo_path && is_readable( $photo_path ) ) {
		$raw  = file_get_contents( $photo_path );
		$mime = ex_public_asset_mime( $photo_path );
		if ( is_string( $raw ) && '' !== $raw && '' !== $mime && 0 === strpos( $mime, 'image/' ) ) {
			$lines[] = ex_public_vcf_fold_line( 'PHOTO;ENCODING=b;TYPE=' . strtoupper( preg_replace( '#^image/#', '', $mime ) ) . ':' . base64_encode( $raw ) );
		}
	}
	$lines[] = 'END:VCARD';
	return implode( "\r\n", $lines ) . "\r\n";
}

/**
 * @param string $file Path.
 * @return string
 */
function ex_public_asset_mime( $file ) {
	$ext = strtolower( pathinfo( (string) $file, PATHINFO_EXTENSION ) );
	$map = array(
		'css'   => 'text/css',
		'webp'  => 'image/webp',
		'png'   => 'image/png',
		'jpg'   => 'image/jpeg',
		'jpeg'  => 'image/jpeg',
		'svg'   => 'image/svg+xml',
		'woff'  => 'font/woff',
		'woff2' => 'font/woff2',
	);
	if ( isset( $map[ $ext ] ) ) {
		return $map[ $ext ];
	}
	if ( function_exists( 'mime_content_type' ) ) {
		$mime = mime_content_type( (string) $file );
		if ( is_string( $mime ) && '' !== $mime ) {
			return $mime;
		}
	}
	return 'application/octet-stream';
}

/**
 * @param array<string, mixed> $manifest Manifest.
 * @param string               $asset_req Requested asset path.
 * @return string|null Normalized relative path when allowlisted.
 */
function ex_public_manifest_asset_path( array $manifest, $asset_req ) {
	$asset_req = ex_public_normalize_path( str_replace( '\\', '/', (string) $asset_req ) );
	if ( '' === $asset_req || false !== strpos( $asset_req, "\0" ) ) {
		return null;
	}
	if ( 0 === strpos( $asset_req, './' ) ) {
		$asset_req = substr( $asset_req, 2 );
	}
	if ( preg_match( '#(^|/)\.\.(/|$)#', $asset_req ) || 0 === strpos( $asset_req, '/' ) ) {
		return null;
	}
	$list = isset( $manifest['public_assets'] ) && is_array( $manifest['public_assets'] ) ? $manifest['public_assets'] : array();
	foreach ( $list as $key => $rel ) {
		if ( ! is_string( $rel ) || '' === $rel ) {
			continue;
		}
		$rel = ex_public_normalize_path( (string) $rel );
		if ( 0 === strpos( $rel, './' ) ) {
			$rel = substr( $rel, 2 );
		}
		if ( '' === $rel || preg_match( '#(^|/)\.\.(/|$)#', $rel ) ) {
			continue;
		}
		$key_str = is_string( $key ) ? ex_public_normalize_path( (string) $key ) : $rel;
		if ( is_string( $key ) && 0 === strpos( $key_str, './' ) ) {
			$key_str = substr( $key_str, 2 );
		}
		if ( $asset_req === $rel || $asset_req === $key_str ) {
			return $rel;
		}
	}
	return null;
}

/**
 * @param array<string, mixed> $vcf_data vcf-data.json.
 * @param string               $contact_id Empty for primary.
 * @return array<string, mixed>|null
 */
function ex_public_vcf_contact_block( array $vcf_data, $contact_id ) {
	if ( '' === $contact_id ) {
		return $vcf_data;
	}
	if ( ! ex_public_valid_secondary_contact_id( $contact_id ) ) {
		return null;
	}
	$rows = isset( $vcf_data['secondary_contacts'] ) && is_array( $vcf_data['secondary_contacts'] ) ? $vcf_data['secondary_contacts'] : array();
	foreach ( $rows as $row ) {
		if ( ! is_array( $row ) ) {
			continue;
		}
		$id = isset( $row['id'] ) ? strtolower( trim( (string) $row['id'] ) ) : '';
		if ( $contact_id === $id ) {
			return $row;
		}
	}
	return null;
}

/**
 * @param string $url Candidate absolute URL.
 * @return bool
 */
function ex_public_valid_http_url( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url || preg_match( '#^(javascript|data|vbscript):#i', $url ) ) {
		return false;
	}
	if ( ! preg_match( '#^https?://#i', $url ) ) {
		return false;
	}
	if ( false !== strpos( $url, '@' ) ) {
		return false;
	}

	return false !== filter_var( $url, FILTER_VALIDATE_URL );
}

/**
 * @param string $html Published card snapshot.
 * @return bool
 */
function ex_public_card_html_has_contact_exchange( $html ) {
	return false !== strpos( (string) $html, 'data-ex-mcard-contact-exchange="1"' );
}

/**
 * @param array<string, mixed> $manifest     Package manifest.
 * @param string               $public_id    Resolved public id.
 * @param string               $card_html    Published card HTML.
 * @param array<string, mixed> $site_config  publication-config.php.
 * @return array<string, string>|null
 */
function ex_public_contact_exchange_runtime_config( array $manifest, $public_id, $card_html, array $site_config ) {
	if ( ! ex_public_card_html_has_contact_exchange( $card_html ) ) {
		return null;
	}

	$cx = isset( $manifest['contact_exchange'] ) && is_array( $manifest['contact_exchange'] ) ? $manifest['contact_exchange'] : array();

	$card_ref = '';
	if ( isset( $cx['card_ref'] ) && ex_public_valid_id( (string) $cx['card_ref'] ) ) {
		$card_ref = (string) $cx['card_ref'];
	} elseif ( preg_match( '/\bdata-ex-card-ref="([a-f0-9]{16})"/', (string) $card_html, $matches ) ) {
		$card_ref = (string) $matches[1];
	} elseif ( ex_public_valid_id( $public_id ) ) {
		$card_ref = (string) $public_id;
	}
	if ( ! ex_public_valid_id( $card_ref ) ) {
		return null;
	}

	$submit = isset( $cx['submit_url'] ) ? trim( (string) $cx['submit_url'] ) : '';
	if ( '' === $submit && isset( $site_config['contact_exchange_submit_url'] ) ) {
		$submit = trim( (string) $site_config['contact_exchange_submit_url'] );
	}
	if ( ! ex_public_valid_http_url( $submit ) ) {
		return null;
	}

	$privacy = isset( $cx['privacy_notice_version'] ) ? trim( (string) $cx['privacy_notice_version'] ) : '1.0';
	if ( '' === $privacy ) {
		$privacy = '1.0';
	}

	return array(
		'cardRef'                => $card_ref,
		'submitUrl'              => $submit,
		'privacyNoticeVersion'   => $privacy,
		'recipientName'          => '',
		'recipientCompany'       => '',
	);
}

/**
 * @param string $current_real Absolute current package dir.
 * @param array<string, string> $runtime Contact-exchange runtime config (mutated).
 * @return void
 */
function ex_public_contact_exchange_enrich_recipient( $current_real, array &$runtime ) {
	$vcf_path = ex_public_normalize_path( (string) $current_real . '/vcf-data.json' );
	if ( ! is_readable( $vcf_path ) ) {
		return;
	}
	$raw = file_get_contents( $vcf_path );
	$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
	if ( ! is_array( $data ) ) {
		return;
	}
	$name = trim( (string) ( $data['display_name'] ?? $data['fn'] ?? '' ) );
	$company = trim( (string) ( $data['company'] ?? $data['org'] ?? '' ) );
	if ( '' !== $name ) {
		$runtime['recipientName'] = $name;
	}
	if ( '' !== $company ) {
		$runtime['recipientCompany'] = $company;
	}
}

/**
 * @param string $dict_key sk|cs|en|de.
 * @return array<string, string>
 */
function ex_public_guest_motion_strings( $dict_key ) {
	$dict_key = ex_public_owner_normalize_dict_key( $dict_key );
	if ( '' === $dict_key ) {
		$dict_key = 'sk';
	}
	$root = ex_public_realpath_root( __DIR__ );
	if ( false === $root ) {
		return array();
	}
	$file = ex_public_realpath_file_in_root( $root . '/lang/contact-exchange.json', $root );
	if ( false === $file ) {
		return array();
	}
	$raw  = file_get_contents( $file );
	$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
	if ( ! is_array( $data ) ) {
		return array();
	}
	$bucket = isset( $data[ $dict_key ]['guestMotion'] ) && is_array( $data[ $dict_key ]['guestMotion'] )
		? $data[ $dict_key ]['guestMotion']
		: array();
	if ( ! empty( $bucket ) ) {
		return $bucket;
	}
	if ( isset( $data['sk']['guestMotion'] ) && is_array( $data['sk']['guestMotion'] ) ) {
		return $data['sk']['guestMotion'];
	}

	return array();
}

/**
 * @param array<string, mixed> $manifest Package manifest.
 * @return array<string, mixed>|null
 */
function ex_public_guest_motion_runtime_config( array $manifest ) {
	$block = isset( $manifest['public_motion'] ) && is_array( $manifest['public_motion'] ) ? $manifest['public_motion'] : null;
	if ( ! is_array( $block ) || empty( $block['profile_id'] ) ) {
		return null;
	}
	$profile_id = strtolower( preg_replace( '/[^a-z0-9_-]/', '', (string) $block['profile_id'] ) );
	if ( 'guest-depth' !== $profile_id ) {
		return null;
	}
	$lang_ctx = ex_public_owner_resolve_lang();
	$i18n     = ex_public_guest_motion_strings( $lang_ctx['dict'] );
	$params   = isset( $block['parameters'] ) && is_array( $block['parameters'] ) ? $block['parameters'] : array();

	return array(
		'profile_id'          => $profile_id,
		'profile_version'     => isset( $block['profile_version'] ) ? (int) $block['profile_version'] : 1,
		'parameters'          => $params,
		'background_parallax' => ! empty( $block['background_parallax'] ),
		'lang'                => $lang_ctx['dict'],
		'i18n'                => $i18n,
	);
}

/**
 * @param string $relative Path under site root, e.g. /assets/js/foo.js.
 * @return string
 */
function ex_public_static_asset_href( $relative ) {
	$href = '/' . ltrim( (string) $relative, '/' );
	if ( false !== strpos( $href, '?' ) ) {
		return $href;
	}
	$root = ex_public_realpath_root( __DIR__ );
	if ( false === $root ) {
		return $href;
	}
	$rel  = ltrim( $href, '/' );
	$file = ex_public_realpath_file_in_root( $root . '/' . $rel, $root );
	if ( false === $file ) {
		return $href;
	}
	$mtime = filemtime( $file );
	if ( false === $mtime ) {
		return $href;
	}

	return $href . '?v=' . (string) (int) $mtime;
}

/**
 * Owner presentation cookie (HttpOnly; raw token never exposed to JS after activation).
 */
const EX_PUBLIC_OWNER_COOKIE = 'excard_owner_sess';
const EX_PUBLIC_OWNER_CHALLENGE_COOKIE = 'excard_owner_chl';
const EX_PUBLIC_OWNER_PREF_COOKIE      = 'excard_owner_pref';
const EX_PUBLIC_UI_LANG_COOKIE         = 'excard_ui_lang';

/**
 * @return array<string, string> Route slug => dictionary key (contact-exchange.json).
 */
function ex_public_owner_lang_route_map() {
	return array(
		'sk' => 'sk',
		'cz' => 'cs',
		'en' => 'en',
		'de' => 'de',
	);
}

/**
 * @param string $raw Route or dict key.
 * @return string sk|cs|en|de or empty.
 */
function ex_public_owner_normalize_dict_key( $raw ) {
	$key = strtolower( trim( (string) $raw ) );
	if ( 'cz' === $key ) {
		return 'cs';
	}
	if ( in_array( $key, array( 'sk', 'cs', 'en', 'de' ), true ) ) {
		return $key;
	}

	return '';
}

/**
 * @param string $dict Dictionary key.
 * @return string Route slug sk|cz|en|de.
 */
function ex_public_owner_dict_to_route( $dict ) {
	$map = array_flip( ex_public_owner_lang_route_map() );

	return isset( $map[ $dict ] ) ? (string) $map[ $dict ] : 'sk';
}

/**
 * @return string
 */
function ex_public_owner_accept_language_dict() {
	$header = isset( $_SERVER['HTTP_ACCEPT_LANGUAGE'] ) ? (string) $_SERVER['HTTP_ACCEPT_LANGUAGE'] : '';
	foreach ( explode( ',', $header ) as $part ) {
		$token = strtolower( trim( (string) strtok( $part, ';' ) ) );
		$primary = strtok( $token, '-' );
		if ( ! is_string( $primary ) ) {
			continue;
		}
		$dict = ex_public_owner_normalize_dict_key( $primary );
		if ( '' !== $dict ) {
			return $dict;
		}
	}

	return 'sk';
}

/**
 * @return array{dict:string,route:string,html_lang:string,locale:string}
 */
function ex_public_owner_resolve_lang() {
	$routes    = ex_public_owner_lang_route_map();
	$dict      = '';
	$set_cookie = false;
	if ( isset( $_GET['lang'] ) ) {
		$route = strtolower( trim( (string) $_GET['lang'] ) );
		if ( isset( $routes[ $route ] ) ) {
			$dict       = $routes[ $route ];
			$set_cookie = true;
		}
	}
	if ( '' === $dict && isset( $_COOKIE[ EX_PUBLIC_UI_LANG_COOKIE ] ) && is_string( $_COOKIE[ EX_PUBLIC_UI_LANG_COOKIE ] ) ) {
		$dict = ex_public_owner_normalize_dict_key( $_COOKIE[ EX_PUBLIC_UI_LANG_COOKIE ] );
	}
	if ( '' === $dict ) {
		$dict = ex_public_owner_accept_language_dict();
	}
	if ( '' === $dict ) {
		$dict = 'sk';
	}
	if ( $set_cookie && ! headers_sent() ) {
		setcookie(
			EX_PUBLIC_UI_LANG_COOKIE,
			$dict,
			array(
				'expires'  => time() + 31536000,
				'path'     => '/',
				'secure'   => ex_public_owner_cookie_secure(),
				'httponly' => false,
				'samesite' => 'Lax',
			)
		);
	}
	$locale = 'sk-SK';
	if ( 'cs' === $dict ) {
		$locale = 'cs-CZ';
	} elseif ( 'en' === $dict ) {
		$locale = 'en-US';
	} elseif ( 'de' === $dict ) {
		$locale = 'de-DE';
	}

	return array(
		'dict'      => $dict,
		'route'     => ex_public_owner_dict_to_route( $dict ),
		'html_lang' => $dict,
		'locale'    => $locale,
	);
}

/**
 * @param string $dict_key sk|cs|en|de.
 * @return array<string, string>
 */
function ex_public_owner_strings( $dict_key ) {
	$dict_key = ex_public_owner_normalize_dict_key( $dict_key );
	if ( '' === $dict_key ) {
		$dict_key = 'sk';
	}
	$root = ex_public_realpath_root( __DIR__ );
	if ( false === $root ) {
		return array();
	}
	$file = ex_public_realpath_file_in_root( $root . '/lang/contact-exchange.json', $root );
	if ( false === $file ) {
		return array();
	}
	$raw  = file_get_contents( $file );
	$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
	if ( ! is_array( $data ) ) {
		return array();
	}
	$bucket = isset( $data[ $dict_key ]['owner'] ) && is_array( $data[ $dict_key ]['owner'] ) ? $data[ $dict_key ]['owner'] : array();
	$base   = isset( $data[ $dict_key ] ) && is_array( $data[ $dict_key ] ) ? $data[ $dict_key ] : array();
	foreach ( array( 'close', 'cancel' ) as $inherit_key ) {
		if ( ! isset( $bucket[ $inherit_key ] ) && isset( $base[ $inherit_key ] ) && is_string( $base[ $inherit_key ] ) ) {
			$bucket[ $inherit_key ] = $base[ $inherit_key ];
		}
	}
	if ( ! empty( $bucket ) ) {
		return $bucket;
	}
	if ( isset( $data['sk']['owner'] ) && is_array( $data['sk']['owner'] ) ) {
		return $data['sk']['owner'];
	}

	return array();
}

/**
 * @param array<string, string> $strings Owner dictionary.
 * @param string                $key     Key.
 * @param string                $fallback Fallback.
 * @return string
 */
function ex_public_owner_t( array $strings, $key, $fallback = '' ) {
	$key = (string) $key;
	if ( isset( $strings[ $key ] ) && is_string( $strings[ $key ] ) ) {
		return $strings[ $key ];
	}

	return (string) $fallback;
}

/**
 * Graphical modal close control (Owner panels / logout dialog).
 *
 * @param array<string, string> $strings Owner dictionary.
 * @return string
 */
function ex_public_owner_modal_close_btn_html( array $strings, $data_attr = 'data-ex-owner-modal-close' ) {
	$label = ex_public_owner_t( $strings, 'close', 'Zavrieť' );
	$attr  = preg_replace( '/[^a-z0-9_-]/', '', (string) $data_attr );
	if ( '' === $attr ) {
		$attr = 'data-ex-owner-modal-close';
	}

	return '<button type="button" class="ex-public-owner-app__modal-close" ' . $attr . ' aria-label="' . htmlspecialchars( $label, ENT_QUOTES, 'UTF-8' ) . '"><span class="ex-public-owner-app__modal-close-glyph" aria-hidden="true"></span></button>';
}

/**
 * @param array<string, mixed> $bg       owner_presentation.background.
 * @param array<string, mixed> $manifest Package manifest.
 * @param string               $segment  URL segment (slug or public_id).
 * @return array{style:string,contrast:string}
 */
function ex_public_owner_body_background_from_manifest( array $bg, array $manifest, $segment ) {
	$style_parts = array();
	$contrast    = 'complex';
	$bg_type     = isset( $bg['type'] ) ? (string) $bg['type'] : '';

	if ( 'image' === $bg_type && isset( $bg['asset'] ) && is_string( $bg['asset'] ) ) {
		$allowed_bg = ex_public_manifest_asset_path( $manifest, (string) $bg['asset'] );
		if ( null !== $allowed_bg ) {
			$bg_url        = '/' . rawurlencode( $segment ) . '?asset=' . rawurlencode( $allowed_bg );
			$px            = isset( $bg['position_x'] ) ? max( 0, min( 100, (int) $bg['position_x'] ) ) : 50;
			$py            = isset( $bg['position_y'] ) ? max( 0, min( 100, (int) $bg['position_y'] ) ) : 50;
			$zoom          = isset( $bg['zoom_percent'] ) ? max( 100, min( 300, (int) $bg['zoom_percent'] ) ) : 100;
			$fit_raw       = isset( $bg['fit'] ) ? strtolower( preg_replace( '/[^a-z0-9_-]/', '', (string) $bg['fit'] ) ) : 'cover';
			$fit           = '' !== $fit_raw ? $fit_raw : 'cover';
			$size          = 'cover';
			if ( 'contain' === $fit ) {
				$size = 'contain';
			} elseif ( 'fill' === $fit ) {
				$size = '100% 100%';
			} elseif ( $zoom > 100 ) {
				$size = $zoom . '%';
			}
			$style_parts[] = 'background-image:url(' . $bg_url . ')';
			$style_parts[] = 'background-size:' . $size;
			$style_parts[] = 'background-position:' . $px . '% ' . $py . '%';
			$style_parts[] = 'background-repeat:no-repeat';
			if ( isset( $bg['background_opacity'] ) ) {
				$op = max( 0, min( 100, (int) $bg['background_opacity'] ) );
				if ( $op < 100 ) {
					$style_parts[] = '--ex-owner-bg-opacity:' . ( $op / 100 );
				}
			}
			if ( isset( $bg['overlay_color'], $bg['overlay_opacity'] ) ) {
				$oc = trim( (string) $bg['overlay_color'] );
				$oo = max( 0, min( 100, (int) $bg['overlay_opacity'] ) );
				if ( preg_match( '/^#[0-9a-fA-F]{3,8}$/', $oc ) && $oo > 0 ) {
					$style_parts[] = '--ex-owner-overlay-color:' . $oc;
					$style_parts[] = '--ex-owner-overlay-opacity:' . ( $oo / 100 );
				}
			}
		}
	} elseif ( 'gradient' === $bg_type && ! empty( $bg['colors'] ) && is_array( $bg['colors'] ) ) {
		$colors = array();
		foreach ( $bg['colors'] as $color ) {
			$c = trim( (string) $color );
			if ( preg_match( '/^#[0-9a-fA-F]{3,8}$/', $c ) ) {
				$colors[] = $c;
			}
		}
		if ( count( $colors ) >= 2 ) {
			$angle = isset( $bg['angle'] ) ? (int) $bg['angle'] : 180;
			$stops = array();
			$last  = count( $colors ) - 1;
			foreach ( $colors as $index => $color ) {
				$percent  = 0 === $last ? 0 : (int) round( ( $index / $last ) * 100 );
				$stops[]  = $color . ' ' . $percent . '%';
			}
			$style_parts[] = 'background-image:linear-gradient(' . $angle . 'deg,' . implode( ',', $stops ) . ')';
			if ( isset( $manifest['owner_presentation']['brand_contrast'] ) ) {
				$contrast = strtolower( preg_replace( '/[^a-z0-9_-]/', '', (string) $manifest['owner_presentation']['brand_contrast'] ) );
			}
		}
	} elseif ( 'color' === $bg_type && isset( $bg['value'] ) ) {
		$color = trim( (string) $bg['value'] );
		if ( preg_match( '/^#[0-9a-fA-F]{3,8}$/', $color ) ) {
			$style_parts[] = 'background-color:' . $color;
			if ( isset( $manifest['owner_presentation']['brand_contrast'] ) ) {
				$contrast = strtolower( preg_replace( '/[^a-z0-9_-]/', '', (string) $manifest['owner_presentation']['brand_contrast'] ) );
			}
		}
	}

	if ( isset( $manifest['owner_presentation']['brand_contrast'] ) ) {
		$manifest_contrast = strtolower( preg_replace( '/[^a-z0-9_-]/', '', (string) $manifest['owner_presentation']['brand_contrast'] ) );
		if ( in_array( $manifest_contrast, array( 'light', 'dark', 'complex' ), true ) ) {
			$contrast = $manifest_contrast;
		}
	}

	return array(
		'style'    => implode( ';', $style_parts ) . ( $style_parts ? ';' : '' ),
		'contrast' => $contrast,
	);
}

/**
 * Rich-text brand token: <i>express</i> + CARD (Owner UI only).
 *
 * @return string Safe HTML fragment.
 */
function ex_public_owner_brand_html() {
	return '<span class="ex-public-owner-brand" lang="en"><i class="ex-public-owner-brand__express">express</i><span class="ex-public-owner-brand__card">CARD</span></span>';
}

/**
 * @param string $variant Glyph key (maps to CSS modifier).
 * @return string
 */
function ex_public_owner_glyph_html( $variant ) {
	$variant = preg_replace( '/[^a-z0-9_-]/', '', strtolower( (string) $variant ) );
	if ( '' === $variant ) {
		return '';
	}

	return '<span class="ex-public-owner-app__glyph ex-public-owner-app__glyph--' . htmlspecialchars( $variant, ENT_QUOTES, 'UTF-8' ) . '" aria-hidden="true"></span>';
}

/**
 * Public site origin for absolute manifest icon URLs.
 *
 * @param array<string, mixed> $config Publication config.
 * @return string
 */
function ex_public_owner_site_origin( array $config ) {
	$base = isset( $config['public_base_url'] ) ? trim( (string) $config['public_base_url'] ) : '';
	if ( '' === $base ) {
		return 'https://expresscard.eu';
	}

	return rtrim( $base, '/' );
}

/**
 * @return string
 */
function ex_public_owner_pwa_head_markup() {
	return '<link rel="manifest" href="/owner/app.webmanifest"><link rel="apple-touch-icon" href="/images/expresscard-home-180.png">';
}

/**
 * Sanitized UI-only setup query (?setup=homescreen).
 *
 * @return string homescreen or empty.
 */
function ex_public_owner_sanitize_setup_query() {
	if ( ! isset( $_GET['setup'] ) ) {
		return '';
	}
	$value = strtolower( trim( (string) $_GET['setup'] ) );

	return 'homescreen' === $value ? 'homescreen' : '';
}

/**
 * @return bool
 */
function ex_public_owner_setup_hint_active() {
	return 'homescreen' === ex_public_owner_sanitize_setup_query();
}

/**
 * Query params preserved across Owner navigation (UI only).
 *
 * @return array<string, string>
 */
function ex_public_owner_query_passthrough() {
	$query = array();
	if ( ex_public_owner_setup_hint_active() ) {
		$query['setup'] = 'homescreen';
	}

	return $query;
}

/**
 * @param array<string, string> $strings Owner dictionary.
 * @param string                $prefix_key        Key for translatable prefix before brand.
 * @param string                $fallback          Fallback prefix.
 * @param string                $suffix_key        Optional key for text after brand (e.g. DE verb).
 * @param string                $suffix_fallback   Fallback suffix.
 * @return string HTML safe for echo inside buttons/headings.
 */
function ex_public_owner_label_with_brand_html( array $strings, $prefix_key, $fallback, $suffix_key = '', $suffix_fallback = '' ) {
	$prefix = ex_public_owner_t( $strings, $prefix_key, $fallback );
	$suffix = '' !== $suffix_key ? ex_public_owner_t( $strings, $suffix_key, $suffix_fallback ) : '';

	return htmlspecialchars( $prefix, ENT_QUOTES, 'UTF-8' ) . ex_public_owner_brand_html() . htmlspecialchars( $suffix, ENT_QUOTES, 'UTF-8' );
}

/**
 * @param string               $card_ref Route ref.
 * @param array<string, mixed> $lang_ctx Language context.
 * @return string
 */
function ex_public_owner_card_screen_url( $card_ref, array $lang_ctx ) {
	$url   = '/owner/card/' . rawurlencode( (string) $card_ref );
	$query = ex_public_owner_query_passthrough();
	if ( isset( $lang_ctx['route'] ) && '' !== (string) $lang_ctx['route'] ) {
		$query['lang'] = (string) $lang_ctx['route'];
	}
	if ( ! empty( $query ) ) {
		$url .= '?' . http_build_query( $query );
	}

	return $url;
}

/**
 * Redirect when session has exactly one authorized card.
 *
 * @param array<int, mixed>    $cards    Cards from Core.
 * @param array<string, mixed> $lang_ctx Language context.
 * @return void
 */
function ex_public_owner_redirect_if_single_card( array $cards, array $lang_ctx ) {
	if ( 1 !== count( $cards ) ) {
		return;
	}
	$card = $cards[0];
	if ( ! is_array( $card ) ) {
		return;
	}
	$ref = ex_public_owner_card_route_ref( $card );
	if ( '' === $ref ) {
		return;
	}
	header( 'Location: ' . ex_public_owner_card_screen_url( $ref, $lang_ctx ), true, 302 );
	exit;
}

/**
 * Owner frame stylesheet with cache-busting when the file exists on disk.
 *
 * @param array<string, mixed> $config Site config.
 * @return string
 */
function ex_public_owner_frame_css_href( array $config ) {
	$href = isset( $config['frame_css'] ) ? (string) $config['frame_css'] : '/assets/css/expresscard-public.css';
	if ( '' === $href || false !== strpos( $href, '?' ) ) {
		return $href;
	}
	$root = ex_public_realpath_root( __DIR__ );
	if ( false === $root ) {
		return $href;
	}
	$rel  = ltrim( $href, '/' );
	$file = ex_public_realpath_file_in_root( $root . '/' . $rel, $root );
	if ( false === $file ) {
		return $href;
	}
	$mtime = filemtime( $file );
	if ( false === $mtime ) {
		return $href;
	}

	return $href . '?v=' . (string) (int) $mtime;
}

/**
 * @param string $preferred_route sk|cz|en|de
 * @return list<string>
 */
function ex_public_owner_lang_route_display_order( $preferred_route ) {
	$pref = strtolower( trim( (string) $preferred_route ) );
	if ( ! in_array( $pref, array( 'sk', 'cz', 'en', 'de' ), true ) ) {
		$pref = 'sk';
	}
	$tail  = array( 'en', 'de', 'cz', 'sk' );
	$order = array( $pref );
	foreach ( $tail as $route ) {
		if ( $route !== $pref ) {
			$order[] = $route;
		}
	}

	return $order;
}

/**
 * @param array{route:string} $lang_ctx Language context.
 * @param string              $path     Path without query, e.g. /owner/ or /owner/card/ref.
 * @param array<string, string> $extra_query Extra query params.
 * @return string
 */
function ex_public_owner_lang_switcher_markup( array $lang_ctx, $path, array $extra_query = array(), $activate_inpage = false ) {
	$routes_map = ex_public_owner_lang_route_map();
	$preferred  = isset( $lang_ctx['route'] ) ? (string) $lang_ctx['route'] : 'sk';
	$routes     = ex_public_owner_lang_route_display_order( $preferred );
	$dict       = isset( $lang_ctx['dict'] ) ? (string) $lang_ctx['dict'] : 'sk';
	$strings    = ex_public_owner_strings( $dict );
	$nav_label  = ex_public_owner_t( $strings, 'languageNav', 'Jazyk' );
	$html       = '<nav class="ex-public-owner-app__lang" aria-label="' . htmlspecialchars( $nav_label, ENT_QUOTES, 'UTF-8' ) . '">';
	$html      .= '<label class="ex-public-owner-app__lang-select-wrap">';
	$html      .= '<span class="ex-public-sr-only">' . htmlspecialchars( $nav_label, ENT_QUOTES, 'UTF-8' ) . '</span>';
	$html      .= '<select class="ex-public-owner-app__lang-select" data-ex-owner-lang-select="1"';
	if ( $activate_inpage ) {
		$html .= ' data-ex-owner-lang-inpage="1"';
	}
	$html .= '>';
	foreach ( $routes as $route ) {
		$selected = ( isset( $lang_ctx['route'] ) && $route === $lang_ctx['route'] ) ? ' selected="selected"' : '';
		$html    .= '<option value="' . htmlspecialchars( $route, ENT_QUOTES, 'UTF-8' ) . '" lang="' . htmlspecialchars( $routes_map[ $route ], ENT_QUOTES, 'UTF-8' ) . '"';
		if ( ! $activate_inpage ) {
			$query = array_merge( $extra_query, array( 'lang' => $route ) );
			$href  = $path . '?' . http_build_query( $query );
			$html .= ' data-ex-owner-lang-href="' . htmlspecialchars( $href, ENT_QUOTES, 'UTF-8' ) . '"';
		}
		$html .= $selected . '>' . htmlspecialchars( strtoupper( $route ), ENT_QUOTES, 'UTF-8' ) . '</option>';
	}
	$html .= '</select></label></nav>';

	return $html;
}

/**
 * @return bool
 */
function ex_public_owner_cookie_secure() {
	return true;
}

/**
 * @param string $url URL to validate.
 * @return bool
 */
function ex_public_owner_allowed_core_url( $url ) {
	$parts = parse_url( (string) $url );
	if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return false;
	}
	if ( 'https' !== strtolower( (string) $parts['scheme'] ) ) {
		return false;
	}
	$host = strtolower( (string) $parts['host'] );

	return 'expressar.eu' === $host;
}

/**
 * @param array<string, mixed> $config Publication config.
 * @return string Core REST base, e.g. https://expressar.eu/wp-json/expressar/v1
 */
function ex_public_owner_core_api_base( array $config ) {
	$url = isset( $config['contact_exchange_submit_url'] ) ? trim( (string) $config['contact_exchange_submit_url'] ) : '';
	if ( '' === $url ) {
		return 'https://expressar.eu/wp-json/expressar/v1';
	}
	$base = preg_replace( '#/expresscard/contact-exchange$#', '', $url );
	return is_string( $base ) && '' !== $base ? $base : 'https://expressar.eu/wp-json/expressar/v1';
}

/**
 * @param string               $url  HTTPS URL.
 * @param array<string, mixed> $body JSON body.
 * @return array{http_code:int,raw:string,json:array<string,mixed>|null,content_type:string}
 */
function ex_public_owner_core_post( $url, array $body ) {
	$url = (string) $url;
	$empty = array(
		'http_code'      => 0,
		'raw'            => '',
		'json'           => null,
		'content_type'   => '',
	);
	if ( ! ex_public_owner_allowed_core_url( $url ) ) {
		return $empty;
	}
	$payload = json_encode( $body );
	if ( ! is_string( $payload ) ) {
		return $empty;
	}
	if ( function_exists( 'curl_init' ) ) {
		$ch = curl_init( $url );
		if ( false === $ch ) {
			return $empty;
		}
		curl_setopt_array(
			$ch,
			array(
				CURLOPT_POST           => true,
				CURLOPT_POSTFIELDS     => $payload,
				CURLOPT_HTTPHEADER     => array( 'Content-Type: application/json', 'Accept: application/json' ),
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_TIMEOUT        => 12,
				CURLOPT_FOLLOWLOCATION => false,
				CURLOPT_SSL_VERIFYPEER => true,
				CURLOPT_SSL_VERIFYHOST => 2,
			)
		);
		$raw  = curl_exec( $ch );
		$code = (int) curl_getinfo( $ch, CURLINFO_HTTP_CODE );
		$type = (string) curl_getinfo( $ch, CURLINFO_CONTENT_TYPE );
		curl_close( $ch );
		if ( ! is_string( $raw ) ) {
			return array(
				'http_code'    => $code,
				'raw'          => '',
				'json'         => null,
				'content_type' => $type,
			);
		}
		$decoded = json_decode( $raw, true );
		return array(
			'http_code'    => $code,
			'raw'          => $raw,
			'json'         => is_array( $decoded ) ? $decoded : null,
			'content_type' => $type,
		);
	}
	$ctx = stream_context_create(
		array(
			'http' => array(
				'method'          => 'POST',
				'header'          => "Content-Type: application/json\r\nAccept: application/json\r\n",
				'content'         => $payload,
				'timeout'         => 12,
				'follow_location' => 0,
				'ignore_errors'   => true,
			),
			'ssl'  => array(
				'verify_peer'      => true,
				'verify_peer_name' => true,
			),
		)
	);
	$raw = @file_get_contents( $url, false, $ctx ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( ! is_string( $raw ) ) {
		return $empty;
	}
	$code = 0;
	if ( isset( $http_response_header[0] ) && is_string( $http_response_header[0] ) ) {
		if ( preg_match( '/\s(\d{3})\s/', $http_response_header[0], $matches ) ) {
			$code = (int) $matches[1];
		}
	}
	$decoded = json_decode( $raw, true );
	return array(
		'http_code'    => $code,
		'raw'          => $raw,
		'json'         => is_array( $decoded ) ? $decoded : null,
		'content_type' => '',
	);
}

/**
 * @param string               $url  HTTPS URL.
 * @param array<string, mixed> $body JSON body.
 * @return array<string, mixed>|null
 */
function ex_public_owner_core_post_json( $url, array $body ) {
	$response = ex_public_owner_core_post( $url, $body );
	if ( $response['http_code'] < 200 || $response['http_code'] >= 300 ) {
		return null;
	}

	return is_array( $response['json'] ) ? $response['json'] : null;
}

/**
 * @param array<string, mixed> $response Core HTTP response.
 * @return string
 */
function ex_public_owner_core_json_error_code( array $response ) {
	if ( ! is_array( $response['json'] ) ) {
		return '';
	}
	$code = isset( $response['json']['code'] ) ? (string) $response['json']['code'] : '';

	return $code;
}

/**
 * @return array<int, string>
 */
function ex_public_owner_core_session_invalid_error_codes() {
	return array(
		'expressar_owner_session_invalid',
		'expressar_dsi_access_session_invalid',
	);
}

/**
 * Classify Core transport, HTTP and contract without cookie side effects.
 *
 * @param array<string, mixed> $response Core HTTP response.
 * @param string               $endpoint session|cards|verify.
 * @return array{state:string,data:array<string,mixed>|null,http_code:int}
 */
function ex_public_owner_core_classify_response( array $response, $endpoint ) {
	$http_code = (int) $response['http_code'];
	$json      = is_array( $response['json'] ) ? $response['json'] : null;
	$err_code  = ex_public_owner_core_json_error_code( $response );
	$endpoint  = (string) $endpoint;

	if ( 0 === $http_code ) {
		return array(
			'state'     => 'unavailable',
			'data'      => null,
			'http_code' => 0,
		);
	}
	if ( $http_code >= 500 || 429 === $http_code ) {
		return array(
			'state'     => 'unavailable',
			'data'      => $json,
			'http_code' => $http_code,
		);
	}
	if ( $http_code >= 200 && $http_code < 300 ) {
		if ( null === $json ) {
			return array(
				'state'     => 'unavailable',
				'data'      => null,
				'http_code' => $http_code,
			);
		}
		if ( 'session' === $endpoint ) {
			if ( ! array_key_exists( 'valid', $json ) || ! is_bool( $json['valid'] ) ) {
				return array(
					'state'     => 'unavailable',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}
			if ( empty( $json['valid'] ) ) {
				return array(
					'state'     => 'session_invalid',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}

			return array(
				'state'     => 'ok',
				'data'      => $json,
				'http_code' => $http_code,
			);
		}
		if ( 'cards' === $endpoint ) {
			if ( ! isset( $json['cards'] ) || ! is_array( $json['cards'] ) ) {
				return array(
					'state'     => 'unavailable',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}

			return array(
				'state'     => 'ok',
				'data'      => $json,
				'http_code' => $http_code,
			);
		}
		if ( 'verify' === $endpoint ) {
            if ( ! array_key_exists( 'allowed', $json ) || ! is_bool( $json['allowed'] ) ) {
                return array(
                    'state'     => 'unavailable',
                    'data'      => $json,
                    'http_code' => $http_code,
                );
            }
            if ( false === $json['allowed'] ) {
				return array(
					'state'     => 'card_denied',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}

			return array(
				'state'     => 'ok',
				'data'      => $json,
				'http_code' => $http_code,
			);
		}
		if ( 'bootstrap' === $endpoint ) {
			if ( ! isset( $json['session_state'] ) || ! is_string( $json['session_state'] ) ) {
				return array(
					'state'     => 'unavailable',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}
			$session_state = (string) $json['session_state'];
			if ( 'invalid' === $session_state ) {
				return array(
					'state'     => 'session_invalid',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}
			if ( 'unavailable' === $session_state ) {
				return array(
					'state'     => 'unavailable',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}
			if ( 'valid' !== $session_state ) {
				return array(
					'state'     => 'unavailable',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}
			if ( ! isset( $json['cards'] ) || ! is_array( $json['cards'] ) ) {
				return array(
					'state'     => 'unavailable',
					'data'      => $json,
					'http_code' => $http_code,
				);
			}

			return array(
				'state'     => 'ok',
				'data'      => $json,
				'http_code' => $http_code,
			);
		}

		return array(
			'state'     => 'ok',
			'data'      => $json,
			'http_code' => $http_code,
		);
	}
	if ( in_array( $err_code, ex_public_owner_core_session_invalid_error_codes(), true ) ) {
		return array(
			'state'     => 'session_invalid',
			'data'      => $json,
			'http_code' => $http_code,
		);
	}
	if ( 'verify' === $endpoint && 'expressar_dsi_access_forbidden' === $err_code ) {
		return array(
			'state'     => 'card_denied',
			'data'      => $json,
			'http_code' => $http_code,
		);
	}

	return array(
		'state'     => 'unavailable',
		'data'      => $json,
		'http_code' => $http_code,
	);
}

/**
 * @param string               $url      HTTPS URL.
 * @param array<string, mixed> $body     JSON body.
 * @param string               $endpoint session|cards|verify|bootstrap.
 * @return array{state:string,data:array<string,mixed>|null,http_code:int}
 */
function ex_public_owner_core_post_state( $url, array $body, $endpoint ) {
	$response = ex_public_owner_core_post( $url, $body );

	return ex_public_owner_core_classify_response( $response, $endpoint );
}

/**
 * @param string $route sk|cz|en|de route key.
 * @return array{dict:string,route:string,html_lang:string,locale:string}
 */
function ex_public_owner_lang_ctx_from_route( $route ) {
	$routes = ex_public_owner_lang_route_map();
	$route  = strtolower( trim( (string) $route ) );
	if ( 'cs' === $route ) {
		$route = 'cz';
	}
	if ( ! isset( $routes[ $route ] ) ) {
		return ex_public_owner_resolve_lang();
	}
	$dict = $routes[ $route ];
	if ( ! headers_sent() ) {
		setcookie(
			EX_PUBLIC_UI_LANG_COOKIE,
			$dict,
			array(
				'expires'  => time() + 31536000,
				'path'     => '/',
				'secure'   => ex_public_owner_cookie_secure(),
				'httponly' => false,
				'samesite' => 'Lax',
			)
		);
	}
	$locale = 'sk-SK';
	if ( 'cs' === $dict ) {
		$locale = 'cs-CZ';
	} elseif ( 'en' === $dict ) {
		$locale = 'en-US';
	} elseif ( 'de' === $dict ) {
		$locale = 'de-DE';
	}

	return array(
		'dict'      => $dict,
		'route'     => $route,
		'html_lang' => $dict,
		'locale'    => $locale,
	);
}

/**
 * @param array<string, mixed> $params Bootstrap POST body.
 * @return array{0:array{dict:string,route:string,html_lang:string,locale:string},1:bool}
 */
function ex_public_owner_bootstrap_lang_setup( array $params ) {
	$lang_route = isset( $params['lang_route'] ) ? trim( (string) $params['lang_route'] ) : '';
	$lang_ctx   = '' !== $lang_route ? ex_public_owner_lang_ctx_from_route( $lang_route ) : ex_public_owner_resolve_lang();
	$setup      = ! empty( $params['setup_homescreen'] );

	return array( $lang_ctx, $setup );
}

/**
 * @param string               $api_base Core REST base.
 * @param string               $token    Session token.
 * @param string               $card_ref Optional card ref for verify.
 * @return array<string, mixed>
 */
function ex_public_owner_session_api_payload( $api_base, $token, $card_ref = '' ) {
	if ( '' === $token ) {
		return array( 'valid' => false );
	}
	$core_body = array( 'session_token' => $token );
	$card_ref  = trim( (string) $card_ref );
	if ( '' !== $card_ref && ( ex_public_valid_id( $card_ref ) || ex_public_valid_slug_segment( $card_ref ) ) ) {
		$core_body['card_ref'] = $card_ref;
	}
	$boot_resp = ex_public_owner_core_post_state(
		$api_base . '/expresscard/owner/bootstrap',
		$core_body,
		'bootstrap'
	);
	if ( 'unavailable' === $boot_resp['state'] ) {
		return array(
			'valid'       => false,
			'unavailable' => true,
		);
	}
	if ( 'session_invalid' === $boot_resp['state'] ) {
		ex_public_owner_clear_session_cookie();

		return array( 'valid' => false );
	}
	if ( 'ok' !== $boot_resp['state'] || ! is_array( $boot_resp['data'] ) ) {
		return array(
			'valid'       => false,
			'unavailable' => true,
		);
	}
	$boot = $boot_resp['data'];
	$payload = array(
		'valid' => true,
		'cards' => isset( $boot['cards'] ) && is_array( $boot['cards'] ) ? $boot['cards'] : array(),
	);
	if ( '' === $card_ref ) {
		return $payload;
	}
	$card_outcome = ex_public_owner_bootstrap_card_outcome( $boot );
	if ( 'unavailable' === $card_outcome ) {
		return array(
			'valid'       => false,
			'unavailable' => true,
		);
	}
	if ( 'card_denied' === $card_outcome ) {
		$payload['card_allowed'] = false;

		return $payload;
	}
	$payload['card_allowed'] = true;
	$editor_access           = ex_public_owner_normalize_editor_access_from_core( isset( $boot['editor'] ) ? $boot['editor'] : null );
	if ( is_array( $editor_access ) ) {
		$payload['editor_access'] = $editor_access;
	}
	$publication_request = ex_public_owner_normalize_publication_request_from_core( isset( $boot['publication_request'] ) ? $boot['publication_request'] : null );
	if ( is_array( $publication_request ) ) {
		$payload['publication_request'] = $publication_request;
	}

	return $payload;
}

/**
 * @param array<string, mixed> $card Card row from Core.
 * @return string
 */
function ex_public_owner_card_route_ref( array $card ) {
	$slug = isset( $card['public_slug'] ) ? trim( (string) $card['public_slug'] ) : '';
	if ( '' !== $slug && ( ex_public_valid_id( $slug ) || ex_public_valid_slug_segment( $slug ) ) ) {
		return $slug;
	}
	$pid = isset( $card['public_id'] ) ? (string) $card['public_id'] : '';
	return ex_public_valid_id( $pid ) ? $pid : '';
}

/**
 * @param string               $card_ref Route ref.
 * @param array<int, mixed>    $cards    Session cards.
 * @param string               $cards_root Cards root.
 * @return string|false public_id or false.
 */
function ex_public_owner_resolve_public_id( $card_ref, array $cards, $cards_root ) {
	$card_ref = trim( (string) $card_ref );
	if ( '' === $card_ref ) {
		return false;
	}
	foreach ( $cards as $card ) {
		if ( ! is_array( $card ) ) {
			continue;
		}
		$pid  = isset( $card['public_id'] ) ? (string) $card['public_id'] : '';
		$slug = isset( $card['public_slug'] ) ? trim( (string) $card['public_slug'] ) : '';
		if ( $card_ref === $pid || ( '' !== $slug && $card_ref === $slug ) ) {
			return ex_public_valid_id( $pid ) ? $pid : false;
		}
	}
	if ( ex_public_valid_id( $card_ref ) ) {
		return $card_ref;
	}
	if ( ex_public_valid_slug_segment( $card_ref ) ) {
		$resolved = ex_public_resolve_public_id_by_slug( $cards_root, $card_ref );
		if ( is_string( $resolved ) && ex_public_valid_id( $resolved ) ) {
			return $resolved;
		}
	}

	return false;
}

/**
 * @param string $cards_root Cards root.
 * @param string $public_id  Public id.
 * @return array{manifest:array<string,mixed>,current_real:string}|null
 */
function ex_public_owner_load_package( $cards_root, $public_id ) {
	if ( ! ex_public_valid_id( $public_id ) ) {
		return null;
	}
	$resolved = ex_public_resolve_current_dir( $cards_root, $public_id );
	if ( false === $resolved ) {
		return null;
	}
	list( , $current_real ) = $resolved;
	$manifest_path = $current_real . '/manifest.json';
	if ( ! is_readable( $manifest_path ) ) {
		return null;
	}
	$raw = file_get_contents( $manifest_path );
	$manifest = is_string( $raw ) ? json_decode( $raw, true ) : null;
	if ( ! is_array( $manifest ) || ! ex_public_manifest_is_valid( $manifest, $public_id ) ) {
		return null;
	}

	return array(
		'manifest'     => $manifest,
		'current_real' => $current_real,
	);
}

/**
 * @param string $name Display name.
 * @return string
 */
function ex_public_owner_initials_from_name( $name ) {
	$name = trim( strip_tags( (string) $name ) );
	if ( '' === $name ) {
		return '';
	}
	$parts = preg_split( '/\s+/u', $name );
	if ( ! is_array( $parts ) ) {
		return '';
	}
	$initials = '';
	foreach ( $parts as $part ) {
		$part = trim( (string) $part );
		if ( '' === $part ) {
			continue;
		}
		if ( function_exists( 'mb_substr' ) ) {
			$char = mb_substr( $part, 0, 1, 'UTF-8' );
			$initials .= function_exists( 'mb_strtoupper' ) ? mb_strtoupper( $char, 'UTF-8' ) : strtoupper( $char );
		} else {
			$initials .= strtoupper( substr( $part, 0, 1 ) );
		}
		if ( strlen( $initials ) >= 2 ) {
			break;
		}
	}

	return substr( $initials, 0, 2 );
}

/**
 * @param array<string, mixed> $manifest  Manifest.
 * @param string               $public_id Public id.
 * @param string               $base_url  Site base URL.
 * @param string               $current_real Package dir.
 * @return array<string, mixed>
 */
function ex_public_owner_presentation_from_package( array $manifest, $public_id, $base_url, $current_real ) {
	$raw = isset( $manifest['owner_presentation'] ) && is_array( $manifest['owner_presentation'] )
		? $manifest['owner_presentation']
		: array();

	$display_name = isset( $raw['display_name'] ) ? trim( strip_tags( (string) $raw['display_name'] ) ) : '';

	$vcf_path = ex_public_normalize_path( (string) $current_real . '/vcf-data.json' );
	if ( is_readable( $vcf_path ) ) {
		$vcf_raw  = file_get_contents( $vcf_path );
		$vcf_data = is_string( $vcf_raw ) ? json_decode( $vcf_raw, true ) : null;
		if ( is_array( $vcf_data ) && '' === $display_name ) {
			$display_name = trim( (string) ( $vcf_data['display_name'] ?? $vcf_data['fn'] ?? '' ) );
		}
	}

	$slug    = ex_public_manifest_public_slug( $manifest );
	$segment = '' !== $slug ? $slug : (string) $public_id;
	$photo_rel = '';
	if ( isset( $raw['profile_photo_asset'] ) && is_string( $raw['profile_photo_asset'] ) ) {
		$photo_rel = (string) $raw['profile_photo_asset'];
	} elseif ( isset( $raw['photo_asset'] ) && is_string( $raw['photo_asset'] ) ) {
		$photo_rel = (string) $raw['photo_asset'];
	} elseif ( isset( $raw['switch_thumb_asset'] ) && is_string( $raw['switch_thumb_asset'] ) ) {
		$photo_rel = (string) $raw['switch_thumb_asset'];
	} elseif ( is_readable( $vcf_path ) ) {
		$vcf_raw  = file_get_contents( $vcf_path );
		$vcf_data = is_string( $vcf_raw ) ? json_decode( $vcf_raw, true ) : null;
		if ( is_array( $vcf_data ) && isset( $vcf_data['photo_asset'] ) ) {
			$photo_rel = (string) $vcf_data['photo_asset'];
		}
	}
	$photo_url = '';
	if ( '' !== $photo_rel ) {
		$allowed = ex_public_manifest_asset_path( $manifest, $photo_rel );
		if ( null !== $allowed ) {
			$photo_url = '/' . rawurlencode( $segment ) . '?asset=' . rawurlencode( $allowed );
		}
	}

	$public_url  = rtrim( (string) $base_url, '/' ) . '/' . rawurlencode( $segment );
	$public_host = preg_replace( '#^https?://#i', '', $public_url );
	if ( ! is_string( $public_host ) ) {
		$public_host = '';
	}

	$bg_wrap = ex_public_owner_body_background_from_manifest(
		isset( $raw['background'] ) && is_array( $raw['background'] ) ? $raw['background'] : array(),
		$manifest,
		$segment
	);

	return array(
		'display_name'          => $display_name,
		'photo_url'             => $photo_url,
		'public_url'            => $public_url,
		'public_host'           => $public_host,
		'body_background_style' => isset( $bg_wrap['style'] ) ? (string) $bg_wrap['style'] : '',
		'brand_contrast'        => isset( $bg_wrap['contrast'] ) ? (string) $bg_wrap['contrast'] : 'complex',
	);
}

/**
 * @param string $api_base Core REST base.
 * @param string $endpoint Path after base, e.g. /expresscard/owner/contacts/list.
 * @param string $token    Session token.
 * @return void
 */
function ex_public_owner_bff_proxy_json( $api_base, $endpoint, $token ) {
	header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
	header( 'Pragma: no-cache' );
	if ( '' === $token ) {
		header( 'Content-Type: application/json; charset=UTF-8' );
		http_response_code( 401 );
		echo json_encode( array( 'ok' => false ) );
		exit;
	}
	$raw_body = file_get_contents( 'php://input' );
	$params   = is_string( $raw_body ) ? json_decode( $raw_body, true ) : null;
	if ( ! is_array( $params ) ) {
		$params = array();
	}
	unset( $params['session_token'] );
	$params['session_token'] = $token;
	$response = ex_public_owner_core_post( rtrim( (string) $api_base, '/' ) . $endpoint, $params );
	$code     = $response['http_code'];
	$type     = strtolower( (string) $response['content_type'] );

	if ( '/expresscard/owner/contacts/vcf' === $endpoint ) {
		$json = isset( $response['json'] ) && is_array( $response['json'] )
			? $response['json']
			: array();
		$vcf = isset( $json['vcf'] ) && is_string( $json['vcf'] )
			? $json['vcf']
			: '';

		if ( $code >= 200 && $code < 300 && preg_match( '/\ABEGIN:VCARD(?:\r\n|\n)/', $vcf ) ) {
			header( 'Content-Type: text/vcard; charset=utf-8' );
			header( 'X-Robots-Tag: noindex, nofollow' );
			http_response_code( 200 );
			echo $vcf;
			exit;
		}

		header( 'Content-Type: application/json; charset=UTF-8' );
		http_response_code( $code >= 400 && $code <= 599 ? (int) $code : 502 );
		echo json_encode(
			array(
				'ok'   => false,
				'code' => 'expressar_owner_vcf_unavailable',
			)
		);
		exit;
	}
	if ( false !== strpos( $type, 'text/vcard' ) || false !== strpos( $type, 'text/x-vcard' ) ) {
		header( 'Content-Type: text/vcard; charset=utf-8' );
		header( 'X-Robots-Tag: noindex, nofollow' );
		if ( $code >= 200 && $code < 300 ) {
			http_response_code( $code );
			echo $response['raw'];
		} else {
			http_response_code( $code >= 400 ? $code : 502 );
		}
		exit;
	}
	header( 'Content-Type: application/json; charset=UTF-8' );
	if ( $code >= 200 && $code < 300 ) {
		http_response_code( $code );
		echo json_encode( is_array( $response['json'] ) ? $response['json'] : array() );
		exit;
	}
	http_response_code( $code >= 400 ? $code : 502 );
	echo json_encode( is_array( $response['json'] ) ? $response['json'] : array( 'ok' => false ) );
	exit;
}

/**
 * @param array<string, mixed> $strings Owner dictionary.
 * @return string
 */
function ex_public_owner_busy_shell_markup( array $strings ) {
	$label = ex_public_owner_t( $strings, 'workingLabel', 'Pracujem…' );
	$retry = ex_public_owner_t( $strings, 'bootstrapRetry', 'Skúsiť znova' );
	$noscript = ex_public_owner_t( $strings, 'bootstrapNoScript', 'Na zobrazenie karty je potrebný JavaScript.' );

	return '<div class="ex-excard-busy" data-ex-excard-busy-root hidden role="status" aria-live="polite" aria-hidden="true" aria-label="' . htmlspecialchars( $label, ENT_QUOTES, 'UTF-8' ) . '"><div class="ex-excard-busy__panel"><div class="ex-excard-busy__logo" aria-hidden="true"></div></div></div>'
		. '<p class="ex-public-owner-boot-error" data-ex-owner-boot-error hidden><span data-ex-owner-boot-error-text></span> <button type="button" class="ex-public-owner-app__count-retry" data-ex-owner-boot-retry>' . htmlspecialchars( $retry, ENT_QUOTES, 'UTF-8' ) . '</button></p>'
		. '<noscript><p class="ex-public-owner-boot-noscript">' . htmlspecialchars( $noscript, ENT_QUOTES, 'UTF-8' ) . '</p></noscript>';
}

/**
 * @param array<string, mixed> $config   Site config.
 * @param array<string, mixed> $page_cfg Page boot config for JS.
 * @param string               $title    Document title.
 * @return void
 */
function ex_public_owner_render_boot_shell( array $config, array $page_cfg, $title ) {
	$lang_ctx  = isset( $page_cfg['lang'] ) && is_array( $page_cfg['lang'] ) ? $page_cfg['lang'] : ex_public_owner_resolve_lang();
	$strings   = ex_public_owner_strings( isset( $lang_ctx['dict'] ) ? (string) $lang_ctx['dict'] : 'sk' );
	$frame_css = ex_public_owner_frame_css_href( $config );
	$html_lang = isset( $lang_ctx['html_lang'] ) ? (string) $lang_ctx['html_lang'] : 'sk';
	header( 'Content-Type: text/html; charset=UTF-8' );
	header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
	header( 'Pragma: no-cache' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	echo '<!DOCTYPE html><html lang="' . htmlspecialchars( $html_lang, ENT_QUOTES, 'UTF-8' ) . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' . htmlspecialchars( $title, ENT_QUOTES, 'UTF-8' ) . '</title>' . ex_public_owner_pwa_head_markup() . '<link rel="stylesheet" href="' . htmlspecialchars( $frame_css, ENT_QUOTES, 'UTF-8' ) . '"></head><body class="ex-public-body ex-public-owner-body ex-public-owner-body--boot">';
	echo ex_public_owner_busy_shell_markup( $strings );
	echo '<div data-ex-owner-mount hidden></div>';
	echo '<script type="application/json" id="ex-owner-page-config">';
	echo json_encode(
		$page_cfg,
		JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
	);
	echo '</script><script src="/assets/js/vendor/qrcodegen.js" defer></script><script src="/assets/js/expresscard-owner-public.js" defer></script></body></html>';
	exit;
}

/**
 * @param array<int, mixed>    $cards    Cards from Core.
 * @param array<string, mixed> $lang_ctx Language.
 * @param bool                 $view_cards Hub list mode.
 * @return string|null Redirect path or null.
 */
function ex_public_owner_hub_redirect_target( array $cards, array $lang_ctx, $view_cards ) {
	if ( empty( $cards ) ) {
		if ( '' !== ex_public_owner_pref_from_cookie() ) {
			ex_public_owner_clear_pref_cookie();
		}
		return null;
	}
	if ( 1 === count( $cards ) ) {
		$card = $cards[0];
		if ( is_array( $card ) ) {
			$ref = ex_public_owner_card_route_ref( $card );
			if ( '' !== $ref ) {
				return ex_public_owner_card_screen_url( $ref, $lang_ctx );
			}
		}
	}
	if ( ! $view_cards ) {
		$pref = ex_public_owner_pref_from_cookie();
		if ( '' !== $pref ) {
			foreach ( $cards as $card ) {
				if ( ! is_array( $card ) ) {
					continue;
				}
				$pid  = isset( $card['public_id'] ) ? (string) $card['public_id'] : '';
				$slug = isset( $card['public_slug'] ) && '' !== (string) $card['public_slug'] ? (string) $card['public_slug'] : $pid;
				if ( '' === $slug ) {
					continue;
				}
				if ( $pref === $pid || $pref === $slug ) {
					return ex_public_owner_card_screen_url( ex_public_owner_card_route_ref( $card ), $lang_ctx );
				}
			}
			ex_public_owner_clear_pref_cookie();
		}
	} elseif ( $view_cards ) {
		$pref = ex_public_owner_pref_from_cookie();
		if ( '' !== $pref ) {
			$pref_valid = false;
			foreach ( $cards as $card ) {
				if ( ! is_array( $card ) ) {
					continue;
				}
				$pid  = isset( $card['public_id'] ) ? (string) $card['public_id'] : '';
				$slug = isset( $card['public_slug'] ) && '' !== (string) $card['public_slug'] ? (string) $card['public_slug'] : '';
				if ( $pref === $pid || ( '' !== $slug && $pref === $slug ) ) {
					$pref_valid = true;
					break;
				}
			}
			if ( ! $pref_valid ) {
				ex_public_owner_clear_pref_cookie();
			}
		}
	}
	return null;
}

/**
 * @param array<int, mixed>    $cards    Cards.
 * @param array<string, mixed> $lang_ctx Language.
 * @param array<string, mixed> $strings  i18n.
 * @return string
 */
function ex_public_owner_hub_main_html( array $cards, array $lang_ctx, array $strings ) {
	$hub_query = array_merge( ex_public_owner_query_passthrough(), array( 'view' => 'cards' ) );
	if ( isset( $lang_ctx['route'] ) && '' !== (string) $lang_ctx['route'] ) {
		$hub_query['lang'] = (string) $lang_ctx['route'];
	}
	$html  = ex_public_owner_lang_switcher_markup( $lang_ctx, '/owner/', $hub_query );
	$html .= '<main class="ex-public-owner-activate"><h1>' . htmlspecialchars( ex_public_owner_t( $strings, 'myCards', 'Moje karty' ), ENT_QUOTES, 'UTF-8' ) . '</h1>';
	if ( empty( $cards ) ) {
		$activate_query         = ex_public_owner_query_passthrough();
		$activate_query['lang'] = $lang_ctx['route'];
		$activate_href          = '/owner/activate?' . http_build_query( $activate_query );
		$html .= '<p>' . htmlspecialchars( ex_public_owner_t( $strings, 'hubEmpty', '' ), ENT_QUOTES, 'UTF-8' ) . '</p><p><a href="' . htmlspecialchars( $activate_href, ENT_QUOTES, 'UTF-8' ) . '">' . htmlspecialchars( ex_public_owner_t( $strings, 'activateLink', 'Aktivácia' ), ENT_QUOTES, 'UTF-8' ) . '</a></p>';
		$html .= '<form class="ex-public-owner-renew" id="ex-owner-renew-form"><label>' . htmlspecialchars( ex_public_owner_t( $strings, 'renewEmail', 'E-mail' ), ENT_QUOTES, 'UTF-8' ) . '<input type="email" name="email" required autocomplete="email" /></label><button type="submit">' . htmlspecialchars( ex_public_owner_t( $strings, 'renewSubmit', 'Odoslať' ), ENT_QUOTES, 'UTF-8' ) . '</button><p id="ex-owner-renew-status" hidden="hidden"></p></form>';
	} else {
		$html .= '<ul class="ex-public-owner-hub-list">';
		foreach ( $cards as $card ) {
			if ( ! is_array( $card ) ) {
				continue;
			}
			$ref = ex_public_owner_card_route_ref( $card );
			if ( '' === $ref ) {
				continue;
			}
			$label = isset( $card['label'] ) ? trim( (string) $card['label'] ) : $ref;
			$href  = ex_public_owner_card_screen_url( $ref, $lang_ctx );
			$html .= '<li><a href="' . htmlspecialchars( $href, ENT_QUOTES, 'UTF-8' ) . '">' . htmlspecialchars( $label, ENT_QUOTES, 'UTF-8' ) . '</a></li>';
		}
		$html .= '</ul>';
	}
	$html .= '</main>';
	return $html;
}

/**
 * @param array<string, mixed>|null $editor Core editor payload.
 * @return array<string, mixed>|null
 */
function ex_public_owner_normalize_editor_access_from_core( $editor ) {
	if ( ! is_array( $editor ) || ! array_key_exists( 'can_edit', $editor ) || ! is_bool( $editor['can_edit'] ) ) {
		return null;
	}
	$mode = isset( $editor['mode'] ) ? strtolower( trim( (string) $editor['mode'] ) ) : '';
	if ( $editor['can_edit'] && ! in_array( $mode, array( 'manager', 'delegated' ), true ) ) {
		return null;
	}
	if ( ! $editor['can_edit'] && '' !== $mode ) {
		return null;
	}
	$normalized = array(
		'can_edit' => $editor['can_edit'],
		'mode'     => $mode,
		'edit_url' => isset( $editor['edit_url'] ) ? (string) $editor['edit_url'] : '',
	);
	if ( 'delegated' === $mode && $editor['can_edit'] ) {
		$expires = isset( $editor['expires_at'] ) ? trim( (string) $editor['expires_at'] ) : '';
		if ( '' === $expires || ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $expires ) ) {
			return null;
		}
		$normalized['expires_at'] = $expires;
	}
	if ( 'manager' === $mode && $editor['can_edit'] ) {
		$url = $normalized['edit_url'];
		if ( '' === $url || false === filter_var( $url, FILTER_VALIDATE_URL ) || 0 !== stripos( $url, 'https://expressar.eu/' ) ) {
			return null;
		}
	}
	if ( ! $normalized['can_edit'] ) {
		$normalized['manager_email'] = isset( $editor['manager_email'] ) ? (string) $editor['manager_email'] : '';
	}

	return $normalized;
}

/**
 * @param mixed $raw Raw state string from Core.
 * @return string
 */
function ex_public_owner_normalize_publication_state_key( $raw ) {
	if ( ! is_scalar( $raw ) ) {
		return 'unavailable';
	}
	$state = strtolower( trim( (string) $raw ) );
	if ( '' === $state ) {
		return 'unavailable';
	}
	$state = preg_replace( '/[^a-z0-9_]/', '', $state );

	return '' === $state ? 'unavailable' : $state;
}

/**
 * @param array<string, mixed>|null $raw Core publication_request presentation.
 * @return array<string, mixed>|null
 */
function ex_public_owner_normalize_publication_request_from_core( $raw ) {
	if ( ! is_array( $raw ) ) {
		return null;
	}
	$state = ex_public_owner_normalize_publication_state_key( isset( $raw['state'] ) ? $raw['state'] : '' );
	$allowed = array(
		'synced',
		'no_concept',
		'unpublished',
		'request_stale',
		'request_sent',
		'request_pending',
		'request_mail_failed',
		'unavailable',
	);
	if ( ! in_array( $state, $allowed, true ) ) {
		$state = 'unavailable';
	}
	$out = array( 'state' => $state );
	if ( ! empty( $raw['show_unpublished_notice'] ) ) {
		$out['show_unpublished_notice'] = true;
	}
	if ( ! empty( $raw['can_request'] ) ) {
		$out['can_request'] = true;
	}

	return $out;
}

/**
 * @param array<string, mixed> $boot Core bootstrap row.
 * @return string ok|card_denied|unavailable
 */
function ex_public_owner_bootstrap_card_outcome( array $boot ) {
	if ( ! isset( $boot['card'] ) || ! is_array( $boot['card'] ) ) {
		return 'unavailable';
	}
	$status = isset( $boot['card']['status'] ) ? (string) $boot['card']['status'] : '';
	if ( 'denied' === $status ) {
		return 'card_denied';
	}
	if ( 'ok' !== $status ) {
		return 'unavailable';
	}
	if ( empty( $boot['card']['allowed'] ) ) {
		return 'card_denied';
	}
	if ( ! isset( $boot['editor'] ) || ! is_array( $boot['editor'] ) ) {
		return 'unavailable';
	}
	if ( null === ex_public_owner_normalize_editor_access_from_core( $boot['editor'] ) ) {
		return 'unavailable';
	}

	return 'ok';
}

/**
 * @param array<string, mixed> $config   Site config.
 * @param string               $api_base Core REST base.
 * @param string               $mode     hub|card.
 * @param string               $card_ref Card ref for card mode.
 * @param bool                 $view_cards Hub view=cards.
 * @return array<string, mixed>
 */
function ex_public_owner_bootstrap_payload( array $config, $api_base, $mode, $card_ref = '', $view_cards = false, array $bootstrap_params = array(), &$server_timing = '' ) {
	$total_start = microtime( true );
	$core_ms     = 0.0;
	$package_ms  = 0.0;
	list( $lang_ctx, $setup_homescreen ) = ex_public_owner_bootstrap_lang_setup( $bootstrap_params );
	$strings  = ex_public_owner_strings( $lang_ctx['dict'] );
	$token    = ex_public_owner_session_from_cookie();
	if ( 'card' === $mode && '' === $token ) {
		return array( 'ok' => true, 'redirect' => '/owner/' );
	}
	if ( '' === $token ) {
		return array(
			'ok'      => true,
			'kind'    => 'hub',
			'html'    => ex_public_owner_hub_main_html( array(), $lang_ctx, $strings ),
			'page'    => array(
				'page'                 => 'hub',
				'i18n'                 => $strings,
				'lang'                 => $lang_ctx,
				'setupHomescreenGuide' => $setup_homescreen,
			),
		);
	}
	$core_body = array( 'session_token' => $token );
	$card_ref  = trim( (string) $card_ref );
	if ( 'card' === $mode && '' !== $card_ref && ( ex_public_valid_id( $card_ref ) || ex_public_valid_slug_segment( $card_ref ) ) ) {
		$core_body['card_ref'] = $card_ref;
	}
	$core_start = microtime( true );
	$boot_resp  = ex_public_owner_core_post_state( $api_base . '/expresscard/owner/bootstrap', $core_body, 'bootstrap' );
	$core_ms    = ( microtime( true ) - $core_start ) * 1000;
	if ( 'unavailable' === $boot_resp['state'] ) {
		$server_timing = sprintf( 'core;dur=%.1f, package;dur=0, total;dur=%.1f', $core_ms, ( microtime( true ) - $total_start ) * 1000 );

		return array( 'ok' => false, 'code' => 'core_unavailable' );
	}
	if ( 'session_invalid' === $boot_resp['state'] ) {
		ex_public_owner_clear_session_cookie();
		$server_timing = sprintf( 'core;dur=%.1f, package;dur=0, total;dur=%.1f', $core_ms, ( microtime( true ) - $total_start ) * 1000 );

		return array(
			'ok'   => true,
			'kind' => 'hub',
			'html' => ex_public_owner_hub_main_html( array(), $lang_ctx, $strings ),
			'page' => array(
				'page'                 => 'hub',
				'i18n'                 => $strings,
				'lang'                 => $lang_ctx,
				'setupHomescreenGuide' => $setup_homescreen,
			),
		);
	}
	if ( 'ok' !== $boot_resp['state'] || ! is_array( $boot_resp['data'] ) ) {
		$server_timing = sprintf( 'core;dur=%.1f, package;dur=0, total;dur=%.1f', $core_ms, ( microtime( true ) - $total_start ) * 1000 );

		return array( 'ok' => false, 'code' => 'core_unavailable' );
	}
	$boot  = $boot_resp['data'];
	$cards = $boot['cards'];
	if ( 'hub' === $mode ) {
		$server_timing = sprintf( 'core;dur=%.1f, package;dur=0, total;dur=%.1f', $core_ms, ( microtime( true ) - $total_start ) * 1000 );
		$redirect = ex_public_owner_hub_redirect_target( $cards, $lang_ctx, $view_cards );
		if ( null !== $redirect ) {
			return array( 'ok' => true, 'redirect' => $redirect );
		}
		return array(
			'ok'   => true,
			'kind' => 'hub',
			'html' => ex_public_owner_hub_main_html( $cards, $lang_ctx, $strings ),
			'page' => array(
				'page'                 => 'hub',
				'i18n'                 => $strings,
				'lang'                 => $lang_ctx,
				'setupHomescreenGuide' => $setup_homescreen,
			),
		);
	}
	if ( ! ex_public_valid_id( $card_ref ) && ! ex_public_valid_slug_segment( $card_ref ) ) {
		$server_timing = sprintf( 'core;dur=%.1f, package;dur=0, total;dur=%.1f', $core_ms, ( microtime( true ) - $total_start ) * 1000 );

		return array( 'ok' => true, 'redirect' => '/owner/' );
	}
	$card_outcome = ex_public_owner_bootstrap_card_outcome( $boot );
	if ( 'card_denied' === $card_outcome ) {
		$deny_query = array( 'view' => 'cards' );
		if ( $setup_homescreen ) {
			$deny_query['setup'] = 'homescreen';
		}
		if ( isset( $lang_ctx['route'] ) && '' !== (string) $lang_ctx['route'] ) {
			$deny_query['lang'] = (string) $lang_ctx['route'];
		}
		$server_timing = sprintf( 'core;dur=%.1f, package;dur=0, total;dur=%.1f', $core_ms, ( microtime( true ) - $total_start ) * 1000 );

		return array( 'ok' => true, 'redirect' => '/owner/?' . http_build_query( $deny_query ) );
	}
	if ( 'unavailable' === $card_outcome ) {
		$server_timing = sprintf( 'core;dur=%.1f, package;dur=0, total;dur=%.1f', $core_ms, ( microtime( true ) - $total_start ) * 1000 );

		return array( 'ok' => false, 'code' => 'core_unavailable' );
	}
	$editor_access = ex_public_owner_normalize_editor_access_from_core( $boot['editor'] );
	$publication_request = ex_public_owner_normalize_publication_request_from_core( isset( $boot['publication_request'] ) ? $boot['publication_request'] : null );
	$cards_root = isset( $config['cards_root'] ) ? trim( (string) $config['cards_root'] ) : '';
	$base_url   = isset( $config['public_base_url'] ) ? trim( (string) $config['public_base_url'] ) : '';
	$public_id  = ( '' !== $cards_root ) ? ex_public_owner_resolve_public_id( $card_ref, $cards, $cards_root ) : false;
	$presentation = array(
		'display_name'          => '',
		'photo_url'             => '',
		'public_url'            => '',
		'public_host'           => '',
		'body_background_style' => '',
		'brand_contrast'        => 'complex',
	);
	$resolved_public_id = is_string( $public_id ) ? $public_id : '';
	$package_start      = microtime( true );
	if ( is_string( $public_id ) && '' !== $cards_root && '' !== $base_url ) {
		$package = ex_public_owner_load_package( $cards_root, $public_id );
		if ( is_array( $package ) ) {
			$presentation = ex_public_owner_presentation_from_package(
				$package['manifest'],
				$public_id,
				$base_url,
				$package['current_real']
			);
		}
	}
	if ( '' === $presentation['public_url'] && '' !== $base_url ) {
		$presentation['public_url']  = rtrim( $base_url, '/' ) . '/' . rawurlencode( $card_ref );
		$presentation['public_host'] = preg_replace( '#^https?://#i', '', $presentation['public_url'] );
	}
	$package_ms = ( microtime( true ) - $package_start ) * 1000;
	$parts = ex_public_owner_render_card_screen( $config, $card_ref, $cards, $presentation, $lang_ctx, $resolved_public_id, true, $setup_homescreen, $editor_access, $publication_request );
	if ( ! is_array( $parts ) ) {
		$server_timing = sprintf( 'core;dur=%.1f, package;dur=%.1f, total;dur=%.1f', $core_ms, $package_ms, ( microtime( true ) - $total_start ) * 1000 );

		return array( 'ok' => false, 'code' => 'core_unavailable' );
	}
	$parts['ok']   = true;
	$parts['kind'] = 'card';
	$server_timing = sprintf( 'core;dur=%.1f, package;dur=%.1f, total;dur=%.1f', $core_ms, $package_ms, ( microtime( true ) - $total_start ) * 1000 );

	return $parts;
}

/**
 * @param array<string, mixed> $config       Site config.
 * @param string               $card_ref     Active card ref.
 * @param array<int, mixed>    $cards        Cards list.
 * @param array<string, mixed> $presentation Presentation.
 * @param array<string, string> $lang_ctx    Language context.
 * @param string               $public_id    Canonical public id for exports.
 * @param bool                 $as_parts           Return fragment array instead of emitting document.
 * @param bool|null            $setup_homescreen   Optional setup guide flag (bootstrap POST).
 * @param array<string,mixed>|null $editor_access Prefetched editor-link payload.
 * @param array<string,mixed>|null $publication_request Prefetched publication state.
 * @return array<string, mixed>|void
 */
function ex_public_owner_render_card_screen( array $config, $card_ref, array $cards, array $presentation, array $lang_ctx, $public_id = '', $as_parts = false, $setup_homescreen = null, $editor_access = null, $publication_request = null ) {
	if ( null === $setup_homescreen ) {
		$setup_homescreen = ex_public_owner_setup_hint_active();
	}
	$frame_css  = ex_public_owner_frame_css_href( $config );
	$public_url = isset( $presentation['public_url'] ) ? (string) $presentation['public_url'] : '';
	$strings    = ex_public_owner_strings( isset( $lang_ctx['dict'] ) ? (string) $lang_ctx['dict'] : 'sk' );
	$runtime    = array(
		'card_ref'              => (string) $card_ref,
		'public_id'             => (string) $public_id,
		'cards'                 => $cards,
		'public_url'            => $public_url,
		'lang'                  => $lang_ctx,
		'i18n'                  => $strings,
		'setupHomescreenGuide'  => (bool) $setup_homescreen,
		'api'        => array(
			'session'            => '/owner/api/session',
			'revoke'             => '/owner/api/revoke',
			'contacts_list'      => '/owner/api/contacts/list',
			'contacts_count'     => '/owner/api/contacts/count',
			'contacts_detail'    => '/owner/api/contacts/detail',
			'contacts_read'      => '/owner/api/contacts/read',
			'contacts_note'      => '/owner/api/contacts/note',
			'contacts_processed' => '/owner/api/contacts/processed',
			'contacts_vcf'       => '/owner/api/contacts/vcf',
			'editor_link'        => '/owner/api/editor-link',
			'edit_request'       => '/owner/api/edit-request',
		),
	);
	if ( is_array( $editor_access ) ) {
		$runtime['editor_access'] = $editor_access;
	}
	if ( is_array( $publication_request ) ) {
		$runtime['publication_request'] = $publication_request;
	}
	$display_name = isset( $presentation['display_name'] ) ? (string) $presentation['display_name'] : '';
	$photo_url    = isset( $presentation['photo_url'] ) ? (string) $presentation['photo_url'] : '';
	$multi_cards  = count( $cards ) > 1;
	$html_lang    = isset( $lang_ctx['html_lang'] ) ? (string) $lang_ctx['html_lang'] : 'sk';
	$body_style   = isset( $presentation['body_background_style'] ) ? (string) $presentation['body_background_style'] : '';
	$contrast     = isset( $presentation['brand_contrast'] ) ? (string) $presentation['brand_contrast'] : 'complex';
	if ( ! in_array( $contrast, array( 'light', 'dark', 'complex' ), true ) ) {
		$contrast = 'complex';
	}
	$lang_path = '/owner/card/' . rawurlencode( (string) $card_ref );
	$hub_query = array_merge( ex_public_owner_query_passthrough(), array( 'view' => 'cards' ) );
	if ( isset( $lang_ctx['route'] ) && '' !== (string) $lang_ctx['route'] ) {
		$hub_query['lang'] = (string) $lang_ctx['route'];
	}
	$hub_href = '/owner/?' . http_build_query( $hub_query );

	$body_attr = '' !== $body_style ? ' style="' . htmlspecialchars( $body_style, ENT_QUOTES, 'UTF-8' ) . '"' : '';
	$body_class = 'ex-public-body ex-public-owner-body ex-public-owner-body--card ex-public-owner-contrast--' . $contrast;
	if ( ! $as_parts ) {
		header( 'Content-Type: text/html; charset=UTF-8' );
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Pragma: no-cache' );
		header( 'X-Robots-Tag: noindex, nofollow' );
		echo '<!DOCTYPE html><html lang="' . htmlspecialchars( $html_lang, ENT_QUOTES, 'UTF-8' ) . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' . htmlspecialchars( ex_public_owner_t( $strings, 'pageTitle', 'expressCARD' ), ENT_QUOTES, 'UTF-8' ) . '</title>' . ex_public_owner_pwa_head_markup() . '<link rel="stylesheet" href="' . htmlspecialchars( $frame_css, ENT_QUOTES, 'UTF-8' ) . '"></head><body class="' . htmlspecialchars( $body_class, ENT_QUOTES, 'UTF-8' ) . '"' . $body_attr . '>';
	}
	ob_start();
	echo '<div class="ex-public-owner-app" data-ex-owner-app>';
	echo '<div class="ex-public-owner-app__brand-top" aria-hidden="true"><p class="ex-public-owner-app__brand-mark" lang="en"><span class="ex-public-owner-app__brand-mark-icon" aria-hidden="true"></span><span class="ex-public-owner-app__brand-mark-express">express</span><span class="ex-public-owner-app__brand-mark-card">CARD</span></p></div>';
	echo ex_public_owner_lang_switcher_markup( $lang_ctx, $lang_path, ex_public_owner_query_passthrough() );
	if ( $multi_cards ) {
		echo '<header class="ex-public-owner-app__header"><a class="ex-public-owner-app__hub" href="' . htmlspecialchars( $hub_href, ENT_QUOTES, 'UTF-8' ) . '">' . ex_public_owner_glyph_html( 'cards-switch' ) . '<span>' . htmlspecialchars( ex_public_owner_t( $strings, 'myCards', 'Moje karty' ), ENT_QUOTES, 'UTF-8' ) . '</span></a></header>';
	}
	echo '<main class="ex-public-owner-app__main">';
	if ( $multi_cards ) {
		echo '<section class="ex-public-owner-app__switcher" aria-label="' . htmlspecialchars( ex_public_owner_t( $strings, 'myCards', 'Moje karty' ), ENT_QUOTES, 'UTF-8' ) . '"><div class="ex-public-owner-app__switcher-track" data-ex-owner-switcher>';
		foreach ( $cards as $card ) {
			if ( ! is_array( $card ) ) {
				continue;
			}
			$ref   = ex_public_owner_card_route_ref( $card );
			$label = isset( $card['label'] ) ? trim( (string) $card['label'] ) : $ref;
			if ( '' === $ref ) {
				continue;
			}
			$active = $ref === (string) $card_ref;
			$href   = ex_public_owner_card_screen_url( $ref, $lang_ctx );
			echo '<a class="ex-public-owner-app__switch' . ( $active ? ' is-active' : '' ) . '" href="' . htmlspecialchars( $href, ENT_QUOTES, 'UTF-8' ) . '"' . ( $active ? ' aria-current="page"' : '' ) . '><span class="ex-public-owner-app__switch-tile" aria-hidden="true">' . ex_public_owner_glyph_html( 'cards-switch' ) . '</span><span class="ex-public-owner-app__switch-label">' . htmlspecialchars( $label, ENT_QUOTES, 'UTF-8' ) . '</span></a>';
		}
		echo '</div></section>';
	}
	echo '<section class="ex-public-owner-app__identity" aria-labelledby="ex-owner-display-name">';
	if ( '' !== $photo_url ) {
		echo '<div class="ex-public-owner-app__photo"><img src="' . htmlspecialchars( $photo_url, ENT_QUOTES, 'UTF-8' ) . '" alt="" width="120" height="120" decoding="async"></div>';
	}
	echo '<h1 class="ex-public-owner-app__name" id="ex-owner-display-name">' . htmlspecialchars( $display_name, ENT_QUOTES, 'UTF-8' ) . '</h1>';
	echo '</section>';
	echo '<p class="ex-public-owner-app__publication-state" data-ex-owner-publication-state hidden></p>';
	echo '<nav class="ex-public-owner-app__actions" aria-label="' . htmlspecialchars( ex_public_owner_t( $strings, 'pageTitle', 'expressCARD' ), ENT_QUOTES, 'UTF-8' ) . '">';
	echo '<button type="button" class="ex-public-owner-app__action ex-public-owner-app__action--primary" data-ex-owner-open-qr>' . ex_public_owner_glyph_html( 'qr' ) . '<span>' . htmlspecialchars( ex_public_owner_t( $strings, 'actionQr', 'QR kód' ), ENT_QUOTES, 'UTF-8' ) . '</span></button>';
	echo '<button type="button" class="ex-public-owner-app__action" data-ex-owner-share>' . ex_public_owner_glyph_html( 'share' ) . '<span>' . ex_public_owner_label_with_brand_html( $strings, 'actionSharePrefix', 'Zdieľať ', 'actionShareSuffix', '' ) . '</span></button>';
	echo '<button type="button" class="ex-public-owner-app__action ex-public-owner-app__action--contacts" data-ex-owner-contacts>' . ex_public_owner_glyph_html( 'contacts' ) . '<span>' . htmlspecialchars( ex_public_owner_t( $strings, 'actionContacts', 'Kontakty' ), ENT_QUOTES, 'UTF-8' ) . '</span><span class="ex-public-owner-app__badge" data-ex-owner-unread hidden>0</span></button>';
	echo '<button type="button" class="ex-public-owner-app__action" data-ex-owner-manage hidden>' . ex_public_owner_glyph_html( 'edit' ) . '<span data-ex-owner-manage-label="1">' . ex_public_owner_label_with_brand_html( $strings, 'actionEditPrefix', 'Upraviť ', 'actionEditSuffix', '' ) . '</span></button>';
	echo '</nav>';
	echo '<p class="ex-public-owner-app__edit-request" data-ex-owner-edit-request hidden></p>';
	echo '<nav class="ex-public-owner-app__service" aria-label="' . htmlspecialchars( ex_public_owner_t( $strings, 'actionHomescreen', 'Pridať na plochu' ), ENT_QUOTES, 'UTF-8' ) . '"><button type="button" class="ex-public-owner-app__homescreen-link" data-ex-owner-homescreen>' . ex_public_owner_glyph_html( 'home-screen' ) . '<span data-ex-owner-homescreen-label>' . htmlspecialchars( ex_public_owner_t( $strings, 'actionHomescreen', 'Pridať na plochu' ), ENT_QUOTES, 'UTF-8' ) . '</span></button></nav>';
	echo '<footer class="ex-public-owner-app__footer"><button type="button" class="ex-public-owner-app__logout-link" data-ex-owner-logout>' . htmlspecialchars( ex_public_owner_t( $strings, 'logoutLink', 'Odhlásiť toto zariadenie' ), ENT_QUOTES, 'UTF-8' ) . '</button></footer>';
	echo '<p class="ex-public-owner-app__count-error" data-ex-owner-count-error hidden><span data-ex-owner-count-error-text></span> <button type="button" class="ex-public-owner-app__count-retry" data-ex-owner-count-retry>' . htmlspecialchars( ex_public_owner_t( $strings, 'countRetry', 'Skúsiť znova' ), ENT_QUOTES, 'UTF-8' ) . '</button></p>';
	echo '<p class="ex-public-owner-app__live" data-ex-owner-live role="status" aria-live="polite"></p>';
	echo '</main>';
	echo '<div class="ex-public-owner-app__brand-footer" aria-hidden="true"><span class="ex-public-owner-app__brand-footer-icon"></span></div>';
	echo '<div class="ex-public-owner-logout-dialog" data-ex-owner-logout-dialog hidden><div class="ex-public-owner-logout-dialog__card" role="dialog" aria-modal="true" aria-labelledby="ex-owner-logout-title"><div class="ex-public-owner-app__panel-head ex-public-owner-logout-dialog__head"><h2 class="ex-public-owner-logout-dialog__title" id="ex-owner-logout-title">' . htmlspecialchars( ex_public_owner_t( $strings, 'logoutConfirmTitle', 'Odhlásenie' ), ENT_QUOTES, 'UTF-8' ) . '</h2>' . ex_public_owner_modal_close_btn_html( $strings, 'data-ex-owner-logout-close' ) . '</div><p class="ex-public-owner-logout-dialog__text">' . htmlspecialchars( ex_public_owner_t( $strings, 'logoutConfirmMessage', 'Naozaj chcete odhlásiť toto zariadenie?' ), ENT_QUOTES, 'UTF-8' ) . '</p><div class="ex-public-owner-logout-dialog__actions"><button type="button" class="ex-public-owner-logout-dialog__confirm" data-ex-owner-logout-confirm>' . htmlspecialchars( ex_public_owner_t( $strings, 'logoutConfirmSubmit', 'Odhlásiť toto zariadenie' ), ENT_QUOTES, 'UTF-8' ) . '</button></div></div></div>';
	echo '<div class="ex-public-owner-logout-dialog" data-ex-owner-edit-request-dialog hidden><div class="ex-public-owner-logout-dialog__card" role="dialog" aria-modal="true" aria-labelledby="ex-owner-edit-request-title"><div class="ex-public-owner-app__panel-head ex-public-owner-logout-dialog__head"><h2 class="ex-public-owner-logout-dialog__title" id="ex-owner-edit-request-title">' . htmlspecialchars( ex_public_owner_t( $strings, 'editRequestModalTitle', 'Požiadať o prístup na úpravu' ), ENT_QUOTES, 'UTF-8' ) . '</h2>' . ex_public_owner_modal_close_btn_html( $strings, 'data-ex-owner-edit-request-close' ) . '</div><p class="ex-public-owner-logout-dialog__text">' . htmlspecialchars( ex_public_owner_t( $strings, 'editRequestConfirm', 'Chcete požiadať správcu kariet o prístup na úpravu?' ), ENT_QUOTES, 'UTF-8' ) . '</p><div class="ex-public-owner-logout-dialog__actions"><button type="button" class="ex-public-owner-logout-dialog__confirm" data-ex-owner-edit-request-confirm>' . htmlspecialchars( ex_public_owner_t( $strings, 'editRequestModalSubmit', 'Odoslať žiadosť' ), ENT_QUOTES, 'UTF-8' ) . '</button></div></div></div>';
	echo '<script type="application/json" id="ex-owner-app-config">';
	echo json_encode(
		$runtime,
		JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
	);
	echo '</script>';
	echo '<div class="ex-public-owner-panel" data-ex-owner-panel="qr" hidden><div class="ex-public-owner-panel__card ex-public-owner-app__panel ex-public-owner-app__panel--qr"><div class="ex-public-owner-app__panel-head"><h2>' . htmlspecialchars( ex_public_owner_t( $strings, 'qrPanelTitle', 'QR kód' ), ENT_QUOTES, 'UTF-8' ) . '</h2>' . ex_public_owner_modal_close_btn_html( $strings, 'data-ex-owner-panel-close' ) . '</div><p class="ex-public-owner-app__qr-name">' . htmlspecialchars( $display_name, ENT_QUOTES, 'UTF-8' ) . '</p><div class="ex-public-owner-app__qr-box" data-ex-owner-qr></div><button type="button" class="ex-public-owner-app__action ex-public-owner-app__action--download" data-ex-owner-download-qr>' . ex_public_owner_glyph_html( 'qr-download' ) . '<span>' . htmlspecialchars( ex_public_owner_t( $strings, 'downloadQr', 'Stiahnuť QR kód' ), ENT_QUOTES, 'UTF-8' ) . '</span></button></div></div>';
	echo '<div class="ex-public-owner-panel" data-ex-owner-panel="export" hidden><div class="ex-public-owner-panel__card ex-public-owner-app__panel"><div class="ex-public-owner-app__panel-head"><h2>' . htmlspecialchars( ex_public_owner_t( $strings, 'downloadQr', 'Stiahnuť QR kód' ), ENT_QUOTES, 'UTF-8' ) . '</h2>' . ex_public_owner_modal_close_btn_html( $strings, 'data-ex-owner-export-close' ) . '</div><button type="button" class="ex-public-owner-app__action" data-ex-owner-export-png>' . ex_public_owner_glyph_html( 'qr-png' ) . '<span>' . htmlspecialchars( ex_public_owner_t( $strings, 'downloadPng', 'Stiahnuť PNG' ), ENT_QUOTES, 'UTF-8' ) . '</span></button><button type="button" class="ex-public-owner-app__action" data-ex-owner-export-svg>' . ex_public_owner_glyph_html( 'qr-svg' ) . '<span>' . htmlspecialchars( ex_public_owner_t( $strings, 'downloadSvg', 'Stiahnuť SVG' ), ENT_QUOTES, 'UTF-8' ) . '</span></button></div></div>';
	echo '<div class="ex-public-owner-panel" data-ex-owner-panel="share" hidden><div class="ex-public-owner-panel__card ex-public-owner-app__panel"><div class="ex-public-owner-app__panel-head"><h2>' . ex_public_owner_label_with_brand_html( $strings, 'actionSharePrefix', 'Zdieľať ', 'actionShareSuffix', '' ) . '</h2>' . ex_public_owner_modal_close_btn_html( $strings, 'data-ex-owner-panel-close' ) . '</div><p class="ex-public-owner-app__share-hint" data-ex-owner-share-hint hidden></p><label class="ex-public-owner-app__share-label">' . htmlspecialchars( ex_public_owner_t( $strings, 'shareManualLabel', 'Verejný odkaz' ), ENT_QUOTES, 'UTF-8' ) . '<input type="text" class="ex-public-owner-app__share-field" data-ex-owner-share-field readonly></label></div></div>';
	echo '<div class="ex-public-owner-panel" data-ex-owner-panel="contacts" hidden><div class="ex-public-owner-panel__card ex-public-owner-app__panel"><div class="ex-public-owner-app__panel-head"><h2>' . htmlspecialchars( ex_public_owner_t( $strings, 'contactsTitle', 'Kontakty' ), ENT_QUOTES, 'UTF-8' ) . '</h2>' . ex_public_owner_modal_close_btn_html( $strings, 'data-ex-owner-panel-close' ) . '</div><ul class="ex-public-owner-app__contact-list" data-ex-owner-contact-list></ul><p class="ex-public-owner-app__contact-more-wrap" hidden><button type="button" class="ex-public-owner-app__contact-more" data-ex-owner-contacts-more>' . htmlspecialchars( ex_public_owner_t( $strings, 'contactsLoadMore', 'Načítať ďalšie' ), ENT_QUOTES, 'UTF-8' ) . '</button></p></div></div>';
	echo '<div class="ex-public-owner-panel" data-ex-owner-panel="detail" hidden><div class="ex-public-owner-panel__card ex-public-owner-app__panel ex-public-owner-app__panel--detail"><div class="ex-public-owner-app__panel-head"><button type="button" class="ex-public-owner-app__detail-back" data-ex-owner-detail-back>' . htmlspecialchars( ex_public_owner_t( $strings, 'back', 'Späť' ), ENT_QUOTES, 'UTF-8' ) . '</button><h2 data-ex-owner-detail-name>' . htmlspecialchars( ex_public_owner_t( $strings, 'contactDefault', 'Kontakt' ), ENT_QUOTES, 'UTF-8' ) . '</h2>' . ex_public_owner_modal_close_btn_html( $strings, 'data-ex-owner-panel-close' ) . '</div><div class="ex-public-owner-app__detail" data-ex-owner-detail></div><div class="ex-public-owner-app__detail-actions"><button type="button" data-ex-owner-mark-read>' . htmlspecialchars( ex_public_owner_t( $strings, 'markRead', 'Označiť prečítané' ), ENT_QUOTES, 'UTF-8' ) . '</button><button type="button" data-ex-owner-mark-processed>' . htmlspecialchars( ex_public_owner_t( $strings, 'markProcessed', 'Vybavené' ), ENT_QUOTES, 'UTF-8' ) . '</button><button type="button" data-ex-owner-download-vcf>' . htmlspecialchars( ex_public_owner_t( $strings, 'downloadVcf', 'Stiahnuť VCF' ), ENT_QUOTES, 'UTF-8' ) . '</button></div><label class="ex-public-owner-app__note-label">' . htmlspecialchars( ex_public_owner_t( $strings, 'noteLabel', 'Poznámka' ), ENT_QUOTES, 'UTF-8' ) . '<textarea rows="3" data-ex-owner-note></textarea></label><button type="button" class="ex-public-owner-app__note-save" data-ex-owner-save-note>' . htmlspecialchars( ex_public_owner_t( $strings, 'noteSave', 'Uložiť poznámku' ), ENT_QUOTES, 'UTF-8' ) . '</button></div></div>';
	echo '<div class="ex-public-owner-panel" data-ex-owner-panel="homescreen" hidden><div class="ex-public-owner-panel__card ex-public-owner-app__panel ex-public-owner-app__panel--homescreen"><div class="ex-public-owner-app__panel-head"><h2>' . htmlspecialchars( ex_public_owner_t( $strings, 'homescreenGuideTitle', 'Pridať na plochu' ), ENT_QUOTES, 'UTF-8' ) . '</h2>' . ex_public_owner_modal_close_btn_html( $strings, 'data-ex-owner-panel-close' ) . '</div><p class="ex-public-owner-app__homescreen-intro">' . htmlspecialchars( ex_public_owner_t( $strings, 'homescreenGuideIntro', '' ), ENT_QUOTES, 'UTF-8' ) . '</p><ol class="ex-public-owner-app__homescreen-steps" data-ex-owner-homescreen-steps></ol></div></div>';
	$inner_html = ob_get_clean();
	if ( $as_parts ) {
		return array(
			'html'       => $inner_html,
			'runtime'    => $runtime,
			'body_class' => $body_class,
			'body_attr'  => $body_attr,
			'body_style' => $body_style,
		);
	}
	echo $inner_html;
	echo '<script src="/assets/js/vendor/qrcodegen.js" defer></script><script src="/assets/js/expresscard-owner-public.js" defer></script></body></html>';
	exit;
}

/**
 * @return string
 */
function ex_public_owner_session_from_cookie() {
	if ( ! isset( $_COOKIE[ EX_PUBLIC_OWNER_COOKIE ] ) || ! is_string( $_COOKIE[ EX_PUBLIC_OWNER_COOKIE ] ) ) {
		return '';
	}
	$token = strtolower( (string) $_COOKIE[ EX_PUBLIC_OWNER_COOKIE ] );
	if ( ! preg_match( '/^[a-f0-9]{64}$/', $token ) ) {
		return '';
	}

	return $token;
}

/**
 * @return string Sanitized public_id preference (non-authoritative).
 */
function ex_public_owner_pref_from_cookie() {
	if ( ! isset( $_COOKIE[ EX_PUBLIC_OWNER_PREF_COOKIE ] ) || ! is_string( $_COOKIE[ EX_PUBLIC_OWNER_PREF_COOKIE ] ) ) {
		return '';
	}
	$pref = trim( (string) $_COOKIE[ EX_PUBLIC_OWNER_PREF_COOKIE ] );
	if ( ex_public_valid_id( $pref ) || ex_public_valid_slug_segment( $pref ) ) {
		return $pref;
	}

	return '';
}

/**
 * @return void
 */
function ex_public_owner_clear_pref_cookie() {
	setcookie(
		EX_PUBLIC_OWNER_PREF_COOKIE,
		'',
		array(
			'expires'  => time() - 3600,
			'path'     => '/',
			'secure'   => ex_public_owner_cookie_secure(),
			'httponly' => false,
			'samesite' => 'Lax',
		)
	);
}

/**
 * @return string
 */
function ex_public_owner_challenge_from_cookie() {
	if ( ! isset( $_COOKIE[ EX_PUBLIC_OWNER_CHALLENGE_COOKIE ] ) || ! is_string( $_COOKIE[ EX_PUBLIC_OWNER_CHALLENGE_COOKIE ] ) ) {
		return '';
	}
	$challenge = strtolower( (string) $_COOKIE[ EX_PUBLIC_OWNER_CHALLENGE_COOKIE ] );
	if ( ! preg_match( '/^[a-f0-9]{32}$/', $challenge ) ) {
		return '';
	}

	return $challenge;
}

/**
 * @param string $challenge Challenge hex.
 * @return void
 */
function ex_public_owner_set_challenge_cookie( $challenge ) {
	$challenge = strtolower( (string) $challenge );
	if ( ! preg_match( '/^[a-f0-9]{32}$/', $challenge ) ) {
		return;
	}
	setcookie(
		EX_PUBLIC_OWNER_CHALLENGE_COOKIE,
		$challenge,
		array(
			'expires'  => time() + 600,
			'path'     => '/',
			'secure'   => ex_public_owner_cookie_secure(),
			'httponly' => true,
			'samesite' => 'Strict',
		)
	);
}

/**
 * @return void
 */
function ex_public_owner_clear_challenge_cookie() {
	setcookie(
		EX_PUBLIC_OWNER_CHALLENGE_COOKIE,
		'',
		array(
			'expires'  => time() - 3600,
			'path'     => '/',
			'secure'   => ex_public_owner_cookie_secure(),
			'httponly' => true,
			'samesite' => 'Strict',
		)
	);
}

/**
 * @return bool
 */
function ex_public_owner_request_origin_ok() {
	$origin = isset( $_SERVER['HTTP_ORIGIN'] ) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
	if ( '' === $origin ) {
		return true;
	}

	return 'https://expresscard.eu' === $origin;
}

/**
 * Parse Core session expires_at (UTC mysql) to unix time for Set-Cookie.
 *
 * @param string $expires_at Core expires_at.
 * @return int 0 when invalid or already expired.
 */
function ex_public_owner_session_cookie_expires_unix( $expires_at ) {
	$expires_at = trim( (string) $expires_at );
	if ( ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $expires_at ) ) {
		return 0;
	}
	try {
		$zone = new DateTimeZone( 'UTC' );
		$dt   = DateTimeImmutable::createFromFormat( 'Y-m-d H:i:s', $expires_at, $zone );
	} catch ( Exception $e ) {
		return 0;
	}
	if ( ! ( $dt instanceof DateTimeImmutable ) || $dt->format( 'Y-m-d H:i:s' ) !== $expires_at ) {
    return 0;
	}
	$unix = (int) $dt->getTimestamp();
	if ( $unix <= time() ) {
		return 0;
	}

	return $unix;
}

/**
 * @param string $token      Raw session token.
 * @param string $expires_at Core session absolute expiry (UTC Y-m-d H:i:s).
 * @return bool True when cookie was set.
 */
function ex_public_owner_set_session_cookie( $token, $expires_at = '' ) {
	$token = strtolower( (string) $token );
	if ( ! preg_match( '/^[a-f0-9]{64}$/', $token ) ) {
		return false;
	}
	if ( ! ex_public_owner_cookie_secure() ) {
		return false;
	}
	$expires_unix = ex_public_owner_session_cookie_expires_unix( $expires_at );
	if ( $expires_unix < 1 ) {
		return false;
	}
	return setcookie(
		EX_PUBLIC_OWNER_COOKIE,
		$token,
		array(
			'expires'  => $expires_unix,
			'path'     => '/',
			'secure'   => true,
			'httponly' => true,
			'samesite' => 'Lax',
		)
	);
}

/**
 * @return void
 */
function ex_public_owner_clear_session_cookie() {
	setcookie(
		EX_PUBLIC_OWNER_COOKIE,
		'',
		array(
			'expires'  => time() - 3600,
			'path'     => '/',
			'secure'   => ex_public_owner_cookie_secure(),
			'httponly' => true,
			'samesite' => 'Lax',
		)
	);
}

/**
 * @param string               $path_entry Normalized path without leading slash.
 * @param array<string, mixed> $config     Publication config.
 * @return void
 */
function ex_public_owner_dispatch( $path_entry, array $config ) {
	$path_entry = strtolower( trim( (string) $path_entry, '/' ) );
	$api_base   = ex_public_owner_core_api_base( $config );
	$method     = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( (string) $_SERVER['REQUEST_METHOD'] ) : 'GET';

	if ( 'owner/app.webmanifest' === $path_entry && 'GET' === $method ) {
		$origin = ex_public_owner_site_origin( $config );
		header( 'Content-Type: application/manifest+json; charset=UTF-8' );
		header( 'Cache-Control: public, max-age=3600' );
		$manifest = array(
			'id'                            => '/owner/',
			'name'                          => 'expressCARD',
			'short_name'                    => 'expressCARD',
			'start_url'                     => '/owner/',
			'scope'                         => '/owner/',
			'display'                       => 'standalone',
			'prefer_related_applications'   => false,
			'icons'                         => array(
				array(
					'src'     => $origin . '/images/expresscard-home-192.png',
					'sizes'   => '192x192',
					'type'    => 'image/png',
					'purpose' => 'any',
				),
				array(
					'src'     => $origin . '/images/expresscard-home-512.png',
					'sizes'   => '512x512',
					'type'    => 'image/png',
					'purpose' => 'any',
				),
			),
		);
		echo json_encode( $manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		exit;
	}

	if ( 'owner/activate' === $path_entry && 'POST' === $method ) {
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Pragma: no-cache' );
		header( 'Referrer-Policy: no-referrer' );
		header( 'Content-Type: application/json; charset=UTF-8' );
		if ( ! ex_public_owner_request_origin_ok() ) {
			http_response_code( 403 );
			echo json_encode( array( 'ok' => false ) );
			exit;
		}
		$raw_body = file_get_contents( 'php://input' );
		$params   = is_string( $raw_body ) ? json_decode( $raw_body, true ) : null;
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$challenge_body = isset( $params['browser_challenge'] ) ? strtolower( (string) $params['browser_challenge'] ) : '';
		$challenge_cookie = ex_public_owner_challenge_from_cookie();
		if ( '' === $challenge_body || '' === $challenge_cookie || $challenge_body !== $challenge_cookie ) {
			http_response_code( 403 );
			echo json_encode( array( 'ok' => false ) );
			exit;
		}
		$secret = isset( $params['activation_secret'] ) ? (string) $params['activation_secret'] : '';
		if ( ! preg_match( '/^[a-f0-9]{64}$/i', $secret ) ) {
			http_response_code( 400 );
			echo json_encode( array( 'ok' => false ) );
			exit;
		}
		$device = isset( $params['device_label'] ) ? (string) $params['device_label'] : 'Zariadenie';
		$core_body = array(
			'activation_secret' => strtolower( $secret ),
			'device_label'      => $device,
		);
		$existing_session = ex_public_owner_session_from_cookie();
		if ( is_string( $existing_session ) && preg_match( '/^[a-f0-9]{64}$/i', $existing_session ) ) {
			$core_body['session_token'] = strtolower( $existing_session );
		}
		$core_response = ex_public_owner_core_post( $api_base . '/expresscard/owner/activate', $core_body );
		ex_public_owner_clear_challenge_cookie();
		$http_code = (int) $core_response['http_code'];
		$core_json = is_array( $core_response['json'] ) ? $core_response['json'] : null;
		if ( $http_code >= 200 && $http_code < 300 && is_array( $core_json ) && ! empty( $core_json['session_token'] ) && preg_match( '/^[a-f0-9]{64}$/', strtolower( (string) $core_json['session_token'] ) ) ) {
			$core_expires = isset( $core_json['expires_at'] ) ? (string) $core_json['expires_at'] : '';
			if ( ! ex_public_owner_set_session_cookie( (string) $core_json['session_token'], $core_expires ) ) {
				http_response_code( 502 );
				echo json_encode( array( 'ok' => false ) );
				exit;
			}
			echo json_encode( array( 'ok' => true, 'redirect' => '/owner/' ) );
			exit;
		}
		$out_code = 400;
		if ( $http_code >= 400 && $http_code < 600 ) {
			$out_code = $http_code;
		}
		$payload = array( 'ok' => false );
		if ( is_array( $core_json ) && isset( $core_json['code'] ) && is_string( $core_json['code'] ) ) {
			$payload['code'] = $core_json['code'];
		}
		http_response_code( $out_code );
		echo json_encode( $payload );
		exit;
	}

	if ( 'owner/api/revoke' === $path_entry && 'POST' === $method ) {
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Content-Type: application/json; charset=UTF-8' );
		if ( ! ex_public_owner_request_origin_ok() ) {
			http_response_code( 403 );
			echo json_encode( array( 'ok' => false, 'message' => 'Požiadavka bola odmietnutá.' ) );
			exit;
		}
		$token   = ex_public_owner_session_from_cookie();
		$revoked = false;
		if ( '' !== $token ) {
			$response = ex_public_owner_core_post_json( $api_base . '/expresscard/owner/session/revoke', array( 'session_token' => $token ) );
			$revoked  = is_array( $response ) && ! empty( $response['revoked'] );
		}
		ex_public_owner_clear_session_cookie();
		if ( '' !== $token && ! $revoked ) {
			echo json_encode(
				array(
					'ok'      => false,
					'message' => 'Zariadenie bolo odhlásené lokálne. Serverové odvolanie sa nepodarilo potvrdiť.',
				)
			);
			exit;
		}
		echo json_encode( array( 'ok' => true ) );
		exit;
	}

	if ( 'owner/api/bootstrap' === $path_entry && 'POST' === $method ) {
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Content-Type: application/json; charset=UTF-8' );
		if ( ! ex_public_owner_request_origin_ok() ) {
			http_response_code( 403 );
			echo json_encode( array( 'ok' => false ) );
			exit;
		}
		$raw_body = file_get_contents( 'php://input' );
		$params   = is_string( $raw_body ) ? json_decode( $raw_body, true ) : null;
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$mode = isset( $params['mode'] ) ? strtolower( trim( (string) $params['mode'] ) ) : 'hub';
		if ( 'card' !== $mode ) {
			$mode = 'hub';
		}
		$card_ref   = isset( $params['card_ref'] ) ? trim( (string) $params['card_ref'] ) : '';
		$view_cards = ! empty( $params['view_cards'] );
		$server_timing = '';
		$result        = ex_public_owner_bootstrap_payload( $config, $api_base, $mode, $card_ref, $view_cards, $params, $server_timing );
		if ( '' !== $server_timing ) {
			header( 'Server-Timing: ' . $server_timing );
		}
		if ( empty( $result['ok'] ) ) {
			http_response_code( 503 );
		}
		echo json_encode( $result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
		exit;
	}

	if ( 'owner/api/session' === $path_entry && 'POST' === $method ) {
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Content-Type: application/json; charset=UTF-8' );
		if ( ! ex_public_owner_request_origin_ok() ) {
			http_response_code( 403 );
			echo json_encode( array( 'valid' => false ) );
			exit;
		}
		$raw_body = file_get_contents( 'php://input' );
		$params   = is_string( $raw_body ) ? json_decode( $raw_body, true ) : null;
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$token = ex_public_owner_session_from_cookie();
		$card_ref_raw = isset( $params['card_ref'] ) ? trim( (string) $params['card_ref'] ) : '';
		$card_ref     = '';
		if ( ex_public_valid_id( $card_ref_raw ) || ex_public_valid_slug_segment( $card_ref_raw ) ) {
			$card_ref = $card_ref_raw;
		}
		$payload = ex_public_owner_session_api_payload( $api_base, $token, $card_ref );
		echo json_encode( $payload );
		exit;
	}

	$owner_bff_contacts = array(
		'owner/api/contacts/list'       => '/expresscard/owner/contacts/list',
		'owner/api/contacts/count'      => '/expresscard/owner/contacts/count',
		'owner/api/contacts/detail'     => '/expresscard/owner/contacts/detail',
		'owner/api/contacts/read'       => '/expresscard/owner/contacts/read',
		'owner/api/contacts/note'       => '/expresscard/owner/contacts/note',
		'owner/api/contacts/processed'  => '/expresscard/owner/contacts/processed',
		'owner/api/contacts/vcf'        => '/expresscard/owner/contacts/vcf',
		'owner/api/editor-link'         => '/expresscard/owner/editor-link',
		'owner/api/edit-request'        => '/expresscard/owner/edit-request',
	);
	if ( isset( $owner_bff_contacts[ $path_entry ] ) && 'POST' === $method ) {
		if ( ! ex_public_owner_request_origin_ok() ) {
			header( 'Content-Type: application/json; charset=UTF-8' );
			http_response_code( 403 );
			echo json_encode( array( 'ok' => false ) );
			exit;
		}
		ex_public_owner_bff_proxy_json( $api_base, $owner_bff_contacts[ $path_entry ], ex_public_owner_session_from_cookie() );
	}

	if ( 'owner/api/renew' === $path_entry && 'POST' === $method ) {
		header( 'Content-Type: application/json; charset=UTF-8' );
		$raw_body = file_get_contents( 'php://input' );
		$params   = is_string( $raw_body ) ? json_decode( $raw_body, true ) : null;
		$email    = is_array( $params ) && isset( $params['email'] ) ? (string) $params['email'] : '';
		$result   = ex_public_owner_core_post_json( $api_base . '/expresscard/owner/renew', array( 'email' => $email ) );
		echo json_encode( is_array( $result ) ? $result : array( 'message' => 'Ak je e-mail evidovaný a máte pridelený prístup, pošleme odkaz na obnovu.' ) );
		exit;
	}

	if ( 'owner/activate' === $path_entry && 'GET' === $method ) {
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Pragma: no-cache' );
		header( 'Referrer-Policy: no-referrer' );
		header( 'Content-Type: text/html; charset=UTF-8' );
		$frame_css = ex_public_owner_frame_css_href( $config );
		try {
			$challenge = bin2hex( random_bytes( 16 ) );
		} catch ( Exception $e ) {
			ex_public_fail( 503, 'Aktivácia nie je dostupná.' );
		}
		ex_public_owner_set_challenge_cookie( $challenge );
		$lang_ctx = ex_public_owner_resolve_lang();
		$strings  = ex_public_owner_strings( $lang_ctx['dict'] );
		$i18n_all = array();
		foreach ( array_keys( ex_public_owner_lang_route_map() ) as $route_key ) {
			$i18n_all[ $route_key ] = ex_public_owner_strings( $route_key );
		}
		$page_cfg = array(
			'page'     => 'activate',
			'i18n'     => $strings,
			'i18nAll'  => $i18n_all,
			'lang'     => $lang_ctx,
			'inpageLang' => true,
		);
		echo '<!DOCTYPE html><html lang="' . htmlspecialchars( $lang_ctx['html_lang'], ENT_QUOTES, 'UTF-8' ) . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . htmlspecialchars( ex_public_owner_t( $strings, 'activateTitle', 'Aktivácia' ), ENT_QUOTES, 'UTF-8' ) . '</title>' . ex_public_owner_pwa_head_markup() . '<link rel="stylesheet" href="' . htmlspecialchars( $frame_css, ENT_QUOTES, 'UTF-8' ) . '"></head><body class="ex-public-body ex-public-owner-body">';
		echo ex_public_owner_busy_shell_markup( $strings );
		echo '<main class="ex-public-owner-activate" data-ex-owner-challenge="' . htmlspecialchars( $challenge, ENT_QUOTES, 'UTF-8' ) . '">';
		echo ex_public_owner_lang_switcher_markup( $lang_ctx, '/owner/activate', array(), true );
		echo '<h1>' . htmlspecialchars( ex_public_owner_t( $strings, 'activateTitle', 'Aktivácia prístupu' ), ENT_QUOTES, 'UTF-8' ) . '</h1><p>' . htmlspecialchars( ex_public_owner_t( $strings, 'activateIntro', '' ), ENT_QUOTES, 'UTF-8' ) . '</p><button type="button" id="ex-owner-activate-btn">' . htmlspecialchars( ex_public_owner_t( $strings, 'activateBtn', 'Aktivovať' ), ENT_QUOTES, 'UTF-8' ) . '</button><p id="ex-owner-activate-status" hidden="hidden"></p></main>';
		echo '<script type="application/json" id="ex-owner-page-config">';
		echo json_encode(
			$page_cfg,
			JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
		);
		echo '</script>';
		echo '<script>(function(){var h=String(location.hash||"").replace(/^#/,"");try{h=decodeURIComponent(h);}catch(e){}window.__exOwnerActivationSecret=h||"";if(history.replaceState){history.replaceState(null,document.title,location.pathname+location.search);}})();</script><script src="/assets/js/expresscard-owner-public.js" defer></script></body></html>';
		exit;
	}

	if ( preg_match( '#^owner/card/([^/]+)$#', $path_entry, $owner_card_match ) && 'GET' === $method ) {
		$card_ref = rawurldecode( (string) $owner_card_match[1] );
		if ( ! ex_public_valid_id( $card_ref ) && ! ex_public_valid_slug_segment( $card_ref ) ) {
			ex_public_fail( 404, 'Karta nebola nájdená.' );
		}
		if ( '' === ex_public_owner_session_from_cookie() ) {
			header( 'Location: /owner/', true, 302 );
			exit;
		}
		$lang_ctx = ex_public_owner_resolve_lang();
		$strings  = ex_public_owner_strings( $lang_ctx['dict'] );
		$page_cfg = array(
			'page'                 => 'boot-card',
			'mode'                 => 'card',
			'card_ref'             => $card_ref,
			'i18n'                 => $strings,
			'lang'                 => $lang_ctx,
			'setupHomescreenGuide' => ex_public_owner_setup_hint_active(),
			'api'                  => array( 'bootstrap' => '/owner/api/bootstrap' ),
		);
		ex_public_owner_render_boot_shell( $config, $page_cfg, ex_public_owner_t( $strings, 'pageTitle', 'expressCARD' ) );
	}

	if ( 'owner' === $path_entry || 'owner/' === $path_entry ) {
		$lang_ctx   = ex_public_owner_resolve_lang();
		$strings    = ex_public_owner_strings( $lang_ctx['dict'] );
		$view_cards = 'cards' === ex_public_scalar_query( 'view' );
		$page_cfg   = array(
			'page'                 => 'boot-hub',
			'mode'                 => 'hub',
			'view_cards'           => $view_cards,
			'i18n'                 => $strings,
			'lang'                 => $lang_ctx,
			'setupHomescreenGuide' => ex_public_owner_setup_hint_active(),
			'api'                  => array( 'bootstrap' => '/owner/api/bootstrap' ),
		);
		ex_public_owner_render_boot_shell( $config, $page_cfg, ex_public_owner_t( $strings, 'pageTitle', 'expressCARD' ) );
	}

	if ( 0 === strpos( $path_entry, 'owner/' ) ) {
		ex_public_fail( 405, 'Metóda nie je povolená.' );
	}

	ex_public_fail( 404, 'Stránka nebola nájdená.' );
}

$config_path_early = __DIR__ . '/publication-config.php';
$config_early      = is_readable( $config_path_early ) ? require $config_path_early : array();
if ( ! is_array( $config_early ) ) {
	$config_early = array();
}
$uri_early   = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
$path_early  = strtolower( trim( (string) parse_url( $uri_early, PHP_URL_PATH ), '/' ) );
if ( 'index.php' === $path_early ) {
	$path_early = '';
}
if ( 0 === strpos( $path_early, 'owner' ) ) {
	ex_public_owner_dispatch( $path_early, $config_early );
}

$has_card_param = array_key_exists( 'card', $_GET );
$card_query     = ex_public_scalar_query( 'card' );
$uri            = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
$path           = (string) parse_url( $uri, PHP_URL_PATH );
$path           = trim( $path, '/' );
$path_id        = ex_public_valid_id( $path ) ? $path : '';

if ( $has_card_param && ( null === $card_query || ! ex_public_valid_id( $card_query ) ) ) {
	ex_public_fail( 404, 'Karta nebola nájdená.' );
}


// Marketing routes are exact matches, separate from published card routing.
// An explicit card query retains the existing priority and validation.
$landing_request_path = (string) parse_url( $uri, PHP_URL_PATH );
$landing_routes = array( '/sk' => 'sk', '/sk/' => 'sk', '/cz' => 'cz', '/cz/' => 'cz', '/en' => 'en', '/en/' => 'en', '/de' => 'de', '/de/' => 'de' );
$is_landing_root = '/' === $landing_request_path || '/index.php' === $landing_request_path || '' === $landing_request_path;
if ( ! $has_card_param && ( $is_landing_root || isset( $landing_routes[ $landing_request_path ] ) ) ) {
	foreach ( array( 'asset', 'vcf', 'contact' ) as $landing_query_key ) {
		if ( array_key_exists( $landing_query_key, $_GET ) ) {
			ex_public_fail( 404, 'Karta nebola nájdená.' );
		}
	}
	if ( $is_landing_root ) {
		header( 'Cache-Control: public, max-age=300' );
		header( 'Location: /sk/', true, 302 );
		exit;
	}
	$landing_language = $landing_routes[ $landing_request_path ];
	if ( '/' . $landing_language . '/' !== $landing_request_path ) {
		header( 'Cache-Control: public, max-age=300' );
		header( 'Location: /' . $landing_language . '/', true, 302 );
		exit;
	}
	ex_public_serve_product_page( $landing_language );
}

$public_id      = '';
$route_via_slug = false;
$path_slug      = '';
if ( null !== $card_query && ex_public_valid_id( $card_query ) ) {
	$public_id = $card_query;
} elseif ( '' !== $path_id ) {
	$public_id = $path_id;
} else {
	$path_entry = strtolower( trim( $path, '/' ) );
	if ( '' !== $path_entry && 'index.php' !== $path_entry && ex_public_valid_slug_segment( $path_entry ) ) {
		$path_slug = $path_entry;
	}
}

if ( '' === $public_id && '' !== $path_slug ) {
	$config_path = __DIR__ . '/publication-config.php';
	$config_early = is_readable( $config_path ) ? require $config_path : array();
	if ( ! is_array( $config_early ) ) {
		$config_early = array();
	}
	$cards_root_early = isset( $config_early['cards_root'] ) ? trim( (string) $config_early['cards_root'] ) : '';
	if ( '' === $cards_root_early ) {
		ex_public_fail( 503, 'Verejné zobrazenie expressCARD nie je nakonfigurované.' );
	}
	$resolved_slug = ex_public_resolve_public_id_by_slug( $cards_root_early, $path_slug );
	if ( 'ambiguous' === $resolved_slug ) {
		ex_public_fail( 503, 'Verejná adresa karty nie je jednoznačná.' );
	}
	if ( false === $resolved_slug || ! ex_public_valid_id( $resolved_slug ) ) {
		ex_public_fail( 404, 'Karta nebola nájdená.' );
	}
	$public_id      = (string) $resolved_slug;
	$route_via_slug = true;
}

if ( '' === $public_id ) {
	$path_entry = strtolower( trim( $path, '/' ) );
	if ( '' !== $path_entry && 'index.php' !== $path_entry ) {
		ex_public_fail( 404, 'Stránka nebola nájdená.' );
	}
	foreach ( array( 'asset', 'vcf', 'contact' ) as $query_key ) {
		if ( array_key_exists( $query_key, $_GET ) && null === ex_public_scalar_query( $query_key ) ) {
			ex_public_fail( 404, 'Karta nebola nájdená.' );
		}
	}
	if ( null !== ex_public_scalar_query( 'asset' ) || null !== ex_public_scalar_query( 'vcf' ) ) {
		ex_public_fail( 404, 'Karta nebola nájdená.' );
	}
	ex_public_serve_product_page();
}

foreach ( array( 'asset', 'vcf', 'contact' ) as $query_key ) {
	if ( array_key_exists( $query_key, $_GET ) && null === ex_public_scalar_query( $query_key ) ) {
		ex_public_fail( 400, 'Neplatný požiadavok.' );
	}
}

$config_path = __DIR__ . '/publication-config.php';
$config      = is_readable( $config_path ) ? require $config_path : array();
if ( ! is_array( $config ) ) {
	$config = array();
}

$cards_root = isset( $config['cards_root'] ) ? trim( (string) $config['cards_root'] ) : '';
$base_url   = isset( $config['public_base_url'] ) ? trim( (string) $config['public_base_url'] ) : '';
$frame_css  = isset( $config['frame_css'] ) ? (string) $config['frame_css'] : '/assets/css/expresscard-public.css';

if ( '' === $cards_root || '' === $base_url ) {
	ex_public_fail( 503, 'Verejné zobrazenie expressCARD nie je nakonfigurované.' );
}

$storage_root_real = ex_public_realpath_root( $cards_root );
if ( false === $storage_root_real ) {
	ex_public_fail( 503, 'Verejné zobrazenie expressCARD nie je nakonfigurované.' );
}
$card_dir = ex_public_normalize_path( $storage_root_real . '/' . $public_id );
if ( ! ex_public_path_within_root( $card_dir, $storage_root_real ) || ! is_dir( $card_dir ) ) {
	ex_public_fail( 404, 'Karta nebola nájdená.' );
}
$resolved = ex_public_resolve_current_dir( $cards_root, $public_id );
if ( false === $resolved ) {
	ex_public_fail( 404, 'Karta nebola nájdená.' );
}
list( $storage_root_real, $current_real ) = $resolved;

$manifest_path = $current_real . '/manifest.json';
$access_path   = $current_real . '/access.json';

if ( ! is_readable( $manifest_path ) ) {
	ex_public_fail( 404, 'Karta nebola nájdená.' );
}

$manifest_raw = file_get_contents( $manifest_path );
$manifest     = is_string( $manifest_raw ) ? json_decode( $manifest_raw, true ) : null;
if ( ! is_array( $manifest ) || ! ex_public_manifest_is_valid( $manifest, $public_id ) ) {
	ex_public_fail( 503, 'Publikačný balík nie je platný.' );
}

$access = array( 'public_access_allowed' => false );
if ( is_readable( $access_path ) ) {
	$access_raw = file_get_contents( $access_path );
	$decoded    = is_string( $access_raw ) ? json_decode( $access_raw, true ) : null;
	if ( is_array( $decoded ) ) {
		$access = $decoded;
	}
}

if ( ! ex_public_access_allowed_now( $access ) ) {
	ex_public_fail( 403, 'Karta momentálne nie je verejne dostupná.' );
}

$visibility = isset( $manifest['visibility'] ) ? trim( (string) $manifest['visibility'] ) : '';

$serve_vcf = null !== ex_public_scalar_query( 'vcf' );
if ( $serve_vcf ) {
	$vcf_flag = ex_public_scalar_query( 'vcf' );
	if ( '1' !== $vcf_flag ) {
		ex_public_fail( 400, 'Neplatný požiadavok.' );
	}
	$vcf_path = $current_real . '/vcf-data.json';
	if ( ! is_readable( $vcf_path ) ) {
		ex_public_fail( 404, 'Kontakt nie je dostupný.' );
	}
	$vcf_raw = file_get_contents( $vcf_path );
	$data    = is_string( $vcf_raw ) ? json_decode( $vcf_raw, true ) : null;
	if ( ! is_array( $data ) ) {
		ex_public_fail( 503, 'Kontakt nie je dostupný.' );
	}
	$contact_param = ex_public_scalar_query( 'contact' );
	$contact_id      = null !== $contact_param ? strtolower( $contact_param ) : '';
	if ( null !== $contact_param && ! ex_public_valid_secondary_contact_id( $contact_id ) ) {
		ex_public_fail( 400, 'Neplatný kontakt.' );
	}
	$block = ex_public_vcf_contact_block( $data, $contact_id );
	if ( null === $block ) {
		ex_public_fail( 404, 'Kontakt nie je dostupný.' );
	}
	$photo_path = '';
	$photo_rel  = '';
	if ( '' === $contact_id ) {
		$photo_rel = isset( $data['photo_asset'] ) ? (string) $data['photo_asset'] : '';
	} elseif ( isset( $block['photo_asset'] ) ) {
		$photo_rel = (string) $block['photo_asset'];
	}
	if ( '' !== $photo_rel ) {
		$rel = ex_public_manifest_asset_path( $manifest, $photo_rel );
		if ( null !== $rel ) {
			$candidate = ex_public_normalize_path( $current_real . '/' . $rel );
			$photo_real = ex_public_realpath_file_in_root( $candidate, $current_real );
			if ( false !== $photo_real ) {
				$photo_path = $photo_real;
			}
		}
	}
	$body = ex_public_build_vcard_body( $block, $photo_path );
	header( 'Content-Type: text/vcard; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename="contact.vcf"' );
	header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
	header( 'Pragma: no-cache' );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	echo $body;
	exit;
}

$asset_req = ex_public_scalar_query( 'asset' );
if ( null !== $asset_req ) {
	$rel = ex_public_manifest_asset_path( $manifest, $asset_req );
	if ( null === $rel ) {
		ex_public_fail( 404, 'Súbor nebol nájdený.' );
	}
	$candidate = ex_public_normalize_path( $current_real . '/' . $rel );
	$file_real = ex_public_realpath_file_in_root( $candidate, $current_real );
	if ( false === $file_real ) {
		ex_public_fail( 404, 'Súbor nebol nájdený.' );
	}
	$mime = ex_public_asset_mime( $file_real );
	header( 'Content-Type: ' . $mime );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
	header( 'Pragma: no-cache' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	readfile( $file_real );
	exit;
}

$card_html_path = $current_real . '/card.html';
if ( ! is_readable( $card_html_path ) ) {
	ex_public_fail( 503, 'Publikačný balík nie je kompletný.' );
}
$card_html = (string) file_get_contents( $card_html_path );
$card_html = ex_public_apply_brand_url( $card_html, $config );

$contact_exchange_runtime = ex_public_contact_exchange_runtime_config( $manifest, $public_id, $card_html, $config );
if ( is_array( $contact_exchange_runtime ) ) {
	ex_public_contact_exchange_enrich_recipient( $current_real, $contact_exchange_runtime );
}
$guest_motion_runtime = ex_public_guest_motion_runtime_config( $manifest );

$manifest_slug = ex_public_manifest_public_slug( $manifest );
if ( ! $route_via_slug && '' !== $manifest_slug ) {
	header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
	header( 'Pragma: no-cache' );
	header( 'Location: ' . rtrim( $base_url, '/' ) . '/' . rawurlencode( $manifest_slug ), true, 302 );
	exit;
}

$robots    = ( 'public' === $visibility ) ? 'index, follow' : 'noindex, nofollow';
$canonical_segment = '' !== $manifest_slug ? $manifest_slug : $public_id;
$canonical = rtrim( $base_url, '/' ) . '/' . rawurlencode( $canonical_segment );
$asset_qs  = '/' . rawurlencode( $public_id ) . '?asset=';
if ( null !== $card_query ) {
	$fallback_prefix = 'index.php?card=' . rawurlencode( $public_id ) . '&asset=';
	$card_html       = str_replace( $asset_qs, $fallback_prefix, $card_html );
	$asset_qs        = $fallback_prefix;
}

header( 'Content-Type: text/html; charset=UTF-8' );
header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
header( 'Pragma: no-cache' );
header( 'X-Robots-Tag: ' . $robots );

?><!DOCTYPE html>
<html lang="sk">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>expressCARD</title>
	<link rel="canonical" href="<?php echo htmlspecialchars( $canonical, ENT_QUOTES, 'UTF-8' ); ?>">
	<meta name="robots" content="<?php echo htmlspecialchars( $robots, ENT_QUOTES, 'UTF-8' ); ?>">
	<link rel="stylesheet" href="<?php echo htmlspecialchars( $frame_css, ENT_QUOTES, 'UTF-8' ); ?>">
	<?php if ( is_array( $guest_motion_runtime ) ) : ?>
	<link rel="stylesheet" href="<?php echo htmlspecialchars( ex_public_static_asset_href( '/assets/css/expresscard-motion.css' ), ENT_QUOTES, 'UTF-8' ); ?>">
	<?php endif; ?>
	<?php
	$styles = isset( $manifest['styles'] ) && is_array( $manifest['styles'] ) ? $manifest['styles'] : array();
	foreach ( $styles as $rel ) {
		if ( ! is_string( $rel ) ) {
			continue;
		}
		$allowed = ex_public_manifest_asset_path( $manifest, $rel );
		if ( null === $allowed ) {
			continue;
		}
		$href = $asset_qs . rawurlencode( $allowed );
		echo '<link rel="stylesheet" href="' . htmlspecialchars( $href, ENT_QUOTES, 'UTF-8' ) . '">';
	}
	?>
</head>
<body class="ex-public-body">
<main class="ex-public-shell">
	<div class="ex-public-card-host">
		<?php
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted publisher HTML snapshot.
		echo $card_html;
		?>
	</div>
</main>
<?php if ( is_array( $guest_motion_runtime ) ) : ?>
<div class="ex-public-motion-fab" data-ex-public-motion-fab>
	<button type="button" class="ex-public-motion-toggle" data-ex-public-motion-toggle aria-pressed="false">
		<span class="ex-public-motion-toggle__icon" aria-hidden="true"></span>
		<span class="ex-public-motion-toggle__sr ex-public-sr-only"><?php echo htmlspecialchars( ex_public_owner_t( ex_public_guest_motion_strings( isset( $guest_motion_runtime['lang'] ) ? (string) $guest_motion_runtime['lang'] : 'sk' ), 'toggleOn', 'Zapnúť pohyb' ), ENT_QUOTES, 'UTF-8' ); ?></span>
	</button>
</div>
<script>
window.expresscardMotion = <?php echo json_encode(
	$guest_motion_runtime,
	JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
); ?>;
</script>
<script src="<?php echo htmlspecialchars( ex_public_static_asset_href( '/assets/js/expresscard-motion.js' ), ENT_QUOTES, 'UTF-8' ); ?>" defer></script>
<?php endif; ?>
<?php if ( is_array( $contact_exchange_runtime ) ) : ?>
<script>
window.expresscardContactExchange = <?php echo json_encode(
	$contact_exchange_runtime,
	JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
); ?>;
</script>
<script src="/assets/js/expresscard-contact-exchange-public.js" defer></script>
<?php endif; ?>
</body>
</html>
