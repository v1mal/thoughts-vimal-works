const adminConfig = window.THOUGHTS_ADMIN_CONFIG || {};
const setupMessage = document.querySelector("[data-setup-message]");
const runtimeMessage = document.querySelector("[data-runtime-message]");
const feedMessage = document.querySelector("[data-feed-message]");
const authPanel = document.querySelector("[data-auth-panel]");
const adminApp = document.querySelector("[data-admin-app]");
const loginButton = document.querySelector("[data-login-button]");
const logoutButton = document.querySelector("[data-logout-button]");
const statusFilterTabs = Array.from(document.querySelectorAll("[data-status-filter-tab]"));
const thoughtsList = document.querySelector("[data-thoughts-list]");
const queueTitle = document.querySelector("[data-queue-title]");
const queueSection = document.querySelector("[data-queue-section]");
const refreshQueueButton = document.querySelector("[data-refresh-queue]");
const userEmail = document.querySelector("[data-user-email]");
const listMessage = document.querySelector("[data-list-message]");
const publicSummary = document.querySelector("[data-public-summary]");

let supabaseClient = null;
let currentSession = null;
let currentRows = [];
let currentFilter = "pending";
const inFlightThoughtIds = new Set();
const REQUEST_TIMEOUT_MS = 12000;
const COUNTS_CACHE_TTL_MS = 30000;
let thoughtsRequestSequence = 0;
let countsFetchedAt = 0;
const rowsCache = new Map();
let currentCounts = {
  pending: 0,
  approved: 0,
  rejected: 0,
  hidden: 0,
  all: 0,
};

function withTimeout(promise, ms, message) {
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  });
}

function cloneRows(rows = []) {
  return rows.map((row) => ({ ...row }));
}

function showMessage(element, message, options = {}) {
  if (!element) {
    return;
  }

  const status = options.status || "hidden";
  const label = options.label || (status ? getStatusLabel(status) : "Notice");

  element.hidden = false;
  element.dataset.status = status;
  element.innerHTML = `
    <div class="ui-alert-main">
      <p class="ui-alert-label">${label}</p>
      <p class="ui-alert-text">${message}</p>
    </div>
    <button class="ui-alert-close" type="button" aria-label="Dismiss message" data-alert-close>&times;</button>
  `;
}

function clearMessage(element) {
  if (!element) {
    return;
  }

  element.hidden = true;
  delete element.dataset.status;
  element.innerHTML = "";
}

function showLoadingMessage(element, message) {
  showMessage(element, message, {
    status: "hidden",
    label: "Loading",
  });
}

function getQueueHeading(filter, count) {
  const total = Number.isFinite(count) ? count : 0;

  if (filter === "all") {
    return `All Thoughts (${total})`;
  }

  const label = getStatusLabel(filter);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} Queue (${total})`;
}

function updateQueueTitle(count) {
  if (!queueTitle) {
    return;
  }

  queueTitle.textContent = getQueueHeading(currentFilter, count);
}

function showQueueState(message, state = "empty") {
  if (!listMessage) {
    return;
  }

  listMessage.hidden = false;
  listMessage.dataset.state = state;
  listMessage.innerHTML = `<p class="ui-queue-empty-copy">${message}</p>`;
}

function clearQueueState() {
  if (!listMessage) {
    return;
  }

  listMessage.hidden = true;
  delete listMessage.dataset.state;
  listMessage.innerHTML = "";
}


function isConfigured() {
  return (
    adminConfig.supabaseUrl &&
    adminConfig.supabaseAnonKey &&
    !adminConfig.supabaseUrl.includes("REPLACE_WITH") &&
    !adminConfig.supabaseAnonKey.includes("REPLACE_WITH")
  );
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeTime(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, "day");
}

async function fetchPublicSummary() {
  if (!publicSummary) {
    return;
  }

  try {
    const response = await fetch("./data/thoughts.json", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Unexpected response: ${response.status}`);
    }

    const payload = await response.json();
    const thoughts = Array.isArray(payload?.thoughts) ? payload.thoughts : [];

    if (!thoughts.length) {
      publicSummary.hidden = true;
      publicSummary.innerHTML = "";
      return;
    }

    const latestTimestamp = thoughts[0]?.timestamp;
    const relative = formatRelativeTime(latestTimestamp);

    if (!relative) {
      publicSummary.hidden = false;
      publicSummary.innerHTML = `<span class="workspace-banner-summary-strong">${thoughts.length} items live on public site</span>`;
      return;
    }

    publicSummary.hidden = false;
    publicSummary.innerHTML = `
      <span class="workspace-banner-summary-prefix">Latest published thought</span>
      <span class="workspace-banner-summary-strong">${relative} — ${thoughts.length} items</span>
      <span class="workspace-banner-summary-suffix">live on public site</span>
    `;
  } catch (error) {
    console.error("Failed to load public summary", error);
    publicSummary.hidden = true;
    publicSummary.innerHTML = "";
  }
}

