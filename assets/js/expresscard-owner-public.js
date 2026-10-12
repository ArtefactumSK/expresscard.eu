(function () {
  "use strict";

  function deviceLabel() {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return "iOS";
    }
    if (/Android/i.test(ua)) {
      return "Android";
    }
    if (/Windows/i.test(ua)) {
      return "Windows";
    }
    if (/Mac OS/i.test(ua)) {
      return "macOS";
    }
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
    if (!main) {
      return "";
    }
    var value = main.getAttribute("data-ex-owner-challenge") || "";
    return /^[a-f0-9]{32}$/i.test(value) ? value.toLowerCase() : "";
  }

  function postJson(url, body, retries) {
    var left = typeof retries === "number" ? retries : 0;
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {})
    })
      .then(function (res) {
        if (!res.ok && left > 0) {
          return postJson(url, body, left - 1);
        }
        return res.json().catch(function () {
          return null;
        });
      })
      .catch(function () {
        if (left > 0) {
          return postJson(url, body, left - 1);
        }
        return null;
      });
  }

  function postSession(body) {
    return postJson("/owner/api/session", body || {}, 1);
  }

  var activateInFlight = false;

  function activateOnThisDevice(secret, challenge) {
    return postJson(
      "/owner/activate",
      {
        activation_secret: secret,
        device_label: deviceLabel(),
        browser_challenge: challenge
      },
      0
    );
  }

  var activateBtn = document.getElementById("ex-owner-activate-btn");
  var statusNode = document.getElementById("ex-owner-activate-status");
  if (activateBtn) {
    activateBtn.addEventListener("click", function () {
      if (activateInFlight) {
        return;
      }
      var secret = readActivationSecret();
      var challenge = readChallenge();
      if (!secret || !challenge) {
        if (statusNode) {
          statusNode.hidden = false;
          statusNode.textContent = "Aktivačný odkaz nie je platný.";
        }
        return;
      }
      activateInFlight = true;
      activateBtn.disabled = true;
      activateOnThisDevice(secret, challenge).then(function (payload) {
        window.__exOwnerActivationSecret = "";
        if (payload && payload.ok) {
          window.location.href = payload.redirect || "/owner/";
          return;
        }
        postSession({}).then(function (sessionPayload) {
          if (sessionPayload && sessionPayload.valid) {
            window.location.href = "/owner/";
            return;
          }
          if (statusNode) {
            statusNode.hidden = false;
            statusNode.textContent =
              "Aktiváciu sa nepodarilo dokončiť. Požiadajte o nový aktivačný odkaz.";
          }
          activateBtn.disabled = false;
          activateInFlight = false;
        });
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
      if (!email) {
        return;
      }
      var submitBtn = renewForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
      }
      postJson("/owner/api/renew", { email: email }, 0).then(function (payload) {
        if (renewStatus) {
          renewStatus.hidden = false;
          renewStatus.textContent =
            payload && payload.message
              ? payload.message
              : "Ak je e-mail evidovaný a máte pridelený prístup, pošleme odkaz na obnovu.";
        }
        if (submitBtn) {
          submitBtn.disabled = false;
        }
      });
    });
  }

  var cfg = window.expresscardOwner || null;
  var bar = null;
  var guestHidden = false;
  var hubLink = null;
  var revalidating = false;

  function ensureHubLink() {
    if (hubLink || !cfg || !cfg.session_valid) {
      return;
    }
    hubLink = document.createElement("a");
    hubLink.href = "/owner/?view=cards";
    hubLink.className = "ex-public-owner-hub-link";
    hubLink.textContent = "Moje karty";
    hubLink.setAttribute("data-ex-owner-hub-link", "1");
    document.body.appendChild(hubLink);
  }

  function syncHubLinkVisibility() {
    ensureHubLink();
    if (!hubLink) {
      return;
    }
    var show =
      cfg &&
      cfg.session_valid &&
      (guestHidden || !cfg.enabled);
    hubLink.hidden = !show;
  }

  function buildBar() {
    if (!cfg || !cfg.enabled || bar) {
      return;
    }
    bar = document.createElement("div");
    bar.className = "ex-public-owner-bar";
    bar.setAttribute("data-ex-owner-bar", "1");
    if (cfg.cards && cfg.cards.length > 1) {
      var cardsBtn = document.createElement("button");
      cardsBtn.type = "button";
      cardsBtn.className = "ex-public-owner-bar__btn ex-public-owner-bar__btn--primary";
      cardsBtn.textContent = "Karty";
      cardsBtn.addEventListener("click", function () {
        window.location.href = "/owner/?view=cards";
      });
      bar.appendChild(cardsBtn);
    }
    var guestBtn = document.createElement("button");
    guestBtn.type = "button";
    guestBtn.className = "ex-public-owner-bar__btn";
    guestBtn.textContent = "Zobraziť ako návštevník";
    guestBtn.addEventListener("click", function () {
      guestHidden = true;
      bar.hidden = true;
      syncHubLinkVisibility();
    });
    bar.appendChild(guestBtn);
    var moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "ex-public-owner-bar__btn";
    moreBtn.textContent = "Viac";
    moreBtn.setAttribute("aria-expanded", "false");
    var menu = document.createElement("div");
    menu.className = "ex-public-owner-bar__menu";
    menu.hidden = true;
    var ownerBtn = document.createElement("button");
    ownerBtn.type = "button";
    ownerBtn.className = "ex-public-owner-bar__menu-btn";
    ownerBtn.textContent = "Owner ovládanie";
    ownerBtn.addEventListener("click", function () {
      guestHidden = false;
      if (cfg.enabled) {
        bar.hidden = false;
      }
      menu.hidden = true;
      moreBtn.setAttribute("aria-expanded", "false");
      syncHubLinkVisibility();
    });
    menu.appendChild(ownerBtn);
    var logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "ex-public-owner-bar__menu-btn ex-public-owner-bar__menu-btn--danger";
    logoutBtn.textContent = "Odhlásiť zariadenie";
    logoutBtn.addEventListener("click", function () {
      menu.hidden = true;
      postJson("/owner/api/revoke", {}, 0).then(function (payload) {
        if (payload && payload.ok === false && payload.message) {
          window.alert(payload.message);
        }
        window.location.reload();
      });
    });
    menu.appendChild(logoutBtn);
    moreBtn.addEventListener("click", function () {
      var open = menu.hidden;
      menu.hidden = !open;
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    bar.appendChild(moreBtn);
    bar.appendChild(menu);
    document.body.appendChild(bar);
  }

  function tearDownBar() {
    if (bar && bar.parentNode) {
      bar.parentNode.removeChild(bar);
    }
    bar = null;
  }

  function applyOwnerChrome() {
    if (!cfg || !cfg.session_valid) {
      tearDownBar();
      syncHubLinkVisibility();
      return;
    }
    if (cfg.enabled && !guestHidden) {
      if (!bar) {
        buildBar();
      } else {
        bar.hidden = false;
      }
    } else {
      if (bar) {
        bar.hidden = true;
      }
    }
    syncHubLinkVisibility();
  }

  function revalidateOwner() {
    if (!cfg || !cfg.session_valid || revalidating) {
      return;
    }
    revalidating = true;
    if (bar) {
      bar.hidden = true;
    }
    var body = {};
    if (cfg.current_public_id) {
      body.card_ref = cfg.current_public_id;
    }
    postSession(body).then(function (payload) {
      revalidating = false;
      if (!payload || !payload.valid) {
        cfg.session_valid = false;
        cfg.enabled = false;
        tearDownBar();
        if (hubLink && hubLink.parentNode) {
          hubLink.parentNode.removeChild(hubLink);
        }
        hubLink = null;
        return;
      }
      cfg.cards = payload.cards || [];
      if (cfg.current_public_id && typeof payload.card_allowed === "boolean") {
        cfg.enabled = payload.card_allowed;
      }
      applyOwnerChrome();
    });
  }

  function rememberCardPreference(publicId) {
    publicId = String(publicId || "").trim();
    if (!publicId) {
      return;
    }
    document.cookie =
      "excard_owner_pref=" +
      encodeURIComponent(publicId) +
      "; path=/; max-age=2592000; secure; samesite=lax";
  }

  if (cfg && cfg.session_valid) {
    if (cfg.enabled && cfg.current_public_id) {
      rememberCardPreference(cfg.current_public_id);
    }
    applyOwnerChrome();
    window.addEventListener("pageshow", revalidateOwner);
    document.addEventListener("visibilitychange", function () {
      if ("visible" === document.visibilityState) {
        revalidateOwner();
      }
    });
  }
})();
