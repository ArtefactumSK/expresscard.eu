(function () {
  "use strict";

  /* expressCARD Owner mode prototype.
     Isolated sample data only. Not a production renderer, JSON contract,
     authentication engine, or entitlement source of truth. */

  var SHARE_TITLE = "expressCARD";
  var SHARE_TEXT = "Moja expressCARD";
  var DEFAULT_CARD = "AF";

  var CARDS = {
    AS: {
      id: "AS",
      shortName: "Osobná",
      typeLabel: "osobná karta",
      initials: "AS",
      /* TEMPORARY fallback: no card thumbnail asset exists yet. Remove when a real preview image is supplied. */
      thumbnail: null,
      name: "Alexander Smart",
      role: "Osobný profil",
      company: "",
      guestUrl: "https://expresscard.eu/alexander",
      publicHost: "expresscard.eu/alexander",
      unread: 1,
      contacts: [
        { name: "Mária Nováková", detail: "Ukážkový kontakt" },
        { name: "Tomáš Belko", detail: "Ukážkový kontakt" }
      ]
    },
    AF: {
      id: "AF",
      shortName: "Artefactum",
      typeLabel: "pracovná karta",
      initials: "AF",
      /* TEMPORARY fallback: no card thumbnail asset exists yet. Remove when a real preview image is supplied. */
      thumbnail: null,
      name: "Alexander Smart",
      role: "Marketing strategist of expressar",
      company: "Artefactum s.r.o.",
      guestUrl: "https://expresscard.eu/alexander-smart",
      publicHost: "expresscard.eu/alexander-smart",
      unread: 2,
      contacts: [
        { name: "Jana Kováčová", detail: "Ukážkový kontakt" },
        { name: "Peter Horváth", detail: "Ukážkový kontakt" }
      ]
    },
    EX: {
      id: "EX",
      shortName: "expressar",
      typeLabel: "pracovná a projektová karta",
      initials: "EX",
      /* TEMPORARY fallback: no card thumbnail asset exists yet. Remove when a real preview image is supplied. */
      thumbnail: null,
      name: "expressar",
      role: "Projektová identita",
      company: "Artefactum s.r.o.",
      guestUrl: "https://expresscard.eu/expressar",
      publicHost: "expresscard.eu/expressar",
      unread: 0,
      contacts: [
        { name: "Lucia Minárik", detail: "Ukážkový kontakt" },
        { name: "Martin Veselý", detail: "Ukážkový kontakt" }
      ]
    }
  };

  var guestUrl = "";
  var activeId = DEFAULT_CARD;
  var lastAction = "—";
  var modalOpen = false;
  var missingIcons = [];
  var live = document.getElementById("ec-owner-live");
  var manual = document.getElementById("ec-owner-manual");
  var urlField = document.getElementById("ec-owner-url-field");
  var debugRoot = document.getElementById("ec-debug");
  var shell = document.querySelector(".ec-owner");
  var dialog = document.getElementById("ec-owner-contacts-dialog");
  var dialogList = document.getElementById("ec-owner-dialog-list");
  var lastFocus = null;

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

  function activeCard() {
    return CARDS[activeId] || CARDS[DEFAULT_CARD];
  }

  function iconMode() {
    var slots = document.querySelectorAll(".ec-owner-glyph[data-icon-path]");
    var present = 0;
    Array.prototype.forEach.call(slots, function (node) {
      if (!node.classList.contains("is-icon-missing")) {
        present += 1;
      }
    });
    if (present === 0) {
      return "text-fallback";
    }
    if (missingIcons.length) {
      return "core-outline + text-fallback";
    }
    return "core-outline";
  }

  function fillDebug() {
    if (!debugRoot || debugRoot.hidden) {
      return;
    }
    var card = activeCard();
    var values = {
      "ec-debug-viewport": String(window.innerWidth) + "px",
      "ec-debug-mode": "owner",
      "ec-debug-card-id": card.id,
      "ec-debug-card-name": card.shortName,
      "ec-debug-guest-url": guestUrl || "—",
      "ec-debug-unread": String(card.unread),
      "ec-debug-modal": modalOpen ? "otvorený" : "zatvorený",
      "ec-debug-share": hasShareApi() ? "áno" : "nie",
      "ec-debug-clipboard": hasClipboardApi() ? "áno" : "nie",
      "ec-debug-icons": iconMode(),
      "ec-debug-missing": missingIcons.length ? missingIcons.join(", ") : "žiadne",
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
    urlField.value = guestUrl;
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

  function setText(selector, value) {
    var node = document.querySelector(selector);
    if (node) {
      node.textContent = value;
    }
  }

  function updateUnreadUi() {
    var card = activeCard();
    var trigger = document.querySelector(".ec-owner-action--contacts");
    var countNode = document.querySelector("[data-owner-unread-count]");
    if (countNode) {
      countNode.textContent = String(card.unread);
    }
    if (!trigger) {
      return;
    }
    if (card.unread > 0) {
      trigger.hidden = false;
      trigger.setAttribute("data-owner-new-contacts", "");
    } else {
      trigger.hidden = true;
      trigger.removeAttribute("data-owner-new-contacts");
    }
  }

  function applyCard(id) {
    var card = CARDS[id];
    if (!card) {
      return;
    }
    activeId = card.id;
    guestUrl = card.guestUrl;
    if (shell) {
      shell.setAttribute("data-guest-url", card.guestUrl);
    }
    if (urlField) {
      urlField.value = card.guestUrl;
    }
    if (manual) {
      manual.hidden = true;
    }

    setText("[data-owner-initials]", card.initials);
    setText("#ec-owner-name", card.name);
    setText("[data-owner-role]", card.role);
    setText("[data-owner-public-url]", card.publicHost);

    var company = document.querySelector("[data-owner-company]");
    if (company) {
      company.textContent = card.company;
      company.hidden = !card.company;
    }

    var openPublic = document.querySelector('[data-owner-icon-action="open-public"]');
    if (openPublic && openPublic.tagName === "A") {
      openPublic.setAttribute("href", card.guestUrl);
    }

    var switches = document.querySelectorAll(".ec-owner-switch");
    Array.prototype.forEach.call(switches, function (btn) {
      var tile = btn.querySelector("[data-owner-card-switch]");
      var switchId = tile ? tile.getAttribute("data-owner-card-switch") : null;
      var switchCard = switchId ? CARDS[switchId] : null;
      var isActive = switchId === card.id;
      if (isActive) {
        btn.setAttribute("aria-current", "true");
        if (tile) {
          tile.setAttribute("aria-current", "true");
        }
      } else {
        btn.removeAttribute("aria-current");
        if (tile) {
          tile.removeAttribute("aria-current");
        }
      }
      syncThumbnail(tile, switchCard, isActive);
    });

    updateUnreadUi();
    fillDebug();
  }

  function syncThumbnail(tile, data, isActive) {
    if (!tile) {
      return;
    }
    var hasThumb = !!(data && data.thumbnail);
    var img = tile.querySelector("[data-owner-card-thumb]");
    var mono = tile.querySelector("[data-owner-card-fallback]");

    if (hasThumb && !img) {
      img = document.createElement("img");
      img.className = "ec-owner-switch__thumb";
      img.setAttribute("data-owner-card-thumb", "");
      img.alt = "";
      tile.insertBefore(img, tile.firstChild);
    }

    if (img) {
      if (hasThumb) {
        img.src = data.thumbnail;
      }
      img.hidden = isActive || !hasThumb;
    }

    tile.classList.toggle("has-thumb", hasThumb && !isActive);

    if (mono) {
      mono.hidden = hasThumb && !isActive;
    }
  }

  function fillDialog(card) {
    if (!dialogList) {
      return;
    }
    dialogList.textContent = "";
    card.contacts.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "ec-owner-dialog__item";
      var name = document.createElement("p");
      name.className = "ec-owner-dialog__name";
      name.textContent = item.name;
      var detail = document.createElement("p");
      detail.className = "ec-owner-dialog__detail";
      detail.textContent = item.detail;
      li.appendChild(name);
      li.appendChild(detail);
      dialogList.appendChild(li);
    });
  }

  function closeDialog() {
    if (!dialog || !modalOpen) {
      return;
    }
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function onDialogClosed() {
    modalOpen = false;
    if (dialogList) {
      dialogList.textContent = "";
    }
    updateUnreadUi();
    fillDebug();
    var trigger = document.querySelector(".ec-owner-action--contacts");
    var restore = lastFocus;
    lastFocus = null;
    if (restore && restore.hidden) {
      var share = document.querySelector('[data-owner-icon-action="share"]');
      if (share) {
        share.focus();
      }
      return;
    }
    if (restore && typeof restore.focus === "function") {
      restore.focus();
      return;
    }
    if (trigger && !trigger.hidden) {
      trigger.focus();
    }
  }

  function openDialog() {
    var card = activeCard();
    lastAction = "contacts";
    lastFocus = document.activeElement;
    fillDialog(card);
    card.unread = 0;
    modalOpen = true;
    fillDebug();
    if (dialog && typeof dialog.showModal === "function") {
      dialog.showModal();
      return;
    }
    if (dialog) {
      dialog.setAttribute("open", "");
    }
  }

  function onIconAction(event) {
    var action = event.currentTarget.getAttribute("data-owner-icon-action");
    if (action === "share") {
      event.preventDefault();
      shareGuestUrl();
      return;
    }
    if (action === "copy-link") {
      event.preventDefault();
      copyGuestUrl();
      return;
    }
    if (action === "contacts") {
      event.preventDefault();
      openDialog();
    }
  }

  function onSwitchClick(event) {
    var tile = event.currentTarget.querySelector("[data-owner-card-switch]");
    var id = tile ? tile.getAttribute("data-owner-card-switch") : null;
    lastAction = "switch:" + id;
    applyCard(id);
  }

  function watchIcons() {
    var glyphs = document.querySelectorAll(".ec-owner-glyph[data-icon-path]");
    Array.prototype.forEach.call(glyphs, function (glyph) {
      var path = glyph.getAttribute("data-icon-path") || "";
      var src = path.replace(/^\//, "");
      if (!src) {
        return;
      }
      function markMissing() {
        glyph.classList.add("is-icon-missing");
        if (path && missingIcons.indexOf(path) === -1) {
          missingIcons.push(path);
        }
        fillDebug();
      }
      var probe = new Image();
      probe.addEventListener("error", markMissing);
      probe.src = src;
    });
  }

  function bind() {
    var switches = document.querySelectorAll(".ec-owner-switch");
    Array.prototype.forEach.call(switches, function (node) {
      node.addEventListener("click", onSwitchClick);
    });

    var actions = document.querySelectorAll("[data-owner-icon-action]");
    Array.prototype.forEach.call(actions, function (node) {
      var action = node.getAttribute("data-owner-icon-action");
      if (action === "share" || action === "copy-link" || action === "contacts") {
        node.addEventListener("click", onIconAction);
      }
    });

    var closers = document.querySelectorAll("[data-owner-dialog-close]");
    Array.prototype.forEach.call(closers, function (node) {
      node.addEventListener("click", function () {
        closeDialog();
      });
    });

    if (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) {
          closeDialog();
        }
      });
      dialog.addEventListener("close", onDialogClosed);
    }
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
    watchIcons();
    bind();
    applyCard(DEFAULT_CARD);
    setupDebug();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
