/* Decorative marketing video. No visible playback controls. */
(function () {
    'use strict';
    var video = document.querySelector('[data-ex-landing-video]');
    if (!video) return;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var mobile = window.matchMedia('(max-width: 767px)');
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var currentSource = '';
    var failedSource = '';
    var revision = 0;
    var destroyed = false;

    function showFallback() {
        video.classList.remove('is-playing');
    }

    function permitted() {
        return !destroyed && !reducedMotion.matches && !(connection && connection.saveData);
    }

    function pause() {
        revision += 1;
        video.pause();
        showFallback();
    }

    function unload() {
        pause();
        if (video.hasAttribute('src')) {
            video.removeAttribute('src');
            video.load();
        }
        currentSource = '';
    }

    function synchronize() {
        if (!permitted()) {
            unload();
            return;
        }
        if (document.hidden) {
            pause();
            return;
        }
        var source = video.getAttribute(mobile.matches ? 'data-mobile-src' : 'data-desktop-src') || '';
        if (!source || source === failedSource) {
            unload();
            return;
        }
        var token = ++revision;
        if (source !== currentSource) {
            video.pause();
            showFallback();
            currentSource = source;
            video.src = source;
            video.load();
        }
        video.muted = true;
        video.defaultMuted = true;
        try {
            var attempt = video.play();
            if (attempt && typeof attempt.catch === 'function') {
                attempt.catch(function () {
                    if (token === revision) {
                        failedSource = source;
                        unload();
                    }
                });
            }
        } catch (error) {
            if (token === revision) {
                failedSource = source;
                unload();
            }
        }
    }

    function listen(query, handler) {
        if (query.addEventListener) query.addEventListener('change', handler);
        else if (query.addListener) query.addListener(handler);
    }

    video.addEventListener('playing', function () {
        if (permitted() && !document.hidden && currentSource) video.classList.add('is-playing');
        else pause();
    });
    video.addEventListener('error', function () {
        if (!currentSource || !video.getAttribute('src')) return;
        failedSource = currentSource;
        unload();
    });
    listen(mobile, synchronize);
    listen(reducedMotion, synchronize);
    if (connection && connection.addEventListener) connection.addEventListener('change', synchronize);
    document.addEventListener('visibilitychange', synchronize);
    window.addEventListener('pagehide', function () { destroyed = true; unload(); });
    window.addEventListener('pageshow', function () { destroyed = false; synchronize(); });
    synchronize();
}());
