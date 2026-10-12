<?php
/**
 * expressCARD public site configuration (no credentials).
 *
 * Copy this file to the server and set absolute paths for your hosting layout.
 * Leave values empty until deployment — the public runtime stays fail-closed.
 */

return array(
	// Absolute filesystem root where WP publisher writes packages: {cards_root}/{public_id}/current/
	'cards_root' => '/home/html/multi_196737/expressar-common-files/storage/expresscard-public',

	// Canonical public origin, no trailing slash, e.g. https://expresscard.eu
	'public_base_url' => 'https://expresscard.eu',

	// Optional path to standalone frame CSS relative to this site root.
	'frame_css' => '/assets/css/expresscard-public.css',

	// Brand destination for published card watermarks (replaced per HTML request; no republish needed).
	'brand_url' => 'https://expresscard.eu',

	// Fallback Core REST URL when older packages lack manifest.contact_exchange.submit_url.
	'contact_exchange_submit_url' => 'https://expressar.eu/wp-json/expressar/v1/expresscard/contact-exchange',
);
