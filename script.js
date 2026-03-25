const colors = [
  "#1f2421",
  "#216869",
  "#49a078",
  "#9cc5a1",
  "#dce1de",
];

const cardStyles = {
  "#1f2421": {
    background: "#1f2421",
    foreground: "#f7f5ef",
    date: "#d7d2c8",
  },
  "#216869": {
    background: "#216869",
    foreground: "#f7f5ef",
    date: "#d7ebe6",
  },
  "#49a078": {
    background: "#49a078",
    foreground: "#0c1f1f",
    date: "#123030",
  },
  "#9cc5a1": {
    background: "#9cc5a1",
    foreground: "#102020",
    date: "#173030",
  },
  "#dce1de": {
    background: "#dce1de",
    foreground: "#1f2421",
    date: "#2f3933",
  },
};

const grid = document.querySelector("[data-grid]");
const statusPanel = document.querySelector("[data-status]");
const template = document.querySelector("#thought-card-template");
const main = document.querySelector("main");
const toast = document.querySelector("[data-toast]");
const thoughtModalOverlay = document.querySelector("[data-thought-modal]");
const thoughtModal = thoughtModalOverlay?.querySelector(".thought-modal");
const thoughtModalCloseButton = thoughtModalOverlay?.querySelector(".thought-modal-close");
const thoughtModalText = thoughtModalOverlay?.querySelector(".thought-modal-text");
const thoughtModalDate = thoughtModalOverlay?.querySelector(".thought-modal-date");
const thoughtModalLink = thoughtModalOverlay?.querySelector(".thought-modal-link");
const siteUrlMeta = document.querySelector('meta[name="site-url"]');
const canonicalSiteUrl = siteUrlMeta?.content || window.location.origin || window.location.href;
let activeShareMenu = null;
let toastTimeoutId = null;
let renderedThoughts = [];
let htmlToImageLoader = null;

function setStatus(message) {
  statusPanel.hidden = false;
  statusPanel.textContent = message;
}

function clearStatus() {
  statusPanel.hidden = true;
  statusPanel.textContent = "";
}

function showToast(message) {
  if (!toast) {
    return;
  }

  toast.hidden = false;
  toast.textContent = message;

  window.clearTimeout(toastTimeoutId);
  toastTimeoutId = window.setTimeout(() => {
    toast.hidden = true;
    toast.textContent = "";
  }, 2200);
}

function formatDate(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function hashString(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function loadHtmlToImage() {
  if (window.htmlToImage) {
    return Promise.resolve(window.htmlToImage);
  }

  if (htmlToImageLoader) {
    return htmlToImageLoader;
  }

  htmlToImageLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./assets/vendor/html-to-image.min.js";
    script.async = true;
    script.onload = () => resolve(window.htmlToImage);
    script.onerror = () => reject(new Error("Failed to load export library"));
    document.head.appendChild(script);
  });

  return htmlToImageLoader;
}

function getShareOptions(menu) {
  return Array.from(menu.querySelectorAll(".share-option"));
}

function closeShareMenu(menu, { restoreFocus = false } = {}) {
  if (!menu) {
    return;
  }

  const trigger = menu.parentElement?.querySelector(".card-share");
  menu.hidden = true;
  trigger?.setAttribute("aria-expanded", "false");

  if (restoreFocus && trigger instanceof HTMLButtonElement) {
    trigger.focus();
  }

  if (activeShareMenu === menu) {
    activeShareMenu = null;
  }
}

function openShareMenu(menu) {
  if (activeShareMenu && activeShareMenu !== menu) {
    closeShareMenu(activeShareMenu);
  }

  const trigger = menu.parentElement?.querySelector(".card-share");
  menu.hidden = false;
  trigger?.setAttribute("aria-expanded", "true");
  activeShareMenu = menu;

  const [firstOption] = getShareOptions(menu);
  firstOption?.focus();
}

function buildThoughtUrl(thoughtId) {
  const base = new URL(canonicalSiteUrl, window.location.href);
  base.hash = thoughtId;
  return base.toString();
}

function buildSharePayload(button) {
  const card = button.closest(".thought-card");
  const text = card?.querySelector(".thought-text")?.textContent?.trim() ?? "";
  const thoughtId = card?.dataset.thoughtId || "";
  const url = buildThoughtUrl(thoughtId);

  return {
    text,
    url,
    message: `${text}\n\n${url}`,
  };
}

