(function () {
  "use strict";

  var ownerBootstrapped = false;
  var bootstrapInFlight = false;
  var ownerAppBound = false;
  var ownerAppTeardownFns = [];
  var ownerSwitchGen = 0;
  var ownerViewGen = 0;
  var ownerBootstrapGen = 0;
  var ownerPersistGen = 0;
  var ownerBootstrapAbort = null;
  var ownerBackgroundBootstrap = false;
  var ownerPrefetchInFlight = null;
  var ownerSessionInvalid = false;
  var ownerActivePackSnapshot = null;
  var ownerPendingBootstrapParts = null;
  var ownerSuppressPendingBootstrapFlush = 0;
  var OWNER_LOCAL_SCHEMA = 1;
  var OWNER_LS_SCOPE = "ex_owner_lcs";
  var OWNER_LS_LAST_REF = "ex_owner_last_ref";
  var OWNER_BC_NAME = "expresscard-owner";
  var OWNER_ASSET_SEP = "\x1e";
  var ownerCurrentCardIds = { publicId: "", slug: "", ref: "" };
  var ownerRejectedCardIds = {};
  var ownerCardsChangedCallback = null;

  function ownerBumpViewGeneration() {
    ownerPendingBootstrapParts = null;
    ownerViewGen += 1;
    ownerBootstrapGen += 1;
    if (ownerBootstrapAbort) {
      try {
        ownerBootstrapAbort.abort();
      } catch (e) {}
      ownerBootstrapAbort = null;
    }
  }

  function ownerClearCacheScopeStorage() {
    try {
      localStorage.removeItem(OWNER_LS_SCOPE);
    } catch (e) {}
  }

  function ownerBroadcastSessionCleared(scope) {
    try {
      var bc = new BroadcastChannel(OWNER_BC_NAME);
      bc.postMessage({ type: "session_cleared", scope: scope || "" });
      bc.close();
    } catch (e) {}
  }

  function ownerBroadcastCardsChanged(scope, publicId) {
    try {
      var bc = new BroadcastChannel(OWNER_BC_NAME);
      bc.postMessage({ type: "cards_changed", scope: scope || "", public_id: publicId || "" });
      bc.close();
    } catch (e) {}
  }

  function ownerInitSessionBroadcast() {
    try {
      var bc = new BroadcastChannel(OWNER_BC_NAME);
      bc.onmessage = function (event) {
        var data = event.data;
        if (!data) return;
        if (data.type === "cards_changed") {
          ownerHandleCardsChanged(String(data.scope || ""), String(data.public_id || ""));
          return;
        }
        if (data.type !== "session_cleared") return;
        ownerSessionInvalid = true;
        ownerPersistGen += 1;
        ownerBumpViewGeneration();
        ownerClearCacheScopeStorage();
        try {
          localStorage.removeItem(OWNER_LS_LAST_REF);
        } catch (e) {}
        ownerReleaseAppBindings();
        var mount = document.querySelector("[data-ex-owner-mount]");
        if (mount) {
          mount.innerHTML = "";
          mount.hidden = true;
        }
        exCardBusy.reset();
      };
    } catch (e) {}
  }

  function ownerHydratePageConfigFromLocation(pageCfg) {
    pageCfg = pageCfg && typeof pageCfg === "object" ? pageCfg : {};
    var path = String(window.location.pathname || "");
    var params = new URLSearchParams(window.location.search || "");
    var cardMatch = path.match(/^\/owner\/card\/([^/]+)\/?$/i);
    if (cardMatch) {
      pageCfg.page = "boot-card";
      pageCfg.mode = "card";
      pageCfg.view_cards = false;
      try {
        pageCfg.card_ref = decodeURIComponent(cardMatch[1]);
      } catch (e) {
        pageCfg.card_ref = cardMatch[1];
      }
    } else if (/^\/owner\/?$/i.test(path)) {
      pageCfg.page = "boot-hub";
      pageCfg.mode = "hub";
      pageCfg.view_cards = params.get("view") === "cards";
    }
    var langRoute = params.get("lang");
    if (langRoute === "cs") langRoute = "cz";
    if (langRoute && ["sk", "cz", "en", "de"].indexOf(langRoute) !== -1) {
      if (!pageCfg.lang) pageCfg.lang = {};
      pageCfg.lang.route = langRoute;
    }
    pageCfg.setupHomescreenGuide = params.get("setup") === "homescreen";
    var node = document.getElementById("ex-owner-page-config");
    if (node) {
      node.textContent = JSON.stringify(pageCfg);
    }
    return pageCfg;
  }

  function ownerPresentationSignature(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return "";

    return JSON.stringify([
      snapshot.public_id || "",
      snapshot.publication_fingerprint || "",
      snapshot.public_url || "",
      snapshot.display_name || "",
      snapshot.card_role || "",
      snapshot.photo_url || "",
      snapshot.logo_url || "",
      snapshot.logo_width_ratio,
      snapshot.body_background_style || "",
      snapshot.brand_contrast || "",
      snapshot.lang || {},
      snapshot.switcher || []
    ]);
  }

  function ownerAnyPanelOpen() {
    var panel = document.querySelector(".ex-public-owner-panel:not([hidden])");
    return !!panel;
  }

  function ownerAssetStoreKey(scope, url) {
    return String(scope || "") + OWNER_ASSET_SEP + String(url || "");
  }

  function ownerRegisterTeardown(fn) {
    if (typeof fn === "function") ownerAppTeardownFns.push(fn);
  }

  function ownerReleaseAppBindings() {
    ownerClearDesktopBlurredBackdrop();
    if (ownerActivePackSnapshot) {
      ownerRevokeSnapshotBlobUrls(ownerActivePackSnapshot);
      ownerActivePackSnapshot = null;
    }
    ownerAppTeardownFns.forEach(function (fn) {
      try {
        fn();
      } catch (e) {}
    });
    ownerAppTeardownFns = [];
    ownerAppBound = false;
  }

  function ownerTeardownApp() {
    ownerBumpViewGeneration();
    ownerReleaseAppBindings();
  }

  function ownerReadCacheScope() {
    try {
      var v = localStorage.getItem(OWNER_LS_SCOPE);
      return v && /^[a-f0-9]{32}$/i.test(v) ? v.toLowerCase() : "";
    } catch (e) {
      return "";
    }
  }

  function ownerWriteCacheScope(scope) {
    if (!scope || !/^[a-f0-9]{32}$/i.test(scope)) {
      if (scope === "" || scope === null || scope === undefined) ownerClearCacheScopeStorage();
      return;
    }
    try {
      localStorage.setItem(OWNER_LS_SCOPE, scope.toLowerCase());
    } catch (e) {}
  }

  function ownerReadLastCardRef() {
    try {
      return String(localStorage.getItem(OWNER_LS_LAST_REF) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function ownerWriteLastCardRef(ref) {
    if (!ref) return;
    try {
      localStorage.setItem(OWNER_LS_LAST_REF, ref);
    } catch (e) {}
  }

  function ownerSanitizeRuntimeForCache(runtime) {
    if (!runtime || typeof runtime !== "object") return null;
    var cards = Array.isArray(runtime.cards) ? runtime.cards : [];
    return {
      card_ref: String(runtime.card_ref || ""),
      public_id: String(runtime.public_id || ""),
      public_url: String(runtime.public_url || ""),
      lang: runtime.lang || {},
      i18n: runtime.i18n || {},
      setupHomescreenGuide: !!runtime.setupHomescreenGuide,
      ui_hints: {
        contacts_visible: !!(runtime.ui_hints && runtime.ui_hints.contacts_visible === true),
        edit_visible: !!(runtime.ui_hints && runtime.ui_hints.edit_visible === true)
      },
      api: runtime.api || {},
      cards: cards.map(function (c) {
        if (!c || typeof c !== "object") return null;
        return {
          public_id: String(c.public_id || ""),
          public_slug: String(c.public_slug || ""),
          label: String(c.label || ""),
          card_role: String(c.card_role || "")
        };
      }).filter(Boolean)
    };
  }

  function ownerStripConfigScript(html) {
    return String(html || "").replace(
      /<script type="application\/json" id="ex-owner-app-config">[\s\S]*?<\/script>/i,
      ""
    );
  }

  function ownerBuildConfigScript(runtime) {
    var safe = ownerSanitizeRuntimeForCache(runtime);
    if (!safe) return "";
    return '<script type="application/json" id="ex-owner-app-config">'
      + JSON.stringify(safe).replace(/</g, "\\u003c")
      + "</script>";
  }

  var ownerIdbPromise = null;
  function ownerOpenIdb() {
    if (ownerIdbPromise) return ownerIdbPromise;
    if (!window.indexedDB) {
      ownerIdbPromise = Promise.resolve(null);
      return ownerIdbPromise;
    }
    ownerIdbPromise = new Promise(function (resolve) {
      var req = indexedDB.open("expresscard-owner", 1);
      req.onerror = function () {
        resolve(null);
      };
      req.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains("cards")) db.createObjectStore("cards");
        if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
        if (!db.objectStoreNames.contains("qr")) db.createObjectStore("qr");
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
    });
    return ownerIdbPromise;
  }

  function ownerIdbPut(store, key, value) {
    var persistGen = ownerPersistGen;

    return ownerOpenIdb().then(function (db) {
      if (!db || ownerSessionInvalid || persistGen !== ownerPersistGen) {
        return false;
      }

      var scope = ownerReadCacheScope();
      var prefix = scope + (store === "assets" ? OWNER_ASSET_SEP : ":");

      if (!scope || String(key).indexOf(prefix) !== 0) {
        return false;
      }

      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(store, "readwrite");
          tx.oncomplete = function () {
            resolve(true);
          };
          tx.onerror = tx.onabort = function () {
            resolve(false);
          };
          tx.objectStore(store).put(value, key);
        } catch (e) {
          resolve(false);
        }
      });
    }).catch(function () {
      return false;
    });
  }

  function ownerIdbGet(store, key) {
    return ownerOpenIdb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx = db.transaction(store, "readonly");
        var req = tx.objectStore(store).get(key);
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          resolve(null);
        };
      });
    });
  }

  function ownerIdbDelete(store, key) {
    return ownerOpenIdb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          resolve();
        };
      });
    });
  }

  function ownerIdbDeletePrefix(store, prefix) {
    return ownerOpenIdb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(store, "readwrite");
        var os = tx.objectStore(store);
        var req = os.openCursor();
        req.onsuccess = function (event) {
          var cursor = event.target.result;
          if (!cursor) return;
          if (String(cursor.key).indexOf(prefix) === 0) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          resolve();
        };
      });
    });
  }

  function ownerCardStoreKey(scope, publicId) {
    return scope + ":" + publicId;
  }

  function ownerQrKeys(scope, publicId) {
    var base = ownerCardStoreKey(scope, publicId);
    return { png: base + ":png", svg: base + ":svg", url: base + ":url" };
  }

  function ownerPersistCardPack(scope, parts, snapshot, opts) {
    opts = opts || {};
    if (!scope || !parts || !snapshot || !snapshot.public_id) return Promise.resolve();
    if (ownerIsCardRejected(snapshot.public_id)) return Promise.resolve();
    if (ownerSessionInvalid) return Promise.resolve();
    var persistGen = ownerPersistGen;
    var publicId = String(snapshot.public_id);
    var key = ownerCardStoreKey(scope, publicId);
    var runtime = parts.runtime || readJsonNode("ex-owner-app-config");
    var shellHtml = ownerStripConfigScript(parts.html || "") + ownerBuildConfigScript(runtime);
    var pack = {
      schema: OWNER_LOCAL_SCHEMA,
      scope: scope,
      snapshot: snapshot,
      html: shellHtml,
      body_class: parts.body_class || "",
      body_style: parts.body_style || "",
      presentation_sig: ownerPresentationSignature(snapshot),
      saved_at: snapshot.saved_at || new Date().toISOString()
    };
    Object.keys(ownerRejectedCardIds).forEach(function (removedId) {
    ownerPruneCardPackNavigation(pack, removedId);
  });

  return ownerIdbPut("cards", key, pack).then(function () {
      if (persistGen !== ownerPersistGen || ownerSessionInvalid) return;
      if (scope !== ownerReadCacheScope() && !opts.allowScopeBootstrap) return;
      ownerWriteCacheScope(scope);
            // Poslednú otvorenú kartu nastavuje initOwnerApp pri jej zobrazení.
      return ownerCacheAssetsFromSnapshot(snapshot, scope, persistGen);
    });
  }

  function ownerCacheAssetsFromSnapshot(snapshot, scope, persistGen) {
    var urls = [];
    if (snapshot.photo_url) urls.push(snapshot.photo_url);
    if (snapshot.logo_url) urls.push(snapshot.logo_url);
    var style = String(snapshot.body_background_style || "");
    var m = style.match(/url\((['"]?)([^'")]+)\1\)/i);
    if (m && m[2]) urls.push(m[2]);
    return Promise.all(
      urls.map(function (url) {
        return fetch(url, { credentials: "same-origin", cache: "force-cache" })
          .then(function (res) {
            if (!res.ok) return;
            return res.blob();
          })
          .then(function (blob) {
            if (!blob || persistGen !== ownerPersistGen || ownerSessionInvalid) return;
            return ownerIdbPut("assets", ownerAssetStoreKey(scope, url), blob);
          })
          .catch(function () {});
      })
    );
  }

  function ownerBlobUrlFromAsset(scope, url) {
    return ownerIdbGet("assets", ownerAssetStoreKey(scope, url)).then(function (blob) {
      if (!blob) return url;
      return URL.createObjectURL(blob);
    });
  }

  function ownerNormalizeCardRole(role) {
    var r = String(role || "").toLowerCase();
    if (r === "company") return "company";
    if (r === "personal") return "personal";
    return "";
  }

  var ownerRuntimeContractHandler = null;

  function ownerNormalizeContractRole(contract) {
    if (!contract || !contract.card_role) return "";
    var r = String(contract.card_role).toLowerCase();
    return r === "company" || r === "personal" ? r : "";
  }

  function ownerApplyShareLabelsForContract(root, i18n, contract) {
    if (!root || !i18n) return;
    var role = ownerNormalizeContractRole(contract);
    var personal = role === "personal";
    function tr(key, fb) {
      return i18n[key] ? String(i18n[key]) : fb;
    }
    var prefix = tr(personal ? "actionSharePersonalPrefix" : "actionSharePrefix", personal ? "Zdieľať moju " : "Zdieľať ");
    var suffix = tr(personal ? "actionSharePersonalSuffix" : "actionShareSuffix", "");
    var shareBtn = root.querySelector("[data-ex-owner-share]");
    if (shareBtn) {
      shareBtn.setAttribute("aria-label", (prefix + "expressCARD" + suffix).trim());
      var prefixEl = shareBtn.querySelector("[data-ex-owner-share-prefix]");
      var suffixEl = shareBtn.querySelector("[data-ex-owner-share-suffix]");
      if (prefixEl) {
        prefixEl.textContent = prefix;
      }
      if (suffixEl) {
        suffixEl.textContent = suffix;
      }
      if (!prefixEl || (!suffixEl && suffix)) {
        var legacyTextSpans = [];
        var child = shareBtn.firstElementChild;
        while (child) {
          if (
            child.tagName === "SPAN" &&
            !child.classList.contains("ex-public-owner-app__share-brand-icon") &&
            !child.classList.contains("ex-public-owner-app__glyph")
          ) {
            legacyTextSpans.push(child);
          }
          child = child.nextElementSibling;
        }
        if (!prefixEl && legacyTextSpans[0]) {
          legacyTextSpans[0].textContent = prefix;
        }
        if (!suffixEl && suffix && legacyTextSpans.length > 1) {
          legacyTextSpans[legacyTextSpans.length - 1].textContent = suffix;
        }
      }
    }
  }

  function ownerDispatchRuntimeContract(runtime, opts) {
    opts = opts || {};
    if (!runtime || typeof runtime !== "object") return;
    var suppressFlush = !!opts.suppressPendingFlush;
    if (suppressFlush) ownerSuppressPendingBootstrapFlush += 1;
    try {
      if (typeof ownerRuntimeContractHandler === "function") {
        ownerRuntimeContractHandler(runtime);
      }
      var root = document.querySelector("[data-ex-owner-app]");
      if (root) {
        ownerApplyShareLabelsForContract(root, runtime.i18n || {}, runtime.card_contract);
      }
    } finally {
      if (suppressFlush) ownerSuppressPendingBootstrapFlush -= 1;
    }
  }

  function ownerIdentityMediaPlan(snap) {
    if (!snap) return { kind: "none" };
    var role = ownerNormalizeCardRole(snap.card_role);
    var photo = String(snap.photo_url || "").trim();
    var logo = String(snap.logo_url || "").trim();
    var ratio =
      snap.logo_width_ratio != null && !isNaN(Number(snap.logo_width_ratio))
        ? Number(snap.logo_width_ratio)
        : 0.75;
    if (role === "company") {
      if (logo) return { kind: "logo", url: logo, ratio: ratio };
      return { kind: "none" };
    }
    if (role === "personal") {
      if (photo) return { kind: "photo", url: photo };
      if (logo) return { kind: "logo", url: logo, ratio: ratio };
      return { kind: "none" };
    }
    return { kind: "none" };
  }

  function ownerSyncIdentityMedia(root, snap, viewGen) {
    if (!root || !snap) return;
    if (viewGen !== undefined && viewGen !== ownerViewGen) return;
    var identity = root.querySelector(".ex-public-owner-app__identity");
    if (!identity) return;
    var plan = ownerIdentityMediaPlan(snap);
    var nameEl = identity.querySelector("#ex-owner-display-name");
    var photoWrap = identity.querySelector(".ex-public-owner-app__photo");
    var logoWrap = identity.querySelector(".ex-public-owner-app__logo");

    function removeNode(node) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    if (plan.kind === "photo") {
      removeNode(logoWrap);
      logoWrap = null;
      var photoHref = snap._photo_blob_url || snap.photo_url;
      if (!photoWrap) {
        photoWrap = document.createElement("div");
        photoWrap.className = "ex-public-owner-app__photo";
        var photoImg = document.createElement("img");
        photoImg.alt = "";
        photoImg.width = 120;
        photoImg.height = 120;
        photoImg.decoding = "async";
        photoWrap.appendChild(photoImg);
        if (nameEl) identity.insertBefore(photoWrap, nameEl);
        else identity.appendChild(photoWrap);
      }
      var photoImg = photoWrap.querySelector("img");
      if (photoImg && photoHref) photoImg.src = photoHref;
    } else if (plan.kind === "logo") {
      removeNode(photoWrap);
      photoWrap = null;
      var logoHref = snap._logo_blob_url || snap.logo_url;
      if (!logoWrap) {
        logoWrap = document.createElement("div");
        logoWrap.className = "ex-public-owner-app__logo";
        var logoImg = document.createElement("img");
        logoImg.alt = "";
        logoImg.decoding = "async";
        logoWrap.appendChild(logoImg);
        if (nameEl) identity.insertBefore(logoWrap, nameEl);
        else identity.appendChild(logoWrap);
      }
      logoWrap.style.setProperty("--ex-owner-logo-width-ratio", String(plan.ratio != null ? plan.ratio : 0.75));
      var logoImg = logoWrap.querySelector("img");
      if (logoImg && logoHref) logoImg.src = logoHref;
    } else {
      removeNode(photoWrap);
      removeNode(logoWrap);
    }
  }

  function ownerApplySnapshotAssets(snapshot, scope, viewGen) {
    var jobs = [];
    if (snapshot.photo_url) {
      jobs.push(
        ownerBlobUrlFromAsset(scope, snapshot.photo_url).then(function (href) {
          if (viewGen !== undefined && viewGen !== ownerViewGen) return;
          snapshot._photo_blob_url = href;
        })
      );
    }
    if (snapshot.logo_url) {
      jobs.push(
        ownerBlobUrlFromAsset(scope, snapshot.logo_url).then(function (href) {
          if (viewGen !== undefined && viewGen !== ownerViewGen) return;
          snapshot._logo_blob_url = href;
        })
      );
    }
    var style = String(snapshot.body_background_style || "");
    var m = style.match(/url\((['"]?)([^'")]+)\1\)/i);
    if (m && m[2]) {
      jobs.push(
        ownerBlobUrlFromAsset(scope, m[2]).then(function (href) {
          if (viewGen !== undefined && viewGen !== ownerViewGen) return;
          snapshot._bg_blob_url = href;
          snapshot._bg_asset_url = m[2];
        })
      );
    }
    return Promise.all(jobs);
  }

  function ownerRevokeSnapshotBlobUrls(snapshot) {
    ["_photo_blob_url", "_logo_blob_url", "_bg_blob_url"].forEach(function (k) {
      if (snapshot[k] && String(snapshot[k]).indexOf("blob:") === 0) {
        try {
          URL.revokeObjectURL(snapshot[k]);
        } catch (e) {}
      }
    });
  }

  function ownerClearDesktopBlurredBackdrop() {
    var html = document.documentElement;
    html.classList.remove("ex-public-owner-has-desktop-bg");
    html.style.removeProperty("--ex-owner-desktop-bg-image");
  }

  function ownerBackgroundUrlFromSnapshot(snap) {
    if (!snap) return "";
    if (snap._bg_blob_url) return String(snap._bg_blob_url);
    var style = String(snap.body_background_style || "");
    var m = style.match(/url\((['"]?)([^'")]+)\1\)/i);
    return m && m[2] ? m[2] : "";
  }

  function ownerSyncDesktopBlurredBackdrop(snap, viewGen) {
    if (viewGen !== undefined && viewGen !== ownerViewGen) return;
    if (!document.body.classList.contains("ex-public-owner-body--card")) {
      ownerClearDesktopBlurredBackdrop();
      return;
    }
    var url = ownerBackgroundUrlFromSnapshot(snap);
    if (!url) {
      ownerClearDesktopBlurredBackdrop();
      return;
    }
    var html = document.documentElement;
    html.classList.add("ex-public-owner-has-desktop-bg");
    html.style.setProperty(
      "--ex-owner-desktop-bg-image",
      'url("' + url.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '")'
    );
  }

  function ownerApplyBodyBackgroundFromSnapshot(snap, viewGen) {
    if (viewGen !== undefined && viewGen !== ownerViewGen) return;
    if (snap && snap._bg_blob_url && snap._bg_asset_url) {
      document.body.style.backgroundImage = "url(" + snap._bg_blob_url + ")";
    }
    ownerSyncDesktopBlurredBackdrop(snap, viewGen);
  }

  function ownerWaitVisualReady(root, bodyStyle, timeoutMs) {
    var limit = typeof timeoutMs === "number" ? timeoutMs : 2000;
    var imgs = root ? root.querySelectorAll("img") : [];
    var pending = [];
    if (imgs.length) {
      imgs.forEach(function (img) {
        if (img.complete && img.naturalWidth > 0) return;
        pending.push(
          new Promise(function (resolve) {
            var done = function () {
              resolve();
            };
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          })
        );
      });
    }
    if (bodyStyle && /url\(/i.test(bodyStyle)) {
      pending.push(
        new Promise(function (resolve) {
          var probe = new Image();
          var m = bodyStyle.match(/url\((['"]?)([^'")]+)\1\)/i);
          probe.onload = probe.onerror = function () {
            resolve();
          };
          probe.src = m && m[2] ? m[2] : "";
        })
      );
    }
    var timer = new Promise(function (resolve) {
      window.setTimeout(resolve, limit);
    });
    if (!pending.length) return Promise.resolve();
    return Promise.race([Promise.all(pending), timer]);
  }

  function ownerShowOfflineBadge(i18n) {
    var root = document.querySelector("[data-ex-owner-app]");
    if (!root) return;
    var el = root.querySelector("[data-ex-owner-offline-badge]");
    if (!el) {
      el = document.createElement("p");
      el.className = "ex-public-owner-app__offline-badge";
      el.setAttribute("data-ex-owner-offline-badge", "1");
      var main = root.querySelector(".ex-public-owner-app__main");
      if (main) main.insertBefore(el, main.firstChild);
    }
    el.textContent = t(i18n, "offlineSavedVersion", "• offline •");
    el.hidden = !navigator.onLine ? false : true;
  }

  function ownerPersistQrFiles(scope, publicId, publicUrl, qrMatrix) {
    if (!scope || !publicId || !publicUrl || !qrMatrix) {
      return Promise.resolve(false);
    }

    var persistGen = ownerPersistGen;
    var keys = ownerQrKeys(scope, publicId);

    function canWrite() {
      return !ownerSessionInvalid
        && persistGen === ownerPersistGen
        && scope === ownerReadCacheScope();
    }

    return ownerOpenIdb().then(function (db) {
      if (!db || !canWrite()) return false;

      var canvas = drawQrExportCanvas(
        qrMatrix,
        QR_EXPORT_SIZE,
        QR_MARGIN_MODULES
      );
      if (!canvas) return false;

      var svg = buildQrSvgDocument(qrMatrix, QR_MARGIN_MODULES);

      return new Promise(function (resolve) {
        canvas.toBlob(function (pngBlob) {
          if (!pngBlob || !canWrite()) {
            resolve(false);
            return;
          }

          try {
            var tx = db.transaction("qr", "readwrite");
            tx.oncomplete = function () {
              resolve(true);
            };
            tx.onerror = tx.onabort = function () {
              resolve(false);
            };

            var store = tx.objectStore("qr");
            store.put(pngBlob, keys.png);
            store.put(
              new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
              keys.svg
            );
            store.put(publicUrl, keys.url);
          } catch (e) {
            resolve(false);
          }
        }, "image/png");
      });
    }).catch(function () {
      return false;
    });
  }

  function ownerEnsureQrForSnapshot(scope, snapshot) {
    if (!scope || !snapshot || !snapshot.public_id || !snapshot.public_url) return Promise.resolve();
    var qr = encodePublicQr(String(snapshot.public_url));
    if (!qr) return Promise.resolve();
    return ownerPersistQrFiles(scope, String(snapshot.public_id), String(snapshot.public_url), qr);
  }

  function ownerLoadQrBlob(scope, publicId, kind, expectedUrl) {
    var keys = ownerQrKeys(scope, publicId);

    return ownerOpenIdb().then(function (db) {
      if (!db || !expectedUrl || ownerSessionInvalid) return null;

      return new Promise(function (resolve) {
        try {
          var tx = db.transaction("qr", "readonly");
          var store = tx.objectStore("qr");
          var urlRequest = store.get(keys.url);
          var blobRequest = store.get(keys[kind]);

          tx.oncomplete = function () {
            resolve(
              urlRequest.result === expectedUrl
                ? blobRequest.result || null
                : null
            );
          };
          tx.onerror = tx.onabort = function () {
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
      });
    }).catch(function () {
      return null;
    });
  }

  function ownerClearScopeCache(scope) {
    if (!scope) return Promise.resolve();
    ownerSessionInvalid = true;
    ownerPersistGen += 1;
    ownerBumpViewGeneration();
    ownerClearCacheScopeStorage();
    try {
      localStorage.removeItem(OWNER_LS_LAST_REF);
    } catch (e) {}
    ownerBroadcastSessionCleared(scope);
    return Promise.all([
      ownerIdbDeletePrefix("cards", scope + ":"),
      ownerIdbDeletePrefix("qr", scope + ":"),
      ownerIdbDeletePrefix("assets", scope + OWNER_ASSET_SEP)
    ]);
  }

  function ownerClearCardCache(scope, publicId) {
    if (!scope || !publicId) return Promise.resolve();
    var cardKey = ownerCardStoreKey(scope, publicId);
    var qrKeys = ownerQrKeys(scope, publicId);
    return Promise.all([
      ownerIdbDelete("cards", cardKey),
      ownerIdbDelete("qr", qrKeys.png),
      ownerIdbDelete("qr", qrKeys.svg),
      ownerIdbDelete("qr", qrKeys.url),
      ownerPruneCachedCardNavigation(scope, publicId)
    ]);
  }

  function ownerIsCardRejected(publicId) {
    return !!ownerRejectedCardIds[String(publicId || "")];
  }

  function ownerInvalidatePersistForCardRemoval(publicId) {
    if (publicId) ownerRejectedCardIds[String(publicId)] = true;
    ownerPersistGen += 1;
    ownerPrefetchInFlight = null;
    ownerPendingBootstrapParts = null;
  }

  function ownerCardDisplayedMatchesGone(goneId) {
    if (!goneId) return false;
    var path = String(window.location.pathname || "");
    var match = path.match(/^\/owner\/card\/([^/]+)\/?$/i);
    if (!match) return false;
    var currentRef = decodeURIComponent(match[1]);
    var ids = ownerCurrentCardIds || {};
    if (String(ids.publicId || "") !== String(goneId)) return false;
    return currentRef === goneId
      || currentRef === ids.slug
      || currentRef === ids.ref
      || currentRef === ids.publicId;
  }

  function ownerPruneCardNavigation(host, publicId) {
    if (!host || !publicId) return;
  
    publicId = String(publicId);
    var configNode = host.querySelector("#ex-owner-app-config");
    var config = null;
  
    try {
      config = configNode ? JSON.parse(configNode.textContent || "") : null;
    } catch (e) {}
  
    var removedRefs = [publicId];
  
    if (config && Array.isArray(config.cards)) {
      config.cards.forEach(function (row) {
        if (!row || String(row.public_id || "") !== publicId) return;
        if (row.public_slug) removedRefs.push(String(row.public_slug));
      });
  
      config.cards = config.cards.filter(function (row) {
        return row && String(row.public_id || "") !== publicId;
      });
  
      configNode.textContent = JSON.stringify(config);
    }
  
    host.querySelectorAll("[data-ex-owner-switcher]").forEach(function (track) {
      track.querySelectorAll("a.ex-public-owner-app__switch").forEach(function (link) {
        try {
          var url = new URL(link.href, window.location.origin);
          if (url.origin !== window.location.origin) return;
  
          var match = url.pathname.match(/^\/owner\/card\/([^/]+)\/?$/i);
          if (!match) return;
  
          var ref = decodeURIComponent(match[1]);
          if (removedRefs.indexOf(ref) !== -1) link.remove();
        } catch (e) {}
      });
  
      if (!track.querySelector("a.ex-public-owner-app__switch")) {
        var section = track.closest(".ex-public-owner-app__switcher");
        if (section) section.remove();
      }
    });
  }
  
  function ownerPruneCardPackNavigation(pack, publicId) {
    if (!pack || !publicId) return pack;
  
    if (pack.html) {
      var template = document.createElement("template");
      template.innerHTML = pack.html;
      ownerPruneCardNavigation(template.content, publicId);
      pack.html = template.innerHTML;
    }
  
    if (pack.snapshot && Array.isArray(pack.snapshot.switcher)) {
      pack.snapshot.switcher = pack.snapshot.switcher.filter(function (row) {
        return row && String(row.public_id || "") !== String(publicId);
      });
      pack.presentation_sig = ownerPresentationSignature(pack.snapshot);
    }
  
    return pack;
  }
  
  function ownerPruneCachedCardNavigation(scope, publicId) {
    return ownerOpenIdb().then(function (db) {
      if (!db || !scope || scope !== ownerReadCacheScope()) return false;
  
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction("cards", "readwrite");
          var request = tx.objectStore("cards").openCursor();
  
          tx.oncomplete = function () {
            resolve(true);
          };
          tx.onerror = tx.onabort = function () {
            resolve(false);
          };
  
          request.onsuccess = function (event) {
            var cursor = event.target.result;
            if (!cursor) return;
  
            var pack = cursor.value;
            if (pack && pack.scope === scope && pack.snapshot
              && String(pack.snapshot.public_id || "") !== String(publicId)) {
              cursor.update(ownerPruneCardPackNavigation(pack, publicId));
            }
  
            cursor.continue();
          };
        } catch (e) {
          resolve(false);
        }
      });
    }).catch(function () {
      return false;
    });
  }
  
  function ownerRemoveCardFromSwitcher(publicId) {
    ownerPruneCardNavigation(document, publicId);
  
    if (ownerActivePackSnapshot && Array.isArray(ownerActivePackSnapshot.switcher)) {
      ownerActivePackSnapshot.switcher = ownerActivePackSnapshot.switcher.filter(function (row) {
        return row && String(row.public_id || "") !== String(publicId);
      });
    }
  }
  
  function ownerSyncBootstrapSwitcher(parts) {
    if (!parts || !parts.html) return;
  
    var pack = {
      html: parts.html,
      snapshot: parts.presentation_snapshot
    };
  
    Object.keys(ownerRejectedCardIds).forEach(function (publicId) {
      ownerPruneCardPackNavigation(pack, publicId);
    });
  
    parts.html = pack.html;
  
    if (Array.isArray(parts.cards_index)) {
      parts.cards_index = parts.cards_index.filter(function (row) {
        return row && !ownerIsCardRejected(row.public_id);
      });
    }
  
    if (parts.runtime && Array.isArray(parts.runtime.cards)) {
      parts.runtime.cards = parts.runtime.cards.filter(function (row) {
        return row && !ownerIsCardRejected(row.public_id);
      });
    }
  
    var root = document.querySelector("[data-ex-owner-app]");
    var snapshot = parts.presentation_snapshot;
  
    if (!root || !snapshot
      || String(ownerCurrentCardIds.publicId || "") !== String(snapshot.public_id || "")) return;
  
    var template = document.createElement("template");
    template.innerHTML = parts.html;
  
    var incoming = template.content.querySelector(".ex-public-owner-app__switcher");
    var current = root.querySelector(".ex-public-owner-app__switcher");
    var main = root.querySelector(".ex-public-owner-app__main");
  
    if (incoming && current) {
      current.replaceWith(incoming.cloneNode(true));
    } else if (incoming && main) {
      main.insertBefore(incoming.cloneNode(true), main.firstChild);
    } else if (current) {
      current.remove();
    }
  
    var configNode = document.getElementById("ex-owner-app-config");
    var config = readJsonNode("ex-owner-app-config");
  
    if (configNode && config && parts.runtime && Array.isArray(parts.runtime.cards)) {
      config.cards = parts.runtime.cards;
      configNode.textContent = JSON.stringify(config);
    }
  }

  function ownerHandleCardsChanged(messageScope, goneId) {
    if (!goneId) return;
    var scope = ownerReadCacheScope();
    if (!scope || String(messageScope) !== String(scope)) return;
    ownerInvalidatePersistForCardRemoval(goneId);
    ownerClearCardCache(scope, goneId).then(function () {
      if (ownerCardDisplayedMatchesGone(goneId)) {
        window.location.replace("/owner/" + (window.location.search || ""));
        return;
      }
      ownerRemoveCardFromSwitcher(goneId);
      if (typeof ownerCardsChangedCallback === "function") {
        ownerCardsChangedCallback(goneId);
        return;
      }
      if (!document.querySelector("[data-ex-owner-app]")) {
        var pageCfg = readJsonNode("ex-owner-page-config");
        if (pageCfg && pageCfg.page === "boot-hub") {
          runOwnerBootstrap({ pageCfg: pageCfg });
        }
      }
    });
  }

  function ownerTopModalRoot() {
    var activeOptions = document.querySelector('[data-ex-owner-panel="options"]');
    if (activeOptions && !activeOptions.hidden) {
      return activeOptions.querySelector("#ex-owner-options-panel") || activeOptions;
    }
    var relinquish = document.querySelector("[data-ex-owner-relinquish-dialog]");
    if (relinquish && !relinquish.hidden) {
      return relinquish.querySelector("[role=\"dialog\"]") || relinquish;
    }
    var logout = document.querySelector("[data-ex-owner-logout-dialog]");
    if (logout && !logout.hidden) {
      return logout.querySelector("[role=\"dialog\"]") || logout;
    }
    var edit = document.querySelector("[data-ex-owner-edit-request-dialog]");
    if (edit && !edit.hidden) {
      return edit.querySelector("[role=\"dialog\"]") || edit;
    }
    var options = document.querySelector("[data-ex-owner-panel=\"options\"]");
    if (options && !options.hidden) {
      return options.querySelector("[role=\"dialog\"]") || options.querySelector(".ex-public-owner-panel__card") || options;
    }
    return null;
  }

  function ownerModalFocusTrap(event) {
    if (event.key !== "Tab") return;
    var root = ownerTopModalRoot();
    if (!root) return;
    var nodes = root.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    var focusable = [];
    for (var i = 0; i < nodes.length; i += 1) {
      if (!nodes[i].disabled && nodes[i].offsetParent !== null) focusable.push(nodes[i]);
    }
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function ownerActivationResultUncertain(env) {
    if (!env) return true;
    if (env.networkError || env.timedOut) return true;
    if (env.status >= 500 || env.parseError) return true;
    return responseCode(env) === "core_unavailable";
  }

  function ownerLoadCardPack(scope, publicId, cardRef) {
    if (!scope) return Promise.resolve(null);
    var key = publicId ? ownerCardStoreKey(scope, publicId) : "";
    var tryKeys = [];
    if (key) tryKeys.push(key);
    if (cardRef) {
      return ownerOpenIdb().then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve) {
          var tx = db.transaction("cards", "readonly");
          var req = tx.objectStore("cards").openCursor();
          var found = null;
          req.onsuccess = function (event) {
            var cursor = event.target.result;
            if (!cursor) {
              resolve(found);
              return;
            }
            var val = cursor.value;
            if (val && val.scope === scope && val.snapshot) {
              var snap = val.snapshot;
              if (
                snap.card_ref === cardRef ||
                snap.public_slug === cardRef ||
                snap.public_id === cardRef
              ) {
                if (ownerIsCardRejected(snap.public_id)) {
                  resolve(null);
                  return;
                }
                found = val;
                resolve(found);
                return;
              }
            }
            cursor.continue();
          };
          req.onerror = function () {
            resolve(null);
          };
        });
      });
    }
    if (publicId && ownerIsCardRejected(publicId)) return Promise.resolve(null);
    return ownerIdbGet("cards", key).then(function (pack) {
      if (pack && pack.snapshot && ownerIsCardRejected(pack.snapshot.public_id)) return null;
      return pack;
    });
  }

  function ownerApplyLocalCardPack(pack, offline, viewGen, opts) {
    opts = opts || {};
    if (viewGen !== undefined && viewGen !== ownerViewGen) return false;
    if (ownerSessionInvalid) return false;
    if (!pack || !pack.html) return false;
    if (pack.snapshot && ownerIsCardRejected(pack.snapshot.public_id)) return false;
  
    Object.keys(ownerRejectedCardIds).forEach(function (removedId) {
      ownerPruneCardPackNavigation(pack, removedId);
    });
  
    var mount = document.querySelector("[data-ex-owner-mount]");
    if (!mount) return false;
    if (opts.skipTeardown) ownerReleaseAppBindings();
    else ownerTeardownApp();
    if (pack.snapshot) {
      ownerActivePackSnapshot = pack.snapshot;
    }
    document.body.className = pack.body_class || document.body.className;
    if (pack.body_style) document.body.style.cssText = pack.body_style;
    else document.body.removeAttribute("style");
    mount.innerHTML = pack.html;
    mount.hidden = false;
    var scope = pack.scope || ownerReadCacheScope();
    var localGen = ownerViewGen;
    if (pack.snapshot) {
      ownerSyncDesktopBlurredBackdrop(pack.snapshot, localGen);
      ownerApplySnapshotAssets(pack.snapshot, scope, localGen).then(function () {
        if (localGen !== ownerViewGen) return;
        var root = mount.querySelector("[data-ex-owner-app]");
        if (!root || !pack.snapshot) return;
        var snap = pack.snapshot;
        var nameEl = root.querySelector("#ex-owner-display-name");
        if (nameEl && snap.display_name) nameEl.textContent = snap.display_name;
        ownerSyncIdentityMedia(root, snap, localGen);
        ownerApplyBodyBackgroundFromSnapshot(snap, localGen);
        ownerWaitVisualReady(root, document.body.style.cssText, 2000).then(function () {
          if (localGen !== ownerViewGen) return;
          exCardBusy.reset();
        });
      });
    } else {
      exCardBusy.reset();
    }
    ownerBootstrapped = true;
    initOwnerLangSwitcher();
    var cfg = readJsonNode("ex-owner-app-config");
    if (cfg && cfg.i18n) ownerShowOfflineBadge(cfg.i18n);
    if (offline) {
      var badge = document.querySelector("[data-ex-owner-offline-badge]");
      if (badge) badge.hidden = false;
    }
    var appRoot = mount.querySelector("[data-ex-owner-app]");
    if (appRoot && pack.presentation_sig) {
      appRoot.setAttribute("data-ex-owner-pres-sig", pack.presentation_sig);
    } else if (appRoot && pack.snapshot) {
      appRoot.setAttribute("data-ex-owner-pres-sig", ownerPresentationSignature(pack.snapshot));
    }
    initOwnerApp();
    return true;
  }

  function ownerRegisterServiceWorkerAssets() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    var urls = [];
    document.querySelectorAll('link[rel="stylesheet"],script[src]').forEach(function (node) {
      var href = node.href || node.src;
      if (!href) return;
      if (href.indexOf("/assets/") !== -1 || href.indexOf("/images/") !== -1) urls.push(href);
    });
    try {
      navigator.serviceWorker.controller.postMessage({ type: "OWNER_STATIC_URLS", urls: urls });
    } catch (e) {}
  }

  function ownerInterceptSwitcher() {
    document.addEventListener("click", function (event) {
      var link = event.target && event.target.closest
        ? event.target.closest("a.ex-public-owner-app__switch")
        : null;
      if (!link || !link.href) return;
      if (!document.querySelector("[data-ex-owner-app]")) return;
      var url;
      try {
        url = new URL(link.href, window.location.origin);
      } catch (e) {
        return;
      }
      if (url.origin !== window.location.origin) return;
      var m = url.pathname.match(/^\/owner\/card\/([^/]+)\/?$/);
      if (!m) return;
      event.preventDefault();
      ownerNavigateToCard(decodeURIComponent(m[1]), true);
    });
    window.addEventListener("popstate", function () {
      var path = window.location.pathname || "";
      var match = path.match(/^\/owner\/card\/([^/]+)\/?$/);
      if (!match) return;
      ownerNavigateToCard(decodeURIComponent(match[1]), false);
    });
  }

  function ownerNavigateToCard(cardRef, pushHistory) {
    var gen = ++ownerSwitchGen;
    var viewGen = ownerViewGen + 1;
    ownerBumpViewGeneration();
    ownerReleaseAppBindings();
    var scope = ownerReadCacheScope();
    exCardBusy.begin();
    ownerLoadCardPack(scope, "", cardRef).then(function (pack) {
      if (gen !== ownerSwitchGen || ownerSessionInvalid) return;
      if (pack && ownerApplyLocalCardPack(pack, !navigator.onLine, ownerViewGen, { skipTeardown: true })) {
        if (pushHistory) {
          var lang = pack.snapshot && pack.snapshot.lang ? pack.snapshot.lang.route : "";
          var path = "/owner/card/" + encodeURIComponent(cardRef);
          if (lang) path += "?lang=" + encodeURIComponent(lang);
          history.pushState({ ownerCard: cardRef }, "", path);
        }
        ownerBackgroundSyncCard(cardRef);
        return;
      }
      if (pushHistory) {
        window.location.href = "/owner/card/" + encodeURIComponent(cardRef) + window.location.search;
        return;
      }
      exCardBusy.reset();
    });
  }

  function ownerBackgroundSyncCard(cardRef) {
    if (!navigator.onLine) return;
    var pageCfg = readJsonNode("ex-owner-page-config") || {
      page: "boot-card",
      mode: "card",
      api: { bootstrap: "/owner/api/bootstrap" },
      i18n: (readJsonNode("ex-owner-app-config") || {}).i18n || {}
    };
    runOwnerBootstrap({
      card_ref: cardRef,
      background: true,
      pageCfg: pageCfg
    });
  }

  function ownerTryFastBoot(pageCfg) {
    if (!pageCfg) return Promise.resolve(false);
    if (ownerSessionInvalid) return Promise.resolve(false);
    pageCfg = ownerHydratePageConfigFromLocation(pageCfg);
    var scope = ownerReadCacheScope();
    if (!scope) return Promise.resolve(false);
    var cardRef = "";
    if (pageCfg.page === "boot-card") cardRef = String(pageCfg.card_ref || "");
    else if (pageCfg.page === "boot-hub" && !pageCfg.view_cards) {
      cardRef = ownerReadLastCardRef() || "";
    }
    if (!cardRef) return Promise.resolve(false);
    exCardBusy.begin();
    return ownerLoadCardPack(scope, "", cardRef).then(function (pack) {
      if (!pack) {
        exCardBusy.reset();
        return false;
      }
      var offline = !navigator.onLine;
      var ok = ownerApplyLocalCardPack(pack, offline, ownerViewGen);
      if (ok && pageCfg.page === "boot-hub") {
        var path = "/owner/card/" + encodeURIComponent(cardRef) + window.location.search;
        history.replaceState({ ownerCard: cardRef }, "", path);
      }
      return ok;
    });
  }

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

  function readActivationSecretFromWindow() {
    if (window.__exOwnerActivationSecret && /^[a-f0-9]{64}$/i.test(window.__exOwnerActivationSecret)) {
      return String(window.__exOwnerActivationSecret).toLowerCase();
    }
    return "";
  }

  function normalizeOwnerActivationInput(raw) {
    var text = String(raw || "").trim();
    if (!text) {
      return { ok: false, reason: "empty" };
    }
    if (text.length > 2048) {
      return { ok: false, reason: "long" };
    }
    if (/^[a-f0-9]{64}$/i.test(text)) {
      return { ok: true, token: text.toLowerCase() };
    }
    var scheme = text.split(":")[0].toLowerCase();
    if (scheme === "javascript" || scheme === "data") {
      return { ok: false, reason: "scheme" };
    }
    var url;
    try {
      url = new URL(text);
    } catch (e) {
      return { ok: false, reason: "format" };
    }
    if (url.protocol !== "https:") {
      return { ok: false, reason: "https" };
    }
    if (url.origin !== window.location.origin || url.username || url.password) {
      return { ok: false, reason: "origin" };
    }
    var path = url.pathname.replace(/\/+$/, "") || "/";
    if (path !== "/owner/activate") {
      return { ok: false, reason: "path" };
    }
    var fragment = url.hash ? String(url.hash).replace(/^#/, "") : "";
    try {
      fragment = decodeURIComponent(fragment);
    } catch (e2) {
      return { ok: false, reason: "fragment" };
    }
    if (!/^[a-f0-9]{64}$/i.test(fragment)) {
      return { ok: false, reason: "fragment" };
    }
    return { ok: true, token: fragment.toLowerCase() };
  }

  function ownerClearActivationSecrets(inputEl) {
    window.__exOwnerActivationSecret = "";
    if (inputEl) {
      inputEl.value = "";
    }
  }

  var OWNER_SIGNIN_ACTIVATE_TIMEOUT_MS = 25000;
  var OWNER_SIGNIN_CHALLENGE_TIMEOUT_MS = 12000;
  var OWNER_SIGNIN_SESSION_TIMEOUT_MS = 20000;
  var OWNER_SIGNIN_RENEW_TIMEOUT_MS = 25000;

  function ownerRequestTimeout(timeoutMs) {
    var ms = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 0;
    var controller = ms && typeof AbortController !== "undefined" ? new AbortController() : null;
    var guard = { signal: controller ? controller.signal : null, timedOut: false };
    guard.wrap = function (promise) {
      if (!ms) return promise;
      var timer = null;
      var timeout = new Promise(function (resolve, reject) {
        timer = setTimeout(function () {
          guard.timedOut = true;
          if (controller) {
            try {
              controller.abort();
            } catch (e) {}
          }
          reject(new Error("timeout"));
        }, ms);
      });
      return Promise.race([promise, timeout]).then(function (value) {
        clearTimeout(timer);
        return value;
      }, function (err) {
        clearTimeout(timer);
        throw err;
      });
    };
    return guard;
  }

  function ownerNewSigninState() {
    return {
      pageCfg: null,
      activateBusy: false,
      refreshBusy: false,
      renewBusy: false,
      activateStatus: null,
      renewStatus: null
    };
  }

  var ownerSigninState = ownerNewSigninState();
  var ownerSigninRefreshRequest = null;
  var ownerSigninPostInFlight = false;

  function ownerResetSigninState() {
    ownerSigninState = ownerNewSigninState();
  }

  function ownerSetSigninChallengeDom(value) {
    var node = document.querySelector("[data-ex-owner-challenge]");
    if (node) {
      node.setAttribute("data-ex-owner-challenge", /^[a-f0-9]{32}$/i.test(value || "") ? String(value).toLowerCase() : "");
    }
  }

  function ownerInvalidateSigninChallengeDom() {
    ownerSetSigninChallengeDom("");
  }

  function ownerSigninChallengeUrl(pageCfg) {
    var route = ownerNormalizeLangRoute(pageCfg && pageCfg.lang ? pageCfg.lang.route : "");
    var q = new URLSearchParams();
    if (route) q.set("lang", route);
    try {
      if (new URL(window.location.href).searchParams.get("setup") === "homescreen") {
        q.set("setup", "homescreen");
      }
    } catch (e) {}
    var qs = q.toString();
    return "/owner/activate" + (qs ? "?" + qs : "");
  }

  function refreshOwnerSigninChallenge(pageCfg) {
    if (!ownerSigninRefreshRequest) {
      var guard = ownerRequestTimeout(OWNER_SIGNIN_CHALLENGE_TIMEOUT_MS);
      var opts = {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "text/html" }
      };
      if (guard.signal) opts.signal = guard.signal;
      var request = guard.wrap(fetch(ownerSigninChallengeUrl(pageCfg), opts).then(function (res) {
        if (!res || !res.ok) return "";
        return res.text().then(function (html) {
          var match = String(html || "").match(/data-ex-owner-challenge="([a-f0-9]{32})"/i);
          return match ? match[1].toLowerCase() : "";
        });
      })).catch(function () {
        return "";
      }).then(function (challenge) {
        if (ownerSigninRefreshRequest === request) ownerSigninRefreshRequest = null;
        ownerSetSigninChallengeDom(challenge);
        return challenge;
      });
      ownerSigninRefreshRequest = request;
    }
    return ownerSigninRefreshRequest.then(function () {
      return readChallenge() !== "";
    });
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

  function postJson(url, body, retries, timeoutMs) {
    var left = typeof retries === "number" ? retries : 0;
    var guard = ownerRequestTimeout(timeoutMs);
    var opts = {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/vcard" },
      body: JSON.stringify(body || {})
    };
    if (guard.signal) opts.signal = guard.signal;
    return guard.wrap(fetch(url, opts)
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
            return postJson(url, body, left - 1, timeoutMs);
          }
          return { httpOk: httpOk, status: status, data: data, parseError: parseError, networkError: false };
        });
      }))
      .catch(function () {
        if (left > 0) return postJson(url, body, left - 1, timeoutMs);
        return { httpOk: false, status: 0, data: null, networkError: true, timedOut: guard.timedOut };
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

  var OWNER_API_MESSAGE_FALLBACKS = {
    errorNetwork: "Network error.",
    errorUnavailable: "Unavailable.",
    activateSessionLimit: "Device limit reached.",
    activateCodeInvalid: "Invalid code or link.",
    activateCodeConsumed: "This activation code has already been used.",
    activateInvalid: "Invalid link.",
    errorForbidden: "Forbidden.",
    errorBadRequest: "Bad request.",
    errorGeneric: "Request failed."
  };

  function mapApiMessageKey(env) {
    if (!env || env.networkError) {
      return "errorNetwork";
    }
    var code = responseCode(env);
    if (code === "expressar_dsi_received_contacts_unavailable") {
      return "errorUnavailable";
    }
    if (code === "expressar_dsi_access_session_limit_reached") {
      return "activateSessionLimit";
    }
    if (code === "expressar_dsi_access_activation_consumed") {
      return "activateCodeConsumed";
    }
    if (code === "expressar_dsi_access_activation_invalid") {
      return "activateCodeInvalid";
    }
    if (code.indexOf("forbidden") !== -1 || code === "expressar_dsi_access_session_invalid" || code === "expressar_owner_origin_forbidden") {
      return "errorForbidden";
    }
    if (code.indexOf("bad_request") !== -1) {
      return "errorBadRequest";
    }
    return "errorGeneric";
  }

  function mapApiMessage(i18n, env) {
    var key = mapApiMessageKey(env);
    return t(i18n, key, OWNER_API_MESSAGE_FALLBACKS[key]);
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

  function applyOwnerSignInI18n(pageCfg, route) {
    var dict = null;
    if (pageCfg && pageCfg.i18nAll) {
      dict = pageCfg.i18nAll[route] || pageCfg.i18nAll.sk || pageCfg.i18n;
    } else if (pageCfg && pageCfg.i18n) {
      dict = pageCfg.i18n;
    }
    if (!dict) return dict;
    if (pageCfg) {
      pageCfg.i18n = dict;
      if (!pageCfg.lang) pageCfg.lang = {};
      pageCfg.lang.route = route;
    }
    ownerSigninSetText("ex-owner-signin-title", dict, "myCards");
    ownerSigninSetText("ex-owner-signin-lead", dict, "hubEmpty");
    ownerSigninSetText("ex-owner-signin-tab-code", dict, "signInCodeTitle");
    ownerSigninSetText("ex-owner-signin-tab-renew", dict, "signInRenewTitle");
    ownerSigninSetText("ex-owner-signin-code-intro", dict, "signInCodeIntro");
    ownerSigninSetText("ex-owner-activate-link-hint", dict, "activateIntro");
    ownerSigninSetText("ex-owner-signin-code-label-text", dict, "signInCodeLabel");
    ownerSigninSetText("ex-owner-activate-btn", dict, "activateBtn");
    ownerSigninSetText("ex-owner-signin-renew-hint", dict, "signInRenewHint");
    ownerSigninSetText("ex-owner-signin-renew-label-text", dict, "signInRenewEmailLabel");
    ownerSigninSetText("ex-owner-renew-submit", dict, "signInRenewSubmit");
    ownerSigninSetText("ex-owner-renew-to-code", dict, "renewGoToCode");
    var tablist = document.getElementById("ex-owner-signin-tabs");
    if (tablist) tablist.setAttribute("aria-label", t(dict, "signInTabsLabel", tablist.getAttribute("aria-label") || ""));
    ownerSigninRenderStatus("activate");
    ownerSigninRenderStatus("renew");
    ownerSyncLangSelectValue(route);
    document.documentElement.setAttribute("lang", route === "en" ? "en" : route === "de" ? "de" : route === "cz" ? "cs" : "sk");
    ownerSetUiLangCookie(route);
    return dict;
  }

  function applyActivateI18n(pageCfg, route) {
    applyOwnerSignInI18n(pageCfg, route);
  }

  function ownerSigninSetText(id, dict, key) {
    var node = document.getElementById(id);
    if (node) node.textContent = t(dict, key, node.textContent);
  }

  function ownerSigninDict() {
    var cfg = ownerSigninState.pageCfg;
    return cfg && cfg.i18n ? cfg.i18n : {};
  }

  function ownerSigninStatusNode(kind) {
    return document.getElementById(kind === "renew" ? "ex-owner-renew-status" : "ex-owner-activate-status");
  }

  function ownerSigninRenderStatus(kind) {
    var node = ownerSigninStatusNode(kind);
    if (!node) return;
    var status = kind === "renew" ? ownerSigninState.renewStatus : ownerSigninState.activateStatus;
    if (!status) {
      node.textContent = "";
      node.removeAttribute("data-ex-owner-status-tone");
      return;
    }
    var dict = ownerSigninDict();
    var parts = [];
    status.keys.forEach(function (key) {
      var text = t(dict, key, OWNER_API_MESSAGE_FALLBACKS[key] || "");
      if (text) parts.push(text);
    });
    if (!parts.length) parts.push(t(dict, "errorGeneric", OWNER_API_MESSAGE_FALLBACKS.errorGeneric));
    node.textContent = parts.join(" ");
    node.setAttribute("data-ex-owner-status-tone", status.tone);
  }

  function ownerSigninShowStatus(state, kind, keys, tone) {
    if (state !== ownerSigninState) return;
    var status = keys && keys.length ? { keys: keys.slice(), tone: tone || "info" } : null;
    if (kind === "renew") state.renewStatus = status;
    else state.activateStatus = status;
    ownerSigninRenderStatus(kind);
    var node = ownerSigninStatusNode(kind);
    if (status && node && typeof node.scrollIntoView === "function") {
      try {
        node.scrollIntoView({ block: "nearest" });
      } catch (e) {}
    }
  }

  function ownerSigninSyncBusy(state) {
    if (state !== ownerSigninState) return;
    var activateBusy = state.activateBusy || state.refreshBusy;
    var activateForm = document.getElementById("ex-owner-activate-form");
    var activateBtn = document.getElementById("ex-owner-activate-btn");
    var renewForm = document.getElementById("ex-owner-renew-form");
    var renewBtn = document.getElementById("ex-owner-renew-submit");
    if (activateBtn) activateBtn.disabled = activateBusy;
    if (activateForm) activateForm.setAttribute("aria-busy", activateBusy ? "true" : "false");
    if (renewBtn) renewBtn.disabled = state.renewBusy;
    if (renewForm) renewForm.setAttribute("aria-busy", state.renewBusy ? "true" : "false");
  }

  function ownerSigninSelectTab(name, focusTab) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-ex-owner-signin-tab]"), function (tab) {
      var selected = tab.getAttribute("data-ex-owner-signin-tab") === name;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      var panel = document.getElementById(tab.getAttribute("aria-controls") || "");
      if (panel) panel.hidden = !selected;
      if (selected && focusTab) tab.focus();
    });
  }

  function ownerSigninBindTabs() {
    var tablist = document.getElementById("ex-owner-signin-tabs");
    if (!tablist || tablist._exOwnerTabsBound) return;
    tablist._exOwnerTabsBound = true;
    tablist.addEventListener("click", function (event) {
      var tab = event.target && event.target.closest ? event.target.closest("[data-ex-owner-signin-tab]") : null;
      if (!tab || !tablist.contains(tab)) return;
      event.preventDefault();
      ownerSigninSelectTab(tab.getAttribute("data-ex-owner-signin-tab"), false);
    });
    tablist.addEventListener("keydown", function (event) {
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll("[data-ex-owner-signin-tab]"));
      var index = tabs.indexOf(document.activeElement);
      if (index === -1) return;
      var next = -1;
      if (event.key === "ArrowRight" || event.key === "Right") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft" || event.key === "Left") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      if (next === -1) return;
      event.preventDefault();
      ownerSigninSelectTab(tabs[next].getAttribute("data-ex-owner-signin-tab"), true);
    });
  }

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

  function ownerSigninActivationSucceeded(state, redirect) {
    var current = state === ownerSigninState;
    ownerClearActivationSecrets(current ? document.getElementById("ex-owner-activation-input") : null);
    if (current) ownerSigninShowStatus(state, "activate", ["activateSuccess"], "success");
    window.location.replace(ownerActivationRedirect(redirect || "/owner/", state.pageCfg) || "/owner/");
  }

  function ownerSigninActivationFailed(state, keys, prepareFailKeys) {
    ownerSigninPostInFlight = false;
    state.activateBusy = false;
    if (state !== ownerSigninState) return;
    ownerSigninShowStatus(state, "activate", keys, "error");
    state.refreshBusy = true;
    ownerSigninSyncBusy(state);
    refreshOwnerSigninChallenge(state.pageCfg).then(function (ok) {
      state.refreshBusy = false;
      if (state !== ownerSigninState) return;
      if (!ok) {
        ownerSigninShowStatus(state, "activate", prepareFailKeys || keys.concat(["activatePrepareFailed"]), "error");
      }
      ownerSigninSyncBusy(state);
    });
  }

  function ownerSigninPrepareChallenge(state) {
    state.refreshBusy = true;
    ownerSigninSyncBusy(state);
    ownerSigninShowStatus(state, "activate", ["activatePreparing"], "info");
    refreshOwnerSigninChallenge(state.pageCfg).then(function (ok) {
      state.refreshBusy = false;
      if (state !== ownerSigninState) return;
      ownerSigninShowStatus(state, "activate", [ok ? "activateReadyAgain" : "activatePrepareFailed"], ok ? "info" : "error");
      ownerSigninSyncBusy(state);
    });
  }

  function ownerSigninSubmitActivation() {
    var state = ownerSigninState;
    if (state.activateBusy || state.refreshBusy) return;
    var input = document.getElementById("ex-owner-activation-input");
    var parsed = normalizeOwnerActivationInput(input ? input.value : "");
    if (!parsed.ok) {
      if (input) {
        input.setAttribute("aria-invalid", "true");
        input.focus();
      }
      ownerSigninShowStatus(state, "activate", [parsed.reason === "empty" ? "activateCodeEmpty" : "activateCodeFormat"], "error");
      return;
    }
    if (input) input.removeAttribute("aria-invalid");
    if (navigator.onLine === false) {
      ownerSigninShowStatus(state, "activate", ["errorNetwork"], "error");
      return;
    }
    if (ownerSigninPostInFlight) {
      ownerSigninShowStatus(state, "activate", ["activatePending"], "info");
      return;
    }
    var challenge = readChallenge();
    if (!challenge || ownerSigninRefreshRequest) {
      ownerSigninPrepareChallenge(state);
      return;
    }
    ownerSigninPostInFlight = true;
    state.activateBusy = true;
    ownerSigninSyncBusy(state);
    ownerSigninShowStatus(state, "activate", ["activatePending"], "info");
    ownerInvalidateSigninChallengeDom();
    postJson("/owner/activate", {
      activation_secret: parsed.token,
      device_label: deviceLabel(),
      browser_challenge: challenge
    }, 0, OWNER_SIGNIN_ACTIVATE_TIMEOUT_MS).then(function (env) {
      ownerInvalidateSigninChallengeDom();
      if (env && env.httpOk && env.data && env.data.ok === true) {
        ownerSigninActivationSucceeded(state, env.data.redirect);
        return;
      }
      var code = responseCode(env);
      if (code === "expressar_dsi_access_session_limit_reached") {
        ownerSigninActivationFailed(state, ["activateSessionLimit"]);
        return;
      }
      if (code === "expressar_dsi_access_identity_mismatch") {
        ownerSigninActivationFailed(state, ["activateIdentityMismatch"]);
        return;
      }
      if (code === "expressar_dsi_access_activation_consumed") {
        ownerSigninActivationFailed(state, ["activateCodeConsumed"]);
        return;
      }
      if (code === "expressar_dsi_access_activation_invalid") {
        ownerSigninActivationFailed(state, ["activateCodeInvalid"]);
        return;
      }
      if (env && !env.networkError && !code && (env.status === 400 || env.status === 403)) {
        ownerSigninActivationFailed(state, ["activateChallengeExpired"], ["activatePrepareFailed"]);
        return;
      }
      var keys = ["activateFailed"];
      if (!env || env.networkError) {
        keys = [env && env.timedOut ? "activateUnconfirmed" : "errorNetwork"];
      } else if (env.status >= 500 || env.parseError || code === "core_unavailable") {
        keys = ["errorUnavailable"];
      }
      ownerSigninShowStatus(state, "activate", ["activateVerifying"], "info");
      return postJson("/owner/api/session", {}, 0, OWNER_SIGNIN_SESSION_TIMEOUT_MS).then(function (sessionEnv) {
        if (sessionEnv && sessionEnv.httpOk && sessionEnv.data && sessionEnv.data.valid === true) {
          ownerSigninActivationSucceeded(state, "/owner/");
          return;
        }
        ownerSigninActivationFailed(state, keys);
      });
    }).catch(function () {
      if (state.activateBusy) ownerSigninActivationFailed(state, ["activateFailed"]);
      else ownerSigninPostInFlight = false;
    });
  }

  function ownerSigninSubmitRenew(form) {
    var state = ownerSigninState;
    if (state.renewBusy) return;
    var emailInput = form.querySelector('input[name="email"]');
    var email = emailInput ? String(emailInput.value || "").trim() : "";
    var toCode = document.getElementById("ex-owner-renew-to-code");
    if (!email || (emailInput && typeof emailInput.checkValidity === "function" && !emailInput.checkValidity())) {
      if (emailInput) {
        emailInput.setAttribute("aria-invalid", "true");
        emailInput.focus();
      }
      ownerSigninShowStatus(state, "renew", ["renewEmailInvalid"], "error");
      return;
    }
    if (emailInput) emailInput.removeAttribute("aria-invalid");
    if (toCode) toCode.hidden = true;
    state.renewBusy = true;
    ownerSigninSyncBusy(state);
    ownerSigninShowStatus(state, "renew", ["renewPending"], "info");
    postJson("/owner/api/renew", { email: email }, 0, OWNER_SIGNIN_RENEW_TIMEOUT_MS).then(function (env) {
      state.renewBusy = false;
      if (state !== ownerSigninState) return;
      if (env && env.httpOk && env.data && (env.data.ok === true || env.data.message)) {
        ownerSigninShowStatus(state, "renew", ["renewSuccess"], "success");
        var toCodeBtn = document.getElementById("ex-owner-renew-to-code");
        if (toCodeBtn) toCodeBtn.hidden = false;
      } else {
        ownerSigninShowStatus(state, "renew", [mapApiMessageKey(env)], "error");
      }
      ownerSigninSyncBusy(state);
    });
  }

  function initActivateAndHub() {
    var pageCfg = readJsonNode("ex-owner-page-config");
    ownerSigninState.pageCfg = pageCfg;
    initOwnerLangSwitcher(function (route) {
      applyOwnerSignInI18n(pageCfg, route);
    });
    var activateForm = document.getElementById("ex-owner-activate-form");
    if (!activateForm) return;
    var activationInput = document.getElementById("ex-owner-activation-input");
    var linkHint = document.getElementById("ex-owner-activate-link-hint");
    var hashToken = readActivationSecretFromWindow();
    if (hashToken) {
      window.__exOwnerActivationSecret = "";
      if (activationInput) activationInput.value = hashToken;
      if (linkHint) linkHint.hidden = false;
      ownerSigninSelectTab("code", false);
    }
    ownerSigninBindTabs();
    if (!activateForm._exOwnerSigninBound) {
      activateForm._exOwnerSigninBound = true;
      activateForm.addEventListener("submit", function (event) {
        event.preventDefault();
        ownerSigninSubmitActivation();
      });
      if (activationInput) {
        activationInput.addEventListener("input", function () {
          var state = ownerSigninState;
          activationInput.removeAttribute("aria-invalid");
          if (linkHint) linkHint.hidden = true;
          if (!state.activateBusy && !state.refreshBusy && state.activateStatus) {
            ownerSigninShowStatus(state, "activate", null);
          }
        });
      }
    }
    var renewForm = document.getElementById("ex-owner-renew-form");
    if (renewForm && !renewForm._exOwnerSigninBound) {
      renewForm._exOwnerSigninBound = true;
      renewForm.addEventListener("submit", function (event) {
        event.preventDefault();
        ownerSigninSubmitRenew(renewForm);
      });
      var emailInput = renewForm.querySelector('input[name="email"]');
      if (emailInput) {
        emailInput.addEventListener("input", function () {
          emailInput.removeAttribute("aria-invalid");
        });
      }
      var toCode = document.getElementById("ex-owner-renew-to-code");
      if (toCode) {
        toCode.addEventListener("click", function () {
          ownerSigninSelectTab("code", false);
          var input = document.getElementById("ex-owner-activation-input");
          if (input) input.focus();
        });
      }
    }
    ownerSigninSyncBusy(ownerSigninState);
  }

  function initOwnerApp() {
    var root = document.querySelector("[data-ex-owner-app]");
    if (!root) return;
    if (ownerAppBound) return;
    var cfg = readJsonNode("ex-owner-app-config");
    if (!cfg || !cfg.card_ref) return;
    ownerAppBound = true;
    var appViewGen = ownerViewGen;
    var myRevalidateInFlight = null;
    var privateValidationGen = 0;
    var i18n = cfg.i18n || {};
    var locale = cfg.lang && cfg.lang.locale ? cfg.lang.locale : "sk-SK";
    var publicUrl = String(cfg.public_url || "");
    var cardRef = String(cfg.card_ref || "");
    var publicId = String(cfg.public_id || cardRef || "");
    ownerCurrentCardIds = {
      publicId: publicId,
      slug: String((cfg.card_contract && cfg.card_contract.public_slug) || ""),
      ref: cardRef
    };
    var cacheScope = ownerReadCacheScope();
    var api = cfg.api || {};
    var cardContract = cfg.card_contract && typeof cfg.card_contract === "object" ? cfg.card_contract : {};
    var uiHints = cfg.ui_hints || {};
    var contactsUiVisible = uiHints.contacts_visible === true;
    var editUiVisible = uiHints.edit_visible === true;
    var contractGen = 0;
    var revalidating = false;
    var revalidateRetryPending = false;
    var privateAllowed = false;
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
      homescreen: document.querySelector('[data-ex-owner-panel="homescreen"]'),
      options: document.querySelector('[data-ex-owner-panel="options"]')
    };
    var optionsBusy = false;
    var optionsBtn = root.querySelector("[data-ex-owner-options]");

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
      if (ownerOptionsMutationBusy() && panels.options && !panels.options.hidden) {
        Object.keys(panels).forEach(function (key) {
          if (key !== "options" && panels[key]) panels[key].hidden = true;
        });
        exportFromQr = false;
        return;
      }
      if (panels.options && !panels.options.hidden) setOptionsView("list");
      Object.keys(panels).forEach(function (key) {
        if (panels[key]) panels[key].hidden = true;
      });
      exportFromQr = false;
      document.body.classList.remove("ex-public-owner-body--panel-open");
      if (optionsBtn) optionsBtn.setAttribute("aria-expanded", "false");
      restorePanelFocus();
      ownerFlushPendingBootstrap();
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
      if (btn && typeof btn.focus === "function") btn.focus({preventScroll:true});
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

    function refreshEditUiFromContract() {
      if (lastEditorAccess) {
        editUiVisible = editorPayloadCanShowManage(lastEditorAccess);
      } else if (ownerNormalizeContractRole(cardContract) === "company") {
        editUiVisible = false;
      } else {
        editUiVisible = cardContract.delegated_edit_request_available === true;
      }
      if (manageBtn) {
        manageBtn.hidden = !editUiVisible;
        if (!editUiVisible) {
          manageBtn.disabled = true;
        }
      }
    }

    function applyCardContract(contract) {
      if (!contract || typeof contract !== "object") return;
      contractGen += 1;
      cardContract = contract;
      if (typeof contract.received_contacts_available === "boolean") {
        contactsUiVisible = contract.received_contacts_available;
      }
      var allowContacts = contactsUiVisible;
      var allowEditRequest = contract.delegated_edit_request_available === true
        && ownerNormalizeContractRole(contract) !== "company";
      var contactsCta = root.querySelector("[data-ex-owner-contacts]");
      if (contactsCta) {
        contactsCta.hidden = !allowContacts;
        contactsCta.disabled = !allowContacts;
      }
      if (!allowContacts) {
        contactsGen += 1;
        detailGen += 1;
        clearPrivateData();
        if (panels.contacts) panels.contacts.hidden = true;
        if (panels.detail) panels.detail.hidden = true;
        var badge = root.querySelector("[data-ex-owner-unread]");
        if (badge) {
          badge.hidden = true;
          badge.textContent = "0";
        }
        var countErr = root.querySelector("[data-ex-owner-count-error]");
        if (countErr) countErr.hidden = true;
        lastUnread = null;
      }
      if (!allowEditRequest) {
        editLinkGen += 1;
        if (typeof closeEditRequestDialog === "function") {
          closeEditRequestDialog();
        }
      }
      ownerApplyShareLabelsForContract(root, i18n, contract);
      refreshEditUiFromContract();
      setPrivateUi(privateAllowed);
      if (typeof renderOwnerServiceActions === "function") renderOwnerServiceActions();
    }

    function setPrivateUi(enabled) {
      if (contactsBtn) {
        contactsBtn.hidden = !contactsUiVisible;
        contactsBtn.disabled = !enabled || !navigator.onLine
          || cardContract.received_contacts_available !== true;
      }

      [panels.contacts, panels.detail].forEach(function (panel) {
        if (!panel) return;

        if (!enabled || !navigator.onLine) {
          panel.hidden = true;
          panel.setAttribute("inert", "");
        } else {
          panel.removeAttribute("inert");
        }
      });

      var editButton = root.querySelector("[data-ex-owner-manage]");
      if (editButton && (!enabled || !navigator.onLine)) {
        editButton.hidden = !editUiVisible;
        editButton.disabled = true;
      }
    }

    function readEditActivationTokenFromHash() {
      try {
        var hash = String(location.hash || "").replace(/^#/, "");
        if (!hash) return "";
        var found = "";
        hash.split("&").forEach(function (part) {
          var idx = part.indexOf("=");
          if (idx < 0) return;
          if (decodeURIComponent(part.slice(0, idx)) === "ex_edit_act") {
            found = decodeURIComponent(part.slice(idx + 1));
          }
        });
        if (!/^[a-f0-9]{64}$/i.test(found)) return "";
        return found.toLowerCase();
      } catch (e) {
        return "";
      }
    }

    function failClosed() {
      privateAllowed = false;
      clearPrivateData();
      closeAllPanels();
      var scope = ownerReadCacheScope();
      ownerClearScopeCache(scope).then(function () {
        ownerReleaseAppBindings();
        root.innerHTML = "";
        window.location.replace("/owner/");
      });
    }

    function failCardDenied() {
      if (readEditActivationTokenFromHash()) {
        ownerSessionInvalid = true;
        ownerTeardownApp();
        clearPrivateData();
        setPrivateUi(false);
        closeAllPanels();
        showBootError(null, t(i18n, "editAccessNeedHolder", "Otvorte svoju kartu a prihláste sa ako jej držiteľ, potom aktiváciu dokončite."));
        return;
      }
      ownerSessionInvalid = true;
      privateValidationGen += 1;
      myRevalidateInFlight = null;
      privateAllowed = false;
      editLinkGen += 1;

      ownerTeardownApp();
      clearPrivateData();
      setPrivateUi(false);
      closeAllPanels();

      root.hidden = true;
      exCardBusy.reset();

      try {
        var lastRef = ownerReadLastCardRef();
        if (lastRef === cardRef || lastRef === publicId) {
          localStorage.removeItem(OWNER_LS_LAST_REF);
        }
      } catch (e) {}

      document.cookie = "excard_owner_pref=; path=/; max-age=0; secure; samesite=lax";

      ownerClearCardCache(cacheScope, publicId).then(function () {
        window.location.replace("/owner/?view=cards");
      }).catch(function () {
        showBootError(null, t(i18n, "errorUnavailable", ""));
      });
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
      if (publicationRequest.holder_request_blocked === true && publicationRequest.block_code === "company_card") {
        pubEl.hidden = true;
        pubEl.textContent = "";
        return;
      }
      var state = String(publicationRequest.state || "");
      var lines = [];
      if (publicationRequest.show_unpublished_notice && (state === "unpublished" || state === "request_stale" || state === "request_mail_failed")) {
        lines.push(t(i18n, "publicationUnpublished", "• zmeny nezverejnené •"));
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
      if (!manageBtn || !privateAllowed) return;
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
      if (typeof renderOwnerServiceActions === "function") renderOwnerServiceActions();
      if (typeof maybeOpenPendingActivation === "function") {
        maybeOpenPendingActivation();
      }
    }

    function revalidate(force) {
      if (appViewGen !== ownerViewGen || ownerSessionInvalid) {
        return Promise.resolve();
      }

      if (!navigator.onLine) {
        onOffline();
        return Promise.resolve();
      }

      if (myRevalidateInFlight) return myRevalidateInFlight;

      var validationGen = ++privateValidationGen;
      revalidating = true;
      revalidateRetryPending = false;
      privateAllowed = false;
      setPrivateUi(false);

      if (countError) countError.hidden = true;

      myRevalidateInFlight = postSession({ card_ref: cardRef })
        .then(function (env) {
          if (validationGen !== privateValidationGen
            || appViewGen !== ownerViewGen
            || ownerSessionInvalid) return;

          revalidating = false;
          myRevalidateInFlight = null;

          if (!navigator.onLine) {
            onOffline();
            return;
          }

          if (env && env.networkError) {
            showRevalidateUnavailable();
            return;
          }

          var payload = env && env.data ? env.data : null;

          if (!env || !env.httpOk || !payload
            || payload.unavailable === true) {
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
          applyCardContract(payload.card_contract || {});
          setPrivateUi(true);
          announce("");
          applySessionEditorAccess(payload.editor_access);
          applyOwnerPublicationState(payload.publication_request);
          refreshUnread();
        })
        .catch(function () {
          if (validationGen !== privateValidationGen
            || appViewGen !== ownerViewGen
            || ownerSessionInvalid) return;

          revalidating = false;
          myRevalidateInFlight = null;

          if (!navigator.onLine) {
            onOffline();
          } else {
            showRevalidateUnavailable();
          }
        });

      return myRevalidateInFlight;
    }

    document.cookie = "excard_owner_pref=" + encodeURIComponent(cardRef) + "; path=/; max-age=2592000; secure; samesite=lax";
    ownerWriteLastCardRef(cardRef);
    ownerBootstrapped = true;
    setPrivateUi(false);
    ownerRegisterTeardown(function () {
      privateValidationGen += 1;
      privateAllowed = false;
      editLinkGen += 1;
      clearPrivateData();

      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    });

    function onPageShow(event) {
      if (event.persisted) revalidate(true);
    }

    function onVisibility() {
      if (document.visibilityState === "visible") revalidate(true);
    }

    function onOffline() {
      if (appViewGen !== ownerViewGen || ownerSessionInvalid) return;

      privateValidationGen += 1;
      myRevalidateInFlight = null;
      revalidating = false;
      privateAllowed = false;
      contractGen += 1;
      editLinkGen += 1;

      clearPrivateData();
      setPrivateUi(false);

      if (manageBtn) {
        manageBtn.hidden = !editUiVisible;
        manageBtn.disabled = true;
      }

      if (editRequestDialog) editRequestDialog.hidden = true;

      var publicationState = root.querySelector(
        "[data-ex-owner-publication-state]"
      );
      if (publicationState) publicationState.hidden = true;

      ownerShowOfflineBadge(i18n);
    }

    function onOnline() {
      if (appViewGen !== ownerViewGen || ownerSessionInvalid) return;

      var badge = root.querySelector("[data-ex-owner-offline-badge]");
      if (badge) badge.hidden = true;

      revalidate(true);
    }

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    revalidate(true);

    function openPanel(name, opener) {
      if (ownerOptionsMutationBusy() && name !== "options") return;

      if (name === "homescreen" && ownerEmbedOptionsView("homescreen", panels.homescreen)) {
        focusPanelClose(panels.options);
        return;
      }
      if (opener) panelOpener = opener;
      Object.keys(panels).forEach(function (key) {
        if (panels[key]) panels[key].hidden = true;
      });
      exportFromQr = false;
      if (panels[name]) {
        panels[name].hidden = false;
        if (name === "options") {
          document.body.classList.add("ex-public-owner-body--panel-open");
          if (optionsBtn) optionsBtn.setAttribute("aria-expanded", "true");
        } else {
          document.body.classList.remove("ex-public-owner-body--panel-open");
          if (optionsBtn) optionsBtn.setAttribute("aria-expanded", "false");
        }
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
    bindPanelClose(panels.options, ownerOptionsBackOrClose);
    bindPanelBackdrop(panels.qr);
    bindPanelBackdrop(panels.share);
    bindPanelBackdrop(panels.contacts);
    bindPanelBackdrop(panels.detail);
    bindPanelBackdrop(panels.homescreen);
    bindPanelBackdrop(panels.options, function () {
      if (ownerOptionsMutationBusy()) return;
      ownerOptionsBackOrClose();
      if (!panels.options.hidden) closeAllPanels();
    });
    bindPanelBackdrop(panels.export, closeExportPanel);

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
    var editHaveCodeBtn = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-have-code]") : null;
    var editAskManagerBtn = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-ask-manager]") : null;
    var editCodePanel = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-code-panel]") : null;
    var editCodeInput = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-code]") : null;
    var editActivateBtn = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-activate]") : null;
    var editRequestPanel = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-request-panel]") : null;
    var editLinkPanel = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-link-panel]") : null;
    var editLinkConfirm = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-link-confirm]") : null;
    var editSuccessPanel = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-success-panel]") : null;
    var editContinueBtn = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-continue]") : null;
    var editAccessStatus = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-access-status]") : null;
    var editAccessOptions = editRequestDialog ? editRequestDialog.querySelector("[data-ex-owner-edit-access-options]") : null;
    var editRequestOpener = null;
    var editRequestInFlight = false;
    var pendingEditActivationToken = "";
    var lastEditorAccess = null;

    function closeLogoutDialog() {
      if (!logoutDialog || logoutDialog.hidden || logoutInFlight) return;
      logoutDialog.hidden = true;
      if (logoutDialog.hasAttribute("data-ex-owner-options-embedded")) setOptionsView("list");
      if (logoutConfirm) logoutConfirm.disabled = false;
      if (panels.options && !panels.options.hidden) {
        panels.options.removeAttribute("data-ex-owner-options-suspended");
      }
      if (logoutOpener && typeof logoutOpener.focus === "function") logoutOpener.focus();
      logoutOpener = null;
    }

    function openLogoutDialog(opener) {
      if (!logoutDialog || logoutInFlight) return;
      logoutOpener = opener || null;
      ownerEmbedOptionsView("logout", logoutDialog);
      logoutDialog.hidden = false;
      if (logoutDialog.hasAttribute("data-ex-owner-options-embedded")) focusPanelClose(panels.options);
      else if (logoutClose) logoutClose.focus({preventScroll:true});
    }

    function onDocumentKeydown(event) {
      if (appViewGen !== ownerViewGen) return;
      if (event.key === "Escape" || event.key === "Esc") {
        if (panels.options && !panels.options.hidden) {
          event.preventDefault();
          ownerOptionsBackOrClose();
          return;
        }
        if (logoutDialog && !logoutDialog.hidden) {
          event.preventDefault();
          closeLogoutDialog();
          return;
        }
        if (relinquishDialog && !relinquishDialog.hidden) {
          event.preventDefault();
          closeRelinquishDialog();
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
    }
    document.addEventListener("keydown", onDocumentKeydown);
    ownerRegisterTeardown(function () {
      document.removeEventListener("keydown", onDocumentKeydown);
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
        if (!navigator.onLine) {
          updateOnlineActions();
          return;
        }
        logoutInFlight = true;
        logoutConfirm.disabled = true;
        postJson(api.revoke || "/owner/api/revoke", {}, 0).then(function (env) {
          logoutInFlight = false;
          closeLogoutDialog();
          failClosed();
          if (env && env.networkError) {
            announce(t(i18n, "logoutLocalNetwork", t(i18n, "logoutFailed", "")));
            return;
          }
          if (env && env.httpOk && env.data && env.data.ok === true) {
            announce(t(i18n, "logoutRevoked", ""));
            return;
          }
          announce(t(i18n, "logoutLocalUnconfirmed", t(i18n, "logoutFailed", "")));
        });
      });
    }

    function ensureQrMatrix() {
      if (!qrMatrix && publicUrl) qrMatrix = encodePublicQr(publicUrl);
      return qrMatrix;
    }

    function renderQrPanelFromStore(host) {
      if (!host || !cacheScope || !publicId) return false;
      return ownerLoadQrBlob(cacheScope, publicId, "png", publicUrl).then(function (blob) {
        if (!blob) return false;
        host.textContent = "";
        var img = document.createElement("img");
        img.src = URL.createObjectURL(blob);
        img.alt = t(i18n, "qrAria", "QR");
        img.setAttribute("role", "img");
        host.appendChild(img);
        return true;
      });
    }

    var openQrBtn = root.querySelector("[data-ex-owner-open-qr]");
    if (openQrBtn) {
      openQrBtn.addEventListener("click", function () {
        var host = panels.qr ? panels.qr.querySelector("[data-ex-owner-qr]") : null;
        renderQrPanelFromStore(host).then(function (usedStore) {
          if (usedStore) {
            openPanel("qr", openQrBtn);
            return;
          }
          var qr = ensureQrMatrix();
          if (!qr || !host) {
            announce(t(i18n, "publicUrlMissing", ""));
            return;
          }
          renderQrToHost(host, qr, 4);
          if (cacheScope && publicId) {
            ownerPersistQrFiles(cacheScope, publicId, publicUrl, qr);
          }
          openPanel("qr", openQrBtn);
        });
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
        ownerLoadQrBlob(cacheScope, publicId, "png", publicUrl).then(function (stored) {
          if (stored) {
            downloadBlob(stored, exportFilename(publicId, "png"));
            closeExportPanel();
            return;
          }
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
            if (cacheScope && publicId) ownerPersistQrFiles(cacheScope, publicId, publicUrl, qr);
            downloadBlob(blob, exportFilename(publicId, "png"));
            closeExportPanel();
          }, "image/png");
        });
      });
    }

    var exportSvg = document.querySelector("[data-ex-owner-export-svg]");
    if (exportSvg) {
      exportSvg.addEventListener("click", function () {
        ownerLoadQrBlob(cacheScope, publicId, "svg", publicUrl).then(function (stored) {
          if (stored) {
            downloadBlob(stored, exportFilename(publicId, "svg"));
            closeExportPanel();
            return;
          }
          var qr = ensureQrMatrix();
          if (!qr) {
            announce(t(i18n, "exportFailed", ""));
            return;
          }
          var svg = buildQrSvgDocument(qr, QR_MARGIN_MODULES);
          var blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
          if (cacheScope && publicId) ownerPersistQrFiles(cacheScope, publicId, publicUrl, qr);
          downloadBlob(blob, exportFilename(publicId, "svg"));
          closeExportPanel();
        });
      });
    }

    var shareBtn = root.querySelector("[data-ex-owner-share]");
    var sharePanel = panels.share;
    var shareCopyBtn = sharePanel && sharePanel.querySelector("[data-ex-owner-share-copy]");
    var shareCopyLabel = sharePanel && sharePanel.querySelector("[data-ex-owner-share-copy-label]");
    var shareOpenLink = sharePanel && sharePanel.querySelector("[data-ex-owner-share-open]");
    var shareManual = sharePanel && sharePanel.querySelector("[data-ex-owner-share-manual]");
    var shareField = sharePanel && sharePanel.querySelector("[data-ex-owner-share-field]");
    var shareHint = sharePanel && sharePanel.querySelector("[data-ex-owner-share-hint]");
    var shareResetTimer = null;
    var shareGeneration = 0;
    var shareUrl = "";

    try {
      var parsedShareUrl = new URL(publicUrl, window.location.origin);
      if (parsedShareUrl.protocol === "https:"
          && parsedShareUrl.origin === window.location.origin
          && !/^\/owner(?:\/|$)/i.test(parsedShareUrl.pathname)) {
        shareUrl = parsedShareUrl.href;
      }
    } catch (shareUrlError) {}
    function updateOnlineActions() {
      if (appViewGen !== ownerViewGen || ownerSessionInvalid) return;

      var online = navigator.onLine;

      if (shareOpenLink) {
        var available = online && !!shareUrl;
        shareOpenLink.hidden = !shareUrl;

        if (available) {
          shareOpenLink.href = shareUrl;
          shareOpenLink.removeAttribute("aria-disabled");
          shareOpenLink.removeAttribute("tabindex");
          shareOpenLink.removeAttribute("role");
        } else {
          shareOpenLink.removeAttribute("href");
          shareOpenLink.setAttribute("aria-disabled", "true");
          shareOpenLink.setAttribute("tabindex", "-1");
          shareOpenLink.setAttribute("role", "link");
        }
      }

      var logoutButton = root.querySelector("[data-ex-owner-logout], [data-ex-owner-service='logout']");
      if (logoutButton) logoutButton.disabled = !online;
      if (logoutConfirm) {
        logoutConfirm.disabled = !online || logoutInFlight;
      }
      if (optionsCodeSubmit) optionsCodeSubmit.disabled = !online || optionsBusy;
      if (relinquishConfirm) relinquishConfirm.disabled = !online || optionsBusy;
      if (editRequestConfirm) editRequestConfirm.disabled = !online || editRequestInFlight;
      if (editActivateBtn) editActivateBtn.disabled = !online || editRequestInFlight;
      if (editLinkConfirm) editLinkConfirm.disabled = !online || editRequestInFlight;
      if (editHaveCodeBtn) editHaveCodeBtn.disabled = !online || editRequestInFlight;
      if (editAskManagerBtn) editAskManagerBtn.disabled = !online || editRequestInFlight;
      if (editContinueBtn) editContinueBtn.disabled = !online || editRequestInFlight;
    }

    if (shareOpenLink) {
      shareOpenLink.addEventListener("click", function (event) {
        updateOnlineActions();

        if (!navigator.onLine || !shareUrl
          || shareOpenLink.getAttribute("aria-disabled") === "true") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      });
    }

    window.addEventListener("online", updateOnlineActions);
    window.addEventListener("offline", updateOnlineActions);

    ownerRegisterTeardown(function () {
      window.removeEventListener("online", updateOnlineActions);
      window.removeEventListener("offline", updateOnlineActions);
    });

    updateOnlineActions();

    function resetShareCopy() {
      if (shareResetTimer !== null) window.clearTimeout(shareResetTimer);
      shareResetTimer = null;
      if (shareCopyBtn) shareCopyBtn.disabled = !shareUrl;
      if (shareCopyLabel) {
        shareCopyLabel.textContent = t(i18n, "shareCopyLink", "Skopírovať odkaz");
      }
    }

    function showShareManual() {
      if (shareManual) shareManual.hidden = false;
      if (shareHint) {
        shareHint.hidden = false;
        shareHint.textContent = t(
          i18n,
          "shareManualHint",
          "Označte odkaz a skopírujte ho ručne."
        );
      }
      if (shareField) {
        shareField.value = shareUrl;
        shareField.focus();
        shareField.select();
      }
    }

    if (shareBtn && sharePanel) {
      shareBtn.addEventListener("click", function () {
        shareGeneration += 1;
        resetShareCopy();

        if (shareManual) shareManual.hidden = true;
        updateOnlineActions();

        openPanel("share", shareBtn);

        if (!shareUrl && shareHint) {
          if (shareManual) shareManual.hidden = false;
          shareHint.hidden = false;
          shareHint.textContent = t(
            i18n,
            "publicUrlMissing",
            "Verejný odkaz nie je dostupný."
          );
          if (shareField) shareField.hidden = true;
        }
      });
    }

    if (shareCopyBtn) {
      shareCopyBtn.addEventListener("click", function () {
        if (!shareUrl || shareCopyBtn.disabled) return;

        var generation = shareGeneration;

        if (!navigator.clipboard
            || typeof navigator.clipboard.writeText !== "function") {
          showShareManual();
          return;
        }

        shareCopyBtn.disabled = true;

        navigator.clipboard.writeText(shareUrl).then(function () {
          if (generation !== shareGeneration || sharePanel.hidden) return;

          if (shareManual) shareManual.hidden = true;
          if (shareCopyLabel) {
            shareCopyLabel.textContent = t(
              i18n,
              "shareCopied",
              "Odkaz skopírovaný."
            );
          }

          shareResetTimer = window.setTimeout(resetShareCopy, 3000);
        }).catch(function () {
          if (generation !== shareGeneration || sharePanel.hidden) return;

          resetShareCopy();
          showShareManual();
        });
      });
    }

    var logoutBtn = null;

    var manageBtn = root.querySelector("[data-ex-owner-manage]");
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
      if (ownerNormalizeContractRole(cardContract) === "company") {
        if (payload && payload.can_edit === true && payload.mode === "manager") {
          return isValidHttpsEditUrl(payload.edit_url, false);
        }
        return false;
      }
      if (payload && payload.can_edit === true) {
        if (payload.mode === "delegated") return true;
        if (payload.mode === "manager") return isValidHttpsEditUrl(payload.edit_url, false);
      }
      return cardContract.delegated_edit_request_available === true;
    }

    function editorPayloadCanNavigate(payload) {
      if (!payload || payload.can_edit !== true) return false;
      if (payload.mode === "delegated") return isValidHttpsEditUrl(payload.edit_url, true);
      if (payload.mode === "manager") return isValidHttpsEditUrl(payload.edit_url, false);
      return false;
    }

    function setEditAccessStatus(message) {
      if (!editAccessStatus) return;
      var text = String(message || "");
      editAccessStatus.textContent = text;
      editAccessStatus.hidden = !text;
    }

    function setEditAccessPanel(mode) {
      if (editAccessOptions) editAccessOptions.hidden = mode !== "options";
      if (editCodePanel) editCodePanel.hidden = mode !== "code";
      if (editRequestPanel) editRequestPanel.hidden = mode !== "request";
      if (editLinkPanel) editLinkPanel.hidden = mode !== "link";
      if (editSuccessPanel) editSuccessPanel.hidden = mode !== "success";
    }

    function closeEditRequestDialog() {
      if (!editRequestDialog || editRequestDialog.hidden || editRequestInFlight) return;
      editRequestDialog.hidden = true;
      if (editRequestDialog.hasAttribute("data-ex-owner-options-embedded")) setOptionsView("list");
      if (panels.options && !panels.options.hidden) {
        panels.options.removeAttribute("data-ex-owner-options-suspended");
      }
      setEditAccessStatus("");
      setEditAccessPanel("options");
      if (editCodeInput) editCodeInput.value = "";
      if (editRequestConfirm) editRequestConfirm.disabled = false;
      if (editActivateBtn) editActivateBtn.disabled = false;
      if (editLinkConfirm) editLinkConfirm.disabled = false;
      if (editRequestOpener && typeof editRequestOpener.focus === "function") editRequestOpener.focus();
      editRequestOpener = null;
    }

    function openEditAccessDialog(opener, mode) {
      if (!editRequestDialog || editRequestInFlight) return;
      editRequestOpener = opener || null;
      ownerEmbedOptionsView("activate-edits", editRequestDialog);
      setEditAccessStatus("");
      setEditAccessPanel(mode || "options");
      editRequestDialog.hidden = false;
      if (mode === "code" && editCodeInput) {
        editCodeInput.focus();
        return;
      }
      if (mode === "link" && editLinkConfirm) {
        editLinkConfirm.focus();
        return;
      }
      if (editRequestDialog.hasAttribute("data-ex-owner-options-embedded")) focusPanelClose(panels.options);
      else if (editRequestClose) editRequestClose.focus({preventScroll:true});
    }

    function clearEditActivationHash() {
      try {
        if (String(location.hash || "").indexOf("ex_edit_act") === -1) return;
        history.replaceState(null, "", location.pathname + location.search);
      } catch (e) {}
    }

    function consumePendingActivationHash() {
      if (pendingEditActivationToken) return pendingEditActivationToken;
      pendingEditActivationToken = readEditActivationTokenFromHash();
      if (pendingEditActivationToken) clearEditActivationHash();
      return pendingEditActivationToken;
    }

    function submitEditRequest() {
      if (editRequestInFlight || !api.edit_request) return;
      if (!navigator.onLine) {
        updateOnlineActions();
        setEditAccessStatus(t(i18n, "networkError", t(i18n, "editRequestFailed", "")));
        return;
      }
      editRequestInFlight = true;
      if (editRequestConfirm) editRequestConfirm.disabled = true;
      postJson(api.edit_request, {
        card_ref: cardRef,
        card_label: cardDisplayLabel() || cardRef
      }, 0).then(function (env) {
        editRequestInFlight = false;
        if (editRequestConfirm) editRequestConfirm.disabled = false;
        if (env && env.httpOk && env.data && env.data.ok === true) {
          closeEditRequestDialog();
          announce(t(i18n, "editRequestSent", ""));
          return;
        }
        if (env && env.status === 429) {
          setEditAccessStatus(t(i18n, "editRequestRateLimited", ""));
          return;
        }
        setEditAccessStatus(t(i18n, "editRequestFailed", ""));
      }).catch(function () {
        editRequestInFlight = false;
        if (editRequestConfirm) editRequestConfirm.disabled = false;
        setEditAccessStatus(t(i18n, "editRequestFailed", ""));
      });
    }

    function submitEditActivation(kind) {
      if (editRequestInFlight || !api.edit_activate) return;
      if (!privateAllowed) {
        setEditAccessStatus(t(i18n, "editAccessNeedHolder", ""));
        return;
      }
      if (!navigator.onLine) {
        updateOnlineActions();
        setEditAccessStatus(t(i18n, "networkError", t(i18n, "editAccessInvalid", "")));
        return;
      }
      var body = { card_ref: cardRef };
      if (kind === "code") {
        body.activation_code = editCodeInput ? String(editCodeInput.value || "") : "";
        if (!String(body.activation_code).replace(/[\s-]/g, "")) {
          setEditAccessStatus(t(i18n, "editAccessInvalid", ""));
          return;
        }
      } else {
        body.activation_token = pendingEditActivationToken || consumePendingActivationHash();
        if (!body.activation_token) {
          setEditAccessStatus(t(i18n, "editAccessInvalid", ""));
          return;
        }
      }
      editRequestInFlight = true;
      if (editActivateBtn) editActivateBtn.disabled = true;
      if (editLinkConfirm) editLinkConfirm.disabled = true;
      postJson(api.edit_activate, body, 0).then(function (env) {
        editRequestInFlight = false;
        if (
          appViewGen !== ownerViewGen
          || ownerSessionInvalid
          || !privateAllowed
          || !navigator.onLine
        ) return;
        if (editActivateBtn) editActivateBtn.disabled = false;
        if (editLinkConfirm) editLinkConfirm.disabled = false;
        if (env && env.status === 401) {
          setEditAccessStatus(t(i18n, "editAccessNeedHolder", ""));
          return;
        }
        if (env && env.httpOk && env.data && env.data.ok === true) {
          pendingEditActivationToken = "";
          lastEditorAccess = {
            can_edit: true,
            mode: "delegated",
            expires_at: env.data.expires_at || ""
          };
          editUiVisible = true;
          if (manageBtn) {
            manageBtn.hidden = false;
            manageBtn.disabled = !navigator.onLine;
          }
          setEditAccessPanel("success");
          announce(t(i18n, "editAccessActivated", ""));
          return;
        }
        setEditAccessStatus(t(i18n, "editAccessInvalid", ""));
      }).catch(function () {
        editRequestInFlight = false;
        if (
          appViewGen !== ownerViewGen
          || ownerSessionInvalid
          || !privateAllowed
          || !navigator.onLine
        ) return;
        if (editActivateBtn) editActivateBtn.disabled = false;
        if (editLinkConfirm) editLinkConfirm.disabled = false;
        setEditAccessStatus(t(i18n, "editAccessInvalid", ""));
      });
    }

    function openEditorFromAccess() {
      if (!privateAllowed || !navigator.onLine || !api.editor_link) return;
      editLinkGen += 1;
      var gen = editLinkGen;
      if (manageBtn) manageBtn.disabled = true;
      postJson(api.editor_link, { card_ref: cardRef }, 0)
        .then(function (env) {
          applyEditorLinkResponse(env, gen);
          if (gen !== editLinkGen) return;
          var payload = env && env.data ? env.data : null;
          if (privateAllowed && env && env.httpOk === true && !env.networkError && !env.parseError && editorPayloadCanNavigate(payload)) {
            window.location.href = String(payload.edit_url);
            return;
          }
          if (manageBtn) manageBtn.disabled = !navigator.onLine;
        })
        .catch(function () {
          if (gen !== editLinkGen) return;
          if (manageBtn) manageBtn.disabled = false;
          showEditLinkServiceError();
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
    if (editHaveCodeBtn) {
      editHaveCodeBtn.addEventListener("click", function () {
        if (editRequestInFlight) return;
        setEditAccessPanel("code");
        if (editCodeInput) editCodeInput.focus();
      });
    }
    if (editAskManagerBtn) {
      editAskManagerBtn.addEventListener("click", function () {
        if (editRequestInFlight) return;
        setEditAccessPanel("request");
        if (editRequestConfirm) editRequestConfirm.focus();
      });
    }
    if (editRequestConfirm) {
      editRequestConfirm.addEventListener("click", function () {
        submitEditRequest();
      });
    }
    if (editActivateBtn) {
      editActivateBtn.addEventListener("click", function () {
        submitEditActivation("code");
      });
    }
    if (editLinkConfirm) {
      editLinkConfirm.addEventListener("click", function () {
        submitEditActivation("token");
      });
    }
    if (editContinueBtn) {
      editContinueBtn.addEventListener("click", function () {
        closeEditRequestDialog();
        openEditorFromAccess();
      });
    }
    if (editCodeInput) {
      editCodeInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          submitEditActivation("code");
        }
      });
    }

    function showEditLinkServiceError() {
      if (manageBtn && cardContract.delegated_edit_request_available !== true && !(lastEditorAccess && lastEditorAccess.can_edit === true)) {
        manageBtn.hidden = true;
      }
      announce(t(i18n, "editLinkUnavailable", t(i18n, "errorUnavailable", "")));
    }

    function applyEditorLinkResponse(env, gen) {
      if (gen !== editLinkGen || !privateAllowed) return;
      if (manageBtn) {
        manageBtn.disabled = !navigator.onLine;
        manageBtn.hidden = true;
      }
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
      lastEditorAccess = payload;
      editUiVisible = editorPayloadCanShowManage(payload);
      if (manageBtn) manageBtn.hidden = !editUiVisible;
      announce("");
    }

    function maybeOpenPendingActivation() {
      if (!privateAllowed || !editRequestDialog) return;
      if (lastEditorAccess && lastEditorAccess.can_edit === true) return;
      var token = consumePendingActivationHash();
      if (!token) return;
      openEditAccessDialog(manageBtn, "link");
    }

    if (manageBtn) {
      manageBtn.hidden = !editUiVisible;
      manageBtn.disabled = true;
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
      maybeOpenPendingActivation();
      manageBtn.addEventListener("click", function () {
        if (!privateAllowed) return;
        if (!navigator.onLine) {
          updateOnlineActions();
          return;
        }
        if (lastEditorAccess && lastEditorAccess.can_edit === true && api.editor_link) {
          openEditorFromAccess();
          return;
        }
        if (cardContract.delegated_edit_request_available === true
          && ownerNormalizeContractRole(cardContract) !== "company") {
          openEditAccessDialog(manageBtn, "options");
        }
      });
    }

    var optionsList = panels.options ? panels.options.querySelector("[data-ex-owner-options-list]") : null;
    var optionsCodeInput = panels.options ? panels.options.querySelector("[data-ex-owner-options-code]") : null;
    var optionsCodeStatus = panels.options ? panels.options.querySelector("[data-ex-owner-options-code-status]") : null;
    var optionsCodeSubmit = panels.options ? panels.options.querySelector("[data-ex-owner-options-code-submit]") : null;
    var howtoBody = panels.options ? panels.options.querySelector("[data-ex-owner-howto-body]") : null;
    var relinquishDialog = document.querySelector("[data-ex-owner-relinquish-dialog]");
    var relinquishClose = relinquishDialog ? relinquishDialog.querySelector("[data-ex-owner-relinquish-close]") : null;
    var relinquishConfirm = relinquishDialog ? relinquishDialog.querySelector("[data-ex-owner-relinquish-confirm]") : null;
    var relinquishText = relinquishDialog ? relinquishDialog.querySelector("[data-ex-owner-relinquish-text]") : null;
    var relinquishOpener = null;

    function ownerServiceActionDefs() {
      return [
        { id: "howto", key: "optionsHowTo", fallback: "Ako používať expressCARD", glyph: "howto", perm: "always" },
        { id: "homescreen", key: "actionHomescreenGuide", fallback: "Ikona na plochu", glyph: "home-screen", perm: "homescreen" },
        { id: "add-code", key: "optionsAddCode", fallback: "Pridať kartu kódom", glyph: "cards-switch", perm: "always" },
        { id: "activate-edits", key: "optionsActivateEdits", fallback: "Aktivovať úpravy kódom", glyph: "edit", perm: "edit-code" },
        { id: "manage", key: "actionManage", fallback: "Správa expressCARD", glyph: "brand", perm: "manager" },
        { id: "relinquish", key: "relinquishTitle", fallback: "Odobrať túto kartu z expressCARD", glyph: "contacts", perm: "shared" },
        { id: "logout", key: "logoutLink", fallback: "Odhlásiť toto zariadenie", glyph: "app", perm: "always" }
      ];
    }

    function ownerServicePermitted(perm) {
      if (perm === "always") return true;
      if (perm === "homescreen") return !isStandaloneDisplay();
      if (perm === "edit-code") {
        return cardContract.delegated_edit_request_available === true
          && ownerNormalizeContractRole(cardContract) !== "company";
      }
      if (perm === "manager") {
        return !!(lastEditorAccess && lastEditorAccess.can_edit === true && lastEditorAccess.mode === "manager"
          && isValidHttpsEditUrl(lastEditorAccess.edit_url, false));
      }
      if (perm === "shared") return cardContract.relationship_kind === "shared";
      return false;
    }

    var optionsActiveView = "list";

