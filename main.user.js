// ==UserScript==
// @name         Bilibili Video Blocker
// @namespace    https://github.com/mr-yifeiwang/bilibili-video-blocker
// @version      1.0.0
// @description  Hide Bilibili video cards from blocked uploader UIDs and confirm before watching blocked uploader videos
// @author       mr-yifeiwang
// @match        https://www.bilibili.com/*
// @match        https://search.bilibili.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  /**
   * Add/remove uploader UIDs here
   */
  const BLOCKED_UIDS = new Set([]);

  const BLOCK_ATTR = "data-bilibili-uid-blocked";
  const SCANNED_ATTR = "data-bilibili-uid-scanned";
  const ALLOW_STORAGE_PREFIX = "bilibili-uid-blocker:allow:";
  const VIDEO_PATH_RE = /\/(video|bangumi\/play)\//i;
  const UID_ATTRS = ["data-usercard-mid", "data-mid", "mid"];
  const MAX_ANCESTOR_STEPS = 8;
  const MAX_CARD_AREA_RATIO = 0.75;
  const RESCAN_INTERVAL_MS = 1500;

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

  addBlockingStyle();
  setupBoot();

  function setupBoot() {
    checkDirectVideoPage();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startScanning, {
        once: true,
      });
    } else {
      startScanning();
    }

    window.addEventListener("pageshow", () => {
      checkDirectVideoPage();
      scheduleScan(document.documentElement);
    });

    patchHistory("pushState");
    patchHistory("replaceState");
    window.addEventListener("popstate", () =>
      setTimeout(checkDirectVideoPage, 0),
    );
  }

  function addBlockingStyle() {
    const css = `
      [${BLOCK_ATTR}="true"] {
        display: none !important;
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
    scan(document.documentElement);

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

    setInterval(() => scan(document.documentElement, true), RESCAN_INTERVAL_MS);
  }

  let scheduled = false;
  const pendingRoots = new Set();

  function scheduleScan(root) {
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
    return uids.find((uid) => BLOCKED_UIDS.has(uid)) || "";
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
    if (!card || isUnsafePageContainer(card) || isTooLargeToHide(card)) return;

    card.setAttribute(BLOCK_ATTR, "true");
    card.setAttribute("data-bilibili-uid-blocked-uid", uid);
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

  function checkDirectVideoPage() {
    if (!isDirectVideoPage()) return;

    const allowKey = ALLOW_STORAGE_PREFIX + location.pathname;
    if (sessionStorage.getItem(allowKey) === "true") return;

    const uid = findDirectPageUploaderUid();
    if (!uid || !BLOCKED_UIDS.has(uid)) return;

    const ok = window.confirm(
      `This Bilibili video is from blocked uploader UID ${uid}. Do you want to continue watching it?`,
    );
    if (ok) {
      sessionStorage.setItem(allowKey, "true");
      return;
    }

    leaveBlockedVideoPage();
  }

  function isDirectVideoPage() {
    return VIDEO_PATH_RE.test(location.pathname);
  }

  function findDirectPageUploaderUid() {
    const fromInitialState = findUidInInitialState();
    if (fromInitialState) return fromInitialState;

    if (!document.documentElement) return "";

    const uid = getBlockedUidInside(document.documentElement);
    if (uid) return uid;

    const spaceLink = document.querySelector('a[href*="space.bilibili.com/"]');
    if (spaceLink) {
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

  function leaveBlockedVideoPage() {
    if (history.length > 1) {
      history.back();
      setTimeout(() => {
        if (isDirectVideoPage()) location.assign("https://www.bilibili.com/");
      }, 800);
      return;
    }

    location.assign("https://www.bilibili.com/");
  }

  function patchHistory(methodName) {
    const original = history[methodName];
    history[methodName] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      setTimeout(checkDirectVideoPage, 0);
      setTimeout(() => scheduleScan(document.documentElement), 0);
      return result;
    };
  }
})();
