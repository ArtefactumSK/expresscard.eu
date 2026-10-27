/* expressCARD Owner — scoped service worker (scope /owner/). */
(function () {
  "use strict";

  var SHELL_CACHE = "expresscard-owner-shell-v2";
  var STATIC_CACHE = "expresscard-owner-static-v2";

  var OWNER_ICON_PATHS = [
    "/images/expressCARD_App.svg",
    "/images/expressar_icon.svg",
    "/images/qr_display.svg",
    "/images/qr_download.svg",
    "/images/card_share.svg",
    "/images/card_contacts.svg",
    "/images/card_edit.svg",
    "/images/cards_switch.svg",
    "/images/qr_png.svg",
    "/images/qr_svg.svg",
    "/images/home-screen.svg"
  ];

  var STATIC_PATH_ALLOWLIST = [
    "/assets/css/expresscard-public.css",
    "/assets/js/expresscard-owner-public.js",
    "/assets/js/vendor/qrcodegen.js"
  ].concat(OWNER_ICON_PATHS);

  function shellStorageKey(origin) {
    return origin + "/owner/__boot_shell__";
  }

  function isOwnerNavigate(url) {
    if (url.origin !== self.location.origin) return false;
    var p = url.pathname;
    if (p === "/owner" || p === "/owner/") return true;
    return /^\/owner\/card\/[^/]+\/?$/.test(p);
  }

  function isNetworkOnlyOwner(url) {
    var p = url.pathname;
    if (p === "/owner/activate" || p.indexOf("/owner/activate/") === 0) return true;
    if (p.indexOf("/owner/api/") === 0) return true;
    return false;
  }

  function isAllowedStaticPath(pathname) {
    for (var i = 0; i < STATIC_PATH_ALLOWLIST.length; i += 1) {
      if (pathname === STATIC_PATH_ALLOWLIST[i]) return true;
    }
    return false;
  }

  function normalizeStaticUrl(href) {
    if (typeof href !== "string" || !href) return "";
    try {
      var u = href.indexOf("://") !== -1 ? new URL(href) : new URL(href, self.location.origin);
      if (u.origin !== self.location.origin) return "";
      if (u.pathname.indexOf("/assets/") !== 0 && u.pathname.indexOf("/images/") !== 0) return "";
      return u.pathname + u.search;
    } catch (e) {
      return "";
    }
  }

  function looksLikeBootShell(response) {
    if (!response || !response.ok) return false;
    var ct = response.headers.get("content-type") || "";
    return ct.indexOf("text/html") !== -1;
  }

  function refreshGenericShell(cache, origin) {
    return fetch(origin + "/owner/", { method: "GET", credentials: "same-origin" })
      .then(function (response) {
        if (!looksLikeBootShell(response)) return;
        return cache.put(shellStorageKey(origin), response.clone());
      })
      .catch(function () {});
  }

  var ownerIconWarmup = null;

  function cacheOwnerIcons() {
    if (ownerIconWarmup) return ownerIconWarmup;

    ownerIconWarmup = caches.open(STATIC_CACHE).then(function (cache) {
      return Promise.all(OWNER_ICON_PATHS.map(function (path) {
        return cache.match(path).then(function (cached) {
          if (cached) return;

          var controller = new AbortController();
          var timer = setTimeout(function () {
            controller.abort();
          }, 8000);

          return fetch(path, {
            credentials: "same-origin",
            cache: "reload",
            signal: controller.signal
          }).then(function (response) {
            var type = (
              response.headers.get("content-type") || ""
            ).toLowerCase();

            if (!response.ok || response.type !== "basic"
              || type.indexOf("image/svg+xml") !== 0) return;

            return cache.put(path, response.clone());
          }).catch(function () {}).then(function () {
            clearTimeout(timer);
          });
        });
      }));
    }).then(function () {
      ownerIconWarmup = null;
    }, function () {
      ownerIconWarmup = null;
    });

    return ownerIconWarmup;
  }

  self.addEventListener("install", function (event) {
    event.waitUntil(cacheOwnerIcons().then(function () {
      return self.skipWaiting();
    }));
  });

  self.addEventListener("activate", function (event) {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key === SHELL_CACHE || key === STATIC_CACHE) return undefined;
            if (key.indexOf("expresscard-owner-") === 0) return caches.delete(key);
            return undefined;
          })
        );
      }).then(function () {
        return self.clients.claim();
      })
    );
  });

  self.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "OWNER_STATIC_URLS" && Array.isArray(data.urls)) {
      event.waitUntil(
        caches.open(STATIC_CACHE).then(function (cache) {
          return Promise.all(
            data.urls.map(function (href) {
              var rel = normalizeStaticUrl(href);
              if (!rel) return undefined;
              var pathOnly = rel.split("?")[0];
              if (!isAllowedStaticPath(pathOnly)) return undefined;
              return cache.add(rel).catch(function () {});
            })
          );
        })
      );
    }
  });

  self.addEventListener("fetch", function (event) {
    var request = event.request;
    if (request.method !== "GET") return;
    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (isNetworkOnlyOwner(url)) {
      return;
    }

    if (request.mode === "navigate" && isOwnerNavigate(url)) {
      event.waitUntil(cacheOwnerIcons());
      var shellKey = shellStorageKey(url.origin);
      event.respondWith(
        caches.open(SHELL_CACHE).then(function (cache) {
          return cache.match(shellKey).then(function (cached) {
            if (cached) {
              event.waitUntil(refreshGenericShell(cache, url.origin));
              return cached;
            }
            return fetch(url.origin + "/owner/", { method: "GET", credentials: "same-origin" })
              .then(function (response) {
                if (looksLikeBootShell(response)) {
                  cache.put(shellKey, response.clone());
                }
                return response;
              })
              .catch(function () {
                return caches.match(shellKey);
              });
          });
        })
      );
      return;
    }

    if (url.pathname.indexOf("/assets/") === 0 || url.pathname.indexOf("/images/") === 0) {
      if (!isAllowedStaticPath(url.pathname)) return;

      event.respondWith(
        caches.open(STATIC_CACHE).then(function (cache) {
          function fetchAndStore() {
            return fetch(request).then(function (response) {
              if (response && response.ok && response.type === "basic") {
                return cache.put(request, response.clone()).then(function () {
                  return response;
                });
              }
              return response;
            });
          }

          return cache.match(request).then(function (cached) {
            if (cached) {
              if (!url.searchParams.has("v")) {
                event.waitUntil(fetchAndStore().catch(function () {}));
              }
              return cached;
            }

            return fetchAndStore();
          });
        })
      );
    }
  });
})();
