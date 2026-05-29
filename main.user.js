// ==UserScript==
// @name         Bilibili Video Blocker
// @namespace    https://github.com/mr-yifeiwang/bilibili-video-blocker
// @version      1.1.1
// @description  Hide Bilibili video cards from blocked uploader UIDs
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
  const SCANNED_ATTR = "data-bilibili-uid-scanned";
  const BLOCKLIST_STORAGE_KEY = "bilibili-uid-blocker:blocklist";
  const BLOCK_NEW_USERS_STORAGE_KEY = "bilibili-uid-blocker:block-new-users";
  const USER_BUTTON_ID = "bilibili-uid-blocker-user-button";
  const MANAGER_BUTTON_ID = "bilibili-uid-blocker-manager-button";
  const FLOATING_BUTTON_CLASS = "bilibili-uid-blocker-floating-button";
  const MANAGER_PANEL_ID = "bilibili-uid-blocker-manager-panel";
  const MANAGER_TEXTAREA_ID = "bilibili-uid-blocker-manager-textarea";
  const MANAGER_BLOCK_NEW_USERS_ID = "bilibili-uid-blocker-manager-block-new-users";
  const VIDEO_PATH_RE = /\/video\//i;
  const UID_ATTRS = ["data-usercard-mid", "data-mid", "mid"];
  const MAX_ANCESTOR_STEPS = 8;
  const MAX_CARD_AREA_RATIO = 0.75;
  const RESCAN_INTERVAL_MS = 1500;
  const BLOCKED_UIDS = new Set();
  let BLOCK_NEW_USERS = false;

  const COMMON_CARD_SELECTOR = [
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

  const UPLOADER_CLUE_SELECTOR = [
    'a[href*="space.bilibili.com/"]',
    "[data-usercard-mid]",
    "[data-mid]",
    "[mid]",
  ].join(",");

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

  addBlockingStyle();
  setupBoot();

  function setupBoot() {
    loadSavedBlockedUids();
    loadBlockNewUsersSetting();
    setupBlocklistSync();
    renderUserPageBlockButton();
    renderBlocklistManager();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startScanning, {
        once: true,
      });
    } else {
      startScanning();
    }

    window.addEventListener("pageshow", () => {
      renderUserPageBlockButton();
      renderBlocklistManager();
      scheduleScan(document.documentElement);
    });

    patchHistory("pushState");
    patchHistory("replaceState");
    window.addEventListener("popstate", () => {
      setTimeout(renderUserPageBlockButton, 0);
      setTimeout(renderBlocklistManager, 0);
    });
  }

  function addBlockingStyle() {
    const css = `
      [${BLOCK_ATTR}="true"] {
        display: none !important;
      }

      .${FLOATING_BUTTON_CLASS} {
        position: fixed;
        top: 72px;
        right: 24px;
        z-index: 999999;
        border: 0;
        border-radius: 18px;
        padding: 8px 16px;
        color: #fff;
        background: #fb7299;
        appearance: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        font-weight: 700;
        line-height: 20px;
        white-space: pre-line;
        text-align: center;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
      }

      .${FLOATING_BUTTON_CLASS}:hover {
        background: #fb7299;
      }

      #${MANAGER_PANEL_ID} button {
        font-weight: 700;
      }

      #${MANAGER_PANEL_ID} {
        position: fixed;
        top: 124px;
        right: 24px;
        z-index: 999999;
        width: min(360px, calc(100vw - 48px));
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 14px;
        padding: 16px;
        color: #18191c;
        background: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
      }

      #${MANAGER_PANEL_ID}[hidden] {
        display: none !important;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-title {
        font-size: 16px;
        font-weight: 700;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-count {
        margin-bottom: 10px;
        color: #61666d;
        font-size: 13px;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-option {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        color: #18191c;
        font-size: 13px;
        cursor: pointer;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-option input {
        margin: 0;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-separator {
        overflow: hidden;
        width: 100%;
        margin: 4px 0 12px;
        color: #c9ccd0;
        font: 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: nowrap;
      }

      #${MANAGER_TEXTAREA_ID} {
        box-sizing: border-box;
        width: 100%;
        min-height: 160px;
        border: 1px solid #c9ccd0;
        border-radius: 10px;
        padding: 10px;
        color: #18191c;
        background: #f6f7f8;
        font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        resize: vertical;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-help {
        margin: 8px 0 12px;
        color: #9499a0;
        font-size: 12px;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-action {
        border: 0;
        border-radius: 8px;
        padding: 7px 12px;
        color: #18191c;
        background: #e3e5e7;
        font-size: 13px;
        cursor: pointer;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-action-primary {
        color: #fff;
        background: #00aeec;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-action:disabled {
        color: #9499a0;
        background: #e3e5e7;
        cursor: not-allowed;
      }

      #${MANAGER_PANEL_ID} .buvb-manager-close {
        border: 0;
        border-radius: 50%;
        width: 28px;
        height: 28px;
        color: #61666d;
        background: #f1f2f3;
        font-size: 18px;
        line-height: 28px;
        cursor: pointer;
      }
    `;

    const style = document.createElement("style");
    style.id = "bilibili-uid-video-blocker-style";
    style.textContent = css;

    const append = () => {
      const parent = document.head || document.documentElement;
      if (parent && !document.getElementById(style.id)) {
        parent.appendChild(style);
      }
    };

    append();
    if (!style.isConnected) {
      document.addEventListener("DOMContentLoaded", append, { once: true });
    }
  }

  function startScanning() {
    if (isCardBlockingPage()) scan(document.documentElement);
    renderUserPageBlockButton();
    renderBlocklistManager();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            scheduleScan(node);
          }
        } else if (mutation.type === "attributes") {
          scheduleScan(mutation.target);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", ...UID_ATTRS, "class", "title", "alt"],
    });

    setInterval(() => {
      if (isCardBlockingPage()) scan(document.documentElement, true);
    }, RESCAN_INTERVAL_MS);
  }

  let scheduled = false;
  const pendingRoots = new Set();

  function scheduleScan(root) {
    if (!isCardBlockingPage()) return;
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

    pendingRoots.add(root);
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      for (const pendingRoot of roots) {
        scan(pendingRoot);
      }
    });
  }

  function scan(root, force = false) {
    if (!isCardBlockingPage()) return;
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

    const elements = collectUploaderCandidates(root);
    for (const element of elements) {
      if (!force && element.getAttribute(SCANNED_ATTR) === "true") continue;
      element.setAttribute(SCANNED_ATTR, "true");

      const uid = getBlockedUidFromElement(element);
      if (!uid) continue;

      const card = findVideoCardAncestor(element);
      if (card) {
        hideCard(card, uid);
      }
    }

    scanCardsByEmbeddedBlockedUid(root, force);
  }

  function collectUploaderCandidates(root) {
    const candidates = new Set();
    if (matchesSafely(root, UPLOADER_CLUE_SELECTOR)) candidates.add(root);
    for (const element of root.querySelectorAll(UPLOADER_CLUE_SELECTOR)) {
      candidates.add(element);
    }
    return candidates;
  }

  function scanCardsByEmbeddedBlockedUid(root, force) {
    const cards = new Set();
    if (isPotentialVideoCard(root)) cards.add(root);

    for (const card of root.querySelectorAll(COMMON_CARD_SELECTOR)) {
      if (isPotentialVideoCard(card)) cards.add(card);
    }

    for (const card of cards) {
      if (!force && card.getAttribute(SCANNED_ATTR) === "card") continue;
      card.setAttribute(SCANNED_ATTR, "card");

      const uid = getBlockedUidInside(card);
      if (uid) hideCard(card, uid);
    }
  }

  function getBlockedUidInside(container) {
    const candidates = collectUploaderCandidates(container);
    for (const candidate of candidates) {
      const uid = getBlockedUidFromElement(candidate);
      if (uid) return uid;
    }
    return "";
  }

  function getBlockedUidFromElement(element) {
    const uids = getUploaderUidsFromElement(element);
    return uids.find(isUidBlocked) || "";
  }

  function isUidBlocked(uid) {
    return BLOCKED_UIDS.has(uid) || (BLOCK_NEW_USERS && isNewUserUid(uid));
  }

  function isNewUserUid(uid) {
    return /^\d{16}$/.test(uid);
  }

  function getUploaderUidsFromElement(element) {
    const uids = new Set();

    if (element instanceof HTMLAnchorElement) {
      addUidFromHref(element.getAttribute("href"), uids);
    }

    for (const attr of UID_ATTRS) {
      addUid(element.getAttribute(attr), uids);
    }

    if (element.dataset) {
      addUid(element.dataset.usercardMid, uids);
      addUid(element.dataset.mid, uids);
    }

    return [...uids];
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
    if (value == null) return "";
    const match = String(value).trim().match(/^\d+$/);
    return match ? match[0] : "";
  }

  function findVideoCardAncestor(start) {
    let best = null;
    let current = start;

    for (
      let depth = 0;
      current && depth <= MAX_ANCESTOR_STEPS;
      depth += 1, current = current.parentElement
    ) {
      if (isUnsafePageContainer(current)) break;

      if (
        matchesSafely(current, COMMON_CARD_SELECTOR) &&
        isPotentialVideoCard(current)
      ) {
        return current;
      }

      if (isPotentialVideoCard(current) && !isTooLargeToHide(current)) {
        best = current;
      }
    }

    return best;
  }

  function isPotentialVideoCard(element) {
    if (!element || isUnsafePageContainer(element)) return false;

    const hasVideoLink =
      Boolean(element.querySelector(VIDEO_LINK_SELECTOR)) ||
      matchesSafely(element, VIDEO_LINK_SELECTOR);
    if (!hasVideoLink) return false;

    if (matchesSafely(element, COMMON_CARD_SELECTOR)) return true;

    const hasVisualClue = Boolean(
      element.querySelector(
        'img, picture, svg, [class*="cover"], [class*="thumb"], [class*="pic"]',
      ),
    );
    const hasTitleClue = Boolean(
      element.querySelector(
        '[title], h1, h2, h3, [class*="title"], [class*="Title"]',
      ),
    );
    const hasUploaderClue =
      Boolean(element.querySelector(UPLOADER_CLUE_SELECTOR)) ||
      matchesSafely(element, UPLOADER_CLUE_SELECTOR);

    return hasUploaderClue && (hasVisualClue || hasTitleClue);
  }

  function hideCard(card, uid) {
    const target = getCardHideTarget(card);

    if (
      !target ||
      isUnsafePageContainer(target) ||
      isTooLargeToHide(target) ||
      isDirectVideoOwnerCard(target, uid) ||
      containsMultipleVideos(target)
    ) {
      return;
    }

    target.setAttribute(BLOCK_ATTR, "true");
    target.setAttribute("data-bilibili-uid-blocked-uid", uid);
  }

  function getCardHideTarget(card) {
    if (!card) return null;

    const cardContainer = card.closest(
      RECOMMENDATION_CARD_CONTAINER_SELECTOR,
    );
    if (isSafeCardHideTarget(cardContainer)) return cardContainer;

    return card;
  }

  function isSafeCardHideTarget(element) {
    return (
      element &&
      !isUnsafePageContainer(element) &&
      !isTooLargeToHide(element) &&
      isPotentialVideoCard(element) &&
      !containsMultipleVideos(element)
    );
  }

  function isDirectVideoOwnerCard(card, uid) {
    if (!uid || !isDirectVideoPage()) return false;
    if (uid !== findDirectPageUploaderUid()) return false;
    return (
      !matchesSafely(card, RECOMMENDATION_AREA_SELECTOR) &&
      !isInsideRecommendationArea(card)
    );
  }

  function isInsideRecommendationArea(element) {
    return Boolean(element && element.closest(RECOMMENDATION_AREA_SELECTOR));
  }

  function containsMultipleVideos(element) {
    return getUniqueVideoHrefs(element).length > 1;
  }

  function getUniqueVideoHrefs(element) {
    const hrefs = new Set();
    const links = [];
    if (matchesSafely(element, VIDEO_LINK_SELECTOR)) links.push(element);
    links.push(...element.querySelectorAll(VIDEO_LINK_SELECTOR));

    for (const link of links) {
      const href = normalizeVideoHref(link.getAttribute("href"));
      if (href) hrefs.add(href);
    }

    return [...hrefs];
  }

  function normalizeVideoHref(href) {
    if (!href) return "";

    try {
      return new URL(href, location.href).pathname.replace(/\/$/, "");
    } catch (_error) {
      return href.split(/[?#]/)[0].replace(/\/$/, "");
    }
  }

  function unhideCardsForUid(uid) {
    for (const card of document.querySelectorAll(
      `[data-bilibili-uid-blocked-uid="${uid}"]`,
    )) {
      card.removeAttribute(BLOCK_ATTR);
      card.removeAttribute("data-bilibili-uid-blocked-uid");
      card.removeAttribute(SCANNED_ATTR);
    }
  }

  function loadSavedBlockedUids() {
    replaceRuntimeBlockedUids(readSavedBlockedUids() || []);
  }

  function loadBlockNewUsersSetting() {
    BLOCK_NEW_USERS = readBlockNewUsersSetting();
  }

  function setupBlocklistSync() {
    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(
        BLOCKLIST_STORAGE_KEY,
        (_key, _oldValue, newValue, remote) => {
          if (!remote) return;
          syncBlockedUidsFromSavedValue(newValue);
        },
      );
      GM_addValueChangeListener(
        BLOCK_NEW_USERS_STORAGE_KEY,
        (_key, _oldValue, newValue, remote) => {
          if (!remote) return;
          syncBlockNewUsersFromSavedValue(newValue);
        },
      );
      return;
    }

    window.addEventListener("storage", (event) => {
      if (event.key === BLOCKLIST_STORAGE_KEY) {
        syncBlockedUidsFromSavedValue(event.newValue);
      } else if (event.key === BLOCK_NEW_USERS_STORAGE_KEY) {
        syncBlockNewUsersFromSavedValue(event.newValue);
      }
    });
  }

  function syncBlockedUidsFromSavedValue(savedValue) {
    const savedUids = parseSavedBlockedUids(savedValue);
    if (!savedUids) return;

    replaceRuntimeBlockedUids(savedUids);
    scan(document.documentElement, true);
    refreshBlocklistManagerPanel();
    const button = document.getElementById(USER_BUTTON_ID);
    const uid = button && button.getAttribute("data-uid");
    if (button && uid) {
      updateUserPageBlockButton(button, uid);
    }
  }

  function syncBlockNewUsersFromSavedValue(savedValue) {
    BLOCK_NEW_USERS = parseSavedBlockNewUsersSetting(savedValue);
    refreshBlockedCards();
    refreshBlockNewUsersControl();
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

  function readBlockNewUsersSetting() {
    try {
      const saved =
        typeof GM_getValue === "function"
          ? GM_getValue(BLOCK_NEW_USERS_STORAGE_KEY, false)
          : localStorage.getItem(BLOCK_NEW_USERS_STORAGE_KEY);
      return parseSavedBlockNewUsersSetting(saved);
    } catch (_error) {
      return false;
    }
  }

  function parseSavedBlockNewUsersSetting(saved) {
    if (saved === true || saved === "true") return true;
    if (saved === false || saved == null || saved === "false") return false;

    try {
      return JSON.parse(saved) === true;
    } catch (_error) {
      return false;
    }
  }

  function parseSavedBlockedUids(saved) {
    if (saved == null) return null;

    try {
      const parsed = typeof saved === "string" ? JSON.parse(saved) : saved;
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeUid).filter(Boolean);
    } catch (_error) {
      return [];
    }
  }

  function replaceRuntimeBlockedUids(nextUids) {
    const nextUidSet = new Set(nextUids.map(normalizeUid).filter(Boolean));
    for (const uid of [...BLOCKED_UIDS]) {
      if (!nextUidSet.has(uid)) {
        BLOCKED_UIDS.delete(uid);
        unhideCardsForUid(uid);
      }
    }

    for (const uid of nextUidSet) {
      BLOCKED_UIDS.add(uid);
    }
  }

  function saveBlockedUids() {
    try {
      const saved = JSON.stringify([...BLOCKED_UIDS]);
      if (typeof GM_setValue === "function") {
        GM_setValue(BLOCKLIST_STORAGE_KEY, saved);
      } else {
        localStorage.setItem(BLOCKLIST_STORAGE_KEY, saved);
      }
    } catch (_error) {
      // Ignore storage failures so blocking still works until reload.
    }
  }

  function saveBlockNewUsersSetting() {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(BLOCK_NEW_USERS_STORAGE_KEY, BLOCK_NEW_USERS);
      } else {
        localStorage.setItem(BLOCK_NEW_USERS_STORAGE_KEY, String(BLOCK_NEW_USERS));
      }
    } catch (_error) {
      // Ignore storage failures so blocking still works until reload.
    }
  }

  function setBlockNewUsersSetting(blocked) {
    BLOCK_NEW_USERS = Boolean(blocked);
    saveBlockNewUsersSetting();
    refreshBlockedCards();
  }

  function refreshBlockedCards() {
    for (const card of document.querySelectorAll(`[${BLOCK_ATTR}="true"]`)) {
      card.removeAttribute(BLOCK_ATTR);
      card.removeAttribute("data-bilibili-uid-blocked-uid");
      card.removeAttribute(SCANNED_ATTR);
    }

    scan(document.documentElement, true);
  }

  function getBlockedUidList() {
    return [...BLOCKED_UIDS].sort(compareNumericUidStrings);
  }

  function compareNumericUidStrings(a, b) {
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  }

  function parseBlockedUidText(text) {
    return [...new Set(text.split(/\r?\n/).map(normalizeUid).filter(Boolean))];
  }

  function replaceBlockedUids(nextUids) {
    const nextUidSet = new Set(nextUids.map(normalizeUid).filter(Boolean));
    for (const uid of [...BLOCKED_UIDS]) {
      if (!nextUidSet.has(uid)) {
        BLOCKED_UIDS.delete(uid);
        unhideCardsForUid(uid);
      }
    }

    for (const uid of nextUidSet) {
      BLOCKED_UIDS.add(uid);
    }

    saveBlockedUids();
    scan(document.documentElement, true);
    refreshBlocklistManagerPanel();
  }

  function setUidBlocked(uid, blocked) {
    replaceRuntimeBlockedUids(readSavedBlockedUids() || []);

    if (blocked) {
      BLOCKED_UIDS.add(uid);
    } else {
      BLOCKED_UIDS.delete(uid);
      unhideCardsForUid(uid);
    }

    saveBlockedUids();
    scan(document.documentElement, true);
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
          refreshBlocklistManagerPanel();
          const textarea = document.getElementById(MANAGER_TEXTAREA_ID);
          if (textarea) textarea.focus();
        }
      });
    }

    if (!button.isConnected) {
      (document.body || document.documentElement).appendChild(button);
    }

    panel = ensureBlocklistManagerPanel();
    if (!panel.isConnected) {
      (document.body || document.documentElement).appendChild(panel);
    }
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
      <label class="buvb-manager-option" for="${MANAGER_BLOCK_NEW_USERS_ID}">
        <input id="${MANAGER_BLOCK_NEW_USERS_ID}" type="checkbox">
        <span>Block new users (after 2022-08-30)</span>
      </label>
      <div class="buvb-manager-separator" aria-hidden="true">------------------------------------------------</div>
      <textarea id="${MANAGER_TEXTAREA_ID}" spellcheck="false"></textarea>
      <div class="buvb-manager-help"></div>
      <div class="buvb-manager-actions">
        <button class="buvb-manager-action buvb-manager-action-primary" type="button" data-action="save" disabled>Save</button>
      </div>
    `;

    panel.addEventListener("click", (event) => {
      const action = event.target && event.target.getAttribute("data-action");
      if (
        event.target &&
        event.target.classList.contains("buvb-manager-close")
      ) {
        panel.hidden = true;
        return;
      }
      if (!action) return;

      const textarea = document.getElementById(MANAGER_TEXTAREA_ID);
      if (!textarea) return;

      if (action === "save") {
        replaceBlockedUids(parseBlockedUidText(textarea.value));
      }
    });

    panel.addEventListener("input", (event) => {
      if (event.target && event.target.id === MANAGER_TEXTAREA_ID) {
        updateManagerSaveButtonState(panel);
      }
    });

    panel.addEventListener("change", (event) => {
      if (event.target && event.target.id === MANAGER_BLOCK_NEW_USERS_ID) {
        setBlockNewUsersSetting(event.target.checked);
      }
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
    refreshBlockNewUsersControl(panel);
    updateManagerSaveButtonState(panel);
    if (help) {
      help.textContent = `Enter one UID per line. ${uids.length} user(s) have been blocked.`;
    }
  }

  function updateManagerSaveButtonState(panel) {
    const textarea = panel.querySelector(`#${MANAGER_TEXTAREA_ID}`);
    const saveButton = panel.querySelector('[data-action="save"]');
    if (!textarea || !saveButton) return;

    saveButton.disabled = textarea.value === (textarea.dataset.cleanValue || "");
  }

  function refreshBlockNewUsersControl(
    panel = document.getElementById(MANAGER_PANEL_ID),
  ) {
    if (!panel) return;

    const blockNewUsers = panel.querySelector(`#${MANAGER_BLOCK_NEW_USERS_ID}`);
    if (blockNewUsers) blockNewUsers.checked = BLOCK_NEW_USERS;
  }

  function isBlocklistManagerPage() {
    return isBilibiliHomePage() || isSearchPage();
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

        replaceRuntimeBlockedUids(readSavedBlockedUids() || []);
        setUidBlocked(currentUid, !BLOCKED_UIDS.has(currentUid));
        updateUserPageBlockButton(button, currentUid);
      });
    }

    updateUserPageBlockButton(button, uid);
    if (!button.isConnected) {
      (document.body || document.documentElement).appendChild(button);
    }
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

  function getCurrentUserPageUid() {
    if (location.hostname !== "space.bilibili.com") return "";
    const match = location.pathname.match(/^\/(\d+)(?:\/|$)/);
    return match ? normalizeUid(match[1]) : "";
  }

  function isCardBlockingPage() {
    return isBlocklistManagerPage() || isDirectVideoPage();
  }

  function isBilibiliHomePage() {
    return (
      location.hostname === "www.bilibili.com" && location.pathname === "/"
    );
  }

  function isSearchPage() {
    return location.hostname === "search.bilibili.com";
  }

  function isUnsafePageContainer(element) {
    if (!element) return true;
    const tagName = element.tagName;
    if (tagName === "HTML" || tagName === "BODY" || tagName === "HEAD")
      return true;
    if (element === document.documentElement || element === document.body)
      return true;
    return false;
  }

  function isTooLargeToHide(element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const elementArea = rect.width * rect.height;
    return elementArea / viewportArea > MAX_CARD_AREA_RATIO;
  }

  function matchesSafely(element, selector) {
    return element instanceof Element && element.matches(selector);
  }

  function isDirectVideoPage() {
    return (
      location.hostname === "www.bilibili.com" &&
      VIDEO_PATH_RE.test(location.pathname)
    );
  }

  function findDirectPageUploaderUid() {
    const fromInitialState = findUidInInitialState();
    if (fromInitialState) return fromInitialState;

    if (!document.documentElement) return "";

    const ownerLink = document.querySelector(VIDEO_OWNER_SELECTOR);
    if (ownerLink && !isInsideRecommendationArea(ownerLink)) {
      const uids = getUploaderUidsFromElement(ownerLink);
      if (uids[0]) return uids[0];
    }

    const spaceLink = document.querySelector('a[href*="space.bilibili.com/"]');
    if (spaceLink && !isInsideRecommendationArea(spaceLink)) {
      const uids = getUploaderUidsFromElement(spaceLink);
      if (uids[0]) return uids[0];
    }

    return "";
  }

  function findUidInInitialState() {
    const scripts = document.scripts || [];
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text.includes("owner") && !text.includes("mid")) continue;

      const ownerMid = text.match(/"owner"\s*:\s*\{[^}]*"mid"\s*:\s*(\d+)/);
      if (ownerMid) return ownerMid[1];

      const upMid = text.match(/"upData"\s*:\s*\{[^}]*"mid"\s*:\s*(\d+)/);
      if (upMid) return upMid[1];
    }

    return "";
  }

  function patchHistory(methodName) {
    const original = history[methodName];
    history[methodName] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      setTimeout(renderUserPageBlockButton, 0);
      setTimeout(renderBlocklistManager, 0);
      setTimeout(() => scheduleScan(document.documentElement), 0);
      return result;
    };
  }
})();
