/**
 * CV page.
 *
 * Static parts (statement, education, research ...) live in cv.html.
 * "Selected works & performances" is generated from assets/releases.json
 * using the same rule as the portfolio print: only items with `"cv": true`.
 * To add or remove something from the CV, flip that flag in releases.json
 * (or tick "CV" on admin/releases.html for entries added there).
 */

import { escapeHtml, initBackLink, initPdfButton } from "./press-page.js";
import { fetchAllReleases } from "./releases-source.js";

const RELEASES_URL = "assets/releases.json";
const SITE_URL = "https://pjotrgerman.xyz/";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COUNTRY_CODES = {
  "czech republic": "CZ",
  czechia: "CZ",
  slovakia: "SK",
  germany: "DE",
  austria: "AT",
  poland: "PL"
};
// Roles that say nothing on a CV line.
const HIDDEN_ROLES = new Set(["release-artist", "maker"]);
const ROLE_LABELS = { "ligtht-designer": "light designer" };
const MAX_ROLES = 4;

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parseDate(iso) {
  const match = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dateValue(parts) {
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) : 0;
}

function formatDateRange(start, end) {
  if (!start) {
    return "";
  }
  const startLabel = `${start.day} ${MONTHS[start.month - 1]}`;
  if (!end || dateValue(end) === dateValue(start)) {
    return startLabel;
  }
  if (end.year === start.year && end.month === start.month) {
    return `${start.day}–${end.day} ${MONTHS[end.month - 1]}`;
  }
  return `${startLabel} – ${end.day} ${MONTHS[end.month - 1]}`;
}

function formatPlace(item) {
  const venue = clean(item.venue);
  const city = clean(item.city);
  const country = clean(item.country);
  const parts = [];
  if (venue) {
    parts.push(venue);
  }
  if (city && !venue.toLowerCase().includes(city.toLowerCase())) {
    parts.push(city);
  }
  const place = parts.join(", ");
  const countryLabel = COUNTRY_CODES[country.toLowerCase()] || country;
  if (!countryLabel) {
    return place;
  }
  return place ? `${place} (${countryLabel})` : countryLabel;
}

function formatRoles(item) {
  const authorRole = clean(item.cvAuthorRole);
  if (authorRole) {
    return authorRole;
  }
  const raw = Array.isArray(item.artistRoles)
    ? item.artistRoles
    : typeof item.artistRoles === "string" ? item.artistRoles.split(",") : [];
  const labels = [];
  for (const role of raw) {
    const slug = clean(role).toLowerCase();
    if (!slug || HIDDEN_ROLES.has(slug)) {
      continue;
    }
    const label = ROLE_LABELS[slug] || slug.replace(/-/g, " ");
    if (!labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels.slice(0, MAX_ROLES).join(", ");
}

function formatCollaborators(item) {
  const raw = Array.isArray(item.collaborators) ? item.collaborators : [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        return clean(entry);
      }
      const name = clean(entry && entry.name);
      const role = clean(entry && entry.role);
      return name && role ? `${name} (${role})` : name;
    })
    .filter(Boolean)
    .join(", ");
}

function resolveLink(item) {
  const url = clean(item.links && item.links.primary && item.links.primary.url);
  if (!url) {
    return "";
  }
  try {
    // Absolute links keep working inside the saved PDF.
    return new URL(url, SITE_URL).toString();
  } catch {
    return "";
  }
}

function renderWork(item, todayValue) {
  const start = parseDate(item.date);
  const end = parseDate(item.dateEnd);
  const event = clean(item.event);
  const title = clean(item.title) || event || "Untitled";
  const showEvent = event && event.toLowerCase() !== title.toLowerCase();
  const place = formatPlace(item);
  const format = clean(item.format) || clean(item.type);
  const roles = formatRoles(item);
  const collaborators = formatCollaborators(item);
  const link = resolveLink(item);
  const isUpcoming = dateValue(end || start) >= todayValue;

  const titleHtml = link
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>`
    : escapeHtml(title);
  const whereLine = [showEvent ? event : "", place].filter(Boolean).join(" · ");
  const whatLine = [format, roles].filter(Boolean).join(" — ");

  return `
    <div class="press-row">
      <dt>${escapeHtml(formatDateRange(start, end))}</dt>
      <dd>
        <span class="cv-work-title">${titleHtml}</span>${isUpcoming ? '<span class="cv-badge">upcoming</span>' : ""}
        ${whereLine ? `<span class="press-row-sub">${escapeHtml(whereLine)}</span>` : ""}
        ${whatLine ? `<span class="press-row-note">${escapeHtml(whatLine)}</span>` : ""}
        ${collaborators ? `<span class="press-row-note">w/ ${escapeHtml(collaborators)}</span>` : ""}
      </dd>
    </div>`;
}

function renderWorks(container, items) {
  const now = new Date();
  const todayValue = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const selected = items
    .filter((item) => item && item.cv === true && parseDate(item.date))
    .sort((a, b) => dateValue(parseDate(b.date)) - dateValue(parseDate(a.date)));

  if (!selected.length) {
    container.innerHTML = '<p class="press-status">No CV-selected works yet.</p>';
    return;
  }

  const byYear = new Map();
  for (const item of selected) {
    const year = parseDate(item.date).year;
    if (!byYear.has(year)) {
      byYear.set(year, []);
    }
    byYear.get(year).push(item);
  }

  container.innerHTML = [...byYear.entries()]
    .map(([year, yearItems]) => `
      <h3 class="cv-year">${year}</h3>
      <dl class="press-rows cv-works">${yearItems.map((item) => renderWork(item, todayValue)).join("")}</dl>`)
    .join("");
}

async function loadWorks() {
  const container = document.getElementById("cv-works");
  if (!container) {
    return;
  }
  try {
    const items = await fetchAllReleases(RELEASES_URL);
    renderWorks(container, Array.isArray(items) ? items : []);
  } catch (error) {
    console.warn("CV: failed to load releases", error);
    container.innerHTML = `<p class="press-status">Works list unavailable — see <a href="${SITE_URL}releases.html">all events</a>.</p>`;
  }
}

function initUpdatedLabel() {
  const el = document.getElementById("cv-updated");
  if (!el) {
    return;
  }
  const now = new Date();
  el.textContent = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

initBackLink();
initPdfButton({ fileName: () => `Petr_Nemec_CV_${new Date().getFullYear()}` });
initUpdatedLabel();
loadWorks();
