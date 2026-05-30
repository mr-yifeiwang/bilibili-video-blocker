// ==UserScript==
// @name         Bilibili Video Blocker
// @namespace    https://github.com/mr-yifeiwang/bilibili-video-blocker
// @version      1.4.0
// @description  Hide Bilibili video cards conditionally
// @author       mr-yifeiwang
// @match        https://www.bilibili.com/*
// @match        https://search.bilibili.com/*
// @match        https://space.bilibili.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// ==/UserScript==

(function () {
  "use strict";

  const BLOCK_ATTR = "data-bilibili-uid-blocked";
  const PREVIEW_ATTR = "data-bilibili-uid-previewed";
  const BLOCKED_UID_ATTR = "data-bilibili-uid-blocked-uid";

  const BLOCKLIST_STORAGE_KEY = "bilibili-uid-blocker:blocklist";
  const SETTING_KEYS = {
    blockNewUsers: "bilibili-uid-blocker:block-new-users",
    previewMode: "bilibili-uid-blocker:preview-mode",
    hideShortVideos: "bilibili-uid-blocker:hide-short-videos",
    hideUnpopularVideos: "bilibili-uid-blocker:hide-unpopular-videos",
  };

  const USER_BUTTON_ID = "bilibili-uid-blocker-user-button";
  const MANAGER_BUTTON_ID = "bilibili-uid-blocker-manager-button";
  const FLOATING_BUTTON_CLASS = "bilibili-uid-blocker-floating-button";
  const MANAGER_PANEL_ID = "bilibili-uid-blocker-manager-panel";
  const MANAGER_TEXTAREA_ID = "bilibili-uid-blocker-manager-textarea";

  const SHORT_VIDEO_MAX_SECONDS = 5 * 60;
  const UNPOPULAR_VIDEO_MAX_VIEWS = 10000;
  const MAX_ANCESTOR_STEPS = 8;
  const MAX_CARD_AREA_RATIO = 0.75;
  const RESCAN_INTERVAL_MS = 1500;
  const VIDEO_PATH_RE = /\/video\//i;
  const UID_ATTRS = ["data-usercard-mid", "data-mid", "mid"];

  const CARD_SELECTOR = [
    ".bili-video-card",
    ".bili-video-card__wrap",
    ".video-card",
    ".video-card-common",
    ".video-card-reco",
    ".feed-card",
    ".bili-feed-card",
    ".rank-item",
    ".rank-list-item",
    ".small-item",
    ".card-box",
    ".video-list-item",
    ".list-item",
    ".video-item",
    ".result-item",
    ".search-result-item",
    ".search-card",
    ".search-video-card",
    ".bili-video-item",
    '[class*="video-card"]',
    '[class*="VideoCard"]',
    '[class*="video-item"]',
    '[class*="VideoItem"]',
    '[class*="result-item"]',
    '[class*="ResultItem"]',
  ].join(",");

  const VIDEO_LINK_SELECTOR = [
    'a[href*="/video/"]',
    'a[href*="bilibili.com/video/"]',
    'a[href*="/bangumi/play/"]',
  ].join(",");

  const UPLOADER_SELECTOR = [
    'a[href*="space.bilibili.com/"]',
    "[data-usercard-mid]",
    "[data-mid]",
    "[mid]",
  ].join(",");

  const TITLE_SELECTOR =
    '[title], h1, h2, h3, [class*="title"], [class*="Title"]';
  const VISUAL_SELECTOR =
    'img, picture, svg, [class*="cover"], [class*="thumb"], [class*="pic"]';
  const DURATION_SELECTOR = '[class*="duration"], [class*="Duration"]';
  const STAT_SELECTOR =
    '[class*="play"], [class*="Play"], [class*="view"], [class*="View"], [class*="stat"], [class*="Stat"]';

  const RECOMMENDATION_AREA_SELECTOR = [
    ".recommend-list",
    ".recommend-container",
    ".right-container",
    ".video-card-reco",
    ".video-page-card-small",
    '[class*="recommend"]',
    '[class*="Recommend"]',
    '[class*="reco"]',
    '[class*="Reco"]',
  ].join(",");
  const RECOMMENDATION_CARD_CONTAINER_SELECTOR = [
    ".video-page-card-small",
    '[class*="col_"][class*="mb_"]',
  ].join(",");
  const SEARCH_PROTECTED_VIDEO_CARD_SELECTOR = ".b-user-video-card";
  const VIDEO_OWNER_SELECTOR = [
    '.up-info-container .up-name[href*="space.bilibili.com/"]',
    '.up-info .up-name[href*="space.bilibili.com/"]',
    '.up-info-right a[href*="space.bilibili.com/"]',
    '.video-owner a[href*="space.bilibili.com/"]',
    '.owner a[href*="space.bilibili.com/"]',
    '.members-info a[href*="space.bilibili.com/"]',
    '.staff-info a[href*="space.bilibili.com/"]',
    '[class*="up-info"] a[href*="space.bilibili.com/"]',
    '[class*="UpInfo"] a[href*="space.bilibili.com/"]',
    '[class*="owner"] a[href*="space.bilibili.com/"]',
    '[class*="Owner"] a[href*="space.bilibili.com/"]',
  ].join(",");

  const BOOLEAN_CONTROLS = [
    {
      name: "blockNewUsers",
      id: "bilibili-uid-blocker-manager-block-new-users",
      label: "Block new users (after 2022-08-30)",
    },
    {
      name: "hideShortVideos",
      id: "bilibili-uid-blocker-manager-hide-short-videos",
      label: "Hide short videos (< 5 min)",
    },
    {
      name: "hideUnpopularVideos",
      id: "bilibili-uid-blocker-manager-hide-unpopular-videos",
      label: "Hide unpopular videos (< 10K views)",
    },
    {
      name: "previewMode",
      id: "bilibili-uid-blocker-manager-preview-mode",
      label: "Preview",
      previewToggle: true,
    },
  ];

  const BLOCKED_UIDS = new Set();
  const settings = {
    blockNewUsers: false,
    previewMode: false,
    hideShortVideos: false,
    hideUnpopularVideos: false,
  };

  let scheduled = false;
  let observerStarted = false;
  const pendingRoots = new Set();

  addStyle();
  boot();

  function boot() {
    replaceRuntimeBlockedUids(readSavedBlockedUids() || []);
    for (const name of Object.keys(settings)) {
      settings[name] = readBooleanSetting(SETTING_KEYS[name], false);
    }

    setupStorageSync();
    renderUserPageBlockButton();
    renderBlocklistManager();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }

    window.addEventListener("pageshow", refreshChromeAndScan);
    patchHistory("pushState");
    patchHistory("replaceState");
    window.addEventListener("popstate", () =>
      setTimeout(refreshChromeAndScan, 0),
    );
  }

  function start() {
    refreshChromeAndScan();
    if (observerStarted || !document.documentElement) return;
    observerStarted = true;

    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) scheduleScan(node);
        } else {
          scheduleScan(mutation.target);
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "class", "title", "alt", ...UID_ATTRS],
    });

    setInterval(
      () => scheduleScan(document.documentElement, { force: true }),
      RESCAN_INTERVAL_MS,
    );
  }

  function refreshChromeAndScan() {
    renderUserPageBlockButton();
    renderBlocklistManager();
    scheduleScan(document.documentElement, { force: true });
  }

  function scheduleScan(root, options = {}) {
    if (!isCardBlockingPage() || !isElement(root)) return;
    pendingRoots.add(root);
    if (options.force) pendingRoots.add(document.documentElement);
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      for (const pendingRoot of roots) scan(pendingRoot, options);
    });
  }

  function scan(root) {
    if (!isCardBlockingPage() || !isElement(root)) return;

    for (const candidate of collectCandidates(root)) {
      const card = resolveVideoCard(candidate);
      if (!card) continue;

      const reason = evaluateCard(card);
      if (!reason) continue;

      const target = resolveConsequenceTarget(card);
      if (isValidConsequenceTarget(target, card, reason)) {
        applyConsequence(target, reason);
      }
    }
  }

  function collectCandidates(root) {
    const candidates = new Set();
    addIfMatches(root, CARD_SELECTOR, candidates);
    addIfMatches(root, UPLOADER_SELECTOR, candidates);
    addIfMatches(root, VIDEO_LINK_SELECTOR, candidates);
    for (const selector of [
      CARD_SELECTOR,
      UPLOADER_SELECTOR,
      VIDEO_LINK_SELECTOR,
    ]) {
      for (const element of root.querySelectorAll(selector))
        candidates.add(element);
    }
    return candidates;
  }

  function resolveVideoCard(candidate) {
    if (!isElement(candidate) || isProtectedSearchVideoCard(candidate))
      return null;
    if (isPotentialVideoCard(candidate)) return candidate;

    let best = null;
    for (
      let element = candidate, depth = 0;
      element && depth <= MAX_ANCESTOR_STEPS;
      element = element.parentElement, depth += 1
    ) {
      if (isUnsafePageContainer(element)) break;
      if (matches(element, CARD_SELECTOR) && isPotentialVideoCard(element))
        return element;
      if (isPotentialVideoCard(element) && !isTooLargeToHide(element))
        best = element;
    }
    return best;
  }

  function evaluateCard(card) {
    return (
      blockedUidReason(card) ||
      newUserReason(card) ||
      shortVideoReason(card) ||
      unpopularVideoReason(card)
    );
  }

  function blockedUidReason(card) {
    const uid = getUploaderUidsInside(card).find((value) =>
      BLOCKED_UIDS.has(value),
    );
    return uid ? { type: "uid", uid } : null;
  }

  function newUserReason(card) {
    if (!settings.blockNewUsers) return null;
    const uid = getUploaderUidsInside(card).find(isNewUserUid);
    return uid ? { type: "new-user", uid } : null;
  }

  function shortVideoReason(card) {
    if (!settings.hideShortVideos || !canUseMetadataFilter(card)) return null;
    const seconds = getVideoDurationSeconds(card);
    return seconds > 0 && seconds < SHORT_VIDEO_MAX_SECONDS
      ? { type: "short-video", uid: "" }
      : null;
  }

  function unpopularVideoReason(card) {
    if (!settings.hideUnpopularVideos || !canUseMetadataFilter(card))
      return null;
    const views = getVideoViewCount(card);
    return views != null && views < UNPOPULAR_VIDEO_MAX_VIEWS
      ? { type: "unpopular-video", uid: "" }
      : null;
  }

  function canUseMetadataFilter(card) {
    return !isDirectVideoPage() || isInsideRecommendationArea(card);
  }

  function resolveConsequenceTarget(card) {
    const recommendationContainer = card.closest(
      RECOMMENDATION_CARD_CONTAINER_SELECTOR,
    );
    return isSafeTargetShape(recommendationContainer)
      ? recommendationContainer
      : card;
  }

  function isValidConsequenceTarget(target, card, reason) {
    if (!isSafeTargetShape(target)) return false;
    if (isProtectedSearchVideoCard(card) || isProtectedSearchVideoCard(target))
      return false;
    if (isDirectVideoOwnerCard(target, reason.uid)) return false;
    return true;
  }

  function isSafeTargetShape(element) {
    return Boolean(
      element &&
      !isUnsafePageContainer(element) &&
      !isTooLargeToHide(element) &&
      isPotentialVideoCard(element) &&
      !containsMultipleVideos(element),
    );
  }

  function applyConsequence(target, reason) {
    clearNestedConsequences(target);
    target.removeAttribute(settings.previewMode ? BLOCK_ATTR : PREVIEW_ATTR);

    const activeAttr = settings.previewMode ? PREVIEW_ATTR : BLOCK_ATTR;
    if (
      target.parentElement &&
      target.parentElement.closest(`[${activeAttr}]`)
    ) {
      clearConsequence(target);
      return;
    }

    target.setAttribute(activeAttr, "true");
    target.setAttribute(BLOCKED_UID_ATTR, reason.uid || "");
  }

  function refreshConsequences() {
    for (const element of document.querySelectorAll(
      `[${BLOCK_ATTR}], [${PREVIEW_ATTR}]`,
    )) {
      clearConsequence(element);
    }
    scan(document.documentElement);
  }

  function clearNestedConsequences(target) {
    for (const nested of target.querySelectorAll(
      `[${BLOCK_ATTR}], [${PREVIEW_ATTR}]`,
    )) {
      clearConsequence(nested);
    }
  }

  function clearConsequence(element) {
    element.removeAttribute(BLOCK_ATTR);
    element.removeAttribute(PREVIEW_ATTR);
    element.removeAttribute(BLOCKED_UID_ATTR);
  }

  function unhideCardsForUid(uid) {
    for (const element of document.querySelectorAll(
      `[${BLOCKED_UID_ATTR}="${uid}"]`,
    )) {
      clearConsequence(element);
    }
  }

  function isPotentialVideoCard(element) {
    if (!isElement(element) || isUnsafePageContainer(element)) return false;
    if (!hasInOrSelf(element, VIDEO_LINK_SELECTOR)) return false;
    if (matches(element, CARD_SELECTOR)) return true;
    return (
      hasInOrSelf(element, UPLOADER_SELECTOR) &&
      (hasInOrSelf(element, VISUAL_SELECTOR) ||
        hasInOrSelf(element, TITLE_SELECTOR))
    );
  }

  function getUploaderUidsInside(container) {
    const uids = new Set();
    if (matches(container, UPLOADER_SELECTOR)) addUploaderUids(container, uids);
    for (const element of container.querySelectorAll(UPLOADER_SELECTOR)) {
      addUploaderUids(element, uids);
    }
    return [...uids];
  }

  function addUploaderUids(element, uids) {
    if (element instanceof HTMLAnchorElement)
      addUidFromHref(element.getAttribute("href"), uids);
    for (const attr of UID_ATTRS) addUid(element.getAttribute(attr), uids);
    if (element.dataset) {
      addUid(element.dataset.usercardMid, uids);
      addUid(element.dataset.mid, uids);
    }
  }

  function addUidFromHref(href, uids) {
    if (!href) return;
    const match =
      href.match(/space\.bilibili\.com\/(\d+)/i) ||
      href.match(/^\/\/(?:space\.)?bilibili\.com\/(\d+)/i);
    if (match) addUid(match[1], uids);
  }

  function addUid(value, uids) {
    const uid = normalizeUid(value);
    if (uid) uids.add(uid);
  }

  function normalizeUid(value) {
    const match = value == null ? null : String(value).trim().match(/^\d+$/);
    return match ? match[0] : "";
  }

  function isNewUserUid(uid) {
    return /^\d{16}$/.test(uid);
  }

  function getVideoDurationSeconds(card) {
    for (const element of getDurationElements(card)) {
      const seconds = parseDurationSeconds(element.textContent || "");
      if (seconds > 0) return seconds;
    }
    return 0;
  }

  function getDurationElements(card) {
    const elements = new Set(card.querySelectorAll(DURATION_SELECTOR));
    if (matches(card, DURATION_SELECTOR)) elements.add(card);
    for (const element of card.querySelectorAll("*")) {
      if (
        !element.children.length &&
        /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/.test(element.textContent || "")
      ) {
        elements.add(element);
      }
    }
    return elements;
  }

  function parseDurationSeconds(text) {
    const match = String(text || "")
      .trim()
      .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return 0;
    return match[3] == null
      ? Number(match[1]) * 60 + Number(match[2])
      : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  function getVideoViewCount(card) {
    const preferred = [...card.querySelectorAll(STAT_SELECTOR)].filter(
      isViewCountElement,
    );
    const fallback = [...card.querySelectorAll(STAT_SELECTOR)].filter(
      isLikelyViewCountFallbackElement,
    );
    for (const element of [...preferred, ...fallback]) {
      const count = parseViewCount(element.textContent || "");
      if (count != null) return count;
    }
    return null;
  }

  function isViewCountElement(element) {
    if (matches(element, DURATION_SELECTOR)) return false;
    return /play|view|播放|观看/i.test(getClueText(element, true));
  }

  function isLikelyViewCountFallbackElement(element) {
    const text = element.textContent || "";
    if (text.includes(":")) return false;
    if (parseViewCount(text) == null) return false;
    return /stat|播放|观看|play|view/i.test(getClueText(element, false));
  }

  function getClueText(element, includeText) {
    return `${element.className || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${includeText ? element.textContent || "" : ""}`;
  }

  function parseViewCount(text) {
    const normalized = String(text || "")
      .replace(/,/g, "")
      .trim();
    if (!normalized || normalized.includes(":")) return null;
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*([万亿]?)/);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    if (match[2] === "万") return value * 10000;
    if (match[2] === "亿") return value * 100000000;
    return value;
  }

  function containsMultipleVideos(element) {
    const hrefs = new Set();
    if (matches(element, VIDEO_LINK_SELECTOR)) addVideoHref(element, hrefs);
    for (const link of element.querySelectorAll(VIDEO_LINK_SELECTOR))
      addVideoHref(link, hrefs);
    return hrefs.size > 1;
  }

  function addVideoHref(link, hrefs) {
    const href = link.getAttribute("href");
    if (!href) return;
    try {
      hrefs.add(new URL(href, location.href).pathname.replace(/\/$/, ""));
    } catch (_error) {
      hrefs.add(href.split(/[?#]/)[0].replace(/\/$/, ""));
    }
  }

  function isDirectVideoOwnerCard(card, uid) {
    return Boolean(
      uid &&
      isDirectVideoPage() &&
      uid === findDirectPageUploaderUid() &&
      !matches(card, RECOMMENDATION_AREA_SELECTOR) &&
      !isInsideRecommendationArea(card),
    );
  }

  function isInsideRecommendationArea(element) {
    return Boolean(element && element.closest(RECOMMENDATION_AREA_SELECTOR));
  }

  function isProtectedSearchVideoCard(element) {
    return Boolean(
      isSearchPage() &&
      element &&
      element.closest(SEARCH_PROTECTED_VIDEO_CARD_SELECTOR),
    );
  }

  function findDirectPageUploaderUid() {
    const fromState = findUidInInitialState();
    if (fromState) return fromState;

    const ownerLink = document.querySelector(VIDEO_OWNER_SELECTOR);
    if (ownerLink && !isInsideRecommendationArea(ownerLink)) {
      const uids = new Set();
      addUploaderUids(ownerLink, uids);
      if ([...uids][0]) return [...uids][0];
    }

    const spaceLink = document.querySelector('a[href*="space.bilibili.com/"]');
    if (spaceLink && !isInsideRecommendationArea(spaceLink)) {
      const uids = new Set();
      addUploaderUids(spaceLink, uids);
      if ([...uids][0]) return [...uids][0];
    }

    return "";
  }

  function findUidInInitialState() {
    for (const script of document.scripts || []) {
      const text = script.textContent || "";
      if (!text.includes("mid")) continue;
      const ownerMid = text.match(/"owner"\s*:\s*\{[^}]*"mid"\s*:\s*(\d+)/);
      if (ownerMid) return ownerMid[1];
      const upMid = text.match(/"upData"\s*:\s*\{[^}]*"mid"\s*:\s*(\d+)/);
      if (upMid) return upMid[1];
    }
    return "";
  }

  function setupStorageSync() {
    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(
        BLOCKLIST_STORAGE_KEY,
        (_key, _oldValue, value, remote) => {
          if (remote) syncBlockedUids(value);
        },
      );
      for (const [name, key] of Object.entries(SETTING_KEYS)) {
        GM_addValueChangeListener(key, (_key, _oldValue, value, remote) => {
          if (remote) syncBooleanSetting(name, value);
        });
      }
      return;
    }

    window.addEventListener("storage", (event) => {
      if (event.key === BLOCKLIST_STORAGE_KEY) syncBlockedUids(event.newValue);
      for (const [name, key] of Object.entries(SETTING_KEYS)) {
        if (event.key === key) syncBooleanSetting(name, event.newValue);
      }
    });
  }

  function syncBlockedUids(savedValue) {
    const savedUids = parseSavedBlockedUids(savedValue);
    if (!savedUids) return;
    replaceRuntimeBlockedUids(savedUids);
    refreshConsequences();
    refreshBlocklistManagerPanel();
    renderUserPageBlockButton();
  }

  function syncBooleanSetting(name, savedValue) {
    settings[name] = parseBooleanSetting(savedValue, false);
    refreshConsequences();
    refreshBooleanControls();
  }

  function readSavedBlockedUids() {
    try {
      const saved =
        typeof GM_getValue === "function"
          ? GM_getValue(BLOCKLIST_STORAGE_KEY, null)
          : localStorage.getItem(BLOCKLIST_STORAGE_KEY);
      return parseSavedBlockedUids(saved);
    } catch (_error) {
      return [];
    }
  }

  function parseSavedBlockedUids(saved) {
    if (saved == null) return null;
    try {
      const parsed = typeof saved === "string" ? JSON.parse(saved) : saved;
      return Array.isArray(parsed)
        ? parsed.map(normalizeUid).filter(Boolean)
        : [];
    } catch (_error) {
      return [];
    }
  }

  function readBooleanSetting(key, defaultValue) {
    try {
      const saved =
        typeof GM_getValue === "function"
          ? GM_getValue(key, defaultValue)
          : localStorage.getItem(key);
      return parseBooleanSetting(saved, defaultValue);
    } catch (_error) {
      return defaultValue;
    }
  }

  function parseBooleanSetting(saved, defaultValue) {
    if (saved == null) return defaultValue;
    if (saved === true || saved === "true") return true;
    if (saved === false || saved === "false") return false;
    try {
      return JSON.parse(saved) === true;
    } catch (_error) {
      return defaultValue;
    }
  }

  function saveBooleanSetting(key, value) {
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, Boolean(value));
      else localStorage.setItem(key, String(Boolean(value)));
    } catch (_error) {
      // Keep runtime setting even if persistence fails.
    }
  }

  function replaceRuntimeBlockedUids(nextUids) {
    const next = new Set(nextUids.map(normalizeUid).filter(Boolean));
    for (const uid of [...BLOCKED_UIDS]) {
      if (!next.has(uid)) {
        BLOCKED_UIDS.delete(uid);
        unhideCardsForUid(uid);
      }
    }
    for (const uid of next) BLOCKED_UIDS.add(uid);
  }

  function saveBlockedUids() {
    try {
      const value = JSON.stringify([...BLOCKED_UIDS]);
      if (typeof GM_setValue === "function")
        GM_setValue(BLOCKLIST_STORAGE_KEY, value);
      else localStorage.setItem(BLOCKLIST_STORAGE_KEY, value);
    } catch (_error) {
      // Keep runtime blocklist even if persistence fails.
    }
  }

  function setBooleanSetting(name, value) {
    settings[name] = Boolean(value);
    saveBooleanSetting(SETTING_KEYS[name], settings[name]);
    refreshConsequences();
  }

  function getBlockedUidList() {
    return [...BLOCKED_UIDS].sort((a, b) =>
      a.length === b.length ? a.localeCompare(b) : a.length - b.length,
    );
  }

  function parseBlockedUidText(text) {
    return [...new Set(text.split(/\r?\n/).map(normalizeUid).filter(Boolean))];
  }

  function replaceBlockedUids(nextUids) {
    replaceRuntimeBlockedUids(nextUids);
    saveBlockedUids();
    refreshConsequences();
    refreshBlocklistManagerPanel();
  }

  function setUidBlocked(uid, blocked) {
    replaceRuntimeBlockedUids(readSavedBlockedUids() || []);
    if (blocked) BLOCKED_UIDS.add(uid);
    else {
      BLOCKED_UIDS.delete(uid);
      unhideCardsForUid(uid);
    }
    saveBlockedUids();
    refreshConsequences();
    refreshBlocklistManagerPanel();
  }

  function renderBlocklistManager() {
    const shouldShow = isBlocklistManagerPage();
    let button = document.getElementById(MANAGER_BUTTON_ID);
    let panel = document.getElementById(MANAGER_PANEL_ID);

    if (!shouldShow) {
      if (button) button.remove();
      if (panel) panel.remove();
      return;
    }

    if (!button) {
      button = document.createElement("button");
      button.id = MANAGER_BUTTON_ID;
      button.className = FLOATING_BUTTON_CLASS;
      button.type = "button";
      button.textContent = "Manage UID\nBlocklist";
      button.title = "View and edit blocked user UIDs";
      button.addEventListener("click", () => {
        const currentPanel = ensureBlocklistManagerPanel();
        currentPanel.hidden = !currentPanel.hidden;
        if (!currentPanel.hidden) {
          refreshBlocklistManagerPanel(currentPanel);
          currentPanel.querySelector(`#${MANAGER_TEXTAREA_ID}`)?.focus();
        }
      });
    }

    appendToPage(button);
    appendToPage(ensureBlocklistManagerPanel());
  }

  function ensureBlocklistManagerPanel() {
    let panel = document.getElementById(MANAGER_PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = MANAGER_PANEL_ID;
    panel.hidden = true;
    panel.innerHTML = `
      <div class="buvb-manager-header">
        <div class="buvb-manager-title">Blocked User UIDs</div>
        <button class="buvb-manager-close" type="button" title="Close">×</button>
      </div>
      ${BOOLEAN_CONTROLS.filter((control) => !control.previewToggle)
        .map(
          (control) =>
            `<label class="buvb-manager-option" for="${control.id}"><input id="${control.id}" type="checkbox" data-setting="${control.name}"><span>${escapeHtml(control.label)}</span></label>`,
        )
        .join("")}
      <div class="buvb-manager-separator" aria-hidden="true">------------------------------------------------</div>
      <textarea id="${MANAGER_TEXTAREA_ID}" spellcheck="false"></textarea>
      <div class="buvb-manager-help"></div>
      <div class="buvb-manager-actions">
        <label class="buvb-manager-preview-toggle" for="${getControl("previewMode").id}">
          <input id="${getControl("previewMode").id}" type="checkbox" data-setting="previewMode">
          <span class="buvb-manager-preview-slider" aria-hidden="true"></span>
          <span>Preview</span>
        </label>
        <button class="buvb-manager-action buvb-manager-action-primary" type="button" data-action="save" disabled>Save</button>
      </div>
    `;

    panel.addEventListener("click", (event) => {
      const target = event.target;
      if (!isElement(target)) return;
      if (target.classList.contains("buvb-manager-close")) panel.hidden = true;
      if (target.getAttribute("data-action") === "save") {
        const textarea = panel.querySelector(`#${MANAGER_TEXTAREA_ID}`);
        if (textarea) replaceBlockedUids(parseBlockedUidText(textarea.value));
      }
    });

    panel.addEventListener("input", (event) => {
      if (event.target && event.target.id === MANAGER_TEXTAREA_ID)
        updateManagerSaveButtonState(panel);
    });

    panel.addEventListener("change", (event) => {
      const target = event.target;
      const name = target && target.getAttribute("data-setting");
      if (!name || !(name in settings)) return;
      setBooleanSetting(name, target.checked);
      refreshBooleanControls(panel);
    });

    refreshBlocklistManagerPanel(panel);
    return panel;
  }

  function refreshBlocklistManagerPanel(
    panel = document.getElementById(MANAGER_PANEL_ID),
  ) {
    if (!panel) return;
    const uids = getBlockedUidList();
    const textarea = panel.querySelector(`#${MANAGER_TEXTAREA_ID}`);
    const help = panel.querySelector(".buvb-manager-help");
    if (textarea) {
      textarea.value = uids.join("\n");
      textarea.dataset.cleanValue = textarea.value;
    }
    if (help)
      help.textContent = `Enter one UID per line. ${uids.length} user(s) have been blocked.`;
    refreshBooleanControls(panel);
    updateManagerSaveButtonState(panel);
  }

  function refreshBooleanControls(
    panel = document.getElementById(MANAGER_PANEL_ID),
  ) {
    if (!panel) return;
    for (const control of BOOLEAN_CONTROLS) {
      const input = panel.querySelector(`#${control.id}`);
      if (input) input.checked = settings[control.name];
    }
  }

  function updateManagerSaveButtonState(panel) {
    const textarea = panel.querySelector(`#${MANAGER_TEXTAREA_ID}`);
    const saveButton = panel.querySelector('[data-action="save"]');
    if (textarea && saveButton)
      saveButton.disabled =
        textarea.value === (textarea.dataset.cleanValue || "");
  }

  function renderUserPageBlockButton() {
    const uid = getCurrentUserPageUid();
    let button = document.getElementById(USER_BUTTON_ID);
    if (!uid) {
      if (button) button.remove();
      return;
    }

    if (!button) {
      button = document.createElement("button");
      button.id = USER_BUTTON_ID;
      button.className = FLOATING_BUTTON_CLASS;
      button.type = "button";
      button.addEventListener("click", () => {
        const currentUid = button.getAttribute("data-uid");
        if (!currentUid) return;
        setUidBlocked(currentUid, !BLOCKED_UIDS.has(currentUid));
        updateUserPageBlockButton(button, currentUid);
      });
    }
    updateUserPageBlockButton(button, uid);
    appendToPage(button);
  }

  function updateUserPageBlockButton(button, uid) {
    const blocked = BLOCKED_UIDS.has(uid);
    button.setAttribute("data-uid", uid);
    button.setAttribute("data-blocked", String(blocked));
    button.textContent = blocked
      ? "Unblock User\nby UID"
      : "Block User\nby UID";
    button.title = `${blocked ? "Unblock" : "Block"} Bilibili user UID ${uid}`;
  }

  function getControl(name) {
    return BOOLEAN_CONTROLS.find((control) => control.name === name);
  }

  function escapeHtml(text) {
    return String(text).replace(
      /[&<>"]/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  }

  function addIfMatches(element, selector, set) {
    if (matches(element, selector)) set.add(element);
  }

  function hasInOrSelf(element, selector) {
    return (
      matches(element, selector) || Boolean(element.querySelector(selector))
    );
  }

  function matches(element, selector) {
    return isElement(element) && element.matches(selector);
  }

  function isElement(value) {
    return value instanceof Element;
  }

  function appendToPage(element) {
    if (!element.isConnected)
      (document.body || document.documentElement).appendChild(element);
  }

  function isUnsafePageContainer(element) {
    return (
      !element ||
      ["HTML", "BODY", "HEAD"].includes(element.tagName) ||
      element === document.documentElement ||
      element === document.body
    );
  }

  function isTooLargeToHide(element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    return (
      (rect.width * rect.height) /
        Math.max(1, window.innerWidth * window.innerHeight) >
      MAX_CARD_AREA_RATIO
    );
  }

  function isCardBlockingPage() {
    return isBlocklistManagerPage() || isDirectVideoPage();
  }

  function isBlocklistManagerPage() {
    return isBilibiliHomePage() || isSearchPage();
  }

  function isBilibiliHomePage() {
    return (
      location.hostname === "www.bilibili.com" && location.pathname === "/"
    );
  }

  function isSearchPage() {
    return location.hostname === "search.bilibili.com";
  }

  function isDirectVideoPage() {
    return (
      location.hostname === "www.bilibili.com" &&
      VIDEO_PATH_RE.test(location.pathname)
    );
  }

  function getCurrentUserPageUid() {
    if (location.hostname !== "space.bilibili.com") return "";
    const match = location.pathname.match(/^\/(\d+)(?:\/|$)/);
    return match ? normalizeUid(match[1]) : "";
  }

  function patchHistory(methodName) {
    const original = history[methodName];
    history[methodName] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      setTimeout(refreshChromeAndScan, 0);
      return result;
    };
  }

  function addStyle() {
    const style = document.createElement("style");
    style.id = "bilibili-uid-video-blocker-style";
    style.textContent = `
      [${BLOCK_ATTR}="true"] { display: none !important; }
      [${PREVIEW_ATTR}="true"] {
        background-color: #ffe8e8 !important;
        outline: 2px solid rgba(251, 114, 153, 0.55) !important;
        outline-offset: -2px;
      }
      [${PREVIEW_ATTR}="true"] * {
        background: transparent !important;
        background-color: transparent !important;
      }
      .${FLOATING_BUTTON_CLASS} {
        position: fixed; top: 72px; right: 24px; z-index: 999999; border: 0;
        border-radius: 18px; padding: 8px 16px; color: #fff; background: #fb7299;
        appearance: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px; font-weight: 700; line-height: 20px; white-space: pre-line;
        text-align: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.18);
      }
      .${FLOATING_BUTTON_CLASS}:hover { background: #fb7299; }
      #${MANAGER_PANEL_ID} {
        position: fixed; top: 124px; right: 24px; z-index: 999999;
        width: min(360px, calc(100vw - 48px)); border: 1px solid rgba(0,0,0,.08);
        border-radius: 14px; padding: 16px; color: #18191c; background: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(0,0,0,.22);
      }
      #${MANAGER_PANEL_ID}[hidden] { display: none !important; }
      #${MANAGER_PANEL_ID} button { font-weight: 700; }
      #${MANAGER_PANEL_ID} .buvb-manager-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      #${MANAGER_PANEL_ID} .buvb-manager-title { font-size: 16px; font-weight: 700; }
      #${MANAGER_PANEL_ID} .buvb-manager-option { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; color: #18191c; font-size: 13px; cursor: pointer; }
      #${MANAGER_PANEL_ID} .buvb-manager-option input { margin: 0; }
      #${MANAGER_PANEL_ID} .buvb-manager-separator { overflow: hidden; width: 100%; margin: 4px 0 12px; color: #c9ccd0; font: 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
      #${MANAGER_TEXTAREA_ID} { box-sizing: border-box; width: 100%; min-height: 160px; border: 1px solid #c9ccd0; border-radius: 10px; padding: 10px; color: #18191c; background: #f6f7f8; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
      #${MANAGER_PANEL_ID} .buvb-manager-help { margin: 8px 0 12px; color: #9499a0; font-size: 12px; }
      #${MANAGER_PANEL_ID} .buvb-manager-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      #${MANAGER_PANEL_ID} .buvb-manager-preview-toggle { display: inline-flex; align-items: center; gap: 8px; color: #61666d; font-size: 13px; font-weight: 700; cursor: pointer; user-select: none; }
      #${MANAGER_PANEL_ID} .buvb-manager-preview-toggle input { position: absolute; opacity: 0; pointer-events: none; }
      #${MANAGER_PANEL_ID} .buvb-manager-preview-slider { position: relative; width: 36px; height: 20px; border-radius: 999px; background: #c9ccd0; transition: background .2s ease; }
      #${MANAGER_PANEL_ID} .buvb-manager-preview-slider::before { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s ease; }
      #${MANAGER_PANEL_ID} .buvb-manager-preview-toggle input:checked + .buvb-manager-preview-slider { background: #fb7299; }
      #${MANAGER_PANEL_ID} .buvb-manager-preview-toggle input:checked + .buvb-manager-preview-slider::before { transform: translateX(16px); }
      #${MANAGER_PANEL_ID} .buvb-manager-action { border: 0; border-radius: 8px; padding: 7px 12px; color: #18191c; background: #e3e5e7; font-size: 13px; cursor: pointer; }
      #${MANAGER_PANEL_ID} .buvb-manager-action-primary { color: #fff; background: #00aeec; }
      #${MANAGER_PANEL_ID} .buvb-manager-action:disabled { color: #9499a0; background: #e3e5e7; cursor: not-allowed; }
      #${MANAGER_PANEL_ID} .buvb-manager-close { border: 0; border-radius: 50%; width: 28px; height: 28px; color: #61666d; background: #f1f2f3; font-size: 18px; line-height: 28px; cursor: pointer; }
    `;

    const append = () => {
      const parent = document.head || document.documentElement;
      if (parent && !document.getElementById(style.id))
        parent.appendChild(style);
    };
    append();
    if (!style.isConnected)
      document.addEventListener("DOMContentLoaded", append, { once: true });
  }
})();
