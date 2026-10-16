const state = { token: sessionStorage.getItem("barlasToken"), account: null, conversationId: null };
const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `HTTP ${response.status}`);
  return body;
}

function card(title, meta, body = "") {
  const node = document.createElement("article");
  node.className = "card";
  const heading = document.createElement("strong"); heading.textContent = title;
  const details = document.createElement("div"); details.className = "meta"; details.textContent = meta;
  const content = document.createElement("div"); content.textContent = body;
  node.append(heading, details, content);
  return node;
}

function showApp(account) {
  state.account = account;
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#identity").textContent = `${account.displayName} · ${account.role}`;
  $("#users-tab").classList.toggle("hidden", account.role !== "owner");
  addMessage("agent", "Готов к работе. Чем займёмся?");
}

function addMessage(kind, text) {
  const node = document.createElement("div");
  node.className = `message ${kind}`;
  node.textContent = text;
  $("#messages").append(node);
  node.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function restore() {
  if (!state.token) return;
  try { const data = await api("/v1/me"); showApp(data.principal); }
  catch { sessionStorage.removeItem("barlasToken"); state.token = null; }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#login-error").textContent = "";
  try {
    const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: $("#email").value, password: $("#password").value }) });
    state.token = data.token; sessionStorage.setItem("barlasToken", data.token); showApp(data.account);
  } catch (error) { $("#login-error").textContent = error.message; }
});

$("#logout").addEventListener("click", async () => {
  try { await api("/v1/auth/logout", { method: "POST" }); } catch {}
  sessionStorage.removeItem("barlasToken"); location.reload();
});

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const input = $("#chat-input"); const text = input.value.trim(); if (!text) return;
  addMessage("user", text); input.value = "";
  try {
    const data = await api("/v1/chat", { method: "POST", body: JSON.stringify({ userId: state.account.id, conversationId: state.conversationId || undefined, messages: [{ role: "user", content: text }], taskClass: $("#task-class").value }) });
    state.conversationId = data.conversationId; addMessage("agent", data.message.content);
  } catch (error) { addMessage("agent", `Ошибка: ${error.message}`); }
});

async function loadPanel(name) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.add("hidden"));
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
  $(`#panel-${name}`).classList.remove("hidden");
  if (name === "jobs") renderList("#jobs", (await api(`/v1/jobs?userId=${encodeURIComponent(state.account.id)}`)).jobs, (item) => card(item.jobType, `${item.status} · попыток ${item.attempts}/${item.maxAttempts}`, item.error || ""));
  if (name === "traces") renderList("#traces", (await api(`/v1/traces?userId=${encodeURIComponent(state.account.id)}`)).traces, (item) => card(item.operation, `${item.status} · ${new Date(item.createdAt).toLocaleString()}`, item.traceId));
  if (name === "skills") renderList("#skills", (await api("/v1/skills")).skills, (item) => card(item.id, `v${item.version} · ${item.allowedTools.join(", ")}`, item.description));
  if (name === "users") await loadUsers();
}

function renderList(selector, items, renderer) { const root = $(selector); root.replaceChildren(...items.map(renderer)); }
document.querySelectorAll("nav button[data-panel]").forEach((button) => button.addEventListener("click", () => loadPanel(button.dataset.panel).catch((error) => alert(error.message))));

async function loadUsers() {
  const users = (await api("/v1/admin/users")).users;
  renderList("#users", users, (user) => card(user.displayName, `${user.email} · ${user.role}`, user.active ? "Активен" : "Отключён"));
}

$("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#user-error").textContent = "";
  try {
    await api("/v1/admin/users", { method: "POST", body: JSON.stringify({ displayName: $("#new-name").value, email: $("#new-email").value, password: $("#new-password").value, role: $("#new-role").value }) });
    event.target.reset(); await loadUsers();
  } catch (error) { $("#user-error").textContent = error.message; }
});

restore();
