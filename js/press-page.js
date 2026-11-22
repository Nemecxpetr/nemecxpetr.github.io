/**
 * Shared helpers for the simple press pages (cv.html, bio.html).
 *
 * "Download pdf" works like the portfolio print: it opens the browser's
 * print dialog and the page's @media print rules turn it into a clean A4
 * document. The document title is swapped while printing so "Save as PDF"
 * suggests a sensible file name (e.g. Petr_Nemec_CV_2026.pdf).
 */

export function initPdfButton({ fileName } = {}) {
  const buttons = document.querySelectorAll("[data-print-pdf]");
  if (!buttons.length) {
    return;
  }

  const originalTitle = document.title;
  const pdfTitle = typeof fileName === "function" ? fileName : () => fileName || originalTitle;

  window.addEventListener("beforeprint", () => {
    document.title = pdfTitle();
  });
  window.addEventListener("afterprint", () => {
    document.title = originalTitle;
  });

  buttons.forEach((button) => {
    button.addEventListener("click", () => window.print());
  });
}

/**
 * Press pages open in a new tab from the portfolio, so "Back" closes the tab
 * and falls back to navigating home when the tab can't be closed.
 */
export function initBackLink() {
  document.querySelectorAll("[data-close-tab]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (window.history.length > 1) {
        return;
      }
      event.preventDefault();
      window.close();
      window.setTimeout(() => {
        window.location.href = link.getAttribute("href") || "index.html";
      }, 120);
    });
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
