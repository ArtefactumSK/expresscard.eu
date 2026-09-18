(function () {
  "use strict";

  /* ------------------------------------------------------------------
     expressCARD Motion coordinator (Guest prototype)
     Not a production renderer and not an entitlement/variant engine.

     Layers:
       1. device input     — gyro / pointer / scroll
       2. normalized state — pose, sheen, parallax, intensity
       3. profile coordinator — one active profile, one rAF
       4. visual output    — CSS custom properties by Motion role
       5. global gates     — reduced-motion, visibility, performance

     Roles (same pose, separate tokens):
       media      — photo tilt / depth / shift
       action     — primary CTA, 1–2 px translate
       icon       — quick and social controls, 1–2 px translate
       background — global overlay, weaker than photo
       static     — name, copy, system signatures, whole card

     Production path (not implemented here):
       Expressar Core Entitlement/Grant → validated publication config
       → allowed motion preset → renderer.
     This file must never infer Solo / Team / Signature from name, URL, or UI.
     ------------------------------------------------------------------ */

  var GYRO_WAIT_MS = 1800;
  var POSE_CLAMP = 1;
  var SMOOTH_POINTER = 0.28;
  var SMOOTH_RETURN = 0.18;
  var ACTION_SHIFT = 4.5;
  var ICON_SHIFT = 1.45;
  var BG_SHIFT = 0.85;
  var PROFILE_CLASSES = [
    "ec-profile-desktop-pointer",
    "ec-profile-mobile-gyro",
    "ec-profile-mobile-fallback"
  ];

  /* Prototype tuning only. Not Solo/Team/Signature and not an entitlement. */
  var TUNING_PROFILES = {
    soft: {
      id: "soft",
      intensity: 1,
      maxTiltX: 4.2,
      maxTiltY: 5,
      gyroDelta: 16,
      smoothGyro: 0.14,
      shiftX: 5.2,
      shiftY: 3.2,
      sheenRangeX: 0.16,
      sheenRangeY: 0.12,
      perspective: 820,
      sheenOpacity: 0.34,
      pointerScale: 0.7,
      photoDepth: 12,
      effects: { enter: true, sheen: true, tilt: true, parallax: true, atmosphere: false }
    },
    balanced: {
      id: "balanced",
      intensity: 1,
      maxTiltX: 6,
      maxTiltY: 7,
      gyroDelta: 11,
      smoothGyro: 0.2,
      shiftX: 8,
      shiftY: 5.5,
      sheenRangeX: 0.25,
      sheenRangeY: 0.19,
      perspective: 640,
      sheenOpacity: 0.42,
      pointerScale: 0.48,
      photoDepth: 14,
      effects: { enter: true, sheen: true, tilt: true, parallax: true, atmosphere: false }
    },
    expressive: {
      id: "expressive",
      intensity: 1,
      maxTiltX: 7.5,
      maxTiltY: 9,
      gyroDelta: 9,
      smoothGyro: 0.23,
      shiftX: 11,
      shiftY: 7,
      sheenRangeX: 0.32,
      sheenRangeY: 0.24,
      perspective: 560,
      sheenOpacity: 0.48,
      pointerScale: 0.4,
      photoDepth: 16,
      effects: { enter: true, sheen: true, tilt: true, parallax: true, atmosphere: false }
    }
  };

  var card = document.getElementById("ec-card");
  var live = document.getElementById("ec-live");
  var debugRoot = document.getElementById("ec-debug");
  var enableWrap = document.getElementById("ec-motion-enable");
  var enableBtn = document.getElementById("ec-enable-motion");
  var root = document.documentElement;

  var mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var mqHover = window.matchMedia("(hover: hover)");
  var mqFine = window.matchMedia("(pointer: fine)");
  var mqCoarse = window.matchMedia("(pointer: coarse)");

  var config = clonePreset(TUNING_PROFILES.balanced);
  var initialized = false;
  var activeProfile = "static";
  var fallbackReason = "—";
  var pointerBound = false;
  var scrollBound = false;
  var gyroBound = false;
  var enableBound = false;
  var visibilityBound = false;
  var orientationBound = false;
  var gyroWaitTimer = 0;
  var rafId = 0;
  var pageVisible = true;
  var smoothRate = 0.2;

  var permissionState = "not-required";
  var gyroEventsValid = false;
  var lastDebugAt = 0;
  var calibrated = false;
  var calX = 0;
  var calY = 0;

  var pose = createPose();
  var tokenStyle = null;

  function clonePreset(preset) {
    return {
      id: preset.id,
      intensity: preset.intensity,
      maxTiltX: preset.maxTiltX,
      maxTiltY: preset.maxTiltY,
      gyroDelta: preset.gyroDelta,
      smoothGyro: preset.smoothGyro,
      shiftX: preset.shiftX,
      shiftY: preset.shiftY,
      sheenRangeX: preset.sheenRangeX,
      sheenRangeY: preset.sheenRangeY,
      perspective: preset.perspective,
      sheenOpacity: preset.sheenOpacity,
      pointerScale: preset.pointerScale,
      photoDepth: preset.photoDepth,
      effects: {
        enter: !!preset.effects.enter,
        sheen: !!preset.effects.sheen,
        tilt: !!preset.effects.tilt,
        parallax: !!preset.effects.parallax,
        atmosphere: !!preset.effects.atmosphere
      }
    };
  }

  function createPose() {
    return {
      targetNx: 0,
      targetNy: 0,
      nx: 0,
      ny: 0,
      sheenX: 0.5,
      sheenY: 0.16,
      targetSheenX: 0.5,
      targetSheenY: 0.16,
      parallaxY: 0,
      targetParallaxY: 0
    };
  }

  function hasGyroApi() {
    return typeof window.DeviceOrientationEvent === "function" ||
      typeof window.DeviceOrientationEvent === "object";
  }

  function hasPermissionApi() {
    return hasGyroApi() &&
      typeof window.DeviceOrientationEvent.requestPermission === "function";
  }

  function isSecure() {
    return window.isSecureContext === true;
  }

  function isDebugRequested() {
    try {
      return new URLSearchParams(window.location.search).get("debug") === "1";
    } catch (error) {
      return false;
    }
  }

  function readTuningName() {
    try {
      var value = new URLSearchParams(window.location.search).get("motion");
      if (!value) {
        return "balanced";
      }
      value = String(value).toLowerCase();
      return TUNING_PROFILES[value] ? value : "balanced";
    } catch (error) {
      return "balanced";
    }
  }

  function isReduced() {
    return mqReduced.matches;
  }

  function isDesktopPointer() {
    return mqHover.matches && mqFine.matches && !mqCoarse.matches;
  }

  function isNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function screenAngle() {
    if (window.screen && window.screen.orientation && isNumber(window.screen.orientation.angle)) {
      return window.screen.orientation.angle;
    }
    if (isNumber(window.orientation)) {
      return window.orientation;
    }
    return 0;
  }

  function mapOrientation(beta, gamma) {
    var angle = ((screenAngle() % 360) + 360) % 360;
    if (angle === 90) {
      return { x: gamma, y: -beta };
    }
    if (angle === 180) {
      return { x: -beta, y: -gamma };
    }
    if (angle === 270) {
      return { x: -gamma, y: beta };
    }
    return { x: beta, y: gamma };
  }

  function effectOn(name) {
    return !isReduced() && !!config.effects[name];
  }

  function bindTokenStyle() {
    var sheets = document.styleSheets;
    var i;
    var j;
    var sheet;
    var rules;
    var rule;

    for (i = 0; i < sheets.length; i += 1) {
      sheet = sheets[i];
      try {
        rules = sheet.cssRules;
        if (!rules) {
          continue;
        }
        for (j = 0; j < rules.length; j += 1) {
          rule = rules[j];
          if (rule.selectorText === ":root") {
            tokenStyle = rule.style;
            return;
          }
        }
      } catch (error) {
        /* inaccessible stylesheet */
      }
    }
  }

  function setToken(name, value) {
    if (tokenStyle) {
      tokenStyle.setProperty(name, value);
      return;
    }
    root.style.setProperty(name, value);
  }

  function gateToken(name, enabled) {
    setToken(name, enabled ? "1" : "0");
  }

  function applyEffectGates() {
    var live = !isReduced();
    gateToken("--ec-fx-enter", live && config.effects.enter);
    gateToken("--ec-fx-sheen", live && config.effects.sheen);
    gateToken("--ec-fx-tilt", live && config.effects.tilt);
    gateToken("--ec-fx-parallax", live && config.effects.parallax);
    gateToken("--ec-fx-atmosphere", live && config.effects.atmosphere);
    setToken("--ec-motion-intensity", live ? String(config.intensity) : "0");
  }

  function resetPose(keepParallax) {
    pose.targetNx = 0;
    pose.targetNy = 0;
    pose.nx = 0;
    pose.ny = 0;
    pose.targetSheenX = 0.5;
    pose.targetSheenY = 0.16;
    pose.sheenX = 0.5;
    pose.sheenY = 0.16;
    if (!keepParallax) {
      pose.targetParallaxY = 0;
      pose.parallaxY = 0;
    }
  }

  function writeVisualTokens() {
    var intensity = isReduced() ? 0 : config.intensity;
    var tiltOn = intensity > 0 && config.effects.tilt;
    var sheenOn = intensity > 0 && config.effects.sheen;
    var parallaxOn = intensity > 0 && config.effects.parallax;
    var nx = tiltOn ? clamp(pose.nx, -POSE_CLAMP, POSE_CLAMP) * intensity : 0;
    var ny = tiltOn ? clamp(pose.ny, -POSE_CLAMP, POSE_CLAMP) * intensity : 0;
    var shadowX = tiltOn ? (-ny * 7).toFixed(1) : "0";
    var shadowY = tiltOn ? (10 + nx * 5).toFixed(1) : "10";
    var bgX = tiltOn ? (ny * BG_SHIFT).toFixed(2) : "0";
    var bgY = tiltOn ? (nx * BG_SHIFT * 0.7).toFixed(2) : (parallaxOn ? (pose.parallaxY * 0.28).toFixed(2) : "0");
    setToken("--ec-tilt-x", (nx * config.maxTiltX).toFixed(2) + "deg");
    setToken("--ec-tilt-y", (ny * config.maxTiltY).toFixed(2) + "deg");
    setToken("--ec-shift-x", tiltOn ? (ny * config.shiftX).toFixed(2) + "px" : "0px");
    setToken("--ec-shift-y", tiltOn ? (nx * config.shiftY).toFixed(2) + "px" : "0px");
    setToken("--ec-pointer-x", sheenOn ? (pose.sheenX * 100).toFixed(2) + "%" : "50%");
    setToken("--ec-pointer-y", sheenOn ? (pose.sheenY * 100).toFixed(2) + "%" : "16%");
    setToken("--ec-parallax-y", parallaxOn ? pose.parallaxY.toFixed(2) + "px" : "0px");
    setToken("--ec-perspective", String(config.perspective) + "px");
    setToken("--ec-sheen-opacity", sheenOn ? String(config.sheenOpacity) : "0.18");
    setToken("--ec-photo-depth", tiltOn ? String(config.photoDepth) + "px" : "0px");
    setToken("--ec-photo-shadow", shadowX + "px " + shadowY + "px 24px rgba(28, 30, 36, 0.2)");
    setToken("--ec-action-shift-x", tiltOn ? (ny * ACTION_SHIFT).toFixed(2) + "px" : "0px");
    setToken("--ec-action-shift-y", tiltOn ? (nx * ACTION_SHIFT * 0.65).toFixed(2) + "px" : "0px");
    setToken("--ec-icon-shift-x", tiltOn ? (ny * ICON_SHIFT).toFixed(2) + "px" : "0px");
    setToken("--ec-icon-shift-y", tiltOn ? (nx * ICON_SHIFT * 0.65).toFixed(2) + "px" : "0px");
    setToken("--ec-bg-shift-x", bgX + "px");
    setToken("--ec-bg-shift-y", bgY + "px");
  }

  function poseCaughtUp() {
    return Math.abs(pose.targetNx - pose.nx) < 0.004 &&
      Math.abs(pose.targetNy - pose.ny) < 0.004 &&
      Math.abs(pose.targetSheenX - pose.sheenX) < 0.002 &&
      Math.abs(pose.targetSheenY - pose.sheenY) < 0.002 &&
      Math.abs(pose.targetParallaxY - pose.parallaxY) < 0.05;
  }

  function tick() {
    rafId = 0;
    if (isReduced() || !pageVisible) {
      return;
    }

    pose.nx += (pose.targetNx - pose.nx) * smoothRate;
    pose.ny += (pose.targetNy - pose.ny) * smoothRate;
    pose.sheenX += (pose.targetSheenX - pose.sheenX) * Math.min(1, smoothRate + 0.12);
    pose.sheenY += (pose.targetSheenY - pose.sheenY) * Math.min(1, smoothRate + 0.12);
    pose.parallaxY += (pose.targetParallaxY - pose.parallaxY) * 0.22;
    writeVisualTokens();
    fillDebug(false);

    if (!poseCaughtUp()) {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  function requestFrame() {
    if (!rafId && pageVisible && !isReduced() && activeProfile !== "static" && activeProfile !== "reduced-motion") {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  function stopFrame() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function setPoseFromGyro(nx, ny) {
    pose.targetNx = clamp(nx, -POSE_CLAMP, POSE_CLAMP);
    pose.targetNy = clamp(ny, -POSE_CLAMP, POSE_CLAMP);
    pose.targetSheenX = 0.5 + pose.targetNy * config.sheenRangeX;
    pose.targetSheenY = 0.18 + pose.targetNx * config.sheenRangeY;
    pose.targetParallaxY = 0;
    smoothRate = config.smoothGyro;
    requestFrame();
  }

  function setPoseFromPointer(nx, ny, sheenX, sheenY) {
    pose.targetNx = clamp(nx, -POSE_CLAMP, POSE_CLAMP);
    pose.targetNy = clamp(ny, -POSE_CLAMP, POSE_CLAMP);
    pose.targetSheenX = clamp(sheenX, 0, 1);
    pose.targetSheenY = clamp(sheenY, 0, 1);
    pose.targetParallaxY = 0;
    smoothRate = SMOOTH_POINTER;
    requestFrame();
  }

  function returnPoseToRest() {
    pose.targetNx = 0;
    pose.targetNy = 0;
    pose.targetSheenX = 0.5;
    pose.targetSheenY = 0.16;
    smoothRate = SMOOTH_RETURN;
    requestFrame();
  }

  function setParallax(offset) {
    pose.targetParallaxY = offset;
    pose.targetNx = 0;
    pose.targetNy = 0;
    requestFrame();
  }

  function clearProfileClasses() {
    PROFILE_CLASSES.forEach(function (name) {
      root.classList.remove(name);
    });
    root.classList.remove("ec-motion-live");
  }

  function setProfile(name, reason) {
    activeProfile = name;
    fallbackReason = reason || "—";
    clearProfileClasses();
    if (name === "desktop-pointer") {
      root.classList.add("ec-profile-desktop-pointer");
      root.classList.add("ec-motion-live");
    } else if (name === "mobile-gyro") {
      root.classList.add("ec-profile-mobile-gyro");
      root.classList.add("ec-motion-live");
    } else if (name === "mobile-fallback") {
      root.classList.add("ec-profile-mobile-fallback");
    }
    fillDebug(true);
  }

  function rememberPermissionBaseline() {
    if (permissionState === "granted" || permissionState === "denied" || permissionState === "error") {
      return;
    }
    permissionState = hasPermissionApi() ? "prompt" : "not-required";
  }

  function announce(message) {
    if (live) {
      live.textContent = message;
    }
  }

  function bindMocks() {
    var mocks = document.querySelectorAll("[data-ec-mock]");
    var messages = {
      save: "Ukážka: uloženie kontaktu ešte nie je aktívne.",
      call: "Ukážka: volanie nie je aktívne. Telefónne číslo je neaktívny placeholder.",
      email: "Ukážka: e-mail sa neodosiela. Adresa je neaktívny placeholder."
    };

    Array.prototype.forEach.call(mocks, function (node) {
      node.addEventListener("click", function (event) {
        var key = node.getAttribute("data-ec-mock");
        if (messages[key]) {
          event.preventDefault();
          announce(messages[key]);
        }
      });
    });
  }

  function onPointerMove(event) {
    if (activeProfile !== "desktop-pointer" || !card || (!effectOn("tilt") && !effectOn("sheen"))) {
      return;
    }
    var rect = card.getBoundingClientRect();
    var x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    var y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    setPoseFromPointer((0.5 - y) * config.pointerScale, (x - 0.5) * config.pointerScale, x, y);
  }

  function onPointerLeave() {
    if (activeProfile !== "desktop-pointer") {
      return;
    }
    returnPoseToRest();
  }

  function onScroll() {
    if (activeProfile !== "mobile-fallback" || !effectOn("parallax")) {
      return;
    }
    setParallax(clamp(window.scrollY * 0.04, -6, 6));
  }

  function bindDesktopPointer() {
    if (pointerBound || !card) {
      return;
    }
    card.addEventListener("pointermove", onPointerMove);
    card.addEventListener("pointerleave", onPointerLeave);
    pointerBound = true;
  }

  function unbindDesktopPointer() {
    if (!pointerBound || !card) {
      return;
    }
    card.removeEventListener("pointermove", onPointerMove);
    card.removeEventListener("pointerleave", onPointerLeave);
    pointerBound = false;
  }

  function bindMobileScroll() {
    if (scrollBound) {
      return;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    scrollBound = true;
  }

  function unbindMobileScroll() {
    if (!scrollBound) {
      return;
    }
    window.removeEventListener("scroll", onScroll);
    scrollBound = false;
  }

  function resetCalibration() {
    calibrated = false;
    calX = 0;
    calY = 0;
  }

  function onDeviceOrientation(event) {
    if (isReduced() || (activeProfile !== "mobile-gyro" && activeProfile !== "mobile-fallback")) {
      return;
    }
    if (!isNumber(event.beta) || !isNumber(event.gamma)) {
      return;
    }

    gyroEventsValid = true;
    var mapped = mapOrientation(event.beta, event.gamma);

    if (!calibrated) {
      calX = mapped.x;
      calY = mapped.y;
      calibrated = true;
      activateGyroFromEvents();
    }

    setPoseFromGyro(
      clamp((mapped.x - calX) / config.gyroDelta, -POSE_CLAMP, POSE_CLAMP),
      clamp((mapped.y - calY) / config.gyroDelta, -POSE_CLAMP, POSE_CLAMP)
    );
  }

  function activateGyroFromEvents() {
    if (isReduced() || isDesktopPointer()) {
      return;
    }
    clearGyroWait();
    hideEnableButton();
    unbindMobileScroll();
    pose.targetParallaxY = 0;
    setProfile("mobile-gyro", "—");
    requestFrame();
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
  }

  function clearGyroWait() {
    if (gyroWaitTimer) {
      window.clearTimeout(gyroWaitTimer);
      gyroWaitTimer = 0;
    }
  }

  function showEnableButton() {
    if (!enableWrap || isReduced() || isDesktopPointer() || permissionState !== "prompt") {
      return;
    }
    if (enableBtn) {
      enableBtn.disabled = false;
    }
    enableWrap.hidden = false;
  }

  function hideEnableButton() {
    if (enableWrap) {
      enableWrap.hidden = true;
    }
  }

  function startGyroWait() {
    clearGyroWait();
    gyroWaitTimer = window.setTimeout(function () {
      gyroWaitTimer = 0;
      if (activeProfile === "mobile-fallback" && !gyroEventsValid) {
        fallbackReason = hasGyroApi() ? "no-events" : "no-api";
        fillDebug(true);
      }
    }, GYRO_WAIT_MS);
  }

  function beginGyroListen(reasonIfWaiting) {
    resetCalibration();
    gyroEventsValid = false;
    bindGyro();
    startGyroWait();
    if (activeProfile !== "mobile-gyro") {
      setProfile("mobile-fallback", reasonIfWaiting || "waiting-orientation");
      bindMobileScroll();
    }
  }

  function onEnableMotion() {
    if (isReduced() || !hasPermissionApi() || !enableBtn) {
      return;
    }

    enableBtn.disabled = true;

    window.DeviceOrientationEvent.requestPermission().then(function (state) {
      if (state === "granted") {
        permissionState = "granted";
        hideEnableButton();
        announce("");
        beginGyroListen("waiting-orientation");
        fillDebug(true);
        return;
      }
      permissionState = state === "denied" ? "denied" : "error";
      hideEnableButton();
      unbindGyro();
      setProfile("mobile-fallback", "permission-" + permissionState);
      bindMobileScroll();
      announce("Pohyb ostáva vypnutý. Kartu môžete používať bez neho.");
      fillDebug(true);
    }).catch(function () {
      permissionState = "error";
      hideEnableButton();
      unbindGyro();
      setProfile("mobile-fallback", "permission-error");
      bindMobileScroll();
      announce("Pohyb sa nepodarilo aktivovať. Kartu môžete používať bez neho.");
      fillDebug(true);
    });
  }

  function bindEnableButton() {
    if (enableBound || !enableBtn) {
      return;
    }
    enableBtn.addEventListener("click", onEnableMotion);
    enableBound = true;
  }

  function onVisibilityChange() {
    pageVisible = document.visibilityState !== "hidden";
    if (!pageVisible) {
      stopFrame();
      return;
    }
    requestFrame();
  }

  function onOrientationChange() {
    if (activeProfile === "mobile-gyro" || (activeProfile === "mobile-fallback" && gyroBound)) {
      resetCalibration();
    }
  }

  function bindEnvironment() {
    if (!visibilityBound) {
      document.addEventListener("visibilitychange", onVisibilityChange);
      visibilityBound = true;
    }
    if (!orientationBound) {
      window.addEventListener("orientationchange", onOrientationChange);
      if (window.screen && window.screen.orientation && typeof window.screen.orientation.addEventListener === "function") {
        window.screen.orientation.addEventListener("change", onOrientationChange);
      }
      orientationBound = true;
    }
  }

  function teardownMotion() {
    clearGyroWait();
    stopFrame();
    unbindDesktopPointer();
    unbindMobileScroll();
    unbindGyro();
    hideEnableButton();
    resetCalibration();
    resetPose(false);
    writeVisualTokens();
    clearProfileClasses();
  }

  /* Future live preview / publication reload: pass a validated config object.
     Never accept arbitrary CSS/JS. Never read variant from the URL. */
  function applyPublishedConfig(nextConfig) {
    if (nextConfig && typeof nextConfig === "object") {
      config = clonePreset(nextConfig);
    } else {
      config = clonePreset(TUNING_PROFILES.balanced);
    }
    applyMotionProfile();
  }

  function applyMotionProfile() {
    teardownMotion();
    applyEffectGates();

    if (isReduced()) {
      root.classList.remove("ec-motion-enabled");
      rememberPermissionBaseline();
      setProfile("reduced-motion", "reduced-motion");
      writeVisualTokens();
      fillDebug(true);
      return;
    }

    root.classList.add("ec-motion-enabled");

    if (isDesktopPointer()) {
      rememberPermissionBaseline();
      setProfile("desktop-pointer", "—");
      bindDesktopPointer();
      fillDebug(true);
      return;
    }

    if (!hasGyroApi() || !isSecure()) {
      rememberPermissionBaseline();
      setProfile("mobile-fallback", hasGyroApi() ? "insecure-context" : "no-api");
      bindMobileScroll();
      fillDebug(true);
      return;
    }

    if (hasPermissionApi()) {
      rememberPermissionBaseline();
      if (permissionState === "granted") {
        beginGyroListen("waiting-orientation");
        fillDebug(true);
        return;
      }
      if (permissionState === "denied" || permissionState === "error") {
        setProfile("mobile-fallback", "permission-" + permissionState);
        bindMobileScroll();
        fillDebug(true);
        return;
      }
      permissionState = "prompt";
      setProfile("mobile-fallback", "permission-required");
      bindMobileScroll();
      bindEnableButton();
      showEnableButton();
      fillDebug(true);
      return;
    }

    permissionState = "not-required";
    beginGyroListen("waiting-orientation");
    fillDebug(true);
  }

  function tiltDebug() {
    if (activeProfile === "desktop-pointer") {
      return pose.nx.toFixed(2) + " / " + pose.ny.toFixed(2);
    }
    if (activeProfile === "mobile-gyro") {
      return (pose.nx * config.maxTiltX).toFixed(1) + " / " + (pose.ny * config.maxTiltY).toFixed(1);
    }
    return "0 / 0";
  }

  function cssTiltDebug() {
    if (!card) {
      return "0deg / 0deg";
    }
    var styles = window.getComputedStyle(card);
    var x = styles.getPropertyValue("--ec-tilt-x").trim() || "0deg";
    var y = styles.getPropertyValue("--ec-tilt-y").trim() || "0deg";
    return x + " / " + y;
  }

  function stageTransformDebug() {
    var stage = document.querySelector(".ec-hero__stage");
    if (!stage) {
      return "none";
    }
    var transform = window.getComputedStyle(stage).transform;
    return !transform || transform === "none" ? "none" : "active";
  }

  function fillDebug(force) {
    if (!debugRoot || debugRoot.hidden) {
      return;
    }
    var now = Date.now();
    if (!force && now - lastDebugAt < 220) {
      return;
    }
    lastDebugAt = now;

    var liveTilt = !isReduced() && (activeProfile === "mobile-gyro" || activeProfile === "desktop-pointer") && effectOn("tilt");
    var liveParallax = !isReduced() && activeProfile === "mobile-fallback" && effectOn("parallax");
    var values = {
      "ec-debug-viewport": String(window.innerWidth) + "px",
      "ec-debug-mode": isDesktopPointer() ? "desktop" : "mobile",
      "ec-debug-hover": mqHover.matches ? "hover" : "none",
      "ec-debug-pointer": mqFine.matches ? "fine" : (mqCoarse.matches ? "coarse" : "unknown"),
      "ec-debug-reduced": isReduced() ? "reduce" : "no-preference",
      "ec-debug-tuning": config.id,
      "ec-debug-role-media": liveTilt || liveParallax ? "aktívny" : "neaktívny",
      "ec-debug-role-action": liveTilt ? "aktívny" : "neaktívny",
      "ec-debug-role-icon": liveTilt ? "aktívny" : "neaktívny",
      "ec-debug-role-background": liveTilt || liveParallax ? "aktívny" : "neaktívny",
      "ec-debug-max-tilt": config.maxTiltX + " / " + config.maxTiltY,
      "ec-debug-gyro-delta": String(config.gyroDelta),
      "ec-debug-perspective": config.perspective + "px",
      "ec-debug-profile": activeProfile,
      "ec-debug-gyro-api": hasGyroApi() ? "áno" : "nie",
      "ec-debug-gyro-perm-api": hasPermissionApi() ? "áno" : "nie",
      "ec-debug-gyro-perm": permissionState,
      "ec-debug-gyro-events": gyroEventsValid ? "áno" : "nie",
      "ec-debug-tilt": tiltDebug(),
      "ec-debug-css-tilt": cssTiltDebug(),
      "ec-debug-stage-transform": stageTransformDebug(),
      "ec-debug-fallback": fallbackReason,
      "ec-debug-js": "inicializovaný"
    };

    Object.keys(values).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) {
        node.textContent = values[id];
      }
    });
  }

  function setupDebug() {
    if (!debugRoot || !isDebugRequested()) {
      return;
    }
    debugRoot.hidden = false;
    fillDebug(true);
    window.addEventListener("resize", function () {
      fillDebug(true);
    });
  }

  function bindMedia(mq, handler) {
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return;
    }
    if (typeof mq.addListener === "function") {
      mq.addListener(handler);
    }
  }

  function onCapabilityChange() {
    applyMotionProfile();
    fillDebug(true);
  }

  function boot() {
    if (initialized) {
      return;
    }
    initialized = true;
    root.classList.add("ec-js");
    bindTokenStyle();
    bindMocks();
    bindEnvironment();
    applyPublishedConfig(TUNING_PROFILES[readTuningName()]);
    setupDebug();
    bindMedia(mqReduced, onCapabilityChange);
    bindMedia(mqHover, onCapabilityChange);
    bindMedia(mqFine, onCapabilityChange);
    bindMedia(mqCoarse, onCapabilityChange);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
