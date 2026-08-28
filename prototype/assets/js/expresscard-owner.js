(function () {
  "use strict";

  /* expressCARD Owner mode prototype.
     Not a production renderer, not authentication, and not an entitlement engine. */

  var SHARE_TITLE = "expressCARD";
  var SHARE_TEXT = "Moja expressCARD";
  var guestUrl = "";
  var lastAction = "—";
  var live = document.getElementById("ec-owner-live");
  var manual = document.getElementById("ec-owner-manual");
  var urlField = document.getElementById("ec-owner-url-field");
  var debugRoot = document.getElementById("ec-debug");
  var shell = document.querySelector(".ec-owner-shell");

  function announce(message) {
    if (live) {
      live.textContent = message;
    }
  }

  function isDebugRequested() {
    try {
      return new URLSearchParams(window.location.search).get("debug") === "1";
    } catch (error) {
      return false;
    }
  }

  function hasShareApi() {
    return typeof navigator.share === "function";
  }

  function hasClipboardApi() {
    return !!(navigator.clipboard && typeof navigator.clipboard.writeText === "function");
  }

  function iconMode() {
    var slots = document.querySelectorAll("[data-icon-name]");
    var present = 0;
    Array.prototype.forEach.call(slots, function (node) {
      if (!node.classList.contains("is-icon-missing")) {
        present += 1;
      }
    });
    return present > 0 ? "svg" : "text-fallback";
  }

  function fillDebug() {
    if (!debugRoot || debugRoot.hidden) {
      return;
    }
    var values = {
      "ec-debug-viewport": String(window.innerWidth) + "px",
      "ec-debug-mode": "owner",
      "ec-debug-guest-url": guestUrl || "—",
      "ec-debug-share": hasShareApi() ? "áno" : "nie",
      "ec-debug-clipboard": hasClipboardApi() ? "áno" : "nie",
      "ec-debug-icons": iconMode(),
      "ec-debug-action": lastAction,
      "ec-debug-motion": "nenačítaný",
      "ec-debug-storage": "nepoužitý"
    };
    Object.keys(values).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) {
        node.textContent = values[id];
      }
    });
  }

  function showManualCopy() {
    if (!manual || !urlField) {
      announce("Verejný odkaz: " + guestUrl);
      return;
    }
    manual.hidden = false;
    urlField.focus();
    if (typeof urlField.select === "function") {
      urlField.select();
    }
    announce("Odkaz označte a skopírujte ručne.");
  }

  function copyGuestUrl() {
    lastAction = "copy-link";
    if (!guestUrl) {
      announce("Verejný odkaz v tomto prototype chýba.");
      fillDebug();
      return;
    }
    if (hasClipboardApi()) {
      navigator.clipboard.writeText(guestUrl).then(function () {
        announce("Verejný odkaz je skopírovaný.");
        fillDebug();
      }).catch(function () {
        showManualCopy();
        fillDebug();
      });
      return;
    }
    showManualCopy();
    fillDebug();
  }

  function shareGuestUrl() {
    lastAction = "share";
    if (!guestUrl) {
      announce("Verejný odkaz v tomto prototype chýba.");
      fillDebug();
      return;
    }
    if (hasShareApi()) {
      navigator.share({
        title: SHARE_TITLE,
        text: SHARE_TEXT,
        url: guestUrl
      }).then(function () {
        announce("Zdieľanie verejného odkazu je pripravené.");
        fillDebug();
      }).catch(function (error) {
        if (error && error.name === "AbortError") {
          announce("Zdieľanie bolo zrušené.");
          fillDebug();
          return;
        }
        copyGuestUrl();
      });
      return;
    }
    announce("Systémové zdieľanie nie je dostupné. Skúste skopírovať odkaz.");
    copyGuestUrl();
  }

  function onPrimaryClick(event) {
    var node = event.currentTarget;
    var action = node.getAttribute("data-owner-primary-action");
    if (action === "share") {
      event.preventDefault();
      shareGuestUrl();
      return;
    }
    if (action === "copy-link") {
      event.preventDefault();
      copyGuestUrl();
    }
  }

  function onMockAction(event) {
    var action = event.currentTarget.getAttribute("data-owner-action");
    var messages = {
      close: "Ukážka: zatvorenie Owner mode ešte nie je aktívne.",
      vcf: "Ukážka: VCF ešte nie je implementované.",
      contacts: "Ukážka: správa kontaktov je budúca funkcia."
    };
    if (!messages[action]) {
      return;
    }
    event.preventDefault();
    lastAction = action;
    announce(messages[action]);
    fillDebug();
  }

  function bind() {
    var primary = document.querySelectorAll("[data-owner-primary-action]");
    Array.prototype.forEach.call(primary, function (node) {
      var action = node.getAttribute("data-owner-primary-action");
      if (action === "share" || action === "copy-link") {
        node.addEventListener("click", onPrimaryClick);
      }
    });

    var mocks = document.querySelectorAll("[data-owner-action]");
    Array.prototype.forEach.call(mocks, function (node) {
      node.addEventListener("click", onMockAction);
    });
  }

  function setupDebug() {
    if (!debugRoot || !isDebugRequested()) {
      return;
    }
    debugRoot.hidden = false;
    fillDebug();
    window.addEventListener("resize", fillDebug);
  }

  function boot() {
    guestUrl = shell ? shell.getAttribute("data-guest-url") || "" : "";
    bind();
    setupDebug();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
