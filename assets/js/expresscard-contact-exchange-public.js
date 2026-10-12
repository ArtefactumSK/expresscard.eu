(function () {
	'use strict';
	var state = {
		open: false,
		submitting: false,
		lastFocus: null,
		overlay: null,
		
		form: null,
		language: 'sk',
		translations: null,
		lastStatusKey: '',
		lastStatusError: false
	};

	function detectLanguage() {
		var supported = ['sk', 'cs', 'en', 'de'];
		var preferred = navigator.languages || [navigator.language || ''];
		for (var i = 0; i < preferred.length; i++) {
			var code = String(preferred[i]).toLowerCase().split('-')[0];
			if (code === 'cz') code = 'cs';
			if (supported.indexOf(code) !== -1) return code;
		}
		return 'en';
	}

	function translate(key, fallback) {
		var all = state.translations || {};
		var current = all[state.language] || {};
		var slovak = all.sk || {};
		return current[key] || slovak[key] || fallback || key;
	}

	function setLanguage(language) {
		if (!state.translations || !state.translations[language]) return;
		state.language = language;
		applyTranslations();
	}

	function applyTranslations() {
		if (!state.overlay) return;
		var root = state.overlay;
		root.setAttribute('lang', state.language);
		root.querySelectorAll('[data-ex-ce-i18n]').forEach(function (el) {
			var value = translate(el.getAttribute('data-ex-ce-i18n'));
			el.replaceChildren();

			String(value).split(/(expressCARD)/g).forEach(function (part) {
				if (part === 'expressCARD') {
					var em = document.createElement('em');
					em.textContent = 'express';
					el.appendChild(em);
					el.appendChild(document.createTextNode('CARD'));
				} else if (part) {
					el.appendChild(document.createTextNode(part));
				}
			});
		});
		root.querySelectorAll('[data-ex-ce-aria]').forEach(function (el) {
			el.setAttribute('aria-label', translate(el.getAttribute('data-ex-ce-aria')));
		});
		var selector = root.querySelector('[data-ex-ce-language]');
		if (selector) selector.value = state.language;
		if (state.lastStatusKey) {
			setStatus(translate(state.lastStatusKey), state.lastStatusError, state.lastStatusKey);
		}
		setSubmitting(state.submitting);
		var header = root.querySelector('.ex-public-ce__header');
		var intro = root.querySelector('.ex-public-ce__privacy');
		var success = root.querySelector('.ex-public-ce__success');
		var isSuccess = success && !success.hidden;

		if (header) header.hidden = !!isSuccess;
		if (intro) intro.hidden = !!isSuccess;
	}


	function config() {
		return window.expresscardContactExchange || null;
	}

	function escapeHtml(value) {
		return String(value || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function recipientLabel(cfg) {
		var name = String(cfg.recipientName || '').trim();
		var company = String(cfg.recipientCompany || '').trim();
		if (name && company) {
			return name + ' (' + company + ')';
		}
		return name || company || 'majiteľa tejto karty';
	}

	
	function privacyNoticeHtml(cfg) {
		return '<p class="ex-public-ce__privacy" id="ex-public-ce-privacy" data-ex-ce-i18n="intro">'
			+ 'Zanechajte svoje kontaktné údaje, aby vás majiteľ tejto expressCARD mohol kontaktovať.'
			+ '</p>';
	}


	function buildOverlay(cfg) {
		var wrap = document.createElement('div');
		wrap.className = 'ex-public-ce';
		wrap.hidden = true;
		wrap.setAttribute('data-ex-public-contact-exchange-root', '1');

		var backdrop = document.createElement('button');
		backdrop.type = 'button';
		backdrop.className = 'ex-public-ce__backdrop';
		backdrop.setAttribute('aria-label', 'Zavrieť formulár');

		var dialog = document.createElement('div');
		dialog.className = 'ex-public-ce__dialog';
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		dialog.setAttribute('aria-labelledby', 'ex-public-ce-title');

		dialog.innerHTML =
			'<header class="ex-public-ce__header">'			
			+ '<h2 class="ex-public-ce__title" id="ex-public-ce-title" data-ex-ce-i18n="title">Vymeniť si kontakt</h2>'
			+ '<div class="ex-public-ce__header-actions">'
			+ '<select class="ex-public-ce__language" data-ex-ce-language="1" aria-label="Language / Jazyk">'
			+ '<option value="sk">SK</option><option value="cs">CZ</option>'
			+ '<option value="en">EN</option><option value="de">DE</option>'
			+ '</select>'
			+ '<button type="button" class="ex-public-ce__close" data-ex-ce-aria="closeForm" aria-label="Zavrieť formulár">&times;</button>'
			+ '</div>'
			+ '</header>'
			+ '<div class="ex-public-ce__body">'
			+ privacyNoticeHtml(cfg)
			+ '<p class="ex-public-ce__status" data-ex-ce-status="1" hidden></p>'
			+ '<form class="ex-public-ce__form" data-ex-ce-form="1" novalidate>'
			+ '<label class="ex-public-ce__field"><span><span data-ex-ce-i18n="name">Meno</span> <em data-ex-ce-i18n="required">(povinné)</em></span>'
			+ '<input type="text" name="name" autocomplete="name" required maxlength="120"></label>'
			+ '<label class="ex-public-ce__field"><span data-ex-ce-i18n="email">E-mail</span>'
			+ '<input type="email" name="email" autocomplete="email" maxlength="191"></label>'
			+ '<label class="ex-public-ce__field"><span data-ex-ce-i18n="phone">Telefón</span>'
			+ '<input type="tel" name="phone" autocomplete="tel" maxlength="50"></label>'
			+ '<p class="ex-public-ce__hint" data-ex-ce-i18n="hint">Vyplňte aspoň e-mail alebo telefón.</p>'
			+ '<label class="ex-public-ce__field"><span data-ex-ce-i18n="company">Firma</span>'
			+ '<input type="text" name="company" autocomplete="organization" maxlength="255"></label>'
			+ '<label class="ex-public-ce__field"><span data-ex-ce-i18n="position">Pozícia</span>'
			+ '<input type="text" name="position" autocomplete="organization-title" maxlength="150"></label>'
			+ '<input type="hidden" name="purpose" value="stay_in_touch">'
			+ '<label class="ex-public-ce__field"><span data-ex-ce-i18n="message">Správa</span>'
			+ '<textarea name="message" rows="3" maxlength="2000"></textarea></label>'
			+ '<input type="text" name="website_hp" class="ex-public-ce__hp" tabindex="-1" autocomplete="off" aria-hidden="true">'			
			+ '<p class="ex-public-ce__privacy-note" data-ex-ce-i18n="privacy">'
			+ 'Údaje budú poskytnuté majiteľovi karty na spätné kontaktovanie.</p>'
			+ '<div class="ex-public-ce__actions">'
			+ '<button type="button" class="ex-public-ce__btn ex-public-ce__btn--ghost" data-ex-ce-cancel="1" data-ex-ce-i18n="cancel">Zrušiť</button>'
			+ '<button type="submit" class="ex-public-ce__btn ex-public-ce__btn--primary" data-ex-ce-submit="1" data-ex-ce-i18n="submit">Odoslať kontakt</button>'
			+ '</div>'
			+ '</form>'
			+ '<div class="ex-public-ce__success" data-ex-ce-success="1" hidden>'			
			+ '<p data-ex-ce-i18n="success">Ďakujeme. Váš kontakt bol odoslaný.</p>'
			+ '<button type="button" class="ex-public-ce__btn ex-public-ce__btn--primary" data-ex-ce-done="1" data-ex-ce-i18n="close">Zavrieť</button>'
			+ '</div>'
			+ '</div>';

		wrap.appendChild(backdrop);
		wrap.appendChild(dialog);
		document.body.appendChild(wrap);

		backdrop.addEventListener('click', closeOverlay);
		dialog.querySelector('.ex-public-ce__close').addEventListener('click', closeOverlay);
		dialog.querySelector('[data-ex-ce-cancel="1"]').addEventListener('click', closeOverlay);
		dialog.querySelector('[data-ex-ce-done="1"]').addEventListener('click', closeOverlay);

		state.overlay = wrap;
		state.form = dialog.querySelector('[data-ex-ce-form="1"]');
		
		state.form.addEventListener('submit', onSubmit);
		dialog.querySelector('[data-ex-ce-language]').addEventListener('change', function (event) {
			setLanguage(event.target.value);
		});
		applyTranslations();


		return wrap;
	}
	
	function setStatus(message, isError, key) {
		var el = state.overlay && state.overlay.querySelector('[data-ex-ce-status="1"]');
		if (!el) return;
		state.lastStatusKey = message ? (key || '') : '';
		state.lastStatusError = !!isError;
		el.hidden = !message;
		el.textContent = message || '';
		el.classList.toggle('ex-public-ce__status--error', !!isError);
	}

	function readForm() {
		var fd = new FormData(state.form);
		return {
			name: String(fd.get('name') || '').trim(),
			email: String(fd.get('email') || '').trim(),
			phone: String(fd.get('phone') || '').trim(),
			company: String(fd.get('company') || '').trim(),
			position: String(fd.get('position') || '').trim(),
			message: String(fd.get('message') || '').trim(),
			purpose: String(fd.get('purpose') || '').trim(),
			website_hp: String(fd.get('website_hp') || '').trim()
		};
	}
	
	function validateClient(data) {
		if (!data.name) return 'nameError';
		if (!data.email && !data.phone) return 'contactError';
		if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
			return 'emailError';
		}
		return '';
	}


	function setSubmitting(flag) {
		state.submitting = !!flag;
		var btn = state.overlay && state.overlay.querySelector('[data-ex-ce-submit="1"]');
		if (btn) {
			btn.disabled = state.submitting;
			btn.setAttribute('aria-busy', state.submitting ? 'true' : 'false');			
			btn.textContent = state.submitting
				? translate('sending', 'Odosielam…')
				: translate('submit', 'Odoslať kontakt');
		}
	}

	function showSuccess() {
		if (!state.overlay) {
			return;
		}
		state.form.hidden = true;
		var header = state.overlay.querySelector('.ex-public-ce__header');
		var intro = state.overlay.querySelector('.ex-public-ce__privacy');

		if (header) header.hidden = true;
		if (intro) intro.hidden = true;
		state.overlay.querySelector('[data-ex-ce-success="1"]').hidden = false;
		setStatus('', false);
	}

	function resetFormView() {
		if (!state.overlay) {
			return;
		}
	
		state.form.hidden = false;
		state.overlay.querySelector('[data-ex-ce-success="1"]').hidden = true;
	
		var header = state.overlay.querySelector('.ex-public-ce__header');
		var intro = state.overlay.querySelector('.ex-public-ce__privacy');
	
		if (header) header.hidden = false;
		if (intro) intro.hidden = false;
	
		setStatus('', false);
	}

	function parseErrorMessage(body) {
		if (!body) {
			return 'Odoslanie zlyhalo. Skúste to neskôr.';
		}
		if (typeof body.message === 'string' && body.message) {
			return body.message;
		}
		if (body.data && typeof body.data.message === 'string' && body.data.message) {
			return body.data.message;
		}
		return 'Odoslanie zlyhalo. Skúste to neskôr.';
	}

	function onSubmit(event) {
		event.preventDefault();
		if (state.submitting) {
			return;
		}
		var cfg = config();
		if (!cfg || !cfg.submitUrl || !cfg.cardRef) {
			setStatus(translate('unavailable'), true, 'unavailable');
			return;
		}
		var data = readForm();
		var clientError = validateClient(data);
		if (clientError) {			
			setStatus(translate(clientError), true, clientError);
			return;
		}
		setStatus('', false);
		setSubmitting(true);

		var payload = {
			card_ref: cfg.cardRef,
			name: data.name,
			email: data.email,
			phone: data.phone,
			company: data.company,
			position: data.position,
			message: data.message,
			purpose: data.purpose,
			privacy_notice_version: cfg.privacyNoticeVersion || '1.0',
			website_hp: data.website_hp
		};

		fetch(cfg.submitUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(payload),
			credentials: 'omit'
		})
			.then(function (response) {
				return response.json().then(function (json) {
					return { ok: response.ok, status: response.status, json: json };
				}).catch(function () {
					return { ok: response.ok, status: response.status, json: null };
				});
			})
			.then(function (result) {
				setSubmitting(false);
				if (result.ok && result.json && result.json.ok === true) {
					showSuccess();
					return;
				}
				if (result.status === 429) {
					setStatus(translate('rateLimit'), true, 'rateLimit');
					return;
				}
				setStatus(translate('failed'), true, 'failed');
			})
			.catch(function () {
				setSubmitting(false);
				setStatus(translate('networkError'), true, 'networkError');
			});
	}

	function focusableIn(node) {
		return node.querySelectorAll(
			'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
	}

	function trapFocus(event) {
		if (!state.open || !state.overlay || event.key !== 'Tab') {
			return;
		}
		var dialog = state.overlay.querySelector('.ex-public-ce__dialog');
		var nodes = focusableIn(dialog);
		if (!nodes.length) {
			return;
		}
		var first = nodes[0];
		var last = nodes[nodes.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function onKeydown(event) {
		if (!state.open) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closeOverlay();
			return;
		}
		trapFocus(event);
	}

	function openOverlay(trigger) {
		var cfg = config();
		if (!cfg || !state.overlay) {
			return;
		}
		resetFormView();
		state.form.reset();
		state.open = true;
		state.lastFocus = trigger || document.activeElement;
		state.overlay.hidden = false;
		document.body.classList.add('ex-public-ce-open');
		var nameInput = state.form.querySelector('input[name="name"]');
		if (nameInput) {
			nameInput.focus();
		}
	}

	function closeOverlay() {
		if (!state.open || !state.overlay) {
			return;
		}
		state.open = false;
		state.overlay.hidden = true;
		document.body.classList.remove('ex-public-ce-open');
		resetFormView();
		state.form.reset();
		if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
			state.lastFocus.focus();
		}
		state.lastFocus = null;
	}

	function bindTriggers(host) {
		var buttons = host.querySelectorAll('[data-ex-mcard-contact-exchange="1"]');
		buttons.forEach(function (btn) {
			if (btn.getAttribute('data-ex-public-ce-bound') === '1') {
				return;
			}
			btn.setAttribute('data-ex-public-ce-bound', '1');
			btn.addEventListener('click', function (event) {
				event.preventDefault();
				openOverlay(btn);
			});
		});
	}
	
	function init() {
		var cfg = config();
		if (!cfg || !cfg.submitUrl || !cfg.cardRef) return;

		var host = document.querySelector('.ex-public-card-host');
		if (!host) return;

		state.language = detectLanguage();

		fetch('/lang/contact-exchange.json', { cache: 'no-cache' })
			.then(function (response) {
				if (!response.ok) throw new Error('Translations unavailable');
				return response.json();
			})
			.then(function (translations) {
				if (!translations || !translations.sk) {
					throw new Error('Invalid translations');
				}
				state.translations = translations;
				if (!translations[state.language]) state.language = 'sk';
			})
			.catch(function () {
				state.language = 'sk';
				state.translations = null;
			})
			.then(function () {
				buildOverlay(cfg);
				bindTriggers(host);
				document.addEventListener('keydown', onKeydown);
			});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
