const state = { token: sessionStorage.getItem("barlasToken"), account: null, conversationId: null, languages: [], skills: [] };
const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `HTTP ${response.status}`);
  return body;
}

async function upload(path, formData) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { method: "POST", headers, body: formData });
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

async function loadLanguages() {
  if (state.languages.length) return state.languages;
  const data = await api("/languages");
  state.languages = data.languages;
  return state.languages;
}

function fillLanguageSelect(selector, selected, includeUnset = false) {
  const select = $(selector);
  const unset = includeUnset ? [new Option("Выберет при первом входе", "")] : [];
  const options = state.languages.map((language) => new Option(
    `${language.nativeName} — ${language.name}`,
    language.code,
    false,
    language.code === selected,
  ));
  select.replaceChildren(...unset, ...options);
  if (selected) select.value = selected;
}

function applyLanguage(account) {
  const language = state.languages.find((item) => item.code === account?.languageCode);
  if (!language) return;
  document.documentElement.lang = language.code;
  document.documentElement.dir = language.direction;
  localStorage.setItem("barlasLanguage", language.code);
}

async function showApp(account) {
  state.account = account;
  $("#login-view").classList.add("hidden");
  await loadLanguages();
  if (!account.languageConfigured) {
    $("#app-view").classList.add("hidden");
    $("#language-view").classList.remove("hidden");
    fillLanguageSelect("#language-setup-select", localStorage.getItem("barlasLanguage") || "");
    return;
  }
  $("#language-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  applyLanguage(account);
  fillLanguageSelect("#language-settings-select", account.languageCode);
  fillLanguageSelect("#new-language", "", true);
  $("#identity").textContent = `${account.displayName} · ${account.role}`;
  $("#users-tab").classList.toggle("hidden", account.role !== "owner");
  await loadSkillOptions();
  newConversation();
  loadPanel("overview").catch((error) => alert(error.message));
}

async function loadSkillOptions() {
  const data = await api("/v1/skills");
  state.skills = data.skills;
  const active = state.skills.filter((skill) => skill.active);
  $("#skill-select").replaceChildren(
    new Option("Без специального навыка", ""),
    ...active.map((skill) => new Option(`${skill.id} · v${skill.version}`, `${skill.id}@${skill.version}`)),
  );
}

function addMessage(kind, text) {
  const node = document.createElement("div");
  node.className = `message ${kind}`;
  node.textContent = text;
  $("#messages").append(node);
  node.scrollIntoView({ behavior: "smooth", block: "end" });
  return node;
}

async function restore() {
  if (!state.token) return;
  try { const data = await api("/v1/me"); await showApp(data.principal); }
  catch { sessionStorage.removeItem("barlasToken"); state.token = null; }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#login-error").textContent = "";
  try {
    const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: $("#email").value, password: $("#password").value }) });
    state.token = data.token; sessionStorage.setItem("barlasToken", data.token); await showApp(data.account);
  } catch (error) { $("#login-error").textContent = error.message; }
});

$("#language-setup-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#language-setup-error").textContent = "";
  try {
    const data = await api("/v1/me/preferences", {
      method: "PATCH",
      body: JSON.stringify({ languageCode: $("#language-setup-select").value }),
    });
    await showApp(data.account);
  } catch (error) { $("#language-setup-error").textContent = error.message; }
});

$("#password-reset-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#password-reset-error").textContent = "";
  try {
    await api("/auth/password-reset", { method: "POST", body: JSON.stringify({
      code: $("#password-reset-code").value.trim(),
      password: $("#password-reset-password").value,
    }) });
    event.target.reset(); $("#password-reset-error").textContent = "Пароль изменён. Теперь войдите.";
  } catch (error) { $("#password-reset-error").textContent = error.message; }
});

$("#logout").addEventListener("click", async () => {
  try { await api("/v1/auth/logout", { method: "POST" }); } catch {}
  sessionStorage.removeItem("barlasToken"); location.reload();
});

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const input = $("#chat-input"); const text = input.value.trim(); if (!text) return;
  addMessage("user", text); input.value = "";
  try {
    const selectedSkill = $("#skill-select").value;
    const split = selectedSkill.lastIndexOf("@");
    const skill = split > 0 ? { skillId: selectedSkill.slice(0, split), skillVersion: selectedSkill.slice(split + 1) } : {};
    const data = await api("/v1/agent/run", { method: "POST", body: JSON.stringify({ userId: state.account.id, conversationId: state.conversationId || undefined, messages: [{ role: "user", content: text }], taskClass: $("#task-class").value, ...skill }) });
    state.conversationId = data.conversationId;
    const statusNode = addMessage("agent", data.message.content);
    if (data.status === "queued" && data.runId) void watchAgentRun(data.runId, statusNode);
    else await loadConversations();
    if (data.status === "waiting_approval") await loadApprovals();
  } catch (error) { addMessage("agent", `Ошибка: ${error.message}`); }
});

