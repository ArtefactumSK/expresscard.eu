(function () {
  "use strict";

  var ownerBootstrapped = false;
  var revalidateInFlight = null;
  var bootstrapInFlight = false;
  var ownerAppBound = false;

  var exCardBusy = (function () {
    var count = 0;
    function rootNode() {
      return document.querySelector("[data-ex-excard-busy-root]");
    }
    function sync() {
      var root = rootNode();
      if (!root) return;
      if (count > 0) {
        root.hidden = false;
        root.setAttribute("aria-hidden", "false");
      } else {
        root.hidden = true;
        root.setAttribute("aria-hidden", "true");
      }
    }
    return {
      begin: function () {
        count += 1;
        sync();
      },
      end: function () {
        count = Math.max(0, count - 1);
        sync();
      },
      reset: function () {
        count = 0;
        sync();
      }
    };
  })();

  var deferredInstallPrompt = null;
  var installPromptConsumed = false;

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    if (!installPromptConsumed) {
      deferredInstallPrompt = event;
    }
  });

  window.addEventListener("appinstalled", function () {
    deferredInstallPrompt = null;
    installPromptConsumed = true;
  });

  var QR_MARGIN_MODULES = 4;
  var QR_EXPORT_SIZE = 1024;

  function deviceLabel() {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
    if (/Android/i.test(ua)) return "Android";
    if (/Windows/i.test(ua)) return "Windows";
    if (/Mac OS/i.test(ua)) return "macOS";
    return "Zariadenie";
  }

  function readActivationSecret() {
    if (window.__exOwnerActivationSecret && /^[a-f0-9]{64}$/i.test(window.__exOwnerActivationSecret)) {
      return String(window.__exOwnerActivationSecret).toLowerCase();
    }
    return "";
  }

  function readChallenge() {
    var main = document.querySelector("[data-ex-owner-challenge]");
    if (!main) return "";
    var value = main.getAttribute("data-ex-owner-challenge") || "";
    return /^[a-f0-9]{32}$/i.test(value) ? value.toLowerCase() : "";
  }

  function readJsonNode(id) {
    var node = document.getElementById(id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "");
    } catch (e) {
      return null;
    }
  }

  function postJson(url, body, retries) {
    var left = typeof retries === "number" ? retries : 0;
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/vcard" },
      body: JSON.stringify(body || {})
    })
      .then(function (res) {
        var status = res.status;
        var httpOk = res.ok;
        var ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.indexOf("text/vcard") !== -1 || ct.indexOf("text/x-vcard") !== -1) {
          return res.text().then(function (text) {
            return { httpOk: httpOk, status: status, data: null, vcf: text, networkError: false };
          });
        }
        return res.text().then(function (text) {
          var data = null;
          var parseError = false;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (e) {
              parseError = true;
            }
          }
          if (!httpOk && left > 0) {
            return postJson(url, body, left - 1);
          }
          return { httpOk: httpOk, status: status, data: data, parseError: parseError, networkError: false };
        });
      })
      .catch(function () {
        if (left > 0) return postJson(url, body, left - 1);
        return { httpOk: false, status: 0, data: null, networkError: true };
      });
  }

  function postSession(body) {
    return postJson("/owner/api/session", body || {}, 1);
  }

  function t(i18n, key, fallback) {
    if (i18n && i18n[key]) return i18n[key];
    return fallback || "";
  }

  function responseCode(env) {
    if (!env || !env.data) return "";
    if (typeof env.data.code === "string") return env.data.code;
    return "";
  }

  function mapApiMessage(i18n, env) {
    if (!env || env.networkError) {
      return t(i18n, "errorNetwork", "Network error.");
    }
    var code = responseCode(env);
    if (code === "expressar_dsi_received_contacts_unavailable") {
      return t(i18n, "errorUnavailable", "Unavailable.");
    }
    if (code === "expressar_dsi_access_session_limit_reached") {
      return t(i18n, "activateSessionLimit", "Device limit reached.");
    }
    if (code === "expressar_dsi_access_activation_invalid" || code === "expressar_dsi_access_activation_consumed") {
      return t(i18n, "activateInvalid", "Invalid link.");
    }
    if (code.indexOf("forbidden") !== -1 || code === "expressar_dsi_access_session_invalid" || code === "expressar_owner_origin_forbidden") {
      return t(i18n, "errorForbidden", "Forbidden.");
    }
    if (code.indexOf("bad_request") !== -1) {
      return t(i18n, "errorBadRequest", "Bad request.");
    }
    if (!env.httpOk || env.parseError) {
      return t(i18n, "errorGeneric", "Request failed.");
    }
    return t(i18n, "errorGeneric", "Request failed.");
  }

  function purposeLabel(i18n, item) {
    if (!item) return "";
    var purpose = String(item.purpose || "");
    if (purpose) {
      var key = "purpose_" + purpose.replace(/-/g, "_");
      var localized = t(i18n, key, "");
      if (localized) return localized;
    }
    return item.purpose_label || purpose || "";
  }

  function isWpErrorPayload(data) {
    return !!(data && typeof data.code === "string" && data.message);
  }

  function isListResponse(env) {
    return !!(env && env.httpOk && env.data && Array.isArray(env.data.items) && !isWpErrorPayload(env.data));
  }

  function isDetailResponse(env) {
    return !!(env && env.httpOk && env.data && env.data.id && !isWpErrorPayload(env.data));
  }

  function isOkMutation(env) {
    return !!(env && env.httpOk && env.data && env.data.ok === true);
  }

  function isNoteResponse(env) {
    return !!(env && env.httpOk && env.data && env.data.id && !isWpErrorPayload(env.data));
  }

  function isCountResponse(env) {
    if (!env || !env.httpOk || !env.data || isWpErrorPayload(env.data)) return false;
    return typeof env.data.unread_count === "number" || typeof env.data.count === "number";
  }

  function isVcfResponse(env) {
    return !!(env && env.httpOk && typeof env.vcf === "string" && env.vcf.indexOf("BEGIN:VCARD") !== -1);
  }

  function parseReceivedDate(item) {
    if (!item) return null;
    var raw = item.received_at || item.created_at || "";
    if (!raw) return null;
    var iso = String(raw);
    if (!/Z$|[+-]\d{2}:\d{2}$/.test(iso)) {
      iso = iso.replace(" ", "T") + "Z";
    }
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return null;
    return dt;
  }

  function encodePublicQr(publicUrl) {
    if (!publicUrl || typeof qrcodegen === "undefined" || !qrcodegen.QrCode) return null;
    return qrcodegen.QrCode.encodeText(publicUrl, qrcodegen.QrCode.Ecc.MEDIUM);
  }

  function drawQrCanvasDisplay(qr, modulePx, marginModules) {
    var size = qr.size;
    var totalModules = size + marginModules * 2;
    var scale = Math.max(1, Math.floor(modulePx));
    var canvasSize = totalModules * scale;
    var canvas = document.createElement("canvas");
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasSize, canvasSize);
    ctx.fillStyle = "#000000";
    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        if (qr.getModule(x, y)) {
          ctx.fillRect((x + marginModules) * scale, (y + marginModules) * scale, scale, scale);
        }
      }
    }
    return canvas;
  }

  function drawQrExportCanvas(qr, exportPx, marginModules) {
    var size = qr.size;
    var totalModules = size + marginModules * 2;
    var scale = Math.max(1, Math.floor(exportPx / totalModules));
    var qrPixelSize = totalModules * scale;
    var offset = Math.floor((exportPx - qrPixelSize) / 2);
    var canvas = document.createElement("canvas");
    canvas.width = exportPx;
    canvas.height = exportPx;
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, exportPx, exportPx);
    ctx.fillStyle = "#000000";
    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        if (qr.getModule(x, y)) {
          ctx.fillRect(offset + (x + marginModules) * scale, offset + (y + marginModules) * scale, scale, scale);
        }
      }
    }
    return canvas;
  }

  function renderQrToHost(host, qr, displayScale) {
    if (!host || !qr) return;
    host.textContent = "";
    var canvas = drawQrCanvasDisplay(qr, displayScale, QR_MARGIN_MODULES);
    if (!canvas) return;
    canvas.setAttribute("role", "img");
    host.appendChild(canvas);
  }

  function buildQrSvgDocument(qr, marginModules) {
    var size = qr.size;
    var total = size + marginModules * 2;
    var parts = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ' + total + " " + total + '" width="' + total + '" height="' + total + '">',
      '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>'
    ];
    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        if (qr.getModule(x, y)) {
          parts.push('<rect x="' + (x + marginModules) + '" y="' + (y + marginModules) + '" width="1" height="1" fill="#000000"/>');
        }
      }
    }
    parts.push("</svg>");
    return parts.join("");
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 500);
  }

  function exportFilename(publicId, ext) {
    var id = String(publicId || "card").replace(/[^a-zA-Z0-9_-]+/g, "");
    if (!id) id = "card";
    return "expresscard-" + id + "-qr." + ext;
  }

  var OWNER_LANG_ORDER_KEY = "excard_owner_lang_option_order";

  function ownerLangRoutesAll() {
    return ["sk", "cz", "en", "de"];
  }

  function ownerNormalizeLangRoute(route) {
    var r = String(route || "").toLowerCase();
    if (r === "cs") r = "cz";
    if (ownerLangRoutesAll().indexOf(r) === -1) return "";
    return r;
  }

  function ownerPersistLangOrder(order) {
    try {
      sessionStorage.setItem(OWNER_LANG_ORDER_KEY, JSON.stringify(order));
    } catch (e) {}
  }

  function ownerReadLangOrder() {
    try {
      var raw = sessionStorage.getItem(OWNER_LANG_ORDER_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length !== 4) return null;
      var seen = {};
      var ok = true;
      ownerLangRoutesAll().forEach(function (r) {
        seen[r] = 0;
      });
      parsed.forEach(function (r) {
        var norm = ownerNormalizeLangRoute(r);
        if (!norm) ok = false;
        else seen[norm] += 1;
      });
      ownerLangRoutesAll().forEach(function (r) {
        if (seen[r] !== 1) ok = false;
      });
      return ok ? parsed.map(ownerNormalizeLangRoute) : null;
    } catch (e) {
      return null;
    }
  }

  function ownerApplyLangOptionOrder(select) {
    var stored = ownerReadLangOrder();
    if (!stored) {
      var initial = [];
      Array.prototype.forEach.call(select.options, function (opt) {
        initial.push(ownerNormalizeLangRoute(opt.value));
      });
      ownerPersistLangOrder(initial);
      return;
    }
    var selectedRoute = ownerNormalizeLangRoute(select.value);
    stored.forEach(function (route) {
      var opt = select.querySelector('option[value="' + route + '"]');
      if (opt) select.appendChild(opt);
    });
    if (selectedRoute) select.value = selectedRoute;
  }

  function ownerRouteToUiLangCookie(route) {
    var r = ownerNormalizeLangRoute(route);
    return r === "cz" ? "cs" : r;
  }

  function ownerSetUiLangCookie(route) {
    var dict = ownerRouteToUiLangCookie(route);
    document.cookie = "excard_ui_lang=" + encodeURIComponent(dict) + "; path=/; max-age=31536000; secure; samesite=lax";
  }

  function ownerSyncLangSelectValue(route) {
    var norm = ownerNormalizeLangRoute(route);
    if (!norm) return;
    document.querySelectorAll("[data-ex-owner-lang-select]").forEach(function (sel) {
      if (ownerNormalizeLangRoute(sel.value) !== norm) sel.value = norm;
    });
  }

  function initOwnerLangSwitcher(onInpageChange) {
    document.querySelectorAll("[data-ex-owner-lang-select]").forEach(function (select) {
      if (select._exOwnerLangBound) return;
      select._exOwnerLangBound = true;
      ownerApplyLangOptionOrder(select);
      select.addEventListener("change", function () {
        var route = ownerNormalizeLangRoute(select.value);
        if (!route) return;
        ownerSetUiLangCookie(route);
        if (select.getAttribute("data-ex-owner-lang-inpage") === "1") {
          if (typeof onInpageChange === "function") {
            onInpageChange(route);
          } else {
            var pageCfg = readJsonNode("ex-owner-page-config");
            applyActivateI18n(pageCfg, route);
          }
          return;
        }
        var opt = select.options[select.selectedIndex];
        var href = opt && opt.getAttribute("data-ex-owner-lang-href");
        if (href) window.location.href = href;
      });
    });
  }

  function applyActivateI18n(pageCfg, route) {
    if (!pageCfg || !pageCfg.i18nAll) return;
    var dict = pageCfg.i18nAll[route] || pageCfg.i18nAll.sk || pageCfg.i18n;
    if (!dict) return;
    pageCfg.i18n = dict;
    if (pageCfg.lang) pageCfg.lang.route = route;
    var title = document.querySelector(".ex-public-owner-activate h1");
    var intro = document.querySelector(".ex-public-owner-activate p");
    var btn = document.getElementById("ex-owner-activate-btn");
    if (title) title.textContent = t(dict, "activateTitle", title.textContent);
    if (intro && intro.id !== "ex-owner-activate-status") intro.textContent = t(dict, "activateIntro", intro.textContent);
    if (btn) btn.textContent = t(dict, "activateBtn", btn.textContent);
    ownerSyncLangSelectValue(route);
    document.documentElement.setAttribute("lang", route === "en" ? "en" : route === "de" ? "de" : route === "cz" ? "cs" : "sk");
    ownerSetUiLangCookie(route);
  }

  var activateInFlight = false;

  function ownerActivationRedirect(target, pageCfg) {
    var url = new URL(target || "/owner/", window.location.origin);
    if (url.origin !== window.location.origin ||
        !/^\/owner(?:\/|$)/.test(url.pathname)) {
      url = new URL("/owner/", window.location.origin);
    }

    var current = new URL(window.location.href);
    if (current.searchParams.get("setup") === "homescreen") {
      url.searchParams.set("setup", "homescreen");
    }

    var route = pageCfg && pageCfg.lang
      ? pageCfg.lang.route
      : current.searchParams.get("lang");
    if (route === "cs") route = "cz";
    if (["sk", "cz", "en", "de"].indexOf(route) !== -1) {
      url.searchParams.set("lang", route);
    }

    url.hash = "";
    return url.pathname + url.search;
  }

  function initActivateAndHub() {
    var pageCfg = readJsonNode("ex-owner-page-config");
    var i18n = pageCfg && pageCfg.i18n ? pageCfg.i18n : {};
    initOwnerLangSwitcher(function (route) {
      applyActivateI18n(pageCfg, route);
      i18n = pageCfg && pageCfg.i18n ? pageCfg.i18n : {};
    });
    var activateBtn = document.getElementById("ex-owner-activate-btn");
    var statusNode = document.getElementById("ex-owner-activate-status");
    if (activateBtn) {
      activateBtn.addEventListener("click", function () {
        if (activateInFlight) return;
        var secret = readActivationSecret();
        var challenge = readChallenge();
        if (!secret || !challenge) {
          if (statusNode) {
            statusNode.hidden = false;
            statusNode.textContent = t(i18n, "activateInvalid", "Invalid link.");
          }
          return;
        }
        activateInFlight = true;
        activateBtn.disabled = true;
        if (statusNode) statusNode.hidden = true;
        exCardBusy.begin();
        postJson("/owner/activate", {
          activation_secret: secret,
          device_label: deviceLabel(),
          browser_challenge: challenge
        }, 0).then(function (env) {
          window.__exOwnerActivationSecret = "";
          if (env && env.httpOk && env.data && env.data.ok === true) {
            var redirect = env.data.redirect ? env.data.redirect : "/owner/";
            window.location.href = ownerActivationRedirect(redirect, pageCfg) || "/owner/";
            return;
          }
          var failCode = responseCode(env);
          if (failCode === "expressar_dsi_access_session_limit_reached") {
            exCardBusy.end();
            if (statusNode) {
              statusNode.hidden = false;
              statusNode.textContent = t(i18n, "activateSessionLimit", "Device limit reached.");
            }
            activateBtn.disabled = false;
            activateInFlight = false;
            return;
          }
          if (failCode === "expressar_dsi_access_activation_invalid" || failCode === "expressar_dsi_access_activation_consumed") {
            exCardBusy.end();
            if (statusNode) {
              statusNode.hidden = false;
              statusNode.textContent = t(i18n, "activateInvalid", "Invalid link.");
            }
            activateBtn.disabled = false;
            activateInFlight = false;
            return;
          }
          postSession({}).then(function (sessionEnv) {
            exCardBusy.end();
            if (sessionEnv && sessionEnv.httpOk && sessionEnv.data && sessionEnv.data.valid === true) {
              window.location.href = ownerActivationRedirect("/owner/", pageCfg);
              return;
            }
            if (statusNode) {
              statusNode.hidden = false;
              statusNode.textContent = mapApiMessage(i18n, env) || t(i18n, "activateFailed", "Activation failed.");
            }
            activateBtn.disabled = false;
            activateInFlight = false;
          });
        }).catch(function () {
          exCardBusy.end();
          activateBtn.disabled = false;
          activateInFlight = false;
        });
      });
    }
    var renewForm = document.getElementById("ex-owner-renew-form");
    var renewStatus = document.getElementById("ex-owner-renew-status");
    if (renewForm) {
      renewForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var emailInput = renewForm.querySelector('input[name="email"]');
        var email = emailInput ? String(emailInput.value || "").trim() : "";
        if (!email) return;
        var submitBtn = renewForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        exCardBusy.begin();
        postJson("/owner/api/renew", { email: email }, 0).then(function (env) {
          exCardBusy.end();
          if (renewStatus) {
            renewStatus.hidden = false;
            if (env && env.httpOk && env.data && (env.data.ok === true || env.data.message)) {
              renewStatus.textContent = t(i18n, "renewSuccess", "") + " " + t(i18n, "renewDeviceHint", "") + " " + t(i18n, "activationLinkValidity", "");
            } else {
              renewStatus.textContent = mapApiMessage(i18n, env);
            }
          }
          if (submitBtn) submitBtn.disabled = false;
        }).catch(function () {
          exCardBusy.end();
          if (submitBtn) submitBtn.disabled = false;
        });
      });
    }
  }

  function initOwnerApp() {
    var root = document.querySelector("[data-ex-owner-app]");
    if (!root) return;
    if (ownerAppBound) return;
    var cfg = readJsonNode("ex-owner-app-config");
    if (!cfg || !cfg.card_ref) return;
    ownerAppBound = true;
    var i18n = cfg.i18n || {};
    var locale = cfg.lang && cfg.lang.locale ? cfg.lang.locale : "sk-SK";
    var publicUrl = String(cfg.public_url || "");
    var cardRef = String(cfg.card_ref || "");
    var publicId = String(cfg.public_id || cardRef || "");
    var api = cfg.api || {};
    var revalidating = false;
    var revalidateRetryPending = false;
    var privateAllowed = true;
    var activeContactId = 0;
    var detailGen = 0;
    var contactsGen = 0;
    var contactsNextOffset = 0;
    var contactsHasMore = false;
    var contactsLoading = false;
    var contactsSeen = {};
    var lastUnread = null;
    var qrMatrix = null;

    var live = root.querySelector("[data-ex-owner-live]");
    var countError = root.querySelector("[data-ex-owner-count-error]");
    var countErrorText = root.querySelector("[data-ex-owner-count-error-text]");
    var countRetry = root.querySelector("[data-ex-owner-count-retry]");

    function announce(message) {
      if (live) live.textContent = message || "";
    }

    var panels = {
      qr: document.querySelector('[data-ex-owner-panel="qr"]'),
      export: document.querySelector('[data-ex-owner-panel="export"]'),
      share: document.querySelector('[data-ex-owner-panel="share"]'),
      contacts: document.querySelector('[data-ex-owner-panel="contacts"]'),
      detail: document.querySelector('[data-ex-owner-panel="detail"]'),
      homescreen: document.querySelector('[data-ex-owner-panel="homescreen"]')
    };

    function isStandaloneDisplay() {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
        return true;
      }
      return window.navigator && window.navigator.standalone === true;
    }

    function homescreenInstallUx() {
      var ua = navigator.userAgent || "";
      var ios = /iPhone|iPod/i.test(ua) || (/\b(iPad|Macintosh)\b/i.test(ua) && navigator.maxTouchPoints > 1);
      if (ios) {
        if (/CriOS/i.test(ua)) return "ios-chrome";
        if (/FxiOS|EdgiOS|OPiOS/i.test(ua)) return "ios-other";
        return "ios-safari";
      }
      if (/Android/i.test(ua)) return "android";
      return "desktop";
    }

    function fillHomescreenGuideSteps() {
      if (!panels.homescreen) return;
      var list = panels.homescreen.querySelector("[data-ex-owner-homescreen-steps]");
      if (!list) return;
      var platform = homescreenInstallUx();
      var keys = platform === "ios-safari"
        ? ["homescreenGuideIosSafari1", "homescreenGuideIosSafari2", "homescreenGuideIosSafari3", "homescreenGuideIosSafari4"]
        : platform === "ios-chrome"
          ? ["homescreenGuideIosChrome1", "homescreenGuideIosChrome2", "homescreenGuideIosChrome3", "homescreenGuideIosChrome4"]
          : platform === "ios-other"
            ? ["homescreenGuideIosOther1", "homescreenGuideIosOther2", "homescreenGuideIosOther3"]
            : platform === "android"
              ? ["homescreenGuideAndroid1", "homescreenGuideAndroid2", "homescreenGuideAndroid3"]
              : ["homescreenGuideDesktop1", "homescreenGuideDesktop2"];
      list.textContent = "";
      keys.forEach(function (key) {
        var text = t(i18n, key, "");
        if (!text) return;
        var li = document.createElement("li");
        li.textContent = text;
        list.appendChild(li);
      });
    }

    function openHomescreenGuide(opener) {
      if (!panels.homescreen) return;
      fillHomescreenGuideSteps();
      openPanel("homescreen", opener);
    }

    function handleHomescreenAction(opener) {
      if (deferredInstallPrompt && !installPromptConsumed) {
        var promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        installPromptConsumed = true;
        promptEvent.prompt();
        if (promptEvent.userChoice && typeof promptEvent.userChoice.then === "function") {
          promptEvent.userChoice.then(function () {
            /* dismissal is not success; appinstalled handles install signal */
          });
        }
        return;
      }
      openHomescreenGuide(opener);
    }

    var panelOpener = null;
    var exportFromQr = false;

    function restorePanelFocus() {
      if (panelOpener && typeof panelOpener.focus === "function") {
        panelOpener.focus();
      }
      panelOpener = null;
    }

    function closeAllPanels() {
      Object.keys(panels).forEach(function (key) {
        if (panels[key]) panels[key].hidden = true;
      });
      exportFromQr = false;
      restorePanelFocus();
    }

    function closeExportPanel() {
      if (panels.export) panels.export.hidden = true;
      if (exportFromQr && panels.qr) {
        panels.qr.hidden = false;
        exportFromQr = false;
        var qrClose = panels.qr.querySelector("[data-ex-owner-panel-close]");
        if (qrClose && typeof qrClose.focus === "function") qrClose.focus();
        return;
      }
      closeAllPanels();
    }

    function focusPanelClose(panel) {
      if (!panel) return;
      var btn = panel.querySelector("[data-ex-owner-panel-close], [data-ex-owner-export-close]");
      if (btn && typeof btn.focus === "function") btn.focus();
    }

    function clearPrivateData() {
      detailGen += 1;
      contactsGen += 1;
      activeContactId = 0;
      contactsSeen = {};
      contactsNextOffset = 0;
      contactsHasMore = false;
      if (contactList) contactList.textContent = "";
      if (contactsMoreWrap) contactsMoreWrap.hidden = true;
      if (panels.detail) {
        var detailHost = panels.detail.querySelector("[data-ex-owner-detail]");
        var nameNode = panels.detail.querySelector("[data-ex-owner-detail-name]");
        var noteField = panels.detail.querySelector("[data-ex-owner-note]");
        if (detailHost) detailHost.textContent = "";
        if (nameNode) nameNode.textContent = "";
        if (noteField) noteField.value = "";
      }
      lastUnread = null;
      if (unreadBadge) {
        unreadBadge.hidden = true;
        unreadBadge.textContent = "0";
      }
      if (countError) countError.hidden = true;
    }

    function setPrivateUi(enabled) {
      if (contactsBtn) contactsBtn.disabled = !enabled;
      if (panels.contacts) {
        if (!enabled) panels.contacts.hidden = true;
        if (enabled) panels.contacts.removeAttribute("inert");
        else panels.contacts.setAttribute("inert", "");
      }
      if (panels.detail) {
        if (!enabled) panels.detail.hidden = true;
        if (enabled) panels.detail.removeAttribute("inert");
        else panels.detail.setAttribute("inert", "");
      }
    }

    function failClosed() {
      privateAllowed = false;
      clearPrivateData();
      closeAllPanels();
      root.innerHTML = "";
      window.location.replace("/owner/");
    }

    function failCardDenied() {
      privateAllowed = false;
      clearPrivateData();
      closeAllPanels();
      window.location.replace("/owner/?view=cards");
    }

    function showRevalidateUnavailable() {
      revalidateRetryPending = true;
      if (countError && countErrorText) {
        countError.hidden = false;
        countErrorText.textContent = t(i18n, "bootstrapUnavailable", t(i18n, "errorUnavailable", ""));
      }
      announce(t(i18n, "bootstrapUnavailable", t(i18n, "errorUnavailable", "")));
    }

    function applyOwnerPublicationState(publicationRequest) {
      var pubEl = root.querySelector("[data-ex-owner-publication-state]");
      if (!pubEl || !privateAllowed) {
        return;
      }
      if (!publicationRequest || typeof publicationRequest !== "object") {
        pubEl.hidden = true;
        pubEl.textContent = "";
        return;
      }
      var state = String(publicationRequest.state || "");
      var lines = [];
      if (publicationRequest.show_unpublished_notice && (state === "unpublished" || state === "request_stale" || state === "request_mail_failed")) {
        lines.push(t(i18n, "publicationUnpublished", "Uložené | Nezverejnené"));
      }
      if (state === "request_sent") {
        lines.push(t(i18n, "publicationRequestSent", "Žiadosť o zverejnenie bola odoslaná."));
      } else if (state === "request_pending") {
        lines.push(t(i18n, "publicationRequestPending", "Žiadosť je zaevidovaná. Upozornenie správcovi sa odosiela."));
      } else if (state === "unavailable") {
        lines.push(t(i18n, "publicationStateUnavailable", "Stav zverejnenia sa momentálne nepodarilo overiť."));
      } else if (state === "request_stale") {
        lines.push(t(i18n, "publicationRequestStale", "Od poslednej žiadosti ste uložili ďalšie zmeny."));
      } else if (state === "request_mail_failed") {
        lines.push(t(i18n, "publicationMailFailed", "Upozornenie správcovi sa nepodarilo odoslať."));
      }
      if (!lines.length) {
        pubEl.hidden = true;
        pubEl.textContent = "";
        return;
      }
      pubEl.textContent = lines.join(" ");
      pubEl.hidden = false;
    }

    function applySessionEditorAccess(editorAccess) {
      if (!manageBtn || !api.editor_link || !privateAllowed) return;
      if (!editorAccess || typeof editorAccess !== "object") return;
      editLinkGen += 1;
      applyEditorLinkResponse(
        {
          httpOk: true,
          status: 200,
          data: editorAccess,
          networkError: false,
          parseError: false
        },
        editLinkGen
      );
    }

    function revalidate(force) {
      if (revalidateInFlight) return revalidateInFlight;
      revalidating = true;
      revalidateRetryPending = false;
      privateAllowed = false;
      setPrivateUi(false);
      if (countError) countError.hidden = true;
      revalidateInFlight = postSession({ card_ref: cardRef })
        .then(function (env) {
          revalidating = false;
          revalidateInFlight = null;
          if (env && env.networkError) {
            showRevalidateUnavailable();
            return;
          }
          var payload = env && env.data ? env.data : null;
          if (!env || !env.httpOk || !payload) {
            showRevalidateUnavailable();
            return;
          }
          if (payload.unavailable === true) {
            showRevalidateUnavailable();
            return;
          }
          if (payload.valid !== true) {
            failClosed();
            return;
          }
          if (payload.card_allowed !== true) {
            failCardDenied();
            return;
          }
          privateAllowed = true;
          setPrivateUi(true);
          announce("");
          refreshUnread();
          applySessionEditorAccess(payload.editor_access);
          applyOwnerPublicationState(payload.publication_request);
        })
        .catch(function () {
          revalidating = false;
          revalidateInFlight = null;
          showRevalidateUnavailable();
        });
      return revalidateInFlight;
    }

    document.cookie = "excard_owner_pref=" + encodeURIComponent(cardRef) + "; path=/; max-age=2592000; secure; samesite=lax";
    ownerBootstrapped = true;
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) revalidate(true);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") revalidate(true);
    });

    function openPanel(name, opener) {
      if (opener) panelOpener = opener;
      Object.keys(panels).forEach(function (key) {
        if (panels[key]) panels[key].hidden = true;
      });
      exportFromQr = false;
      if (panels[name]) {
        panels[name].hidden = false;
        focusPanelClose(panels[name]);
      }
    }

    function bindPanelClose(panel, closeFn) {
      if (!panel) return;
      panel.querySelectorAll("[data-ex-owner-panel-close]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (typeof closeFn === "function") closeFn();
          else closeAllPanels();
        });
      });
    }

    function bindPanelBackdrop(panel, closeFn) {
      if (!panel) return;
      panel.addEventListener("click", function (event) {
        if (event.target !== panel) return;
        if (typeof closeFn === "function") closeFn();
        else closeAllPanels();
      });
    }

    bindPanelClose(panels.qr);
    bindPanelClose(panels.share);
    bindPanelClose(panels.contacts);
    bindPanelClose(panels.detail);
    bindPanelClose(panels.homescreen);
    bindPanelBackdrop(panels.qr);
    bindPanelBackdrop(panels.share);
    bindPanelBackdrop(panels.contacts);
    bindPanelBackdrop(panels.detail);
    bindPanelBackdrop(panels.homescreen);
    bindPanelBackdrop(panels.export, closeExportPanel);

    var homescreenBtn = root.querySelector("[data-ex-owner-homescreen]");
    if (homescreenBtn) {
      if (isStandaloneDisplay()) {
        homescreenBtn.hidden = true;
        var serviceNav = root.querySelector(".ex-public-owner-app__service");
        if (serviceNav) serviceNav.hidden = true;
      } else {
        var homescreenLabel = homescreenBtn.querySelector("[data-ex-owner-homescreen-label]");
        if (homescreenLabel) {
          homescreenLabel.textContent = deferredInstallPrompt && !installPromptConsumed
            ? t(i18n, "actionHomescreen", "Pridať na plochu")
            : t(i18n, "actionHomescreenGuide", "Ako pridať na plochu");
        }
        homescreenBtn.addEventListener("click", function () {
          handleHomescreenAction(homescreenBtn);
        });
      }
    }

   /* Návod sa otvára iba po výslovnom kliknutí používateľa. */

    var detailBack = panels.detail ? panels.detail.querySelector("[data-ex-owner-detail-back]") : null;
    if (detailBack) {
      detailBack.addEventListener("click", function () {
        detailGen += 1;
        if (panels.detail && panels.contacts) {
          panels.detail.hidden = true;
          panels.contacts.hidden = false;
          focusPanelClose(panels.contacts);
        }
      });
    }

    var logoutDialog = document.querySelector("[data-ex-owner-logout-dialog]");
    var logoutClose = logoutDialog ? logoutDialog.querySelector("[data-ex-owner-logout-close]") : null;
    var logoutConfirm = logoutDialog ? logoutDialog.querySelector("[data-ex-owner-logout-confirm]") : null;
    var logoutOpener = null;
    var logoutInFlight = false;
    var editRequestDialog = document.querySelector("[data-ex-owner-edit-request-dialog]");
    var editRequestClose = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-request-close]") : null;
    var editRequestConfirm = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-request-confirm]") : null;
    var editRequestOpener = null;

    function closeLogoutDialog() {
      if (!logoutDialog || logoutDialog.hidden || logoutInFlight) return;
      logoutDialog.hidden = true;
      if (logoutConfirm) logoutConfirm.disabled = false;
      if (logoutOpener && typeof logoutOpener.focus === "function") logoutOpener.focus();
      logoutOpener = null;
    }

    function openLogoutDialog(opener) {
      if (!logoutDialog || logoutInFlight) return;
      logoutOpener = opener || null;
      logoutDialog.hidden = false;
      if (logoutClose) logoutClose.focus();
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.key === "Esc") {
        if (logoutDialog && !logoutDialog.hidden) {
          event.preventDefault();
          closeLogoutDialog();
          return;
        }
        if (editRequestDialog && !editRequestDialog.hidden) {
          event.preventDefault();
          closeEditRequestDialog();
          return;
        }
        if (panels.export && !panels.export.hidden) {
          event.preventDefault();
          closeExportPanel();
          return;
        }
        closeAllPanels();
      }
    });

    if (logoutDialog) {
      logoutDialog.addEventListener("click", function (event) {
        if (event.target === logoutDialog) closeLogoutDialog();
      });
    }
    if (logoutClose) {
      logoutClose.addEventListener("click", function () {
        closeLogoutDialog();
      });
    }
    if (logoutConfirm) {
      logoutConfirm.addEventListener("click", function () {
        if (logoutInFlight) return;
        logoutInFlight = true;
        logoutConfirm.disabled = true;
        postJson(api.revoke || "/owner/api/revoke", {}, 0).then(function (env) {
          logoutInFlight = false;
          if (env && env.httpOk) {
            closeLogoutDialog();
            failClosed();
            return;
          }
          if (logoutConfirm) logoutConfirm.disabled = false;
          announce(t(i18n, "logoutFailed", ""));
        });
      });
    }

    function ensureQrMatrix() {
      if (!qrMatrix && publicUrl) qrMatrix = encodePublicQr(publicUrl);
      return qrMatrix;
    }

    var openQrBtn = root.querySelector("[data-ex-owner-open-qr]");
    if (openQrBtn) {
      openQrBtn.addEventListener("click", function () {
        var qr = ensureQrMatrix();
        var host = panels.qr ? panels.qr.querySelector("[data-ex-owner-qr]") : null;
        if (!qr || !host) {
          announce(t(i18n, "publicUrlMissing", ""));
          return;
        }
        renderQrToHost(host, qr, 4);
        openPanel("qr", openQrBtn);
      });
    }

    var downloadQrBtn = panels.qr ? panels.qr.querySelector("[data-ex-owner-download-qr]") : null;
    if (downloadQrBtn) {
      downloadQrBtn.addEventListener("click", function () {
        if (!ensureQrMatrix()) {
          announce(t(i18n, "exportFailed", ""));
          return;
        }
        exportFromQr = true;
        if (panels.qr) panels.qr.hidden = true;
        if (panels.export) {
          panels.export.hidden = false;
          focusPanelClose(panels.export);
        }
      });
    }

    var exportClose = document.querySelector("[data-ex-owner-export-close]");
    if (exportClose) {
      exportClose.addEventListener("click", function () {
        closeExportPanel();
      });
    }

    var exportPng = document.querySelector("[data-ex-owner-export-png]");
    if (exportPng) {
      exportPng.addEventListener("click", function () {
        var qr = ensureQrMatrix();
        if (!qr) {
          announce(t(i18n, "exportFailed", ""));
          return;
        }
        var canvas = drawQrExportCanvas(qr, QR_EXPORT_SIZE, QR_MARGIN_MODULES);
        if (!canvas || canvas.width !== QR_EXPORT_SIZE || canvas.height !== QR_EXPORT_SIZE) {
          announce(t(i18n, "exportFailed", ""));
          return;
        }
        canvas.toBlob(function (blob) {
          if (!blob) {
            announce(t(i18n, "exportFailed", ""));
            return;
          }
          downloadBlob(blob, exportFilename(publicId, "png"));
          closeExportPanel();
        }, "image/png");
      });
    }

    var exportSvg = document.querySelector("[data-ex-owner-export-svg]");
    if (exportSvg) {
      exportSvg.addEventListener("click", function () {
        var qr = ensureQrMatrix();
        if (!qr) {
          announce(t(i18n, "exportFailed", ""));
          return;
        }
        var svg = buildQrSvgDocument(qr, QR_MARGIN_MODULES);
        var blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        downloadBlob(blob, exportFilename(publicId, "svg"));
        closeExportPanel();
      });
    }

    function showShareManual() {
      var field = document.querySelector("[data-ex-owner-share-field]");
      var hint = document.querySelector("[data-ex-owner-share-hint]");
      if (field) {
        field.value = publicUrl;
        field.focus();
        field.select();
      }
      if (hint) {
        hint.hidden = false;
        hint.textContent = t(i18n, "shareManualHint", "");
      }
      openPanel("share");
    }

    function copyPublicUrl() {
      if (!publicUrl) {
        announce(t(i18n, "publicUrlMissing", ""));
        return;
      }
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(publicUrl).then(function () {
          announce(t(i18n, "shareCopied", ""));
        }).catch(function () {
          showShareManual();
        });
        return;
      }
      showShareManual();
    }

    var shareBtn = root.querySelector("[data-ex-owner-share]");
    if (shareBtn) shareBtn.addEventListener("click", copyPublicUrl);

    var logoutBtn = root.querySelector("[data-ex-owner-logout]");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        openLogoutDialog(logoutBtn);
      });
    }

    var manageBtn = root.querySelector("[data-ex-owner-manage]");
    var editRequestNode = root.querySelector("[data-ex-owner-edit-request]");
    var editLinkGen = 0;
    var nameNode = root.querySelector("#ex-owner-display-name");

    function cardDisplayLabel() {
      if (!nameNode) return "";
      return String(nameNode.textContent || "").trim();
    }

    function canonicalEditorPublicId() {
      return String(publicId || "").trim();
    }

    function isValidHttpsEditUrl(url, requireHandoffFragment) {
      if (!url || typeof url !== "string") return false;
      var expectedCard = canonicalEditorPublicId();
      if (!expectedCard) return false;
      try {
        var parsed = new URL(url, window.location.origin);
        var baseOk = parsed.protocol === "https:" &&
        parsed.hostname === "expressar.eu" &&
        parsed.port === "" &&
        parsed.username === "" &&
        parsed.password === "" &&
        /^\/(?:(?:sk|cz|en|de)\/)?expresscard-management\/?$/.test(parsed.pathname) &&
        parsed.searchParams.get("card") === expectedCard;
        if (!baseOk) return false;
        var entry = parsed.searchParams.get("excard_entry");
        if (entry && entry !== "manager" && entry !== "delegated") return false;
        if (!requireHandoffFragment) {
          if (entry === "delegated") return false;
          return true;
        }
        if (entry && entry !== "delegated") return false;
        var hash = String(parsed.hash || "").replace(/^#/, "");
        if (!hash) return false;
        return hash.split("&").some(function (part) {
          var idx = part.indexOf("=");
          if (idx < 0) return false;
          return decodeURIComponent(part.slice(0, idx)) === "ex_edit" &&
            decodeURIComponent(part.slice(idx + 1)).length > 0;
        });
      } catch (e) {
        return false;
      }
    }

    function editorPayloadCanShowManage(payload) {
      if (!payload || payload.can_edit !== true) return false;
      if (payload.mode === "delegated") return true;
      if (payload.mode === "manager") return isValidHttpsEditUrl(payload.edit_url, false);
      return false;
    }

    function editorPayloadCanNavigate(payload) {
      if (!payload || payload.can_edit !== true) return false;
      if (payload.mode === "delegated") return isValidHttpsEditUrl(payload.edit_url, true);
      if (payload.mode === "manager") return isValidHttpsEditUrl(payload.edit_url, false);
      return false;
    }

    function isManagerEmail(value) {
      if (!value || typeof value !== "string") return false;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
    }

    function clearEditRequestUi() {
      if (!editRequestNode) return;
      editRequestNode.textContent = "";
      editRequestNode.hidden = true;
    }

    var editRequestInFlight = false;

    function closeEditRequestDialog() {
      if (!editRequestDialog || editRequestDialog.hidden || editRequestInFlight) return;
      editRequestDialog.hidden = true;
      if (editRequestConfirm) editRequestConfirm.disabled = false;
      if (editRequestOpener && typeof editRequestOpener.focus === "function") editRequestOpener.focus();
      editRequestOpener = null;
    }

    function openEditRequestDialog(opener) {
      if (!editRequestDialog || editRequestInFlight) return;
      editRequestOpener = opener || null;
      editRequestDialog.hidden = false;
      if (editRequestClose) editRequestClose.focus();
    }

    function submitEditRequest() {
      if (editRequestInFlight || !api.edit_request) return;
      editRequestInFlight = true;
      if (editRequestConfirm) editRequestConfirm.disabled = true;
      postJson(api.edit_request, {
        card_ref: cardRef,
        card_label: cardDisplayLabel() || cardRef
      }, 0).then(function (env) {
        editRequestInFlight = false;
        if (editRequestConfirm) editRequestConfirm.disabled = false;
        closeEditRequestDialog();
        if (env && env.httpOk && env.data && env.data.ok === true) {
          announce(t(i18n, "editRequestSent", ""));
          return;
        }
        if (env && env.status === 429) {
          announce(t(i18n, "editRequestRateLimited", ""));
          return;
        }
        if (!env || env.networkError) {
          announce(t(i18n, "editRequestFailed", ""));
          return;
        }
        announce(t(i18n, "editRequestFailed", ""));
      }).catch(function () {
        editRequestInFlight = false;
        if (editRequestConfirm) editRequestConfirm.disabled = false;
        closeEditRequestDialog();
        announce(t(i18n, "editRequestFailed", ""));
      });
    }

    if (editRequestDialog) {
      editRequestDialog.addEventListener("click", function (event) {
        if (event.target === editRequestDialog) closeEditRequestDialog();
      });
    }
    if (editRequestClose) {
      editRequestClose.addEventListener("click", function () {
        closeEditRequestDialog();
      });
    }
    if (editRequestConfirm) {
      editRequestConfirm.addEventListener("click", function () {
        submitEditRequest();
      });
    }

    function renderEditRequest() {
      if (!editRequestNode) return;
      editRequestNode.textContent = "";
      var lead = t(i18n, "editRequestLead", "");
      var linkText = t(i18n, "editRequestLink", "");
      if (lead) {
        var leadLine = document.createElement("span");
        leadLine.className = "ex-public-owner-app__edit-request-line";
        leadLine.textContent = lead;
        editRequestNode.appendChild(leadLine);
      }
      if (api.edit_request && linkText) {
        var actionLine = document.createElement("span");
        actionLine.className = "ex-public-owner-app__edit-request-line";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ex-public-owner-app__edit-request-link";
        btn.textContent = linkText;
        btn.addEventListener("click", function () {
          openEditRequestDialog(btn);
        });
        actionLine.appendChild(btn);
        editRequestNode.appendChild(actionLine);
      }
      editRequestNode.hidden = !editRequestNode.childNodes.length;
    }

    function showEditLinkServiceError() {
      clearEditRequestUi();
      if (manageBtn) manageBtn.hidden = true;
      announce(t(i18n, "editLinkUnavailable", t(i18n, "errorUnavailable", "")));
    }

    function applyManageCtaLabel(payload) {
      if (!manageBtn) return;
      var span = manageBtn.querySelector("[data-ex-owner-manage-label]");
      if (!span || !payload) return;
      if (payload.mode === "manager") {
        span.textContent = t(i18n, "actionManage", t(i18n, "actionEdit", ""));
        return;
      }
      if (payload.mode === "delegated") {
        span.textContent = t(i18n, "actionEditDelegated", t(i18n, "actionEdit", ""));
      }
    }

    function applyEditorLinkResponse(env, gen) {
      if (gen !== editLinkGen || !privateAllowed) return;
      if (manageBtn) {
        manageBtn.disabled = false;
        manageBtn.hidden = true;
      }
      clearEditRequestUi();
      if (!env || env.networkError || env.parseError) {
        showEditLinkServiceError();
        return;
      }
      if (!env.httpOk || !env.data || env.status >= 500 || env.status === 429) {
        showEditLinkServiceError();
        return;
      }
      var payload = env.data;
      if (typeof payload.can_edit !== "boolean") {
        showEditLinkServiceError();
        return;
      }
      if (editorPayloadCanShowManage(payload)) {
        applyManageCtaLabel(payload);
        if (manageBtn) manageBtn.hidden = false;
        announce("");
        return;
      }
      if (payload.can_edit === false) {
        renderEditRequest();
        announce("");
        return;
      }
      showEditLinkServiceError();
    }

    function refreshEditorLinkAccess() {
      if (!manageBtn || !api.editor_link || !privateAllowed) {
        editLinkGen += 1;
        if (manageBtn) {
          manageBtn.hidden = true;
          manageBtn.disabled = false;
        }
        clearEditRequestUi();
        return;
      }
      editLinkGen += 1;
      var gen = editLinkGen;
      if (manageBtn) {
        manageBtn.hidden = true;
        manageBtn.disabled = true;
      }
      clearEditRequestUi();
      postJson(api.editor_link, { card_ref: cardRef }, 0)
        .then(function (env) {
          applyEditorLinkResponse(env, gen);
        })
        .catch(function () {
          if (gen !== editLinkGen) return;
          if (manageBtn) manageBtn.disabled = false;
          showEditLinkServiceError();
        });
    }

    if (manageBtn && api.editor_link) {
      manageBtn.hidden = true;
      if (cfg && cfg.editor_access && typeof cfg.editor_access === "object") {
        editLinkGen += 1;
        applyEditorLinkResponse(
          {
            httpOk: true,
            status: 200,
            data: cfg.editor_access,
            networkError: false,
            parseError: false
          },
          editLinkGen
        );
      }
      if (cfg && cfg.publication_request) {
        applyOwnerPublicationState(cfg.publication_request);
      }
      manageBtn.addEventListener("click", function () {
        if (!privateAllowed) return;
        editLinkGen += 1;
        var gen = editLinkGen;
        manageBtn.disabled = true;
        clearEditRequestUi();
        postJson(api.editor_link, { card_ref: cardRef }, 0)
          .then(function (env) {
            applyEditorLinkResponse(env, gen);
            if (gen !== editLinkGen) return;
            var payload = env && env.data ? env.data : null;
            if (gen === editLinkGen && privateAllowed && env && env.httpOk === true && !env.networkError && !env.parseError && editorPayloadCanNavigate(payload)) {
              window.location.href = String(payload.edit_url);
            }
          })
          .catch(function () {
            if (gen !== editLinkGen) return;
            manageBtn.disabled = false;
            showEditLinkServiceError();
          });
      });
    }

    var contactsBtn = root.querySelector("[data-ex-owner-contacts]");
    var unreadBadge = root.querySelector("[data-ex-owner-unread]");
    var contactList = root.querySelector("[data-ex-owner-contact-list]");
    var contactsMoreWrap = root.querySelector(".ex-public-owner-app__contact-more-wrap");
    var contactsMoreBtn = root.querySelector("[data-ex-owner-contacts-more]");

    function setUnread(count, verified) {
      var n = parseInt(count, 10);
      if (isNaN(n) || n < 0) n = 0;
      if (verified) lastUnread = n;
      if (!unreadBadge) return;
      if (n > 0) {
        unreadBadge.hidden = false;
        unreadBadge.textContent = String(n);
      } else if (verified) {
        unreadBadge.hidden = true;
        unreadBadge.textContent = "0";
      }
      if (countError && verified) countError.hidden = true;
    }

    function showCountError() {
      if (unreadBadge) unreadBadge.hidden = true;
      if (countError && countErrorText) {
        countError.hidden = false;
        countErrorText.textContent = t(i18n, "countError", "");
      }
    }

    function refreshUnread() {
      if (!api.contacts_count || !privateAllowed) return;
      postJson(api.contacts_count, { card_ref: cardRef }, 0).then(function (env) {
        if (!privateAllowed) return;
        if (!isCountResponse(env)) {
          showCountError();
          return;
        }
        var count = env.data.unread_count;
        if (typeof count !== "number" && typeof env.data.count === "number") count = env.data.count;
        if (typeof count === "number") setUnread(count, true);
        else showCountError();
      });
    }

    if (countRetry) {
      countRetry.addEventListener("click", function () {
        if (revalidateRetryPending) {
          revalidate(true);
          return;
        }
        refreshUnread();
      });
    }

    function updateListItemRead(contactId) {
      if (!contactList) return;
      var btn = contactList.querySelector('[data-contact-id="' + contactId + '"]');
      if (btn) btn.removeAttribute("data-unread");
    }

    function appendContactItem(item) {
      if (!item || !item.id || contactsSeen[item.id]) return;
      contactsSeen[item.id] = true;
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ex-public-owner-app__contact-item";
      btn.setAttribute("data-contact-id", String(item.id));
      if (item.is_unread) btn.setAttribute("data-unread", "1");
      var name = document.createElement("span");
      name.className = "ex-public-owner-app__contact-name";
      name.textContent = item.name || t(i18n, "contactDefault", "Kontakt");
      var meta = document.createElement("span");
      meta.className = "ex-public-owner-app__contact-meta";
      var received = parseReceivedDate(item);
      if (received && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        try {
          meta.textContent = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(received);
        } catch (e) {
          meta.textContent = purposeLabel(i18n, item);
        }
      } else {
        meta.textContent = purposeLabel(i18n, item);
      }
      btn.appendChild(name);
      btn.appendChild(meta);
      btn.addEventListener("click", function () {
        openContactDetail(item.id);
      });
      li.appendChild(btn);
      contactList.appendChild(li);
    }

    function updateContactsMoreUi() {
      if (!contactsMoreWrap) return;
      contactsMoreWrap.hidden = !contactsHasMore;
      if (contactsMoreBtn) contactsMoreBtn.disabled = contactsLoading;
    }

    function loadContactsPage(offset, append) {
      if (!privateAllowed || !api.contacts_list || contactsLoading) return;
      var gen = contactsGen;
      contactsLoading = true;
      updateContactsMoreUi();
      exCardBusy.begin();
      postJson(api.contacts_list, { card_ref: cardRef, offset: offset }, 0).then(function (env) {
        contactsLoading = false;
        exCardBusy.end();
        if (gen !== contactsGen || !privateAllowed) return;
        if (!isListResponse(env)) {
          if (append) announce(t(i18n, "contactsLoadMoreError", ""));
          else announce(mapApiMessage(i18n, env));
          updateContactsMoreUi();
          return;
        }
        if (typeof env.data.unread_count === "number") setUnread(env.data.unread_count, true);
        contactsHasMore = !!env.data.has_more;
        contactsNextOffset = typeof env.data.next_offset === "number" ? env.data.next_offset : offset + (env.data.items ? env.data.items.length : 0);
        if (!append && (!env.data.items || !env.data.items.length)) {
          var empty = document.createElement("li");
          empty.className = "ex-public-owner-app__contact-empty";
          empty.textContent = t(i18n, "contactsEmpty", "");
          contactList.appendChild(empty);
        } else {
          (env.data.items || []).forEach(appendContactItem);
        }
        updateContactsMoreUi();
        if (!append) openPanel("contacts");
      });
    }

    function openContactsList() {
      if (!privateAllowed || !panels.contacts || !contactList || !api.contacts_list) return;
      contactsGen += 1;
      contactsSeen = {};
      contactsNextOffset = 0;
      contactsHasMore = false;
      contactList.textContent = "";
      loadContactsPage(0, false);
    }

    if (contactsMoreBtn) {
      contactsMoreBtn.addEventListener("click", function () {
        if (!contactsHasMore || contactsLoading) return;
        loadContactsPage(contactsNextOffset, true);
      });
    }

    function openContactDetail(id) {
      if (!privateAllowed || !panels.detail || !api.contacts_detail) return;
      var requestId = parseInt(id, 10);
      if (!requestId) return;
      var gen = ++detailGen;
      activeContactId = requestId;
      var detailHost = panels.detail.querySelector("[data-ex-owner-detail]");
      var nameNode = panels.detail.querySelector("[data-ex-owner-detail-name]");
      var noteField = panels.detail.querySelector("[data-ex-owner-note]");
      if (!detailHost) return;
      detailHost.textContent = "";
      postJson(api.contacts_detail, { card_ref: cardRef, id: requestId }, 0).then(function (env) {
        if (gen !== detailGen || !privateAllowed) return;
        if (!isDetailResponse(env)) {
          announce(t(i18n, "contactLoadFailed", ""));
          return;
        }
        var item = env.data;
        if (nameNode) nameNode.textContent = item.name || t(i18n, "contactDefault", "Kontakt");
        if (noteField) noteField.value = item.owner_note || "";
        var rows = [
          [t(i18n, "fieldEmail", "E-mail"), item.email],
          [t(i18n, "fieldPhone", "Telefón"), item.phone],
          [t(i18n, "fieldCompany", "Firma"), item.company],
          [t(i18n, "fieldPosition", "Pozícia"), item.position],
          [t(i18n, "fieldPurpose", "Účel"), purposeLabel(i18n, item)],
          [t(i18n, "fieldMessage", "Správa"), item.message]
        ];
        rows.forEach(function (pair) {
          if (!pair[1]) return;
          var p = document.createElement("p");
          var strong = document.createElement("strong");
          strong.textContent = pair[0] + ": ";
          p.appendChild(strong);
          p.appendChild(document.createTextNode(String(pair[1])));
          detailHost.appendChild(p);
        });
        if (panels.contacts) panels.contacts.hidden = true;
        openPanel("detail");
        if (item.is_unread && api.contacts_read) {
          var readGen = gen;
          var readId = requestId;
          postJson(api.contacts_read, { card_ref: cardRef, id: readId }, 0).then(function (readEnv) {
            if (readGen !== detailGen || !privateAllowed) return;
            if (!isOkMutation(readEnv)) return;
            updateListItemRead(readId);
            refreshUnread();
          });
        }
      });
    }

    if (contactsBtn && api.contacts_list) {
      contactsBtn.addEventListener("click", openContactsList);
    }
    refreshUnread();

    var readBtn = panels.detail ? panels.detail.querySelector("[data-ex-owner-mark-read]") : null;
    if (readBtn && api.contacts_read) {
      readBtn.addEventListener("click", function () {
        var contactId = activeContactId;
        if (!contactId || !privateAllowed) return;
        var gen = detailGen;
        postJson(api.contacts_read, { card_ref: cardRef, id: contactId }, 0).then(function (env) {
          if (gen !== detailGen || !privateAllowed) return;
          if (!isOkMutation(env)) {
            announce(t(i18n, "readFailed", ""));
            return;
          }
          updateListItemRead(contactId);
          refreshUnread();
          announce(t(i18n, "readDone", ""));
        });
      });
    }

    var processedBtn = panels.detail ? panels.detail.querySelector("[data-ex-owner-mark-processed]") : null;
    if (processedBtn && api.contacts_processed) {
      processedBtn.addEventListener("click", function () {
        var contactId = activeContactId;
        if (!contactId || !privateAllowed) return;
        var gen = detailGen;
        postJson(api.contacts_processed, { card_ref: cardRef, id: contactId }, 0).then(function (env) {
          if (gen !== detailGen || !privateAllowed) return;
          if (!isOkMutation(env)) {
            announce(t(i18n, "processedFailed", ""));
            return;
          }
          refreshUnread();
          announce(t(i18n, "processedDone", ""));
        });
      });
    }

    var noteSave = panels.detail ? panels.detail.querySelector("[data-ex-owner-save-note]") : null;
    var noteField = panels.detail ? panels.detail.querySelector("[data-ex-owner-note]") : null;
    if (noteSave && noteField && api.contacts_note) {
      noteSave.addEventListener("click", function () {
        var contactId = activeContactId;
        if (!contactId || !privateAllowed) return;
        var gen = detailGen;
        var draft = String(noteField.value || "");
        postJson(api.contacts_note, {
          card_ref: cardRef,
          id: contactId,
          note: draft
        }, 0).then(function (env) {
          if (gen !== detailGen || !privateAllowed) return;
          if (!isNoteResponse(env)) {
            announce(t(i18n, "noteFailed", ""));
            return;
          }
          if (noteField && typeof env.data.owner_note === "string") {
            noteField.value = env.data.owner_note;
          }
          announce(t(i18n, "noteSaved", ""));
        });
      });
    }

    var vcfBtn = panels.detail ? panels.detail.querySelector("[data-ex-owner-download-vcf]") : null;
    if (vcfBtn && api.contacts_vcf) {
      vcfBtn.addEventListener("click", function () {
        var contactId = activeContactId;
        if (!contactId || !privateAllowed) return;
        var gen = detailGen;
        postJson(api.contacts_vcf, { card_ref: cardRef, id: contactId }, 0).then(function (env) {
          if (gen !== detailGen || !privateAllowed) return;
          if (!isVcfResponse(env)) {
            announce(t(i18n, "vcfUnavailable", ""));
            return;
          }
          var blob = new Blob([env.vcf], { type: "text/vcard;charset=utf-8" });
          downloadBlob(blob, "kontakt.vcf");
        });
      });
    }
  }

  function showBootError(pageCfg, message) {
    var err = document.querySelector("[data-ex-owner-boot-error]");
    var text = document.querySelector("[data-ex-owner-boot-error-text]");
    if (text) text.textContent = message || t(pageCfg && pageCfg.i18n ? pageCfg.i18n : {}, "errorUnavailable", "");
    if (err) err.hidden = false;
    exCardBusy.reset();
  }

  function applyCardBootstrap(parts) {
    var mount = document.querySelector("[data-ex-owner-mount]");
    if (!mount || !parts || !parts.html) {
      exCardBusy.reset();
      return;
    }
    document.body.className = parts.body_class || document.body.className;
    if (typeof parts.body_style === "string" && parts.body_style) {
      document.body.style.cssText = parts.body_style;
    } else {
      document.body.removeAttribute("style");
    }
    mount.innerHTML = parts.html;
    mount.hidden = false;
    exCardBusy.reset();
    ownerBootstrapped = true;
    initOwnerLangSwitcher();
    initOwnerApp();
  }

  function applyHubBootstrap(html, pageCfg) {
    var mount = document.querySelector("[data-ex-owner-mount]");
    if (!mount) return;
    mount.innerHTML = html || "";
    mount.hidden = false;
    if (pageCfg) {
      var node = document.getElementById("ex-owner-page-config");
      if (node) node.textContent = JSON.stringify(pageCfg);
    }
    exCardBusy.reset();
    initActivateAndHub();
    initOwnerLangSwitcher();
  }

  var bootRetryBound = false;

  function runOwnerBootstrap() {
    var pageCfg = readJsonNode("ex-owner-page-config");
    if (!pageCfg || (pageCfg.page !== "boot-hub" && pageCfg.page !== "boot-card")) return;
    if (bootstrapInFlight) return;
    bootstrapInFlight = true;
    var i18n = pageCfg.i18n || {};
    var apiUrl = pageCfg.api && pageCfg.api.bootstrap ? pageCfg.api.bootstrap : "/owner/api/bootstrap";
    var body = {
      mode: pageCfg.mode === "card" ? "card" : "hub",
      card_ref: pageCfg.card_ref || "",
      view_cards: !!pageCfg.view_cards,
      lang_route: pageCfg.lang && pageCfg.lang.route ? pageCfg.lang.route : "",
      setup_homescreen: !!pageCfg.setupHomescreenGuide
    };
    exCardBusy.begin();
    postJson(apiUrl, body, 0)
      .then(function (env) {
        if (!env || env.networkError) {
          showBootError(pageCfg, t(i18n, "errorNetwork", ""));
          return;
        }
        if (!env.httpOk || !env.data) {
          showBootError(pageCfg, t(i18n, "errorUnavailable", ""));
          return;
        }
        if (env.data.code === "core_unavailable") {
          showBootError(pageCfg, t(i18n, "bootstrapUnavailable", t(i18n, "errorUnavailable", "")));
          return;
        }
        if (env.data.redirect) {
          exCardBusy.reset();
          window.location.replace(env.data.redirect);
          return;
        }
        if (env.data.kind === "card") {
          applyCardBootstrap(env.data);
          return;
        }
        if (env.data.kind === "hub") {
          applyHubBootstrap(env.data.html, env.data.page || pageCfg);
          return;
        }
        showBootError(pageCfg, t(i18n, "errorGeneric", ""));
      })
      .catch(function () {
        showBootError(pageCfg, t(i18n, "errorUnavailable", ""));
      })
      .then(function () {
        bootstrapInFlight = false;
      });
    if (!bootRetryBound) {
      bootRetryBound = true;
      var retry = document.querySelector("[data-ex-owner-boot-retry]");
      if (retry) {
        retry.addEventListener("click", function () {
          var err = document.querySelector("[data-ex-owner-boot-error]");
          if (err) err.hidden = true;
          runOwnerBootstrap();
        });
      }
    }
  }

  initActivateAndHub();
  initOwnerLangSwitcher();
  initOwnerApp();
  runOwnerBootstrap();
})();
