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
const userEmail = document.querySelector("[data-user-email]");
const listMessage = document.querySelector("[data-list-message]");

let supabaseClient = null;
let currentSession = null;
let currentRows = [];
let currentFilter = "pending";

function getMessageStatusLabel(status) {
  if (!status) {
    return "Notice";
  }

  return getStatusLabel(status);
}

function showMessage(element, message, options = {}) {
  if (!element) {
    return;
  }

  const status = options.status || "hidden";
  const label = options.label || getMessageStatusLabel(status);

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

function setCurrentFilter(value) {
  currentFilter = value || "pending";

  statusFilterTabs.forEach((tab) => {
    const isActive = tab.dataset.value === currentFilter;
    tab.setAttribute("aria-selected", String(isActive));
  });
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

function renderRows(rows) {
  if (!rows.length) {
    thoughtsList.replaceChildren();
    showMessage(listMessage, getEmptyFilterMessage(currentFilter), {
      status: currentFilter === "all" ? "hidden" : currentFilter,
      label: currentFilter === "all" ? "Notice" : getStatusLabel(currentFilter),
    });
    return;
  }

  clearMessage(listMessage);

  thoughtsList.innerHTML = rows
    .map(
      (row) => {
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

async function fetchThoughts() {
  if (!supabaseClient) {
    return;
  }

  const filter = currentFilter || "pending";
  let query = supabaseClient
    .from("thoughts")
    .select(
      "id, text_original, text_published, status, timestamp_ist, seed, score, reason, suggestion, round, approved_at, hidden_at",
    )
    .order("timestamp_ist", { ascending: false });

  if (filter !== "all") {
    query = query.eq("status", filter);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  currentRows = data || [];
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

  const { error } = await supabaseClient.from("thoughts").update(payload).eq("id", id);

  if (error) {
    throw error;
  }

  await fetchThoughts();
  showMessage(feedMessage, getActionSuccessMessage(id, payload.status), {
    status: payload.status,
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
    clearMessage(feedMessage);
    clearMessage(listMessage);
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
  await fetchThoughts();
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
    loginButton.disabled = true;

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
    }
  });

  logoutButton?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    await handleSession(null);
  });

  statusFilterTabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      const nextFilter = tab.dataset.value || "pending";

      if (nextFilter === currentFilter) {
        return;
      }

      setCurrentFilter(nextFilter);

      try {
        await fetchThoughts();
      } catch (error) {
        console.error("Failed to load filtered thoughts", error);
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

  listMessage?.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-alert-close]");

    if (closeButton) {
      clearMessage(listMessage);
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

    button.disabled = true;

    try {
      await updateThoughtStatus(id, action);
    } catch (error) {
      console.error(`Failed to ${action} ${id}`, error);
      showMessage(feedMessage, `Unable to ${action} this thought right now.`, {
        status: "rejected",
        label: "Error",
      });
    } finally {
      button.disabled = false;
    }
  });

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  setCurrentFilter(currentFilter);
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