$("#media-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file && !$("#media-path").value) $("#media-path").value = `media/${file.name}`;
});

$("#media-upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("#media-upload-status");
  const file = $("#media-file").files[0];
  if (!file) return;
  status.textContent = "Загрузка…";
  try {
    const formData = new FormData();
    formData.append("file", file, file.name);
    const query = new URLSearchParams({ userId: state.account.id, path: $("#media-path").value.trim() });
    const data = await upload(`/v1/media/upload?${query}`, formData);
    status.textContent = `Загружено: ${data.media.path} (${data.media.mimeType}, ${data.media.bytes} байт)`;
    event.target.reset();
  } catch (error) { status.textContent = `Ошибка: ${error.message}`; }
});

async function watchAgentRun(runId, statusNode) {
  const terminal = new Set(["completed", "step_limit", "budget_limit", "cancelled", "failed", "waiting_approval"]);
  while (true) {
    try {
      const data = await api(`/v1/agent-runs/${runId}?userId=${encodeURIComponent(state.account.id)}`);
      const events = await api(`/v1/agent-runs/${runId}/events?userId=${encodeURIComponent(state.account.id)}`);
      const latest = events.events.at(-1);
      statusNode.textContent = latest
        ? `Выполняется: шаг ${latest.step}, ${latest.eventType}`
        : `Состояние: ${data.run.status}`;
      if (terminal.has(data.run.status)) {
        statusNode.textContent = data.run.result?.text || data.run.error || `Состояние: ${data.run.status}`;
        await loadConversations();
        if (data.run.status === "waiting_approval") await loadApprovals();
        return;
      }
    } catch (error) {
      statusNode.textContent = `Не удалось обновить прогресс: ${error.message}`;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function loadPanel(name) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.add("hidden"));
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
  $(`#panel-${name}`).classList.remove("hidden");
  if (name === "overview") await loadOverview();
  if (name === "chat") await loadConversations();
  if (name === "approvals") await loadApprovals();
  if (name === "runs") await loadRuns();
  if (name === "jobs") await loadJobs();
  if (name === "traces") renderList("#traces", (await api(`/v1/traces?userId=${encodeURIComponent(state.account.id)}`)).traces, (item) => card(item.operation, `${item.status} · ${new Date(item.createdAt).toLocaleString()}`, item.traceId));
  if (name === "skills") {
    await loadSkillOptions();
    renderList("#skills", state.skills, (item) => card(item.id, `v${item.version} · ${item.active ? "active" : "candidate"} · ${item.allowedTools.join(", ")}`, item.description));
  }
  if (name === "organizations") await loadOrganizations();
  if (name === "connectors") await loadConnectors();
  if (name === "settings") fillLanguageSelect("#language-settings-select", state.account.languageCode);
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
  const telegram = await api("/v1/me/telegram");
  $("#telegram-status").textContent = telegram.link
    ? `Привязан Telegram ID ${telegram.link.telegramUserId}`
    : "Telegram не привязан";
  $("#telegram-unlink").classList.toggle("hidden", !telegram.link);
}

$("#telegram-code").addEventListener("click", async () => {
  try {
    const data = await api("/v1/me/telegram/code", { method: "POST" });
    $("#telegram-status").textContent = `Отправьте боту команду: /link ${data.code} (код действует 10 минут)`;
  } catch (error) { $("#telegram-status").textContent = error.message; }
});

$("#telegram-unlink").addEventListener("click", async () => {
  await api("/v1/me/telegram", { method: "DELETE" });
  await loadOverview();
});

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
  const data = await api(`/v1/approvals/${id}/decision`, { method: "POST", body: JSON.stringify({ userId: state.account.id, approved }) });
  if (data.resumedRun?.result?.text) {
    state.conversationId = data.resumedRun.conversationId;
    addMessage("agent", data.resumedRun.result.text);
    await loadConversations();
  }
  await loadApprovals();
}

