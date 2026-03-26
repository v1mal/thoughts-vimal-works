const adminConfig = window.THOUGHTS_ADMIN_CONFIG || {};
const setupMessage = document.querySelector("[data-setup-message]");
const runtimeMessage = document.querySelector("[data-runtime-message]");
const authPanel = document.querySelector("[data-auth-panel]");
const adminApp = document.querySelector("[data-admin-app]");
const loginButton = document.querySelector("[data-login-button]");
const logoutButton = document.querySelector("[data-logout-button]");
const refreshButton = document.querySelector("[data-refresh-button]");
const statusFilter = document.querySelector("[data-status-filter]");
const thoughtsList = document.querySelector("[data-thoughts-list]");
const userEmail = document.querySelector("[data-user-email]");
const listMessage = document.querySelector("[data-list-message]");

let supabaseClient = null;
let currentSession = null;
let currentRows = [];

function showMessage(element, message) {
  if (!element) {
    return;
  }

  element.hidden = false;
  element.textContent = message;
}

function clearMessage(element) {
  if (!element) {
    return;
  }

  element.hidden = true;
  element.textContent = "";
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
    <div class="thought-admin-meta-item">
      <span class="thought-admin-meta-label">${label}</span>
      <span class="thought-admin-meta-value">${value || "—"}</span>
    </div>
  `;
}

function renderActions(row) {
  const actions = [];

  if (row.status !== "approved") {
    actions.push(
      `<button class="status-action" type="button" data-action="approve" data-id="${row.id}" data-tone="approve">Approve</button>`,
    );
  }

  if (row.status !== "rejected") {
    actions.push(
      `<button class="status-action" type="button" data-action="reject" data-id="${row.id}" data-tone="reject">Reject</button>`,
    );
  }

  if (row.status !== "hidden") {
    actions.push(
      `<button class="status-action" type="button" data-action="hide" data-id="${row.id}" data-tone="hide">Hide</button>`,
    );
  }

  if (row.status !== "pending") {
    actions.push(
      `<button class="status-action" type="button" data-action="restore" data-id="${row.id}">Restore to pending</button>`,
    );
  }

  return actions.join("");
}

function renderRows(rows) {
  if (!rows.length) {
    thoughtsList.replaceChildren();
    showMessage(listMessage, "No thoughts found for this filter.");
    return;
  }

  clearMessage(listMessage);

  thoughtsList.innerHTML = rows
    .map(
      (row) => `
        <article class="thought-admin-card">
          <div class="thought-admin-top">
            <span class="thought-admin-status" data-status="${row.status}">${row.status}</span>
            <span class="thought-admin-meta-label">${row.id}</span>
          </div>

          <p class="thought-admin-text">${getThoughtText(row)}</p>

          <div class="thought-admin-meta">
            ${renderMeta("Timestamp", formatDate(row.timestamp_ist))}
            ${renderMeta("Score", row.score != null ? `${row.score}/10` : "")}
            ${renderMeta("Round", row.round != null ? String(row.round) : "")}
            ${renderMeta("Seed", row.seed)}
            ${renderMeta("Reason", row.reason)}
            ${renderMeta("Suggestion", row.suggestion)}
          </div>

          <div class="thought-admin-buttons">
            ${renderActions(row)}
          </div>
        </article>
      `,
    )
    .join("");
}

async function fetchThoughts() {
  if (!supabaseClient) {
    return;
  }

  const filter = statusFilter?.value || "pending";
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
  showMessage(runtimeMessage, `Updated ${id} to ${payload.status}.`);
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
    return;
  }

  if (email !== adminConfig.allowedEmail) {
    await supabaseClient.auth.signOut();
    showMessage(runtimeMessage, "This Google account is not allowed to access the admin.");
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
      "Edit admin-config.js with your Supabase project URL, anon key, and optional export webhook URL before using this page.",
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
      showMessage(runtimeMessage, "Unable to start Google sign-in right now.");
    } finally {
      loginButton.disabled = false;
    }
  });

  logoutButton?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    await handleSession(null);
  });

  refreshButton?.addEventListener("click", async () => {
    refreshButton.disabled = true;

    try {
      await fetchThoughts();
    } catch (error) {
      console.error("Failed to refresh thoughts", error);
      showMessage(runtimeMessage, "Unable to refresh thoughts right now.");
    } finally {
      refreshButton.disabled = false;
    }
  });

  statusFilter?.addEventListener("change", async () => {
    try {
      await fetchThoughts();
    } catch (error) {
      console.error("Failed to load filtered thoughts", error);
      showMessage(runtimeMessage, "Unable to load this filter right now.");
    }
  });

  thoughtsList?.addEventListener("click", async (event) => {
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
      showMessage(runtimeMessage, `Unable to ${action} this thought right now.`);
    } finally {
      button.disabled = false;
    }
  });

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  await handleSession(session);

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    await handleSession(session);
  });
}

boot().catch((error) => {
  console.error("Failed to boot admin page", error);
  showMessage(runtimeMessage, "Unable to load the admin right now.");
});
