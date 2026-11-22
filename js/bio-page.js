/**
 * Bio / press text page.
 *
 * assets/bio.txt stays the single source. Its plain-text layout is parsed into
 * headings + paragraphs so it prints as a clean PDF:
 *
 *   -------- English --------      -> language block (dashes around a label)
 *   _______________
 *   1. Bio                          -> section heading (line between two rules)
 *   _______________
 *   text lines...                   -> paragraphs, separated by blank lines
 *
 * If the text can't be parsed, it is shown as-is.
 */

import { escapeHtml, initBackLink, initPdfButton } from "./press-page.js";

const BIO_SOURCES = ["assets/bio.txt", "bio.txt"];
const LANG_LABELS = { cs: "Česky", en: "English" };

const isRule = (line) => /^[_\-=~]{3,}$/.test(line);
const languageDivider = (line) => {
  const match = line.match(/^-{2,}\s*(.+?)\s*-{2,}$/);
  return match ? match[1] : null;
};

function decodeBytes(buffer) {
  for (const encoding of ["utf-8", "windows-1250", "iso-8859-2"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      // try next encoding
    }
  }
  return new TextDecoder("utf-8").decode(buffer);
}

async function loadBioText() {
  for (const path of BIO_SOURCES) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) {
        return decodeBytes(await response.arrayBuffer());
      }
    } catch {
      // try next source
    }
  }
  return null;
}

function parseBio(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((line) => line.trim());
  const groups = [];
  let group = { lang: "cs", sections: [] };
  let section = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length && section) {
      section.paragraphs.push(paragraph.join(" "));
    }
    paragraph = [];
  };
  const hasContent = () => group.sections.length > 0;

  const nextNonEmpty = (from) => {
    for (let i = from; i < lines.length; i += 1) {
      if (lines[i]) {
        return lines[i];
      }
    }
    return "";
  };

  let previousNonEmpty = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      flushParagraph();
      continue;
    }

    const divider = isRule(line) ? null : languageDivider(line);
    if (divider) {
      flushParagraph();
      // A divider before any content (e.g. "English below") is only a hint.
      if (hasContent()) {
        groups.push(group);
        group = { lang: /english|angli/i.test(divider) ? "en" : "cs", sections: [] };
        section = null;
      }
    } else if (isRule(line)) {
      flushParagraph();
    } else if (isRule(previousNonEmpty) && isRule(nextNonEmpty(i + 1))) {
      flushParagraph();
      section = { heading: line, paragraphs: [] };
      group.sections.push(section);
    } else {
      if (!section) {
        section = { heading: "", paragraphs: [] };
        group.sections.push(section);
      }
      paragraph.push(line);
    }
    previousNonEmpty = line;
  }
  flushParagraph();
  if (hasContent()) {
    groups.push(group);
  }

  return groups
    .map((g) => ({ ...g, sections: g.sections.filter((s) => s.paragraphs.length) }))
    .filter((g) => g.sections.length);
}

function renderBio(target, groups) {
  target.innerHTML = groups
    .map((group) => `
      <section class="press-section bio-lang" lang="${group.lang}">
        <h2>${escapeHtml(LANG_LABELS[group.lang] || group.lang)}</h2>
        ${group.sections.map((section) => `
          <div class="bio-section">
            ${section.heading ? `<h3>${escapeHtml(section.heading)}</h3>` : ""}
            ${section.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
          </div>`).join("")}
      </section>`)
    .join("");
}

function initLanguageSwitch(availableLangs) {
  const buttons = [...document.querySelectorAll("[data-bio-lang-option]")];
  const switchEl = document.getElementById("bio-lang-switch");
  if (!buttons.length || availableLangs.length < 2) {
    if (switchEl) {
      switchEl.hidden = true;
    }
    return;
  }

  const setLang = (lang) => {
    document.body.dataset.bioLang = lang;
    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.bioLangOption === lang));
    });
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => setLang(button.dataset.bioLangOption));
  });
  setLang("both");
}

async function init() {
  const target = document.getElementById("bio-content");
  if (!target) {
    return;
  }

  const text = await loadBioText();
  if (!text || !text.trim()) {
    target.innerHTML = '<p class="press-status">Bio unavailable.</p>';
    initLanguageSwitch([]);
    return;
  }

  const groups = parseBio(text);
  if (!groups.length) {
    target.innerHTML = `<pre class="bio-raw">${escapeHtml(text.trim())}</pre>`;
    initLanguageSwitch([]);
    return;
  }

  renderBio(target, groups);
  initLanguageSwitch([...new Set(groups.map((g) => g.lang))]);
}

initBackLink();
initPdfButton({
  fileName: () => {
    const lang = document.body.dataset.bioLang;
    return lang && lang !== "both" ? `Petr_Nemec_bio_${lang}` : "Petr_Nemec_bio";
  }
});
init();
