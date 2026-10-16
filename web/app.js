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
  newConversation();
  loadPanel("overview").catch((error) => alert(error.message));
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
    state.conversationId = data.conversationId; addMessage("agent", data.message.content); await loadConversations();
  } catch (error) { addMessage("agent", `Ошибка: ${error.message}`); }
});

async function loadPanel(name) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.add("hidden"));
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
  $(`#panel-${name}`).classList.remove("hidden");
  if (name === "overview") await loadOverview();
  if (name === "chat") await loadConversations();
  if (name === "approvals") await loadApprovals();
  if (name === "jobs") await loadJobs();
  if (name === "traces") renderList("#traces", (await api(`/v1/traces?userId=${encodeURIComponent(state.account.id)}`)).traces, (item) => card(item.operation, `${item.status} · ${new Date(item.createdAt).toLocaleString()}`, item.traceId));
  if (name === "skills") renderList("#skills", (await api("/v1/skills")).skills, (item) => card(item.id, `v${item.version} · ${item.allowedTools.join(", ")}`, item.description));
  if (name === "users") await loadUsers();
}

function renderList(selector, items, renderer) { const root = $(selector); root.replaceChildren(...items.map(renderer)); }
document.querySelectorAll("nav button[data-panel]").forEach((button) => button.addEventListener("click", () => loadPanel(button.dataset.panel).catch((error) => alert(error.message))));

function newConversation() {
  state.conversationId = null;
  $("#messages").replaceChildren();
  addMessage("agent", "Готов к работе. Чем займёмся?");
}

$("#new-chat").addEventListener("click", newConversation);

async function loadConversations() {
  const root = $("#conversations");
  const items = (await api(`/v1/conversations?userId=${encodeURIComponent(state.account.id)}`)).conversations;
  root.replaceChildren(...items.map((item) => {
    const button = document.createElement("button");
    button.className = "conversation";
    button.textContent = item.title;
    button.title = `${item.messageCount} сообщений`;
    button.addEventListener("click", () => openConversation(item.id));
    return button;
  }));
}

async function openConversation(id) {
  const data = await api(`/v1/conversations/${id}?userId=${encodeURIComponent(state.account.id)}`);
  state.conversationId = id;
  $("#messages").replaceChildren();
  data.conversation.messages.filter((item) => item.role !== "system").forEach((item) => addMessage(item.role === "assistant" ? "agent" : "user", item.content));
}

function stat(label, value) {
  const node = document.createElement("div"); node.className = "stat";
  const caption = document.createElement("span"); caption.className = "meta"; caption.textContent = label;
  const number = document.createElement("strong"); number.textContent = value;
  node.append(caption, number); return node;
}

async function loadOverview() {
  const dashboardUrl = state.account.role === "owner"
    ? "/v1/dashboard"
    : `/v1/dashboard?userId=${encodeURIComponent(state.account.id)}`;
  const data = await api(dashboardUrl);
  const value = data.stats;
  $("#overview").replaceChildren(
    stat("Состояние", data.status === "ok" ? "Работает" : data.status),
    stat("Диалоги", String(value.conversations)),
    stat("Сообщения", String(value.messages)),
    stat("Активные задачи", String(value.queuedJobs)),
    stat("Ожидают подтверждения", String(value.pendingApprovals)),
    stat("Токены", value.totalTokens.toLocaleString()),
    stat("Оценка расходов", `$${value.estimatedCostUsd.toFixed(4)}`),
    stat("Воркер", data.workerEnabled ? "Включён" : "Выключен"),
  );
}

async function loadApprovals() {
  const items = (await api(`/v1/approvals?userId=${encodeURIComponent(state.account.id)}`)).approvals;
  renderList("#approvals", items, (item) => {
    const node = card(item.summary, `${item.toolName} · ${item.risk} · ${item.status}`);
    if (item.status === "pending") {
      const actions = document.createElement("div"); actions.className = "actions";
      const approve = document.createElement("button"); approve.textContent = "Разрешить";
      const reject = document.createElement("button"); reject.textContent = "Отклонить"; reject.className = "reject";
      approve.addEventListener("click", () => decideApproval(item.id, true));
      reject.addEventListener("click", () => decideApproval(item.id, false));
      actions.append(approve, reject); node.append(actions);
    }
    return node;
  });
}

async function decideApproval(id, approved) {
  await api(`/v1/approvals/${id}/decision`, { method: "POST", body: JSON.stringify({ userId: state.account.id, approved }) });
  await loadApprovals();
}

async function loadJobs() {
  const items = (await api(`/v1/jobs?userId=${encodeURIComponent(state.account.id)}`)).jobs;
  renderList("#jobs", items, (item) => {
    const node = card(item.jobType, `${item.status} · попыток ${item.attempts}/${item.maxAttempts}`, item.error || (item.result ? JSON.stringify(item.result) : ""));
    const action = ["queued", "waiting"].includes(item.status) ? "cancel" : ["failed", "cancelled"].includes(item.status) ? "retry" : null;
    if (action) {
      const actions = document.createElement("div"); actions.className = "actions";
      const button = document.createElement("button"); button.textContent = action === "cancel" ? "Отменить" : "Повторить";
      if (action === "cancel") button.className = "reject";
      button.addEventListener("click", () => updateJob(item.id, action));
      actions.append(button); node.append(actions);
    }
    return node;
  });
}

async function updateJob(id, action) {
  await api(`/v1/jobs/${id}/${action}`, { method: "POST", body: JSON.stringify({ userId: state.account.id }) });
  await loadJobs();
}

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