function getThoughtText(row) {
  return row.text_published || row.text_original || "";
}

function renderMeta(label, value) {
  return `
    <div class="ui-meta-item">
      <span class="ui-meta-label">${label}</span>
      <span class="ui-meta-value">${value || "—"}</span>
    </div>
  `;
}

function getStatusLabel(status) {
  return status;
}

function getActionSuccessMessage(id, status) {
  if (status === "approved") {
    return `Thought ID: ${id} is approved.`;
  }

  if (status === "rejected") {
    return `Thought ID: ${id} is rejected.`;
  }

  if (status === "hidden") {
    return `Thought ID: ${id} is hidden.`;
  }

  if (status === "pending") {
    return `Thought ID: ${id} is restored to pending.`;
  }

  return `Thought ID: ${id} is updated.`;
}

function getEmptyFilterMessage(filter) {
  if (filter === "pending") {
    return "No new thoughts are pending review.";
  }

  if (filter === "approved") {
    return "No approved thoughts are available right now.";
  }

  if (filter === "rejected") {
    return "No rejected thoughts are available right now.";
  }

  if (filter === "hidden") {
    return "No hidden thoughts are available right now.";
  }

  return "No thoughts are available right now.";
}

function getCurrentFilterCount() {
  if (currentFilter === "all") {
    return currentCounts.all || 0;
  }

  return currentCounts[currentFilter] || 0;
}

function setCurrentFilter(value) {
  currentFilter = value || "pending";

  statusFilterTabs.forEach((tab) => {
    const isActive = tab.dataset.value === currentFilter;
    tab.setAttribute("aria-selected", String(isActive));
  });
}

function updateStatusCounts(counts = currentCounts) {
  const previousCounts = { ...currentCounts };

  currentCounts = {
    pending: counts.pending || 0,
    approved: counts.approved || 0,
    rejected: counts.rejected || 0,
    hidden: counts.hidden || 0,
    all: counts.all || 0,
  };

  statusFilterTabs.forEach((tab) => {
    const value = tab.dataset.value || "all";
    const countElement = tab.querySelector("[data-status-count]");

    if (countElement) {
      const nextCount = currentCounts[value] ?? 0;
      countElement.textContent = String(nextCount);

      if ((previousCounts[value] ?? 0) !== nextCount) {
        countElement.dataset.updated = "true";
        window.setTimeout(() => {
          if (countElement.dataset.updated === "true") {
            delete countElement.dataset.updated;
          }
        }, 280);
      }
    }
  });
}

function cacheRows(filter, rows) {
  rowsCache.set(filter || "pending", cloneRows(rows || []));
}

function getCachedRows(filter) {
  const cached = rowsCache.get(filter || "pending");
  return cached ? cloneRows(cached) : null;
}

function hasFreshCounts() {
  return Date.now() - countsFetchedAt < COUNTS_CACHE_TTL_MS;
}

function recalculateCountsFromCache() {
  const allRows = getCachedRows("all");

  if (!allRows) {
    return false;
  }

  const nextCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    hidden: 0,
    all: allRows.length,
  };

  allRows.forEach((row) => {
    if (row.status && Object.hasOwn(nextCounts, row.status)) {
      nextCounts[row.status] += 1;
    }
  });

  countsFetchedAt = Date.now();
  updateStatusCounts(nextCounts);
  return true;
}

