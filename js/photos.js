/**
 * Photos gallery module.
 *
 * Loads a manifest of filenames from `assets/promo/manifest.json` and
 * renders them:
 * - Desktop / mouse: a plain, sharp-edged grid by default — nothing
 *   overlaps and nothing floats above anything else. The moment you
 *   grab a photo and actually drag it, every photo freezes into place
 *   (exactly where it already was) and becomes freely movable, so from
 *   then on photos can be dragged on top of each other. That layout is
 *   remembered per-browser (localStorage). Click (without dragging)
 *   brings that one photo to the front, full size, over a blurred page.
 * - Phone / narrow screens: a plain vertical list, tap to enlarge, no
 *   dragging.
 *
 * The manifest is a plain JSON array of filenames living inside
 * `assets/promo/`, e.g. ["one.jpg", "two.jpg"]. Regenerate it with
 * `build-photos-manifest.ps1` any time photos are added or removed
 * from that folder — this module never tries to list the folder itself,
 * since static hosting has no directory listing to read.
 */

const MANIFEST_URL = "assets/promo/manifest.json";
const IMAGE_BASE = "assets/promo/";
const STORAGE_KEY = "pjotrgerman.photoLayout.v2";
const MOBILE_QUERY = "(max-width: 720px)";
const DRAG_CLICK_THRESHOLD_PX = 6;

function readStoredLayout() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStoredLayout(layout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage failures (private browsing, quota, etc.)
  }
}

async function loadManifest() {
  const response = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Manifest request failed: ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Manifest is not an array");
  }
  return data.filter((name) => typeof name === "string" && name.trim().length > 0);
}

