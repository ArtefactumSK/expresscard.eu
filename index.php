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
 * Owner presentation cookie (HttpOnly; raw token never exposed to JS after activation).
 */
const EX_PUBLIC_OWNER_COOKIE = 'excard_owner_sess';
const EX_PUBLIC_OWNER_CHALLENGE_COOKIE = 'excard_owner_chl';
const EX_PUBLIC_OWNER_PREF_COOKIE      = 'excard_owner_pref';

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
 * @return array<string, mixed>|null
 */
function ex_public_owner_core_post_json( $url, array $body ) {
	$url = (string) $url;
	if ( ! ex_public_owner_allowed_core_url( $url ) ) {
		return null;
	}
	$payload = json_encode( $body );
	if ( ! is_string( $payload ) ) {
		return null;
	}
	if ( function_exists( 'curl_init' ) ) {
		$ch = curl_init( $url );
		if ( false === $ch ) {
			return null;
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
		$raw = curl_exec( $ch );
		$code = (int) curl_getinfo( $ch, CURLINFO_HTTP_CODE );
		curl_close( $ch );
		if ( ! is_string( $raw ) || $code < 200 || $code >= 300 ) {
			return null;
		}
		$decoded = json_decode( $raw, true );
		return is_array( $decoded ) ? $decoded : null;
	}
	$ctx = stream_context_create(
		array(
			'http' => array(
				'method'          => 'POST',
				'header'          => "Content-Type: application/json\r\nAccept: application/json\r\n",
				'content'         => $payload,
				'timeout'         => 12,
				'follow_location' => 0,
			),
			'ssl'  => array(
				'verify_peer'      => true,
				'verify_peer_name' => true,
			),
		)
	);
	$raw = @file_get_contents( $url, false, $ctx ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( ! is_string( $raw ) ) {
		return null;
	}
	$decoded = json_decode( $raw, true );
	return is_array( $decoded ) ? $decoded : null;
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
 * @param string $token Raw session token.
 * @return void
 */
function ex_public_owner_set_session_cookie( $token ) {
	$token = strtolower( (string) $token );
	if ( ! preg_match( '/^[a-f0-9]{64}$/', $token ) ) {
		return;
	}
	if ( ! ex_public_owner_cookie_secure() ) {
		return;
	}
	setcookie(
		EX_PUBLIC_OWNER_COOKIE,
		$token,
		array(
			'expires'  => time() + 2592000,
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
		$response = ex_public_owner_core_post_json(
			$api_base . '/expresscard/owner/activate',
			array(
				'activation_secret' => strtolower( $secret ),
				'device_label'      => $device,
			)
		);
		ex_public_owner_clear_challenge_cookie();
		if ( ! is_array( $response ) || empty( $response['session_token'] ) || ! preg_match( '/^[a-f0-9]{64}$/', strtolower( (string) $response['session_token'] ) ) ) {
			http_response_code( 400 );
			echo json_encode( array( 'ok' => false ) );
			exit;
		}
		ex_public_owner_set_session_cookie( (string) $response['session_token'] );
		echo json_encode( array( 'ok' => true, 'redirect' => '/owner/' ) );
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

	if ( 'owner/api/session' === $path_entry && 'POST' === $method ) {
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Content-Type: application/json; charset=UTF-8' );
		if ( ! ex_public_owner_request_origin_ok() ) {
			http_response_code( 403 );
			echo json_encode( array( 'valid' => false ) );
			exit;
		}
		$token = ex_public_owner_session_from_cookie();
		if ( '' === $token ) {
			echo json_encode( array( 'valid' => false ) );
			exit;
		}
		$intro = ex_public_owner_core_post_json( $api_base . '/expresscard/owner/session', array( 'session_token' => $token ) );
		if ( ! is_array( $intro ) || empty( $intro['valid'] ) ) {
			ex_public_owner_clear_session_cookie();
			echo json_encode( array( 'valid' => false ) );
			exit;
		}
		$list  = ex_public_owner_core_post_json( $api_base . '/expresscard/owner/cards', array( 'session_token' => $token ) );
		$cards = ( is_array( $list ) && isset( $list['cards'] ) && is_array( $list['cards'] ) ) ? $list['cards'] : array();
		$raw_body = file_get_contents( 'php://input' );
		$params   = is_string( $raw_body ) ? json_decode( $raw_body, true ) : null;
		$card_ref_raw = is_array( $params ) && isset( $params['card_ref'] ) ? trim( (string) $params['card_ref'] ) : '';
		$card_ref     = '';
		if ( ex_public_valid_id( $card_ref_raw ) || ex_public_valid_slug_segment( $card_ref_raw ) ) {
			$card_ref = $card_ref_raw;
		}
		$payload  = array(
			'valid' => true,
			'cards' => $cards,
		);
		if ( '' !== $card_ref ) {
			$verify = ex_public_owner_core_post_json(
				$api_base . '/expresscard/owner/card-verify',
				array(
					'session_token' => $token,
					'card_ref'      => $card_ref,
				)
			);
			$payload['card_allowed'] = is_array( $verify ) && ! empty( $verify['allowed'] );
		}
		echo json_encode( $payload );
		exit;
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
		$frame_css = isset( $config['frame_css'] ) ? (string) $config['frame_css'] : '/assets/css/expresscard-public.css';
		try {
			$challenge = bin2hex( random_bytes( 16 ) );
		} catch ( Exception $e ) {
			ex_public_fail( 503, 'Aktivácia nie je dostupná.' );
		}
		ex_public_owner_set_challenge_cookie( $challenge );
		echo '<!DOCTYPE html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aktivácia expressCARD</title><link rel="stylesheet" href="' . htmlspecialchars( $frame_css, ENT_QUOTES, 'UTF-8' ) . '"></head><body class="ex-public-body"><main class="ex-public-owner-activate" data-ex-owner-challenge="' . htmlspecialchars( $challenge, ENT_QUOTES, 'UTF-8' ) . '"><h1>Aktivácia prístupu</h1><p>Po potvrdení sa toto zariadenie prihlási na zobrazenie vašich kariet.</p><button type="button" id="ex-owner-activate-btn">Aktivovať na tomto zariadení</button><p id="ex-owner-activate-status" hidden="hidden"></p></main><script>(function(){var h=String(location.hash||"").replace(/^#/,"");try{h=decodeURIComponent(h);}catch(e){}window.__exOwnerActivationSecret=h||"";if(history.replaceState){history.replaceState(null,document.title,location.pathname+location.search);}})();</script><script src="/assets/js/expresscard-owner-public.js" defer></script></body></html>';
		exit;
	}

	if ( 'owner' === $path_entry || 'owner/' === $path_entry ) {
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		$frame_css  = isset( $config['frame_css'] ) ? (string) $config['frame_css'] : '/assets/css/expresscard-public.css';
		$token      = ex_public_owner_session_from_cookie();
		$cards      = array();
		$view_cards = 'cards' === ex_public_scalar_query( 'view' );
		if ( '' !== $token ) {
			$intro = ex_public_owner_core_post_json( $api_base . '/expresscard/owner/session', array( 'session_token' => $token ) );
			if ( is_array( $intro ) && ! empty( $intro['valid'] ) ) {
				$list = ex_public_owner_core_post_json( $api_base . '/expresscard/owner/cards', array( 'session_token' => $token ) );
				if ( is_array( $list ) && isset( $list['cards'] ) && is_array( $list['cards'] ) ) {
					$cards = $list['cards'];
				}
			}
		}
		if ( ! empty( $cards ) && ! $view_cards ) {
			$pref           = ex_public_owner_pref_from_cookie();
			$pref_redirect  = '';
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
						$pref_redirect = $slug;
						break;
					}
				}
				if ( '' === $pref_redirect ) {
					ex_public_owner_clear_pref_cookie();
				}
			}
			if ( '' !== $pref_redirect ) {
				header( 'Location: /' . rawurlencode( $pref_redirect ), true, 302 );
				exit;
			}
		} elseif ( ! empty( $cards ) && $view_cards ) {
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
		} elseif ( empty( $cards ) && '' !== ex_public_owner_pref_from_cookie() ) {
			ex_public_owner_clear_pref_cookie();
		}
		header( 'Content-Type: text/html; charset=UTF-8' );
		echo '<!DOCTYPE html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>expressCARD</title><link rel="stylesheet" href="' . htmlspecialchars( $frame_css, ENT_QUOTES, 'UTF-8' ) . '"></head><body class="ex-public-body"><main class="ex-public-owner-activate"><h1>Moje karty</h1>';
		if ( empty( $cards ) ) {
			echo '<p>Pre zobrazenie kariet aktivujte prístup alebo požiadajte o obnovu e-mailom.</p><p><a href="/owner/activate">Aktivácia</a></p>';
			echo '<form class="ex-public-owner-renew" id="ex-owner-renew-form"><label>E-mail na obnovu<input type="email" name="email" required autocomplete="email" /></label><button type="submit">Odoslať odkaz</button><p id="ex-owner-renew-status" hidden="hidden"></p></form>';
		} else {
			echo '<ul>';
			foreach ( $cards as $card ) {
				if ( ! is_array( $card ) ) {
					continue;
				}
				$slug = isset( $card['public_slug'] ) && '' !== (string) $card['public_slug'] ? (string) $card['public_slug'] : (string) ( $card['public_id'] ?? '' );
				if ( '' === $slug || ! ex_public_valid_id( $slug ) && ! ex_public_valid_slug_segment( $slug ) ) {
					continue;
				}
				$label = isset( $card['label'] ) ? (string) $card['label'] : $slug;
				$href  = '/' . rawurlencode( $slug );
				echo '<li><a href="' . htmlspecialchars( $href, ENT_QUOTES, 'UTF-8' ) . '">' . htmlspecialchars( $label, ENT_QUOTES, 'UTF-8' ) . '</a></li>';
			}
			echo '</ul>';
		}
		echo '</main><script src="/assets/js/expresscard-owner-public.js" defer></script></body></html>';
		exit;
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
<?php if ( is_array( $contact_exchange_runtime ) ) : ?>
<script>
window.expresscardContactExchange = <?php echo json_encode(
	$contact_exchange_runtime,
	JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
); ?>;
</script>
<script src="/assets/js/expresscard-contact-exchange-public.js" defer></script>
<?php endif; ?>
<?php
$owner_token = ex_public_owner_session_from_cookie();
$owner_runtime = null;
if ( '' !== $owner_token ) {
	$api_base_owner = ex_public_owner_core_api_base( $config );
	$intro          = ex_public_owner_core_post_json( $api_base_owner . '/expresscard/owner/session', array( 'session_token' => $owner_token ) );
	$session_valid  = is_array( $intro ) && ! empty( $intro['valid'] );
	if ( $session_valid ) {
		$verify       = ex_public_owner_core_post_json(
			$api_base_owner . '/expresscard/owner/card-verify',
			array(
				'session_token' => $owner_token,
				'card_ref'      => $public_id,
			)
		);
		$card_allowed = is_array( $verify ) && ! empty( $verify['allowed'] );
		$list         = ex_public_owner_core_post_json( $api_base_owner . '/expresscard/owner/cards', array( 'session_token' => $owner_token ) );
		$owner_runtime = array(
			'session_valid'     => true,
			'enabled'           => $card_allowed,
			'cards'             => ( is_array( $list ) && isset( $list['cards'] ) && is_array( $list['cards'] ) ) ? $list['cards'] : array(),
			'current_public_id' => $public_id,
		);
	}
}
if ( is_array( $owner_runtime ) ) :
	?>
<script>
window.expresscardOwner = <?php echo json_encode(
	$owner_runtime,
	JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
); ?>;
</script>
<script src="/assets/js/expresscard-owner-public.js" defer></script>
<?php endif; ?>
</body>
</html>