function setThoughtBusy(card, isBusy) {
  if (!card) {
    return;
  }

  card.dataset.busy = isBusy ? "true" : "false";

  card.querySelectorAll("[data-action]").forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.disabled = isBusy;
    }
  });
}

function applyOptimisticStatusChange(id, nextStatus) {
  const row = currentRows.find((item) => item.id === id);

  if (!row) {
    return;
  }

  const previousStatus = row.status;

  if (previousStatus && Object.hasOwn(currentCounts, previousStatus)) {
    currentCounts[previousStatus] = Math.max(0, (currentCounts[previousStatus] || 0) - 1);
  }

  if (nextStatus && Object.hasOwn(currentCounts, nextStatus)) {
    currentCounts[nextStatus] = (currentCounts[nextStatus] || 0) + 1;
  }

  row.status = nextStatus;
  rowsCache.delete("all");
  rowsCache.delete(previousStatus);
  rowsCache.delete(nextStatus);
  updateStatusCounts(currentCounts);

  if (currentFilter === "all" || currentFilter === nextStatus) {
    renderRows(currentRows);
    return;
  }

  currentRows = currentRows.filter((item) => item.id !== id);
  renderRows(currentRows);
}

function getActionClass(tone) {
  if (tone === "approve") {
    return "ui-button ui-button--primary";
  }

  if (tone === "reject") {
    return "ui-button ui-button--danger";
  }

  if (tone === "hide") {
    return "ui-button ui-button--outline";
  }

  return "ui-button ui-button--muted";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderExpandableText(value) {
  const text = (value || "—").trim() || "—";

  if (text === "—" || text.length <= 158) {
    return `<span class="ui-section-copy-text">${escapeHtml(text)}</span>`;
  }

  const preview = `${text.slice(0, 158)}…`;

  return `
    <span class="ui-section-copy-text" data-collapsed-text>${escapeHtml(preview)}</span>
    <span class="ui-section-copy-text" data-expanded-text hidden>${escapeHtml(text)}</span>
    <button class="ui-inline-link" type="button" data-expand-copy aria-expanded="false">Read more</button>
  `;
}

function renderActions(row) {
  const actions = [];

  if (row.status !== "approved") {
    actions.push(
      `<button class="${getActionClass("approve")}" type="button" data-action="approve" data-id="${row.id}" data-tone="approve">Approve</button>`,
    );
  }

  if (row.status !== "rejected") {
    actions.push(
      `<button class="${getActionClass("reject")}" type="button" data-action="reject" data-id="${row.id}" data-tone="reject">Reject</button>`,
    );
  }

  if (row.status !== "hidden") {
    actions.push(
      `<button class="${getActionClass("hide")}" type="button" data-action="hide" data-id="${row.id}" data-tone="hide">Hide</button>`,
    );
  }

  if (row.status !== "pending") {
    actions.push(
      `<button class="${getActionClass("default")} ui-action-restore" type="button" data-action="restore" data-id="${row.id}">Restore to pending</button>`,
    );
  }

  return actions.join("");
}

function renderCompactMeta(row) {
  const parts = [
    formatDate(row.timestamp_ist),
    row.seed ? `Seed: ${escapeHtml(row.seed)}` : "",
    row.status !== "rejected" && row.round != null ? `Round: ${escapeHtml(String(row.round))}` : "",
    `ID: ${escapeHtml(row.id)}`,
  ].filter(Boolean);

  return parts.map((part) => `<span class="ui-compact-meta-part">${part}</span>`).join("");
}

function renderRows(rows) {
  updateQueueTitle(rows.length);

  if (!rows.length) {
    thoughtsList.replaceChildren();
    showQueueState(getEmptyFilterMessage(currentFilter));
    return;
  }

  clearQueueState();

  thoughtsList.innerHTML = rows
    .map(
      (row) => {
        const isCompact = currentFilter === "all";

        if (isCompact) {
          return `
        <article class="ui-thought-card ui-thought-card--compact" data-status="${row.status}">
          <div class="ui-thought-top">
            <div class="ui-thought-top-left">
              <span class="ui-badge" data-status="${row.status}">${getStatusLabel(row.status)}</span>
              <span class="ui-score-pill">${row.score != null ? `${row.score}/10` : "—"}</span>
            </div>
          </div>

          <p class="ui-thought-text ui-thought-text--compact">${getThoughtText(row)}</p>

          <div class="ui-compact-meta-row">
            ${renderCompactMeta(row)}
          </div>

          <div class="ui-actions ui-actions--compact">
            ${renderActions(row)}
          </div>
        </article>
      `;
        }

        const sections = [
          `
            <div class="ui-section">
              <span class="ui-label">Reason</span>
              <div class="ui-section-copy">${renderExpandableText(row.reason)}</div>
            </div>
          `,
        ];

        if (row.status !== "approved") {
          sections.push(`
            <div class="ui-section">
              <span class="ui-label">Suggestion</span>
              <div class="ui-section-copy">${renderExpandableText(row.suggestion)}</div>
            </div>
          `);
        }

        const sectionsClass =
          sections.length === 1 ? "ui-sections ui-sections--single" : "ui-sections";

        return `
        <article class="ui-thought-card" data-status="${row.status}">
          <div class="ui-thought-top">
            <div class="ui-thought-top-left">
              <span class="ui-badge" data-status="${row.status}">${getStatusLabel(row.status)}</span>
              <span class="ui-score-pill">${row.score != null ? `${row.score}/10` : "—"}</span>
            </div>
            <span class="ui-thought-id">ID: ${row.id}</span>
          </div>

          <p class="ui-thought-text">${getThoughtText(row)}</p>

          <div class="ui-meta-row">
            ${renderMeta("Timestamp", formatDate(row.timestamp_ist))}
            ${row.status !== "rejected" ? renderMeta("Round", row.round != null ? String(row.round) : "") : ""}
            ${renderMeta("Seed", row.seed)}
          </div>

          <div class="${sectionsClass}">
            ${sections.join("")}
          </div>

          <div class="ui-actions">
            ${renderActions(row)}
          </div>
        </article>
      `;
      },
    )
    .join("");
}

async function fetchThoughts(filterOverride = currentFilter) {
  if (!supabaseClient) {
    return;
  }

  const filter = filterOverride || "pending";
  const requestId = ++thoughtsRequestSequence;
  const needsCounts = !hasFreshCounts();
  let query = supabaseClient
    .from("thoughts")
    .select(
      "id, text_original, text_published, status, timestamp_ist, seed, score, reason, suggestion, round, approved_at, hidden_at",
    )
    .order("timestamp_ist", { ascending: false });

  if (filter !== "all") {
    query = query.eq("status", filter);
  }

  const requests = [query];

  if (needsCounts) {
    requests.push(supabaseClient.from("thoughts").select("status"));
  }

  const [rowsResult, countsResult] = await withTimeout(
    Promise.all(requests),
    REQUEST_TIMEOUT_MS,
    "The dashboard took too long to refresh.",
  );

  if (requestId !== thoughtsRequestSequence) {
    return;
  }

  const { data, error } = rowsResult;

  if (error) {
    throw error;
  }

  currentRows = data || [];
  cacheRows(filter, currentRows);

  if (needsCounts) {
    const { data: countRows, error: countsError } = countsResult || {};

    if (countsError) {
      throw countsError;
    }

    const nextCounts = {
      pending: 0,
      approved: 0,
      rejected: 0,
      hidden: 0,
      all: 0,
    };

    (countRows || []).forEach((row) => {
      const status = row.status;

      if (status && Object.hasOwn(nextCounts, status)) {
        nextCounts[status] += 1;
      }

      nextCounts.all += 1;
    });

    countsFetchedAt = Date.now();
    updateStatusCounts(nextCounts);
  } else if (!hasFreshCounts()) {
    recalculateCountsFromCache();
  }

  renderRows(currentRows);
}

async function updateThoughtStatus(id, action) {
  const row = currentRows.find((item) => item.id === id);

  if (!row || !supabaseClient || !currentSession?.user?.email) {
    return;
  }

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (action === "approve") {
    payload.status = "approved";
    payload.approved_at = new Date().toISOString();
    payload.approved_by_email = currentSession.user.email;
    payload.hidden_at = null;
  }

  if (action === "reject") {
    payload.status = "rejected";
    payload.hidden_at = null;
  }

  if (action === "hide") {
    payload.status = "hidden";
    payload.hidden_at = new Date().toISOString();
  }

  if (action === "restore") {
    payload.status = "pending";
    payload.hidden_at = null;
  }

  const { error } = await withTimeout(
    supabaseClient.from("thoughts").update(payload).eq("id", id),
    REQUEST_TIMEOUT_MS,
    "The moderation update took too long to complete.",
  );

  if (error) {
    throw error;
  }

  applyOptimisticStatusChange(id, payload.status);
  showMessage(feedMessage, getActionSuccessMessage(id, payload.status), {
    status: payload.status,
  });

  void fetchThoughts().catch((refreshError) => {
    console.error("Failed to refresh thoughts after moderation action", refreshError);
    showMessage(feedMessage, "Thought updated, but the dashboard did not fully refresh. Try changing the filter or refreshing the page.", {
      status: payload.status,
      label: getStatusLabel(payload.status),
    });
  });
}

async function handleSession(session) {
  currentSession = session;
  clearMessage(runtimeMessage);

  const email = session?.user?.email || "";

  if (!session) {
    authPanel.hidden = false;
    adminApp.hidden = true;
    userEmail.textContent = "";
    thoughtsList.replaceChildren();
    rowsCache.clear();
    countsFetchedAt = 0;
    clearMessage(feedMessage);
    clearQueueState();
    updateQueueTitle(0);
    return;
  }

  if (email !== adminConfig.allowedEmail) {
    await supabaseClient.auth.signOut();
    showMessage(runtimeMessage, "This Google account is not allowed to access the admin.", {
      status: "rejected",
      label: "Error",
    });
    authPanel.hidden = false;
    adminApp.hidden = true;
    return;
  }

  authPanel.hidden = true;
  adminApp.hidden = false;
  userEmail.textContent = email;
  await fetchPublicSummary();
  await fetchThoughts(currentFilter);
}

async function signIn() {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });

  if (error) {
    throw error;
  }
}