async function loadRuns() {
  const items = (await api(`/v1/agent-runs?userId=${encodeURIComponent(state.account.id)}`)).runs;
  renderList("#runs", items, (item) => {
    const result = item.result?.text || item.error || "";
    const node = card(`Запуск ${item.id.slice(0, 8)}`, `${item.status} · ${new Date(item.updatedAt).toLocaleString()}`, result);
    const actions = document.createElement("div"); actions.className = "actions";
    const events = document.createElement("button"); events.textContent = "Шаги"; events.className = "secondary";
    events.addEventListener("click", async () => {
      const data = await api(`/v1/agent-runs/${item.id}/events?userId=${encodeURIComponent(state.account.id)}`);
      const text = data.events.map((event) => `${event.step}. ${event.eventType}`).join("\n") || "Событий пока нет";
      alert(text);
    });
    actions.append(events);
    if (["running", "waiting_approval"].includes(item.status)) {
      const cancel = document.createElement("button"); cancel.textContent = "Отменить"; cancel.className = "reject";
      cancel.addEventListener("click", async () => {
        await api(`/v1/agent-runs/${item.id}/cancel`, { method: "POST", body: JSON.stringify({ userId: state.account.id }) });
        await loadRuns();
      });
      actions.append(cancel);
    }
    node.append(actions); return node;
  });
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
  renderList("#users", users, (user) => {
    const node = card(user.displayName, `${user.email} · ${user.role}`, user.active ? "Активен" : "Отключён");
    const reset = document.createElement("button"); reset.textContent = "Код сброса"; reset.className = "secondary";
    reset.addEventListener("click", async () => {
      const data = await api(`/v1/admin/users/${user.id}/password-reset`, { method: "POST" });
      alert(`Одноразовый код (15 минут):\n${data.code}`);
    });
    node.append(reset); return node;
  });
}

async function loadOrganizations() {
  const items = (await api("/v1/organizations")).organizations;
  renderList("#organizations", items, (organization) => {
    const node = card(organization.name, `${organization.slug} · ${organization.plan} · ${organization.role}`);
    const members = document.createElement("button");
    members.textContent = "Участники"; members.className = "secondary";
    members.addEventListener("click", async () => {
      const data = await api(`/v1/organizations/${organization.id}/members`);
      alert(data.members.map((member) => `${member.displayName} · ${member.email} · ${member.role}`).join("\n"));
    });
    node.append(members);
    return node;
  });
}

$("#organization-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#organization-error").textContent = "";
  try {
    await api("/v1/organizations", { method: "POST", body: JSON.stringify({
      name: $("#organization-name").value,
      slug: $("#organization-slug").value,
      plan: $("#organization-plan").value,
    }) });
    event.target.reset(); await loadOrganizations();
  } catch (error) { $("#organization-error").textContent = error.message; }
});

async function loadConnectors() {
  const data = await api(`/v1/connectors?userId=${encodeURIComponent(state.account.id)}`);
  renderList("#connectors", data.connectors, (connector) => {
    const node = card(connector.label, `${connector.provider} · key v${connector.keyVersion}`, `Обновлено ${new Date(connector.updatedAt).toLocaleString()}`);
    const remove = document.createElement("button"); remove.textContent = "Удалить"; remove.className = "reject";
    remove.addEventListener("click", async () => {
      await api(`/v1/connectors/${connector.id}`, { method: "DELETE", body: JSON.stringify({ userId: state.account.id }) });
      await loadConnectors();
    });
    node.append(remove); return node;
  });
}

$("#connector-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#connector-error").textContent = "";
  try {
    await api("/v1/connectors", { method: "POST", body: JSON.stringify({
      userId: state.account.id,
      provider: $("#connector-provider").value,
      label: $("#connector-label").value,
      secret: $("#connector-secret").value,
      ...($("#connector-provider").value === "mcp_http" ? { metadata: { endpoint: $("#connector-endpoint").value } } : {}),
    }) });
    event.target.reset(); await loadConnectors();
  } catch (error) { $("#connector-error").textContent = error.message; }
});

$("#language-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#language-settings-status").textContent = "";
  try {
    const data = await api("/v1/me/preferences", {
      method: "PATCH",
      body: JSON.stringify({ languageCode: $("#language-settings-select").value }),
    });
    state.account = data.account;
    applyLanguage(data.account);
    $("#language-settings-status").textContent = "Язык сохранён.";
  } catch (error) { $("#language-settings-status").textContent = error.message; }
});

$("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#user-error").textContent = "";
  try {
    const languageCode = $("#new-language").value;
    await api("/v1/admin/users", { method: "POST", body: JSON.stringify({
      displayName: $("#new-name").value,
      email: $("#new-email").value,
      password: $("#new-password").value,
      role: $("#new-role").value,
      ...(languageCode ? { languageCode } : {}),
    }) });
    event.target.reset(); await loadUsers();
  } catch (error) { $("#user-error").textContent = error.message; }
});

loadLanguages().then(() => restore()).catch((error) => { $("#login-error").textContent = error.message; });