function isMobileMode() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildLightbox() {
  const overlay = document.createElement("div");
  overlay.className = "photo-lightbox";
  overlay.innerHTML = `
    <div class="photo-lightbox-frame">
      <img class="photo-lightbox-img" alt="" />
      <button type="button" class="photo-lightbox-close" aria-label="Close">&times;</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const img = overlay.querySelector(".photo-lightbox-img");
  const closeBtn = overlay.querySelector(".photo-lightbox-close");

  const close = () => {
    overlay.classList.remove("is-open");
  };

  const open = (src, alt) => {
    img.src = src;
    img.alt = alt || "";
    overlay.classList.add("is-open");
  };

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) {
      close();
    }
  });
  closeBtn.addEventListener("click", close);
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      close();
    }
  });

  return { open, close };
}

/**
 * Freezes every card currently laid out by CSS Grid into an absolutely
 * positioned element pinned to its exact current spot, then switches the
 * stage into free-drag mode. Called the first time any card is dragged.
 */
function freezeStageToFreeMode(stage, cards, layout, persist) {
  if (stage.classList.contains("is-free")) {
    return;
  }

  const stageWidth = stage.clientWidth;
  const stageHeight = stage.clientHeight;

  cards.forEach((card) => {
    const filename = card.dataset.filename;
    const saved = layout[filename];
    const x = saved ? saved.x : card.offsetLeft;
    const y = saved ? saved.y : card.offsetTop;
    const width = saved && saved.w ? saved.w : card.offsetWidth;
    const height = saved && saved.h ? saved.h : card.offsetHeight;

    card.style.width = `${width}px`;
    card.style.height = `${height}px`;
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;

    if (!layout[filename]) {
      layout[filename] = { x, y, w: width, h: height };
    }
  });

  stage.style.height = `${Math.max(stageHeight, 1)}px`;
  stage.style.width = `${stageWidth}px`;
  stage.classList.add("is-free");
  persist();
}

function attachDragging(card, stage, filename, layout, persist, onDragStart) {
  let dragging = false;
  let startPointerX = 0;
  let startPointerY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moved = false;

  card.addEventListener("pointerdown", (ev) => {
    if (ev.button !== undefined && ev.button !== 0) {
      return;
    }
    dragging = true;
    moved = false;
    startPointerX = ev.clientX;
    startPointerY = ev.clientY;
    card.classList.add("is-dragging");
    if (typeof card.setPointerCapture === "function") {
      try {
        card.setPointerCapture(ev.pointerId);
      } catch {
        // Ignore.
      }
    }
  });

  card.addEventListener("pointermove", (ev) => {
    if (!dragging) {
      return;
    }
    const dx = ev.clientX - startPointerX;
    const dy = ev.clientY - startPointerY;
    if (!moved && (Math.abs(dx) > DRAG_CLICK_THRESHOLD_PX || Math.abs(dy) > DRAG_CLICK_THRESHOLD_PX)) {
      moved = true;
      onDragStart();
      startLeft = card.offsetLeft;
      startTop = card.offsetTop;
    }
    if (!moved) {
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const maxX = Math.max(0, stageRect.width - card.offsetWidth);
    const maxY = Math.max(0, stageRect.height - card.offsetHeight);
    const nextLeft = clamp(startLeft + dx, 0, maxX);
    const nextTop = clamp(startTop + dy, 0, maxY);

    card.style.left = `${nextLeft}px`;
    card.style.top = `${nextTop}px`;
  });

  const finishDrag = (ev) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    card.classList.remove("is-dragging");

    if (moved) {
      layout[filename] = {
        x: card.offsetLeft,
        y: card.offsetTop,
        w: card.offsetWidth,
        h: card.offsetHeight
      };
      persist();
    } else if (ev) {
      card.dispatchEvent(new CustomEvent("photo-card-click"));
    }
  };

  card.addEventListener("pointerup", finishDrag);
  card.addEventListener("pointercancel", () => {
    dragging = false;
    card.classList.remove("is-dragging");
  });
}

function renderPhotos(stage, statusEl, toolbar, files) {
  const lightbox = buildLightbox();
  const storedLayout = readStoredLayout();
  let mobile = isMobileMode();

  const draw = () => {
    mobile = isMobileMode();
    stage.innerHTML = "";
    stage.classList.remove("is-free");
    stage.style.height = "";
    stage.style.width = "";
    stage.hidden = false;
    statusEl.hidden = true;
    toolbar.hidden = mobile;

    const hasSavedLayout = !mobile && Object.keys(storedLayout).length > 0;
    const cards = [];

    files.forEach((filename) => {
      const card = document.createElement("figure");
      card.className = "photo-card";
      card.dataset.filename = filename;

      const img = document.createElement("img");
      img.src = IMAGE_BASE + filename;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      img.addEventListener("error", () => {
        console.warn(`Photo failed to load (check filename case/spelling): ${IMAGE_BASE}${filename}`);
        card.remove();
      });
      card.appendChild(img);

      stage.appendChild(card);
      cards.push(card);

      if (!mobile) {
        attachDragging(
          card,
          stage,
          filename,
          storedLayout,
          () => writeStoredLayout(storedLayout),
          () => freezeStageToFreeMode(stage, cards, storedLayout, () => writeStoredLayout(storedLayout))
        );
        card.addEventListener("photo-card-click", () => lightbox.open(img.src, img.alt));
      } else {
        card.addEventListener("click", () => lightbox.open(img.src, img.alt));
      }
    });

    if (hasSavedLayout) {
      // A previous visit already customized the layout — restore it
      // directly instead of waiting for another drag to trigger it.
      requestAnimationFrame(() => {
        freezeStageToFreeMode(stage, cards, storedLayout, () => writeStoredLayout(storedLayout));
      });
    }
  };

  draw();

  const shuffleBtn = toolbar.querySelector("#photos-shuffle");
  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", () => {
      Object.keys(storedLayout).forEach((key) => delete storedLayout[key]);
      writeStoredLayout(storedLayout);
      draw();
    });
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (isMobileMode() !== mobile) {
        draw();
      }
    }, 180);
  });
}

export function initPhotosGallery() {
  const stage = document.getElementById("photos-stage");
  const statusEl = document.getElementById("photos-status");
  const toolbar = document.getElementById("photos-toolbar");
  if (!stage || !statusEl || !toolbar) {
    return;
  }

  loadManifest()
    .then((files) => {
      if (!files.length) {
        statusEl.textContent = "No photos yet — add images to assets/promo/ and run build-photos-manifest.ps1.";
        return;
      }
      renderPhotos(stage, statusEl, toolbar, files);
    })
    .catch((error) => {
      console.warn("Failed to load photos manifest", error);
      statusEl.textContent = "Couldn't load the photo list. Run build-photos-manifest.ps1 after updating assets/promo/.";
    });
}