async function boot() {
  if (!isConfigured()) {
    showMessage(
      setupMessage,
      "Edit assets/js/admin-config.js with your project URL, publishable key, and allowed email before using this page.",
    );
    authPanel.hidden = true;
    return;
  }

  if (!window.supabase?.createClient) {
    showMessage(setupMessage, "Unable to load the Supabase client library.");
    authPanel.hidden = true;
    return;
  }

  supabaseClient = window.supabase.createClient(
    adminConfig.supabaseUrl,
    adminConfig.supabaseAnonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );

  loginButton?.addEventListener("click", async () => {
    const originalText = loginButton.textContent;
    loginButton.disabled = true;
    loginButton.textContent = "Continuing…";

    try {
      await signIn();
    } catch (error) {
      console.error("Failed to start Google sign-in", error);
      showMessage(runtimeMessage, "Unable to start Google sign-in right now.", {
        status: "rejected",
        label: "Error",
      });
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = originalText;
    }
  });

  logoutButton?.addEventListener("click", async () => {
    const originalText = logoutButton.textContent;

    if (logoutButton instanceof HTMLButtonElement) {
      logoutButton.disabled = true;
      logoutButton.textContent = "Signing out…";
    }

    try {
      await withTimeout(
        supabaseClient.auth.signOut(),
        REQUEST_TIMEOUT_MS,
        "Sign out took too long to complete.",
      );
      await handleSession(null);
    } catch (error) {
      console.error("Failed to sign out", error);
      showMessage(feedMessage, "Unable to sign out right now. Please try again.", {
        status: "rejected",
        label: "Error",
      });
    } finally {
      if (logoutButton instanceof HTMLButtonElement) {
        logoutButton.disabled = false;
        logoutButton.textContent = originalText;
      }
    }
  });

  statusFilterTabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      const nextFilter = tab.dataset.value || "pending";
      const previousFilter = currentFilter;

      if (nextFilter === currentFilter) {
        return;
      }

      setCurrentFilter(nextFilter);
      const cachedRows = getCachedRows(nextFilter);

      if (cachedRows) {
        currentRows = cachedRows;
        renderRows(currentRows);
      } else {
        thoughtsList.replaceChildren();
        updateQueueTitle(getCurrentFilterCount());
        showQueueState(`Loading ${nextFilter} thoughts…`, "loading");
      }

      try {
        await fetchThoughts(nextFilter);
      } catch (error) {
        console.error("Failed to load filtered thoughts", error);
        setCurrentFilter(previousFilter);
        showMessage(feedMessage, "Unable to load this filter right now.", {
          status: "rejected",
          label: "Error",
        });
      }
    });
  });

  feedMessage?.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-alert-close]");

    if (closeButton) {
      clearMessage(feedMessage);
    }
  });

  refreshQueueButton?.addEventListener("click", async () => {
    const originalText = refreshQueueButton.textContent;

    if (refreshQueueButton instanceof HTMLButtonElement) {
      refreshQueueButton.disabled = true;
      refreshQueueButton.textContent = "Refreshing…";
    }

    thoughtsList?.replaceChildren();
    rowsCache.delete(currentFilter);
    rowsCache.delete("all");
    countsFetchedAt = 0;
    updateQueueTitle(getCurrentFilterCount());
    showQueueState(`Loading ${currentFilter} thoughts…`, "loading");

    try {
      await fetchThoughts(currentFilter);
    } catch (error) {
      console.error("Failed to refresh queue", error);
      showMessage(feedMessage, "Unable to refresh the queue right now.", {
        status: "rejected",
        label: "Error",
      });
    } finally {
      if (refreshQueueButton instanceof HTMLButtonElement) {
        refreshQueueButton.disabled = false;
        refreshQueueButton.textContent = originalText;
      }
    }
  });

  thoughtsList?.addEventListener("click", async (event) => {
    const expandButton = event.target.closest("[data-expand-copy]");

    if (expandButton instanceof HTMLButtonElement) {
      const sectionCopy = expandButton.closest(".ui-section-copy");

      if (!sectionCopy) {
        return;
      }

      const collapsedText = sectionCopy.querySelector("[data-collapsed-text]");
      const expandedText = sectionCopy.querySelector("[data-expanded-text]");
      const isExpanded = expandButton.getAttribute("aria-expanded") === "true";

      if (collapsedText && expandedText) {
        collapsedText.hidden = !isExpanded;
        expandedText.hidden = isExpanded;
        expandButton.setAttribute("aria-expanded", String(!isExpanded));
        expandButton.textContent = isExpanded ? "Read more" : "Show less";
      }

      return;
    }

    const button = event.target.closest("[data-action]");

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const { action, id } = button.dataset;

    if (!action || !id) {
      return;
    }

    const card = button.closest(".ui-thought-card");

    if (inFlightThoughtIds.has(id)) {
      return;
    }

    inFlightThoughtIds.add(id);
    setThoughtBusy(card, true);

    try {
      await updateThoughtStatus(id, action);
    } catch (error) {
      console.error(`Failed to ${action} ${id}`, error);
      showMessage(feedMessage, `Unable to ${action} this thought right now.`, {
        status: "rejected",
        label: "Error",
      });
    } finally {
      inFlightThoughtIds.delete(id);
      setThoughtBusy(card, false);
    }
  });

  const {
    data: { session },
  } = await withTimeout(
    supabaseClient.auth.getSession(),
    REQUEST_TIMEOUT_MS,
    "Checking your session took too long.",
  );

  setCurrentFilter(currentFilter);
  updateQueueTitle(getCurrentFilterCount());

  if (session) {
    showQueueState(`Loading ${currentFilter} thoughts…`, "loading");
  }

  await handleSession(session);

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    await handleSession(session);
  });
}

boot().catch((error) => {
  console.error("Failed to boot admin page", error);
  showMessage(runtimeMessage, "Unable to load the admin right now.", {
    status: "rejected",
    label: "Error",
  });
});