function ownerOptionsMutationBusy() {
  return !!(optionsBusy || logoutInFlight || editRequestInFlight);
}

function setOptionsView(name) {
  if (!panels.options) return;

var desktopOptions = window.matchMedia("(min-width:700px)").matches;

if (panels.options.hidden || !desktopOptions) {
  panels.options.removeAttribute("data-ex-owner-options-anchored");
  panels.options.style.removeProperty("--ex-owner-options-bottom");
} else if (!panels.options.hasAttribute("data-ex-owner-options-anchored")) {
  var anchorCard = panels.options.querySelector("#ex-owner-options-panel");
  if (anchorCard) {
    var overlayRect = panels.options.getBoundingClientRect();
    var cardRect = anchorCard.getBoundingClientRect();
    if (cardRect.height > 0) {
      var bottomOffset = Math.max(0, overlayRect.bottom - cardRect.bottom);
      panels.options.style.setProperty("--ex-owner-options-bottom", bottomOffset + "px");
      panels.options.setAttribute("data-ex-owner-options-anchored", "1");
    }
  }
}

optionsActiveView = name;
  panels.options.removeAttribute("data-ex-owner-options-suspended");

  panels.options.querySelectorAll("[data-ex-owner-options-view]").forEach(function (view) {
    view.hidden = view.getAttribute("data-ex-owner-options-view") !== name;
  });

  var title = panels.options.querySelector("#ex-owner-options-title");
  var header = title ? title.closest(".ex-public-owner-app__panel-head") : null;
  var close = panels.options.querySelector("[data-ex-owner-panel-close]");
  if (!title || !header || !close) return;

  title.textContent = t(i18n, "optionsTitle", "Možnosti expressCARD");
  title.removeAttribute("data-ex-owner-service");

  var section = panels.options.querySelector("[data-ex-owner-options-subhead]");
  if (!section) {
    section = document.createElement("div");
    section.setAttribute("data-ex-owner-options-subhead", "1");
    section.innerHTML = '<hr class="ex-public-owner-options__divider"><div class="ex-public-owner-options__subline"><h3 class="ex-public-owner-options__subtitle"></h3></div>';
    header.insertAdjacentElement("afterend", section);
  }

  if (name === "list") {
    header.appendChild(close);
    section.hidden = true;
    return;
  }

  var def = ownerServiceActionDefs().filter(function (row) {
    return row.id === name;
  })[0];

  if (!def) {
    header.appendChild(close);
    section.hidden = true;
    return;
  }

  var subtitle = section.querySelector(".ex-public-owner-options__subtitle");
  subtitle.textContent = "";
  subtitle.setAttribute("data-ex-owner-service", name);

  var icon = document.createElement("span");
  icon.className = "ex-public-owner-app__glyph ex-public-owner-app__glyph--" + def.glyph;
  icon.setAttribute("aria-hidden", "true");

  var label = document.createElement("span");
  label.textContent = t(i18n, def.key, def.fallback);

  subtitle.appendChild(icon);
  subtitle.appendChild(label);
  section.querySelector(".ex-public-owner-options__subline").appendChild(close);
  section.hidden = false;
  focusPanelClose(panels.options);
}

    function ownerEmbedOptionsView(name, source) {
      if (!panels.options || !source) return false;

      if (panels.options.hidden && !source.hasAttribute("data-ex-owner-options-embedded")) {
        return false;
      }

      var card = panels.options.querySelector("#ex-owner-options-panel");
      if (!card) return false;

      source.setAttribute("data-ex-owner-options-view", name);
      source.setAttribute("data-ex-owner-options-embedded", "1");

      var dialog = source.querySelector('[role="dialog"]');
      if (dialog) {
        dialog.removeAttribute("role");
        dialog.removeAttribute("aria-modal");
        dialog.removeAttribute("aria-labelledby");
      }

      if (source.parentNode !== card) card.appendChild(source);

      panels.options.hidden = false;
      document.body.classList.add("ex-public-owner-body--panel-open");
      if (optionsBtn) optionsBtn.setAttribute("aria-expanded", "true");

      setOptionsView(name);
      return true;
    }

    function ownerOptionsBackOrClose() {
      if (!panels.options || panels.options.hidden || ownerOptionsMutationBusy()) return;

      if (optionsActiveView === "list") {
        closeAllPanels();
        return;
      }

      var previous = optionsActiveView;

      if (logoutDialog && !logoutDialog.hidden) closeLogoutDialog();
      if (editRequestDialog && !editRequestDialog.hidden) closeEditRequestDialog();
      if (relinquishDialog && !relinquishDialog.hidden) closeRelinquishDialog();

      setOptionsView("list");

      var opener = panels.options.querySelector('[data-ex-owner-service="' + previous + '"]');
      if (opener) opener.focus({preventScroll:true});
      else focusPanelClose(panels.options);
    }

    function renderOwnerServiceActions() {
      if (!optionsList) return;
      optionsList.textContent = "";
      ownerServiceActionDefs().forEach(function (def) {
        if (!ownerServicePermitted(def.perm)) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ex-public-owner-options__item";
        btn.setAttribute("data-ex-owner-service", def.id);
        var label = t(i18n, def.key, def.fallback);
        if (def.id === "homescreen" && deferredInstallPrompt && !installPromptConsumed) {
          label = t(i18n, "actionHomescreen", "Pridať na plochu");
        }
        btn.innerHTML = '<span class="ex-public-owner-app__glyph ex-public-owner-app__glyph--' + def.glyph + '" aria-hidden="true"></span>';
        var span = document.createElement("span");
        span.textContent = label;
        btn.appendChild(span);
        btn.addEventListener("click", function () {
          runOwnerServiceAction(def.id, btn);
        });
        optionsList.appendChild(btn);
      });
    }

    function runOwnerServiceAction(id, opener) {
      if (optionsBusy) return;
      if (id === "howto") {
        if (howtoBody) howtoBody.textContent = t(i18n, "optionsHowToBody", "");
        setOptionsView("howto");
        return;
      }
      if (id === "homescreen") {
        handleHomescreenAction(opener || optionsBtn);
        return;
      }
      if (id === "add-code") {
        setOptionsView("add-code");
        if (optionsCodeStatus) {
          optionsCodeStatus.hidden = true;
          optionsCodeStatus.textContent = "";
        }
        if (optionsCodeInput) {
          optionsCodeInput.value = "";
          optionsCodeInput.focus();
        }
        return;
      }
      if (id === "activate-edits") {
        openEditAccessDialog(opener || optionsBtn, "code");
        return;
      }
      if (id === "manage") {
        if (manageBtn && !manageBtn.hidden) manageBtn.click();
        return;
      }
      if (id === "relinquish") {
        openRelinquishDialog(opener || optionsBtn);
        return;
      }
      if (id === "logout") {
        openLogoutDialog(opener || optionsBtn);
      }
    }

    function ownerOptionsKbInset() {
      if (!panels.options || typeof window.visualViewport === "undefined" || !window.visualViewport) return;
      var inset = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
      panels.options.style.setProperty("--ex-owner-kb-inset", inset + "px");
    }


    function setOptionsCodeStatus(keys, tone) {
      if (!optionsCodeStatus) return;
      var text = "";
      (keys || []).forEach(function (key) {
        var part = t(i18n, key, "");
        if (part) text = text ? text + " " + part : part;
      });
      optionsCodeStatus.textContent = text;
      optionsCodeStatus.hidden = !text;
      if (tone) optionsCodeStatus.setAttribute("data-ex-owner-status-tone", tone);
    }

    function submitOwnerAddCode() {
      if (optionsBusy) return;
      if (navigator.onLine === false) {
        setOptionsCodeStatus(["errorNetwork"], "error");
        return;
      }
      var parsed = normalizeOwnerActivationInput(optionsCodeInput ? optionsCodeInput.value : "");
      if (!parsed.ok) {
        if (optionsCodeInput) {
          optionsCodeInput.setAttribute("aria-invalid", "true");
          optionsCodeInput.focus();
        }
        setOptionsCodeStatus([parsed.reason === "empty" ? "activateCodeEmpty" : "activateCodeFormat"], "error");
        return;
      }
      if (optionsCodeInput) optionsCodeInput.removeAttribute("aria-invalid");
      optionsBusy = true;
      if (optionsCodeSubmit) optionsCodeSubmit.disabled = true;
      setOptionsCodeStatus(["activatePending"], "info");
      refreshOwnerSigninChallenge(cfg).then(function (ok) {
        var challenge = readChallenge();
        if (!ok || !challenge) {
          optionsBusy = false;
          if (optionsCodeSubmit) optionsCodeSubmit.disabled = !navigator.onLine;
          setOptionsCodeStatus(["activatePrepareFailed"], "error");
          return;
        }
        ownerInvalidateSigninChallengeDom();
        return postJson("/owner/activate", {
          activation_secret: parsed.token,
          device_label: deviceLabel(),
          browser_challenge: challenge
        }, 0, OWNER_SIGNIN_ACTIVATE_TIMEOUT_MS).then(function (env) {
          ownerInvalidateSigninChallengeDom();
          if (optionsCodeInput) optionsCodeInput.value = "";
          if (env && env.httpOk && env.data && env.data.ok === true) {
            setOptionsCodeStatus(["activateSuccess"], "success");
            window.setTimeout(function () {
              window.location.replace(window.location.pathname + window.location.search);
            }, 400);
            return;
          }
          optionsBusy = false;
          if (optionsCodeSubmit) optionsCodeSubmit.disabled = !navigator.onLine;
          var code = responseCode(env);
          if (code === "expressar_dsi_access_identity_mismatch") {
            setOptionsCodeStatus(["activateIdentityMismatch"], "error");
            return;
          }
          if (code === "expressar_dsi_access_session_limit_reached") {
            setOptionsCodeStatus(["activateSessionLimit"], "error");
            return;
          }
          if (code === "expressar_dsi_access_activation_consumed") {
            setOptionsCodeStatus(["activateCodeConsumed"], "error");
            return;
          }
          if (ownerActivationResultUncertain(env)) {
            setOptionsCodeStatus(["activateUnconfirmed"], "error");
            revalidate(true);
            ownerBackgroundSyncCard(cardRef);
            return;
          }
          setOptionsCodeStatus(["activateFailed"], "error");
        });
      }).catch(function () {
        optionsBusy = false;
        if (optionsCodeSubmit) optionsCodeSubmit.disabled = !navigator.onLine;
        setOptionsCodeStatus(["activateUnconfirmed"], "error");
        revalidate(true);
        ownerBackgroundSyncCard(cardRef);
      });
    }

    function openRelinquishDialog(opener) {
      if (!relinquishDialog || optionsBusy) return;
      relinquishOpener = opener || null;
      var name = cardDisplayLabel();
      var template = t(i18n, "relinquishConfirmMessage", "");
      if (relinquishText) {
        relinquishText.textContent = template.replace("%s", name || t(i18n, "pageTitle", "expressCARD"));
      }
      ownerEmbedOptionsView("relinquish", relinquishDialog);
      relinquishDialog.hidden = false;
      if (relinquishDialog.hasAttribute("data-ex-owner-options-embedded")) focusPanelClose(panels.options);
      else if (relinquishClose) relinquishClose.focus({preventScroll:true});
    }

    function closeRelinquishDialog() {
      if (!relinquishDialog || relinquishDialog.hidden || optionsBusy) return;
      relinquishDialog.hidden = true;
      if (relinquishDialog.hasAttribute("data-ex-owner-options-embedded")) setOptionsView("list");
      if (panels.options && !panels.options.hidden) {
        panels.options.removeAttribute("data-ex-owner-options-suspended");
      }
      if (relinquishOpener && typeof relinquishOpener.focus === "function") relinquishOpener.focus();
      relinquishOpener = null;
    }

    function confirmRelinquish() {
      if (optionsBusy) return;
      if (navigator.onLine === false) {
        announce(t(i18n, "errorNetwork", ""));
        return;
      }
      optionsBusy = true;
      if (relinquishConfirm) relinquishConfirm.disabled = true;
      postJson(api.relinquish || "/owner/api/relinquish", { card_ref: cardRef }, 0).then(function (env) {
        var payload = env && env.data ? env.data : null;
        if (!env || !env.httpOk || !payload || payload.ok !== true) {
          optionsBusy = false;
          if (relinquishConfirm) relinquishConfirm.disabled = !navigator.onLine;
          announce(t(i18n, "relinquishFailed", t(i18n, "errorForbidden", "")));
          return;
        }
        var goneId = String(payload.public_id || publicId || "");
        var remaining = payload.cards && Array.isArray(payload.cards) ? payload.cards : [];
        ownerInvalidatePersistForCardRemoval(goneId);
        ownerClearCardCache(cacheScope, goneId).then(function () {
          ownerRemoveCardFromSwitcher(goneId);
          ownerBroadcastCardsChanged(cacheScope, goneId);
          if (payload.session === "revoked" || !remaining.length) {
            window.location.replace("/owner/" + (window.location.search || ""));
            return;
          }
          var next = remaining[0];
          var nextRef = next && (next.public_slug || next.public_id) ? String(next.public_slug || next.public_id) : "";
          if (!nextRef) {
            window.location.replace("/owner/" + (window.location.search || ""));
            return;
          }
          ownerNavigateToCard(nextRef, true);
        });
      }).catch(function () {
        optionsBusy = false;
        if (relinquishConfirm) relinquishConfirm.disabled = !navigator.onLine;
        announce(t(i18n, "errorNetwork", ""));
      });
    }

    if (optionsBtn && panels.options) {
      optionsBtn.addEventListener("click", function () {
        if (optionsBusy) return;
        setOptionsView("list");
        renderOwnerServiceActions();
        ownerOptionsKbInset();
        openPanel("options", optionsBtn);
      });
    }
    if (optionsCodeSubmit) {
      optionsCodeSubmit.addEventListener("click", submitOwnerAddCode);
    }
    if (optionsCodeInput) {
      optionsCodeInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          submitOwnerAddCode();
        }
      });
    }
    if (relinquishDialog) {
      relinquishDialog.addEventListener("click", function (event) {
        if (event.target === relinquishDialog) closeRelinquishDialog();
      });
    }
    if (relinquishClose) {
      relinquishClose.addEventListener("click", closeRelinquishDialog);
    }
    if (relinquishConfirm) {
      relinquishConfirm.addEventListener("click", confirmRelinquish);
    }
    document.addEventListener("keydown", ownerModalFocusTrap);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", ownerOptionsKbInset);
      window.visualViewport.addEventListener("scroll", ownerOptionsKbInset);
    }
    ownerCardsChangedCallback = function () {
      if (appViewGen !== ownerViewGen || ownerSessionInvalid) return;
      revalidate(true);
      ownerBackgroundSyncCard(cardRef);
    };
    ownerRegisterTeardown(function () {
      ownerCardsChangedCallback = null;
      document.removeEventListener("keydown", ownerModalFocusTrap);
      document.body.classList.remove("ex-public-owner-body--panel-open");
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", ownerOptionsKbInset);
        window.visualViewport.removeEventListener("scroll", ownerOptionsKbInset);
      }
    });
    renderOwnerServiceActions();

    ownerRuntimeContractHandler = function (runtime) {
      if (appViewGen !== ownerViewGen || ownerSessionInvalid) return;
      if (runtime.card_contract) {
        applyCardContract(runtime.card_contract);
      }
      if (runtime.publication_request) {
        applyOwnerPublicationState(runtime.publication_request);
      }
      if (runtime.editor_access) {
        applySessionEditorAccess(runtime.editor_access);
      } else if (runtime.card_contract && ownerNormalizeContractRole(runtime.card_contract) === "company") {
        editLinkGen += 1;
        lastEditorAccess = null;
        refreshEditUiFromContract();
      }
    };

    var contactsBtn = root.querySelector("[data-ex-owner-contacts]");
    applyCardContract(cfg.card_contract || {});
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
      if (!api.contacts_count || !privateAllowed || cardContract.received_contacts_available !== true) return;
      var gen = contractGen;
      postJson(api.contacts_count, { card_ref: cardRef }, 0).then(function (env) {
        if (!privateAllowed || gen !== contractGen) return;
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
      if (!privateAllowed || cardContract.received_contacts_available !== true || !api.contacts_list || contactsLoading) return;
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
        var currentItems = env.data.items || [];
        var historicalItems = env.data.historical_items || [];
        if (!append && !currentItems.length && !historicalItems.length) {
          var empty = document.createElement("li");
          empty.className = "ex-public-owner-app__contact-empty";
          empty.textContent = t(i18n, "contactsEmpty", "");
          contactList.appendChild(empty);
        } else {
          currentItems.forEach(appendContactItem);
          if (historicalItems.length) {
            var heading = document.createElement("li");
            heading.className = "ex-public-owner-app__contact-section";
            heading.textContent = t(i18n, "contactsHistoricalTitle", "Predchádzajúce identity");
            contactList.appendChild(heading);
            historicalItems.forEach(function (item) {
              item.identity_scope = item.identity_scope || "historical";
              appendContactItem(item);
            });
          }
        }
        updateContactsMoreUi();
        if (!append) openPanel("contacts");
      });
    }

    function openContactsList() {
      if (!privateAllowed || cardContract.received_contacts_available !== true || !panels.contacts || !contactList || !api.contacts_list) return;
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

  function ownerApplyPresentationDelta(parts, scope) {
    var snap = parts.presentation_snapshot;
    if (!snap) return;
    var root = document.querySelector("[data-ex-owner-app]");
    if (!root) return;
    var sig = ownerPresentationSignature(snap);
    root.setAttribute("data-ex-owner-pres-sig", sig);
    if (typeof parts.body_style === "string") {
      document.body.style.cssText = parts.body_style;
    }
    document.body.className = parts.body_class || document.body.className;
    var nameEl = root.querySelector("#ex-owner-display-name");
    if (nameEl && snap.display_name) nameEl.textContent = snap.display_name;
    var viewGen = ownerViewGen;
    ownerSyncDesktopBlurredBackdrop(snap, viewGen);
    ownerApplySnapshotAssets(snap, scope, viewGen).then(function () {
      if (viewGen !== ownerViewGen) return;
      ownerSyncIdentityMedia(root, snap, viewGen);
      ownerApplyBodyBackgroundFromSnapshot(snap, viewGen);
    });
    ownerActivePackSnapshot = snap;
  }

  function ownerFlushPendingBootstrap() {
    if (ownerSuppressPendingBootstrapFlush > 0) return;
    if (!ownerPendingBootstrapParts || ownerAnyPanelOpen()) return;
    var pending = ownerPendingBootstrapParts;
    ownerPendingBootstrapParts = null;
    applyCardBootstrap(pending, { background: true, forceReplace: true });
  }

  function applyCardBootstrap(parts, options) {
    options = options || {};
    var bootGen = ownerBootstrapGen;
    var mount = document.querySelector("[data-ex-owner-mount]");
    if (!mount || !parts || !parts.html) {
      exCardBusy.reset();
      return;
    }
    if (bootGen !== ownerBootstrapGen || ownerSessionInvalid) return;
    if (parts.presentation_snapshot
      && ownerIsCardRejected(parts.presentation_snapshot.public_id)) return;
  
    ownerSyncBootstrapSwitcher(parts);
  
    var scope = parts.local_cache_scope || ownerReadCacheScope();
    var isBackground = !!options.background;
    var newSig = parts.presentation_snapshot ? ownerPresentationSignature(parts.presentation_snapshot) : "";
    var existingRoot = document.querySelector("[data-ex-owner-app]");
    var currentSig = existingRoot ? existingRoot.getAttribute("data-ex-owner-pres-sig") || "" : "";

    if (isBackground && existingRoot && newSig && newSig === currentSig && !options.forceReplace) {
      if (parts.local_cache_scope) ownerWriteCacheScope(parts.local_cache_scope);
      if (parts.presentation_snapshot && scope) {
        ownerPersistCardPack(scope, parts, parts.presentation_snapshot, { allowScopeBootstrap: true });
        ownerEnsureQrForSnapshot(scope, parts.presentation_snapshot);
      }
      if (parts.runtime) {
        ownerDispatchRuntimeContract(parts.runtime);
      }
      ownerPrefetchSiblingCards(parts);
      return;
    }

    if (isBackground && existingRoot && newSig && newSig !== currentSig && ownerAnyPanelOpen() && !options.forceReplace) {
      ownerPendingBootstrapParts = parts;
      if (parts.presentation_snapshot && scope) {
        ownerPersistCardPack(scope, parts, parts.presentation_snapshot, { allowScopeBootstrap: true });
        ownerEnsureQrForSnapshot(scope, parts.presentation_snapshot);
      }
      if (parts.runtime) {
        ownerDispatchRuntimeContract(parts.runtime, { suppressPendingFlush: true });
      }
      if (!ownerAnyPanelOpen() && ownerPendingBootstrapParts === parts) {
        ownerFlushPendingBootstrap();
      }
      ownerPrefetchSiblingCards(parts);
      return;
    }

        // Zmenená prezentácia pokračuje existujúcim kompletným renderom nižšie.

    ownerTeardownApp();
    document.body.className = parts.body_class || document.body.className;
    if (typeof parts.body_style === "string" && parts.body_style) {
      document.body.style.cssText = parts.body_style;
    } else {
      document.body.removeAttribute("style");
    }
    if (parts.presentation_snapshot) {
      ownerSyncDesktopBlurredBackdrop(parts.presentation_snapshot, ownerViewGen);
    } else {
      ownerClearDesktopBlurredBackdrop();
    }
    mount.innerHTML = parts.html;
    mount.hidden = false;
    ownerBootstrapped = true;
    initOwnerLangSwitcher();
    if (parts.local_cache_scope) ownerWriteCacheScope(parts.local_cache_scope);
    if (parts.presentation_snapshot && scope) {
      ownerPersistCardPack(scope, parts, parts.presentation_snapshot, { allowScopeBootstrap: true });
      ownerEnsureQrForSnapshot(scope, parts.presentation_snapshot);
    }
    var root = mount.querySelector("[data-ex-owner-app]");
    if (root && newSig) root.setAttribute("data-ex-owner-pres-sig", newSig);
    var visualGen = ownerViewGen;
    ownerWaitVisualReady(root, parts.body_style || "", 2000).then(function () {
      if (visualGen !== ownerViewGen) return;
      exCardBusy.reset();
    });
    if (parts.runtime && parts.runtime.i18n) ownerShowOfflineBadge(parts.runtime.i18n);
    initOwnerApp();
    ownerRegisterServiceWorkerAssets();
    ownerPrefetchSiblingCards(parts);
  }

  function ownerPrefetchSiblingCards(parts) {
    if (!parts || !Array.isArray(parts.cards_index)
      || !parts.local_cache_scope) return;

    var scope = parts.local_cache_scope;
    var persistGen = ownerPersistGen;

    if (ownerSessionInvalid || scope !== ownerReadCacheScope()) return;

    if (ownerPrefetchInFlight
      && ownerPrefetchInFlight.scope === scope
      && ownerPrefetchInFlight.generation === persistGen) return;

    var activeId = parts.presentation_snapshot
      ? parts.presentation_snapshot.public_id
      : "";

    var queue = parts.cards_index.filter(function (row) {
      return row && row.public_id && row.public_id !== activeId && !ownerIsCardRejected(row.public_id);
    });

    if (!queue.length) return;

    var ticket = { scope: scope, generation: persistGen };
    ownerPrefetchInFlight = ticket;

    var pageCfg = readJsonNode("ex-owner-page-config") || {};
    var apiUrl = pageCfg.api && pageCfg.api.bootstrap
      ? pageCfg.api.bootstrap
      : "/owner/api/bootstrap";
    var langRoute = pageCfg.lang && pageCfg.lang.route
      ? pageCfg.lang.route
      : "";
    var idx = 0;

    function valid() {
      return !ownerSessionInvalid
        && persistGen === ownerPersistGen
        && scope === ownerReadCacheScope();
    }

    function next() {
      if (!valid() || idx >= queue.length) return Promise.resolve();

      var row = queue[idx++];

      return postJson(apiUrl, {
        mode: "card",
        card_ref: row.public_slug || row.public_id,
        lang_route: langRoute
      }, 0).then(function (env) {
        if (!valid() || !env || !env.httpOk || !env.data
          || env.data.kind !== "card"
          || env.data.local_cache_scope !== scope
          || !env.data.presentation_snapshot
          || env.data.presentation_snapshot.public_id !== row.public_id
          || ownerIsCardRejected(row.public_id)) return;

        return ownerPersistCardPack(
          scope,
          env.data,
          env.data.presentation_snapshot,
          { prefetch: true, allowScopeBootstrap: true }
        ).then(function () {
          if (!valid()) return;

          return ownerEnsureQrForSnapshot(
            scope,
            env.data.presentation_snapshot
          );
        });
      }).then(next, next);
    }

    function finish() {
      if (ownerPrefetchInFlight === ticket) {
        ownerPrefetchInFlight = null;
      }
    }

    next().then(finish, finish);
  }

  function applyHubBootstrap(html, pageCfg) {
    var mount = document.querySelector("[data-ex-owner-mount]");
    if (!mount) return;
    ownerResetSigninState();
    mount.innerHTML = html || "";
    mount.hidden = false;
    if (pageCfg) {
      var node = document.getElementById("ex-owner-page-config");
      if (node) node.textContent = JSON.stringify(pageCfg);
    }
    exCardBusy.reset();
    initActivateAndHub();
  }

  var bootRetryBound = false;

  function runOwnerBootstrap(options) {
    options = options || {};
    var bootGen = ownerBootstrapGen;
    var pageCfg = options.pageCfg || readJsonNode("ex-owner-page-config");
    pageCfg = ownerHydratePageConfigFromLocation(pageCfg);
    if (!pageCfg || (pageCfg.page !== "boot-hub" && pageCfg.page !== "boot-card")) return;
    if (ownerSessionInvalid && !options.background) return;
    if (bootstrapInFlight && !options.background) return;
    if (options.background) ownerBackgroundBootstrap = true;
    else bootstrapInFlight = true;
    if (ownerBootstrapAbort) {
      try {
        ownerBootstrapAbort.abort();
      } catch (e) {}
    }
    ownerBootstrapAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
    var i18n = pageCfg.i18n || {};
    var apiUrl = pageCfg.api && pageCfg.api.bootstrap ? pageCfg.api.bootstrap : "/owner/api/bootstrap";
    var body = {
      mode: pageCfg.mode === "card" || options.card_ref ? "card" : "hub",
      card_ref: options.card_ref || pageCfg.card_ref || "",
      view_cards: !!pageCfg.view_cards,
      lang_route: pageCfg.lang && pageCfg.lang.route ? pageCfg.lang.route : "",
      setup_homescreen: !!pageCfg.setupHomescreenGuide
    };
    if (!options.background) exCardBusy.begin();
    var fetchOpts = {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {})
    };
    if (ownerBootstrapAbort) fetchOpts.signal = ownerBootstrapAbort.signal;
    var fetchPromise = fetch(apiUrl, fetchOpts)
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch (e) {}
          return { httpOk: res.ok, status: res.status, data: data, networkError: false };
        });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return { aborted: true };
        return { httpOk: false, networkError: true };
      });
    fetchPromise
      .then(function (env) {
        ownerInvalidateSigninChallengeDom();
        if (env && env.aborted) return;
        if (bootGen !== ownerBootstrapGen || ownerSessionInvalid) return;
        if (!env || env.networkError) {
          if (!options.background) showBootError(pageCfg, t(i18n, "errorNetwork", ""));
          return;
        }
        if (!env.httpOk || !env.data) {
          if (!options.background) showBootError(pageCfg, t(i18n, "errorUnavailable", ""));
          return;
        }
        if (env.data.code === "core_unavailable") {
          if (!options.background) {
            showBootError(pageCfg, t(i18n, "bootstrapUnavailable", t(i18n, "errorUnavailable", "")));
          }
          return;
        }
        if (env.data.local_cache_scope) ownerWriteCacheScope(env.data.local_cache_scope);
        if (env.data.redirect && !options.background) {
          exCardBusy.reset();
          window.location.replace(env.data.redirect);
          return;
        }
        if (env.data.suggested_card_path && !options.background && pageCfg.page === "boot-hub" && !pageCfg.view_cards) {
          if (!ownerBootstrapped) {
            var suggested = String(env.data.suggested_card_path || "");
            var m = suggested.match(/\/owner\/card\/([^/?#]+)/);
            if (m) {
              ownerNavigateToCard(decodeURIComponent(m[1]), true);
              return;
            }
          }
        }
        if (env.data.kind === "card") {
          applyCardBootstrap(env.data, { background: !!options.background });
          return;
        }
        if (env.data.kind === "hub") {
          if (options.background) {
            if (pageCfg.page === "boot-card" || options.card_ref) {
              var scope = ownerReadCacheScope();
              if (scope) {
                ownerClearScopeCache(scope).then(function () {
                  ownerReleaseAppBindings();
                  window.location.replace("/owner/");
                });
              }
            }
            return;
          }
          applyHubBootstrap(env.data.html, env.data.page || pageCfg);
          return;
        }
        if (!options.background) showBootError(pageCfg, t(i18n, "errorGeneric", ""));
      })
      .catch(function () {
        if (!options.background) showBootError(pageCfg, t(i18n, "errorUnavailable", ""));
      })
      .then(function () {
        if (!options.background) bootstrapInFlight = false;
        ownerBackgroundBootstrap = false;
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

  ownerInitSessionBroadcast();
  initActivateAndHub();
  initOwnerLangSwitcher();
  ownerInterceptSwitcher();
  var bootPageCfg = ownerHydratePageConfigFromLocation(readJsonNode("ex-owner-page-config"));
  if (bootPageCfg && (bootPageCfg.page === "boot-hub" || bootPageCfg.page === "boot-card")) {
    ownerTryFastBoot(bootPageCfg).then(function (handled) {
      if (!handled) {
        runOwnerBootstrap();
        return;
      }
      var ref = ownerReadLastCardRef() || bootPageCfg.card_ref || "";
      runOwnerBootstrap({ background: true, pageCfg: bootPageCfg, card_ref: ref });
    });
  } else {
    initOwnerApp();
  }
})();