function openShareWindow(url) {
  const popup = window.open(url, "_blank", "noopener,noreferrer");

  if (!popup) {
    throw new Error("Popup blocked");
  }
}

function highlightThoughtCard(card) {
  card.classList.add("is-highlighted");
  window.setTimeout(() => {
    card.classList.remove("is-highlighted");
  }, 2200);
}

function getThoughtById(thoughtId) {
  return renderedThoughts.find((thought) => thought.id === thoughtId) || null;
}

function closeThoughtModal({ clearHash = true } = {}) {
  if (!thoughtModalOverlay) {
    return;
  }

  thoughtModalOverlay.hidden = true;
  document.body.style.overflow = "";

  if (clearHash && window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

function openThoughtModal(thought) {
  if (!thoughtModalOverlay || !thoughtModal || !thoughtModalText || !thoughtModalDate || !thoughtModalLink) {
    return;
  }

  const color = colors[hashString(thought.id) % colors.length];
  const style = cardStyles[color] ?? {
    background: color,
    foreground: "#1f1d1a",
    date: "#4f5a53",
  };

  thoughtModal.style.setProperty("--modal-bg", style.background);
  thoughtModal.style.setProperty("--modal-fg", style.foreground);
  thoughtModal.style.setProperty("--modal-date-fg", style.date);

  thoughtModalText.textContent = thought.text;
  thoughtModalDate.textContent = formatDate(thought.timestamp);
  thoughtModalDate.dateTime = thought.timestamp;
  thoughtModalLink.href = buildThoughtUrl(thought.id);

  thoughtModalOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  thoughtModalCloseButton?.focus();
}

function syncThoughtModalWithHash() {
  const hash = window.location.hash.replace(/^#/, "");

  if (!hash) {
    closeThoughtModal({ clearHash: false });
    return;
  }

  const thought = getThoughtById(hash);

  if (!thought) {
    return;
  }

  openThoughtModal(thought);
}

async function shareThought(platform, button) {
  const payload = buildSharePayload(button);
  const text = encodeURIComponent(payload.message);
  const subject = encodeURIComponent("Thought");
  const url = encodeURIComponent(payload.url);

  switch (platform) {
    case "whatsapp":
      openShareWindow(`https://wa.me/?text=${text}`);
      break;
    case "x":
      openShareWindow(`https://twitter.com/intent/tweet?text=${text}`);
      break;
    case "threads":
      openShareWindow(`https://www.threads.net/intent/post?text=${text}`);
      break;
    case "copy-link":
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard not available");
      }

      await navigator.clipboard.writeText(payload.url);
      showToast("Link copied.");
      break;
    case "linkedin":
      openShareWindow(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`);
      break;
    case "email":
      window.location.href = `mailto:?subject=${subject}&body=${text}`;
      break;
    default:
      break;
  }
}

async function exportThoughtCard(button) {
  const card = button.closest(".thought-card");

  if (!card) {
    return;
  }

  const filenameBase = button.dataset.filename || "thought";

  card.classList.add("is-exporting");
  button.disabled = true;

  try {
    const htmlToImage = await loadHtmlToImage();
    await document.fonts.ready;

    const dataUrl = await htmlToImage.toPng(card, {
      pixelRatio: Math.max(2, window.devicePixelRatio || 1),
      cacheBust: true,
      filter: (node) => {
        if (!(node instanceof HTMLElement)) {
          return true;
        }

        return !node.classList.contains("card-download");
      },
    });

    downloadDataUrl(dataUrl, `${filenameBase}.png`);
    showToast("PNG downloaded.");
  } catch (error) {
    console.error("Unable to export thought card", error);
    showToast("Unable to download the PNG right now.");
  } finally {
    button.disabled = false;
    card.classList.remove("is-exporting");
  }
}

function renderThoughts(thoughts) {
  renderedThoughts = thoughts;
  const fragment = document.createDocumentFragment();

  thoughts.forEach((thought) => {
    const card = template.content.firstElementChild.cloneNode(true);
    const text = card.querySelector(".thought-text");
    const date = card.querySelector(".thought-date");
    const button = card.querySelector(".card-download");
    const shareButton = card.querySelector(".card-share");
    const shareMenu = card.querySelector(".share-menu");
    const color = colors[hashString(thought.id) % colors.length];
    const style = cardStyles[color] ?? {
      background: color,
      foreground: "#1f1d1a",
      date: "#4f5a53",
    };

    card.id = `thought-${thought.id}`;
    card.dataset.thoughtId = thought.id;
    card.style.setProperty("--card-bg", style.background);
    card.style.setProperty("--card-fg", style.foreground);
    card.style.setProperty("--card-date-fg", style.date);

    text.textContent = thought.text;
    date.textContent = formatDate(thought.timestamp);
    date.dateTime = thought.timestamp;
    button.dataset.filename = `thought-${thought.id}`;

    if (shareButton instanceof HTMLButtonElement) {
      shareButton.dataset.thoughtId = thought.id;
      shareButton.setAttribute("aria-controls", `share-menu-${thought.id}`);
    }

    if (shareMenu instanceof HTMLElement) {
      shareMenu.id = `share-menu-${thought.id}`;
    }

    fragment.appendChild(card);
  });

  grid.replaceChildren(fragment);
  syncThoughtModalWithHash();
}

function isValidThought(thought) {
  return (
    thought &&
    typeof thought.id === "string" &&
    typeof thought.text === "string" &&
    typeof thought.timestamp === "string"
  );
}

grid.addEventListener("click", (event) => {
  const button = event.target.closest(".card-download");
  const shareTrigger = event.target.closest(".card-share");
  const shareOption = event.target.closest(".share-option");

  if (shareTrigger instanceof HTMLButtonElement) {
    const menu = shareTrigger.parentElement?.querySelector(".share-menu");

    if (menu instanceof HTMLElement) {
      if (menu.hidden) {
        openShareMenu(menu);
      } else {
        closeShareMenu(menu, { restoreFocus: true });
      }
    }

    return;
  }

  if (shareOption instanceof HTMLButtonElement) {
    const platform = shareOption.dataset.platform;
    const menu = shareOption.closest(".share-menu");
    const trigger = menu?.parentElement?.querySelector(".card-share");

    closeShareMenu(menu);

    if (platform && trigger instanceof HTMLButtonElement) {
      shareThought(platform, trigger).catch((error) => {
        console.error(`Unable to share to ${platform}`, error);
        showToast(`Unable to open ${platform} sharing right now.`);
      });
    }

    return;
  }

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  exportThoughtCard(button);
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Node) || !activeShareMenu) {
    return;
  }

  if (!activeShareMenu.contains(event.target)) {
    const trigger = activeShareMenu.parentElement?.querySelector(".card-share");

    if (!trigger?.contains(event.target)) {
      closeShareMenu(activeShareMenu);
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !thoughtModalOverlay?.hidden) {
    closeThoughtModal();
    return;
  }

  if (event.key === "Escape" && activeShareMenu) {
    closeShareMenu(activeShareMenu, { restoreFocus: true });
    return;
  }

  if (!activeShareMenu) {
    return;
  }

  const options = getShareOptions(activeShareMenu);
  const currentIndex = options.findIndex((option) => option === document.activeElement);

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % options.length : 0;
    options[nextIndex]?.focus();
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    const nextIndex =
      currentIndex >= 0 ? (currentIndex - 1 + options.length) % options.length : options.length - 1;
    options[nextIndex]?.focus();
  }

  if (event.key === "Home") {
    event.preventDefault();
    options[0]?.focus();
  }

  if (event.key === "End") {
    event.preventDefault();
    options[options.length - 1]?.focus();
  }

  if (event.key === "Tab") {
    closeShareMenu(activeShareMenu);
  }
});

window.addEventListener("hashchange", () => {
  syncThoughtModalWithHash();
});

thoughtModalOverlay?.addEventListener("click", (event) => {
  if (event.target === thoughtModalOverlay) {
    closeThoughtModal();
  }
});

thoughtModalCloseButton?.addEventListener("click", () => {
  closeThoughtModal();
});

async function loadThoughts() {
  setStatus("Loading thoughts...");

  try {
    const response = await fetch(`./data/thoughts.json?t=${Date.now()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();

    if (!payload || !Array.isArray(payload.thoughts)) {
      throw new Error("Payload is missing a valid thoughts array");
    }

    const thoughts = payload.thoughts.filter(isValidThought);

    if (thoughts.length === 0) {
      grid.replaceChildren();
      setStatus("No thoughts yet.");
      return;
    }

    clearStatus();
    renderThoughts(thoughts);
  } catch (error) {
    console.error("Unable to load thoughts", error);
    grid.replaceChildren();
    setStatus("Unable to load thoughts right now.");
  } finally {
    main.setAttribute("aria-busy", "false");
  }
}

loadThoughts();
