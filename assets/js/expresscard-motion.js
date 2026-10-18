(function () {
	"use strict";

	var STORAGE_KEY = "expresscard_motion_enabled";
	var SMOOTH_POINTER = 0.22;
	var SMOOTH_GYRO = 0.16;
	var SMOOTH_RETURN = 0.18;
	var POSE_CLAMP = 1;

	var initialized = false;
	var config = null;
	var card = null;
	var toggleBtn = null;
	var mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
	var mqHover = window.matchMedia("(hover: hover)");
	var mqFine = window.matchMedia("(pointer: fine)");

	var userPref = true;
	var live = false;
	var permissionPending = false;
	var rafId = 0;
	var pageVisible = true;
	var smoothRate = SMOOTH_POINTER;

	var pointerBound = false;
	var gyroBound = false;
	var visibilityBound = false;
	var reducedBound = false;

	var permissionState = "not-required";
	var gyroCalibrated = false;
	var calBeta = 0;
	var calGamma = 0;

	var pose = {
		targetNx: 0,
		targetNy: 0,
		nx: 0,
		ny: 0
	};

	function cfg() {
		return window.expresscardMotion || null;
	}

	function t(key, fallback) {
		var c = cfg();
		var i18n = c && c.i18n ? c.i18n : {};
		return i18n[key] || fallback || "";
	}

	function params() {
		var c = cfg();
		return c && c.parameters ? c.parameters : {};
	}

	function clamp(v, min, max) {
		return Math.max(min, Math.min(max, v));
	}

	function isReduced() {
		return mqReduced.matches;
	}

	function isMobileMotionDevice() {
		var ua = navigator.userAgent || "";
		var isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
		var isIPadOS = navigator.platform === "MacIntel" &&
			navigator.maxTouchPoints > 1;

		return (isMobile || isIPadOS) &&
			window.matchMedia("(pointer: coarse)").matches &&
			hasGyroApi();
	}

	function isDesktopPointer() {
		return mqHover.matches && mqFine.matches;
	}

	function hasGyroApi() {
		return typeof window.DeviceOrientationEvent === "function" ||
			typeof window.DeviceOrientationEvent === "object";
	}

	function hasPermissionApi() {
		return hasGyroApi() &&
			typeof window.DeviceOrientationEvent.requestPermission === "function";
	}

	function readUserPref() {
		try {
			var v = window.localStorage.getItem(STORAGE_KEY);
			if (v === "0") {
				return false;
			}
			if (v === "1") {
				return true;
			}
		} catch (e) {
			return true;
		}
		return true;
	}

	function writeUserPref(on) {
		try {
			window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
		} catch (e) {
			/* ignore */
		}
	}

	function isMotionActive() {
		return live && !permissionPending;
	}

	function inputReadyForMotion() {
		if (!isMobileMotionDevice()) {
			return false;
		}
		if (hasPermissionApi()) {
			return permissionState === "granted";
		}
		return true;
	}

	function resetMotionVars() {
		if (!card) {
			return;
		}
		card.style.removeProperty("--ex-motion-media-x");
		card.style.removeProperty("--ex-motion-media-y");
		card.style.removeProperty("--ex-motion-media-axis-x");
		card.style.removeProperty("--ex-motion-media-axis-y");
		card.style.removeProperty("--ex-motion-media-angle");
		card.style.removeProperty("--ex-motion-bg-x");
		card.style.removeProperty("--ex-motion-bg-y");
		card.style.removeProperty("--ex-motion-bg-reserve");
		card.style.removeProperty("--ex-motion-action-x");
		card.style.removeProperty("--ex-motion-action-y");
		card.style.removeProperty("--ex-motion-icon-x");
		card.style.removeProperty("--ex-motion-icon-y");
		card.removeAttribute("data-ex-motion-bg-parallax");
	}

	function applyVisuals() {
		if (!card || !live) {
			resetMotionVars();
			return;
		}
		var p = params();
		var bgMax = typeof p.bg_shift_px === "number" && Number.isFinite(p.bg_shift_px) ? p.bg_shift_px : 16;
		var mediaMax = typeof p.media_shift_px === "number" && Number.isFinite(p.media_shift_px) ? p.media_shift_px : 6;
		var tiltMax = typeof p.media_tilt_deg === "number" && Number.isFinite(p.media_tilt_deg) ? p.media_tilt_deg : 4;
		var actionMax = typeof p.action_shift_px === "number" && Number.isFinite(p.action_shift_px) ? p.action_shift_px : 2;
		var iconMax = typeof p.icon_shift_px === "number" && Number.isFinite(p.icon_shift_px) ? p.icon_shift_px : 1;
		mediaMax = Math.min(8, Math.max(0, mediaMax) * 1.333333);
		actionMax = Math.min(3, Math.max(0, actionMax) * 1.5);
		var bgOn = !!(config && config.background_parallax);
		var nx = pose.nx;
		var ny = pose.ny;
		card.style.setProperty("--ex-motion-media-x", (nx * mediaMax).toFixed(2) + "px");
		card.style.setProperty("--ex-motion-media-y", (ny * mediaMax).toFixed(2) + "px");
		var tiltLength = Math.hypot(nx, ny);
		card.style.setProperty("--ex-motion-media-axis-x", tiltLength > 0 ? String(-ny / tiltLength) : "1");
		card.style.setProperty("--ex-motion-media-axis-y", tiltLength > 0 ? String(nx / tiltLength) : "0");
		card.style.setProperty("--ex-motion-media-angle", (Math.min(1, tiltLength) * tiltMax).toFixed(2) + "deg");

		if (bgOn) {
			card.style.setProperty("--ex-motion-bg-reserve", bgMax + "px");
			card.setAttribute("data-ex-motion-bg-parallax", "1");
			card.style.setProperty("--ex-motion-bg-x", (-nx * bgMax).toFixed(2) + "px");
			card.style.setProperty("--ex-motion-bg-y", (-ny * bgMax).toFixed(2) + "px");
		} else {
			card.removeAttribute("data-ex-motion-bg-parallax");
			card.style.removeProperty("--ex-motion-bg-reserve");
			card.style.setProperty("--ex-motion-bg-x", "0px");
			card.style.setProperty("--ex-motion-bg-y", "0px");
		}

		card.style.setProperty("--ex-motion-action-x", (-nx * actionMax).toFixed(2) + "px");
		card.style.setProperty("--ex-motion-action-y", (-ny * actionMax).toFixed(2) + "px");
		card.style.setProperty("--ex-motion-icon-x", (nx * iconMax).toFixed(2) + "px");
		card.style.setProperty("--ex-motion-icon-y", (ny * iconMax).toFixed(2) + "px");
	}

	function tick() {
		rafId = 0;
		if (!live || !pageVisible) {
			return;
		}
		pose.nx += (pose.targetNx - pose.nx) * smoothRate;
		pose.ny += (pose.targetNy - pose.ny) * smoothRate;
		if (Math.abs(pose.targetNx - pose.nx) < 0.0004) {
			pose.nx = pose.targetNx;
		}
		if (Math.abs(pose.targetNy - pose.ny) < 0.0004) {
			pose.ny = pose.targetNy;
		}
		applyVisuals();
		if (live && pageVisible && (pose.nx !== pose.targetNx || pose.ny !== pose.targetNy)) {
			requestFrame();
		}
	}

	function requestFrame() {
		if (rafId) {
			return;
		}
		rafId = window.requestAnimationFrame(tick);
	}

	function stopFrame() {
		if (rafId) {
			window.cancelAnimationFrame(rafId);
			rafId = 0;
		}
	}

	function setTargets(nx, ny, rate) {
		if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
			return;
		}
		pose.targetNx = clamp(nx, -POSE_CLAMP, POSE_CLAMP);
		pose.targetNy = clamp(ny, -POSE_CLAMP, POSE_CLAMP);
		smoothRate = rate || SMOOTH_POINTER;
		requestFrame();
	}

	function restPose() {
		setTargets(0, 0, SMOOTH_RETURN);
	}

	function onPointerMove(event) {
		if (!live || !card || !isDesktopPointer()) {
			return;
		}
		var rect = card.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) {
			return;
		}
		var x = (event.clientX - rect.left) / rect.width;
		var y = (event.clientY - rect.top) / rect.height;
		setTargets((x - 0.5) * 0.85, (0.5 - y) * 0.85, SMOOTH_POINTER);
	}

	function onPointerLeave() {
		if (!live || !isDesktopPointer()) {
			return;
		}
		restPose();
	}

	function bindPointer() {
		if (pointerBound || !card) {
			return;
		}
		card.addEventListener("pointermove", onPointerMove);
		card.addEventListener("pointerleave", onPointerLeave);
		pointerBound = true;
	}

	function unbindPointer() {
		if (!pointerBound || !card) {
			return;
		}
		card.removeEventListener("pointermove", onPointerMove);
		card.removeEventListener("pointerleave", onPointerLeave);
		pointerBound = false;
	}

	function onDeviceOrientation(event) {
		if (!live || isDesktopPointer() || isReduced()) {
			return;
		}
		if (typeof event.beta !== "number" || typeof event.gamma !== "number") {
			return;
		}
		if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) {
			return;
		}
		if (!gyroCalibrated) {
			calBeta = event.beta;
			calGamma = event.gamma;
			gyroCalibrated = true;
		}
		var dx = (event.gamma - calGamma) / 18;
		var dy = (event.beta - calBeta) / 22;
		setTargets(dx, dy, SMOOTH_GYRO);
	}

	function bindGyro() {
		if (gyroBound) {
			return;
		}
		window.addEventListener("deviceorientation", onDeviceOrientation);
		gyroBound = true;
	}

	function unbindGyro() {
		if (!gyroBound) {
			return;
		}
		window.removeEventListener("deviceorientation", onDeviceOrientation);
		gyroBound = false;
		gyroCalibrated = false;
	}

	function setLive(next) {
		live = !!next &&
			isMobileMotionDevice() &&
			inputReadyForMotion() &&
			!isReduced();
		if (!card) {
			return;
		}
		if (live) {
			card.setAttribute("data-ex-motion-live", "1");
			if (isDesktopPointer()) {
				unbindGyro();
				bindPointer();
			} else if (hasGyroApi() && inputReadyForMotion()) {
				unbindPointer();
				bindGyro();
			}
			requestFrame();
		} else {
			card.removeAttribute("data-ex-motion-live");
			stopFrame();
			unbindPointer();
			unbindGyro();
			pose.targetNx = 0;
			pose.targetNy = 0;
			pose.nx = 0;
			pose.ny = 0;
			resetMotionVars();
		}
		updateToggleUi();
	}
	function syncMotionToggleColor() {
		if (!card || !toggleBtn) {
			return;
		}

		var name = card.querySelector(".ex-mcard__name");
		var color = window.getComputedStyle(name || card).color;
		var channels = color.match(/[\d.]+/g);
		var lightText = true;

		if (channels && channels.length >= 3) {
			var brightness =
				Number(channels[0]) * 0.299 +
				Number(channels[1]) * 0.587 +
				Number(channels[2]) * 0.114;

			lightText = brightness >= 150;
		}

		toggleBtn.style.setProperty("--ex-motion-identity-color", color);
		toggleBtn.style.setProperty(
			"--ex-motion-toggle-surface",
			lightText ? "rgba(0, 0, 0, 0.55)" : "rgba(255, 255, 255, 0.85)"
		);
	}
	function updateToggleUi() {
		if (!toggleBtn) {
			return;
		}
		var available = isMobileMotionDevice() && !isReduced();
		var fab = toggleBtn.closest(".ex-public-motion-fab");

		if (fab) {
			fab.hidden = !available;
		}
		toggleBtn.disabled = !available;
		syncMotionToggleColor();
		var active = isMotionActive();
		toggleBtn.setAttribute("aria-pressed", active ? "true" : "false");
		var label;
		if (permissionPending) {
			label = t("togglePending", "Čaká sa na povolenie pohybu");
		} else if (active) {
			label = t("toggleOff", "Vypnúť pohyb karty");
		} else {
			label = t("toggleOn", "Zapnúť pohyb karty");
		}
		toggleBtn.setAttribute("aria-label", label);
	}

	function syncLiveFromPrefs() {
		if (isReduced() || !userPref) {
			setLive(false);
			return;
		}
		if (inputReadyForMotion()) {
			setLive(true);
		} else {
			setLive(false);
		}
	}

	function onToggleClick() {
		if (!isMobileMotionDevice() || isReduced()) {
			return;
		}
		if (permissionPending) {
			return;
		}

		if (isMotionActive()) {
			userPref = false;
			writeUserPref(false);
			syncLiveFromPrefs();
			return;
		}

		userPref = true;
		writeUserPref(true);

		if (!isDesktopPointer() && hasPermissionApi() && permissionState !== "granted") {
			permissionPending = true;
			updateToggleUi();
			window.DeviceOrientationEvent.requestPermission()
				.then(function (state) {
					permissionPending = false;
					permissionState = state;
					if (state === "granted" && userPref && !isReduced()) {
						setLive(true);
					} else {
						setLive(false);
					}
					updateToggleUi();
				})
				.catch(function () {
					permissionPending = false;
					permissionState = "denied";
					setLive(false);
					updateToggleUi();
				});
			return;
		}

		syncLiveFromPrefs();
	}

	function onVisibilityChange() {
		pageVisible = document.visibilityState !== "hidden";
		if (!pageVisible) {
			stopFrame();
			return;
		}
		if (live) {
			requestFrame();
		}
	}

	function onReducedChange() {
		syncLiveFromPrefs();
	}

	function bindEnvironment() {
		if (!visibilityBound) {
			document.addEventListener("visibilitychange", onVisibilityChange);
			visibilityBound = true;
		}
		if (!reducedBound && mqReduced.addEventListener) {
			mqReduced.addEventListener("change", onReducedChange);
			reducedBound = true;
		} else if (!reducedBound && mqReduced.addListener) {
			mqReduced.addListener(onReducedChange);
			reducedBound = true;
		}
	}

	function init() {
		if (initialized) {
			return;
		}
		config = cfg();
		if (!config || !config.profile_id) {
			return;
		}

		card = document.querySelector(".ex-public-card-host [data-ex-mcard=\"1\"]");
		toggleBtn = document.querySelector("[data-ex-public-motion-toggle]");
		if (!card || !toggleBtn) {
			return;
		}

		initialized = true;
		userPref = readUserPref();
		if (hasPermissionApi()) {
			permissionState = "prompt";
		}

		toggleBtn.addEventListener("click", onToggleClick);
		bindEnvironment();
		syncLiveFromPrefs();
	}

	function onPageShow(event) {
		if (event && event.persisted && initialized) {
			pageVisible = document.visibilityState !== "hidden";
			syncLiveFromPrefs();
			return;
		}
		if (!initialized) {
			init();
		}
	}

	window.addEventListener("pageshow", onPageShow);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
