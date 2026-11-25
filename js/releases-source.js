/**
 * Where releases come from.
 *
 * 1. `assets/releases.json` in the repo (the main archive, edited by hand).
 * 2. `releases/` in the Firebase Realtime Database (cellular-live project), added from the
 *    hidden admin page `admin/releases.html` (sign in with Google, phone friendly).
 *    Its "merge" button commits them into releases.json on GitHub; once that deploy is live
 *    the admin page removes them from the database.
 *
 * The database is read through its REST endpoint (no SDK, one small request). If it is slow or
 * down, the page just shows the repo entries. Database entries are appended after the repo ones,
 * so the `?focus=<index>` links of repo entries stay the same; database entries get
 * `releaseKey = "fb-<id>"`.
 */

import { FIREBASE_CONFIG } from "./firebase-config.js";

export const STATIC_RELEASES_URL = "assets/releases.json";
export const REMOTE_RELEASES_PATH = "releases";
const REMOTE_TIMEOUT_MS = 3500;

/** Turn RTDB values back into the shape releases.json uses (RTDB drops empty arrays and may
 *  return arrays as {0: .., 1: ..} objects). */
export function normalizeRemoteRelease(id, raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const toArray = (value) => {
    if (Array.isArray(value)) return value.filter((v) => v != null);
    if (value && typeof value === "object") return Object.values(value).filter((v) => v != null);
    return [];
  };
  const item = { ...raw };
  delete item._meta;
  item.artistRoles = toArray(raw.artistRoles);
  item.collaborators = toArray(raw.collaborators);
  if (raw.links && typeof raw.links === "object") {
    item.links = {
      primary: raw.links.primary && raw.links.primary.url ? raw.links.primary : null,
      secondary: toArray(raw.links.secondary)
    };
  } else {
    item.links = { primary: null, secondary: [] };
  }
  if (!("dateEnd" in item)) item.dateEnd = null;
  item.releaseKey = `fb-${id}`;
  item._remoteId = id;
  return item;
}

export async function fetchStaticReleases(url = STATIC_RELEASES_URL) {
  const resp = await fetch(url, { cache: "no-store" });
  const text = resp.ok ? await resp.text() : "";
  const cleaned = text.replace(/^﻿/, "");
  const items = cleaned ? JSON.parse(cleaned) : [];
  return Array.isArray(items) ? items : [];
}

export async function fetchRemoteReleases() {
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL) {
    return [];
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS) : null;
  try {
    const base = FIREBASE_CONFIG.databaseURL.replace(/\/$/, "");
    const resp = await fetch(`${base}/${REMOTE_RELEASES_PATH}.json`, {
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    });
    if (!resp.ok) {
      return [];
    }
    const data = await resp.json();
    if (!data || typeof data !== "object") {
      return [];
    }
    return Object.entries(data)
      .map(([id, raw]) => normalizeRemoteRelease(id, raw))
      .filter((item) => item && item.hidden !== true);
  } catch (error) {
    console.warn("releases: database entries unavailable", error);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Repo entries first (index order), then database entries that aren't merged into the file yet
 *  (merged entries carry `"firebaseId"` in releases.json; see releases-merge.js). */
export async function fetchAllReleases(staticUrl = STATIC_RELEASES_URL) {
  const [staticItems, remoteItems] = await Promise.all([
    fetchStaticReleases(staticUrl),
    fetchRemoteReleases()
  ]);
  const inFile = new Set(staticItems.map((item) => item && item.firebaseId).filter(Boolean));
  return [...staticItems, ...remoteItems.filter((item) => !inFile.has(item._remoteId))];
}
