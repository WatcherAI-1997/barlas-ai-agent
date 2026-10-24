const fragmentToken = new URLSearchParams(location.hash.slice(1)).get("token");
const startupVoiceTest = new URLSearchParams(location.search).get("voice-test") === "1";
if (fragmentToken) {
  sessionStorage.setItem("barlasToken", fragmentToken);
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}
const state = { token: fragmentToken || sessionStorage.getItem("barlasToken"), account: null, conversationId: null, conversationUpdatedAt: null, manualNewConversation: false, projectId: null, languages: [], skills: [], projects: [], agents: [], voiceRecorder: null, voiceStream: null, voiceChunks: [], voiceTimer: null, microphoneRecorder: null, microphoneStream: null, microphoneChunks: [], microphoneTimer: null, microphoneUrl: null };
const $ = (selector) => document.querySelector(selector);
const panelTitles = {
  overview: "Обзор", chat: "Чат", approvals: "Подтверждения", runs: "Запуски",
  jobs: "Задачи", schedules: "Расписания", files: "Файлы", projects: "Проекты", agents: "Агенты",
  traces: "Трассировка", skills: "Навыки", organizations: "Организации",
  connectors: "Подключения", settings: "Настройки", users: "Пользователи",
};

function notify(message, tone = "info") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = message;
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), 4500);
}

function showDialog(title, content, copyable = false) {
  $("#dialog-title").textContent = title;
  $("#dialog-content").textContent = content;
  $("#dialog-copy").classList.toggle("hidden", !copyable);
  $("#detail-dialog").showModal();
}

function closeNavigation() {
  $("#primary-nav").classList.remove("open");
  $("#nav-backdrop").classList.add("hidden");
  $("#nav-toggle").setAttribute("aria-expanded", "false");
}

$("#nav-toggle").addEventListener("click", () => {
  const open = $("#primary-nav").classList.toggle("open");
  $("#nav-backdrop").classList.toggle("hidden", !open);
  $("#nav-toggle").setAttribute("aria-expanded", String(open));
});
$("#nav-backdrop").addEventListener("click", closeNavigation);
$("#dialog-close").addEventListener("click", () => $("#detail-dialog").close());
$("#dialog-done").addEventListener("click", () => $("#detail-dialog").close());
$("#dialog-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#dialog-content").textContent);
    notify("Скопировано в буфер обмена", "success");
  } catch { notify("Не удалось скопировать", "error"); }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeNavigation(); });
$("#primary-nav").addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const buttons = [...document.querySelectorAll("#primary-nav button[data-panel]")]
    .filter((button) => !button.hidden && !button.classList.contains("hidden") && !button.disabled);
  if (!buttons.length) return;
  const current = Math.max(0, buttons.indexOf(document.activeElement));
  const next = event.key === "Home" ? 0
    : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length
        : (current + 1) % buttons.length;
  event.preventDefault();
  buttons[next].focus();
  buttons[next].scrollIntoView({ block: "nearest" });
});

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

function applySetupLanguage(code) {
  const language = state.languages.find((item) => item.code === code) || state.languages.find((item) => item.code === "en");
  if (!language) return;
  const phrases = language.setupPhrases;
  const fallback = language.setupTranslationStatus !== "verified";
  $("#login-title").textContent = phrases.loginTitle;
  $("#login-description").textContent = phrases.loginDescription;
  $("#login-token-label").textContent = phrases.gatewayTokenLabel;
  $("#login-submit").textContent = phrases.connectLabel;
  $("#language-setup-title").textContent = phrases.title;
  $("#language-setup-description").textContent = phrases.description;
  $("#language-setup-label").textContent = phrases.languageLabel;
  $("#language-setup-submit").textContent = phrases.continueLabel;
  $("#language-setup-fallback").textContent = fallback ? phrases.fallbackNotice : "";
  $("#language-setup-fallback").classList.toggle("hidden", !fallback);
  document.documentElement.lang = fallback ? "en" : language.code;
  document.documentElement.dir = fallback ? "ltr" : language.direction;
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
    const storedLanguage = localStorage.getItem("barlasLanguage") || initialPublicLanguage();
    fillLanguageSelect("#language-setup-select", storedLanguage);
    applySetupLanguage($("#language-setup-select").value);
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
  await loadProjectOptions();
  await loadAgentOptions();
  await loadVoiceAvailability();
  newConversation();
  const initialPanel = startupVoiceTest ? "settings" : "overview";
  loadPanel(initialPanel).then(() => {
    if (!startupVoiceTest) return;
    history.replaceState(null, "", location.pathname);
    $("#voice-diagnostic").focus();
    $("#voice-diagnostic").scrollIntoView({ behavior: "smooth", block: "center" });
  }).catch((error) => notify(error.message, "error"));
}

function initialPublicLanguage() {
  const stored = localStorage.getItem("barlasLanguage");
  if (state.languages.some((language) => language.code === stored)) return stored;
  const browser = navigator.language?.toLowerCase().split("-")[0];
  return state.languages.some((language) => language.code === browser) ? browser : "en";
}

async function loadVoiceAvailability() {
  const status = await api("/v1/voice/status");
  $("#voice-toggle").disabled = !status.available;
  $("#voice-status").textContent = status.available
    ? "Голос выключен. Микрофон включается только после нажатия кнопки."
    : "Голос недоступен: настройте media API для распознавания и озвучивания.";
  $("#voice-service-status").textContent = status.available
    ? `Распознавание и голосовой ответ готовы. Голос: ${status.defaultVoice || "по умолчанию"}.`
    : "Локальную проверку микрофона можно выполнить сейчас. Для распознавания и голосовых ответов настройте media API.";
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
    state.token = $("#gateway-token").value.trim();
    sessionStorage.setItem("barlasToken", state.token);
    const data = await api("/v1/me");
    await showApp(data.principal);
  } catch (error) {
    sessionStorage.removeItem("barlasToken"); state.token = null;
    $("#login-error").textContent = error.message;
  }
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

$("#language-setup-select").addEventListener("change", (event) => {
  localStorage.setItem("barlasLanguage", event.target.value);
  applySetupLanguage(event.target.value);
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
    const agentId = $("#chat-agent").value || undefined;
    const data = await api("/v1/agent/run", { method: "POST", body: JSON.stringify({ userId: state.account.id, conversationId: state.conversationId || undefined, agentId, ...(!agentId ? { projectId: $("#chat-project").value || undefined, taskClass: $("#task-class").value } : {}), messages: [{ role: "user", content: text }], ...skill }) });
    state.conversationId = data.conversationId;
    state.manualNewConversation = false;
    const statusNode = addMessage("agent", data.message.content);
    if (data.status === "queued" && data.runId) void watchAgentRun(data.runId, statusNode);
    else await loadConversations();
    if (data.status === "waiting_approval") await loadApprovals();
  } catch (error) { addMessage("agent", `Ошибка: ${error.message}`); }
});

function preferredRecordingType() {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function stopVoiceTracks() {
  if (state.voiceTimer) clearTimeout(state.voiceTimer);
  state.voiceTimer = null;
  state.voiceStream?.getTracks().forEach((track) => track.stop());
  state.voiceStream = null;
}

async function playVoiceAudio(audio) {
  const bytes = Uint8Array.from(atob(audio.base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: audio.mimeType }));
  const player = new Audio(url);
  player.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  player.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
  await player.play();
}

async function submitVoiceTurn(blob, extension) {
  const button = $("#voice-toggle");
  const status = $("#voice-status");
  button.disabled = true;
  status.textContent = "Распознаю речь и готовлю ответ…";
  try {
    const formData = new FormData();
    formData.append("file", blob, `voice.${extension}`);
    const query = new URLSearchParams({
      userId: state.account.id,
      consent: "true",
      ...($("#chat-agent").value ? { agentId: $("#chat-agent").value } : { taskClass: $("#task-class").value }),
      ...(state.conversationId ? { conversationId: state.conversationId } : {}),
    });
    const data = await upload(`/v1/voice/turn?${query}`, formData);
    state.conversationId = data.conversationId;
    addMessage("user", data.transcript);
    addMessage("agent", data.message.content);
    status.textContent = data.audio.truncated
      ? "Ответ озвучен частично; полный текст показан в чате."
      : "Ответ озвучен. Микрофон выключен.";
    await loadConversations();
    await playVoiceAudio(data.audio).catch(() => notify("Браузер заблокировал автовоспроизведение — текст ответа сохранён.", "error"));
  } catch (error) {
    status.textContent = `Ошибка голоса: ${error.message}`;
  } finally {
    button.disabled = false;
    button.setAttribute("aria-pressed", "false");
    button.textContent = "🎙";
  }
}

$("#voice-toggle").addEventListener("click", async () => {
  const button = $("#voice-toggle");
  const status = $("#voice-status");
  if (state.voiceRecorder?.state === "recording") {
    state.voiceRecorder.stop();
    button.disabled = true;
    status.textContent = "Завершаю запись…";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    notify("Этот браузер не поддерживает голосовую запись.", "error");
    return;
  }
  try {
    const mimeType = preferredRecordingType();
    state.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.voiceChunks = [];
    state.voiceRecorder = new MediaRecorder(state.voiceStream, mimeType ? { mimeType } : undefined);
    state.voiceRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.voiceChunks.push(event.data);
    });
    state.voiceRecorder.addEventListener("stop", () => {
      const actualType = state.voiceRecorder.mimeType || mimeType || "audio/webm";
      const extension = actualType.includes("ogg") ? "ogg" : "webm";
      const blob = new Blob(state.voiceChunks, { type: actualType });
      stopVoiceTracks();
      state.voiceRecorder = null;
      void submitVoiceTurn(blob, extension);
    }, { once: true });
    state.voiceRecorder.start(250);
    state.voiceTimer = setTimeout(() => {
      if (state.voiceRecorder?.state === "recording") state.voiceRecorder.stop();
    }, 120_000);
    button.setAttribute("aria-pressed", "true");
    button.textContent = "■";
    status.textContent = "Слушаю только сейчас. Нажмите ещё раз, чтобы отправить фразу.";
  } catch (error) {
    stopVoiceTracks();
    status.textContent = error.name === "NotAllowedError"
      ? "Доступ к микрофону не разрешён. Измените разрешение сайта, если хотите использовать голос."
      : `Не удалось включить микрофон: ${error.message}`;
  }
});

window.addEventListener("pagehide", stopVoiceTracks);

function stopMicrophoneTestTracks() {
  if (state.microphoneTimer) clearTimeout(state.microphoneTimer);
  state.microphoneTimer = null;
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  state.microphoneStream = null;
}

function deleteMicrophoneTest() {
  stopMicrophoneTestTracks();
  if (state.microphoneUrl) URL.revokeObjectURL(state.microphoneUrl);
  state.microphoneUrl = null;
  const audio = $("#microphone-test-audio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  audio.classList.add("hidden");
  $("#microphone-test-delete").classList.add("hidden");
  $("#microphone-test-status").textContent = "Тестовая запись удалена. Микрофон выключен.";
}

$("#microphone-test-start").addEventListener("click", async () => {
  const button = $("#microphone-test-start");
  const status = $("#microphone-test-status");
  if (state.microphoneRecorder?.state === "recording") {
    state.microphoneRecorder.stop();
    button.disabled = true;
    status.textContent = "Завершаю локальную запись…";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    status.textContent = "Этот браузер не поддерживает проверку микрофона.";
    return;
  }
  deleteMicrophoneTest();
  try {
    const mimeType = preferredRecordingType();
    const startedAt = performance.now();
    state.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.microphoneChunks = [];
    state.microphoneRecorder = new MediaRecorder(state.microphoneStream, mimeType ? { mimeType } : undefined);
    state.microphoneRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.microphoneChunks.push(event.data);
    });
    state.microphoneRecorder.addEventListener("stop", () => {
      const actualType = state.microphoneRecorder.mimeType || mimeType || "audio/webm";
      const elapsed = Math.min(5, Math.max(0.1, (performance.now() - startedAt) / 1000));
      const blob = new Blob(state.microphoneChunks, { type: actualType });
      stopMicrophoneTestTracks();
      state.microphoneRecorder = null;
      button.disabled = false;
      button.textContent = "Записать ещё раз";
      if (blob.size > 10 * 1024 * 1024) {
        status.textContent = "Запись превысила локальный предел 10 МБ и была удалена.";
        return;
      }
      state.microphoneUrl = URL.createObjectURL(blob);
      const audio = $("#microphone-test-audio");
      audio.src = state.microphoneUrl;
      audio.classList.remove("hidden");
      $("#microphone-test-delete").classList.remove("hidden");
      status.textContent = `Готово: ${elapsed.toFixed(1)} с · ${(blob.size / 1024).toFixed(1)} КБ · ${actualType}. Запись осталась только в браузере.`;
    }, { once: true });
    state.microphoneRecorder.start(100);
    state.microphoneTimer = setTimeout(() => {
      if (state.microphoneRecorder?.state === "recording") state.microphoneRecorder.stop();
    }, 5_000);
    button.textContent = "Остановить";
    status.textContent = "Записываю локально… максимум 5 секунд.";
  } catch (error) {
    stopMicrophoneTestTracks();
    state.microphoneRecorder = null;
    button.disabled = false;
    status.textContent = error.name === "NotAllowedError"
      ? "Доступ к микрофону не разрешён. Разрешите его для локального адреса Barlas и повторите тест."
      : `Не удалось проверить микрофон: ${error.message}`;
  }
});

$("#microphone-test-delete").addEventListener("click", deleteMicrophoneTest);
window.addEventListener("pagehide", deleteMicrophoneTest);

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
  document.querySelectorAll("nav button[data-panel]").forEach((button) => {
    const active = button.dataset.panel === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $(`#panel-${name}`).classList.remove("hidden");
  $("#page-title").textContent = panelTitles[name] || name;
  document.title = `${panelTitles[name] || name} · Barlas AI Agent`;
  closeNavigation();
  if (name === "overview") await loadOverview();
  if (name === "chat") await loadConversations();
  if (name === "approvals") await loadApprovals();
  if (name === "runs") await loadRuns();
  if (name === "jobs") await loadJobs();
  if (name === "schedules") await loadSchedules();
  if (name === "files") await loadFiles();
  if (name === "projects") await loadProjects();
  if (name === "agents") await loadAgents();
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

function renderList(selector, items, renderer) {
  const root = $(selector);
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Здесь пока ничего нет";
    root.replaceChildren(empty);
    return;
  }
  root.replaceChildren(...items.map(renderer));
}
document.querySelectorAll("nav button[data-panel]").forEach((button) => button.addEventListener("click", () => loadPanel(button.dataset.panel).catch((error) => notify(error.message, "error"))));

$("#file-upload").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file && !$("#file-upload-path").value) $("#file-upload-path").value = file.name;
});

$("#file-upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("#file-upload-status");
  const file = $("#file-upload").files[0];
  if (!file) return;
  status.textContent = "Загрузка…";
  try {
    const formData = new FormData(); formData.append("file", file, file.name);
    const query = new URLSearchParams({
      userId: state.account.id,
      path: $("#file-upload-path").value.trim(),
      overwrite: String($("#file-overwrite").checked),
    });
    const data = await upload(`/v1/files/upload?${query}`, formData);
    status.textContent = `Загружено: ${data.file.path} (${data.file.bytes} байт)`;
    event.target.reset();
    await loadFiles();
  } catch (error) { status.textContent = `Ошибка: ${error.message}`; }
});

$("#file-path-form").addEventListener("submit", async (event) => { event.preventDefault(); await loadFiles(); });
$("#file-up").addEventListener("click", async () => {
  const parts = $("#file-path").value.split("/").filter((part) => part && part !== ".");
  parts.pop(); $("#file-path").value = parts.join("/") || "."; await loadFiles();
});

async function downloadFile(path) {
  const query = new URLSearchParams({ userId: state.account.id, path });
  const headers = state.token ? { authorization: `Bearer ${state.token}` } : {};
  const response = await fetch(`/v1/files/download?${query}`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || `HTTP ${response.status}`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = path.split("/").at(-1) || "download";
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

async function loadFiles() {
  const path = $("#file-path").value.trim() || "."; $("#file-path").value = path;
  const query = new URLSearchParams({ userId: state.account.id, path });
  const items = (await api(`/v1/files?${query}`)).files;
  renderList("#files", items, (item) => {
    const node = card(item.path, item.type === "directory" ? "Папка" : "Файл");
    const button = document.createElement("button"); button.textContent = item.type === "directory" ? "Открыть" : "Скачать";
    button.addEventListener("click", () => {
      if (item.type === "directory") { $("#file-path").value = item.path; loadFiles().catch((error) => notify(error.message, "error")); }
      else downloadFile(item.path).catch((error) => notify(error.message, "error"));
    });
    node.append(button); return node;
  });
}

$("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const status = $("#project-status"); status.textContent = "Создание…";
  try {
    const data = await api("/v1/projects", { method: "POST", body: JSON.stringify({ userId: state.account.id, name: $("#project-name").value.trim(), description: $("#project-description").value.trim() }) });
    event.target.reset(); status.textContent = `Создан проект: ${data.project.name}`; state.projectId = data.project.id; await loadProjects(); await openProject(data.project.id);
  } catch (error) { status.textContent = `Ошибка: ${error.message}`; }
});

async function loadProjects() {
  const items = (await api(`/v1/projects?userId=${encodeURIComponent(state.account.id)}`)).projects;
  state.projects = items; fillProjectSelect();
  renderList("#projects", items, (item) => {
    const node = card(item.name, `${item.status} · ${new Date(item.updatedAt).toLocaleString()}`, item.description);
    const button = document.createElement("button"); button.textContent = "Открыть"; button.addEventListener("click", () => openProject(item.id).catch((error) => notify(error.message, "error"))); node.append(button); return node;
  });
}

async function loadProjectOptions() {
  state.projects = (await api(`/v1/projects?userId=${encodeURIComponent(state.account.id)}`)).projects; fillProjectSelect();
}

function fillProjectSelect() {
  const selected = $("#chat-project").value;
  $("#chat-project").replaceChildren(new Option("Без проекта", ""), ...state.projects.map((project) => new Option(project.name, project.id)));
  if (state.projects.some((project) => project.id === selected)) $("#chat-project").value = selected;
  const selectedAgentProject = $("#agent-project").value;
  $("#agent-project").replaceChildren(new Option("Без проекта", ""), ...state.projects.map((project) => new Option(project.name, project.id)));
  if (state.projects.some((project) => project.id === selectedAgentProject)) $("#agent-project").value = selectedAgentProject;
}

async function loadAgentOptions() {
  state.agents = (await api(`/v1/agents?userId=${encodeURIComponent(state.account.id)}`)).profiles;
  const selected = $("#chat-agent").value;
  $("#chat-agent").replaceChildren(new Option("Основной Barlas", ""), ...state.agents.map((agent) => new Option(`${agent.name} · ${agent.slug}`, agent.id)));
  if (state.agents.some((agent) => agent.id === selected)) $("#chat-agent").value = selected;
}

async function loadAgents() {
  await loadProjectOptions();
  await loadAgentOptions();
  const council = await api("/v1/agents/council");
  $("#crisis-form").classList.toggle("hidden", state.account.role !== "owner");
  const crisis = state.account.role === "owner" ? await api("/v1/system/crisis") : { mode: "standby" };
  const regent = council.crisisRegent;
  renderList("#crisis-regent", [crisis], (item) => card(
    `${regent.name} · ${item.mode}`,
    item.expiresAt ? `Полномочия до ${new Date(item.expiresAt).toLocaleString()}` : "Временная кризисная роль",
    [item.reason || regent.mandate, item.scope?.length ? `Область: ${item.scope.join(", ")}` : "", `Границы: ${regent.boundaries}`].filter(Boolean).join("\n"),
  ));
  renderList("#council", [council.chief, ...council.members], (member, index) => index === 0
    ? card(member.name, "Глава · единая ответственность", member.mandate)
    : card(member.name, `${member.id} · ${member.taskClass}`, `${member.character}\n${member.mandate}\nГраница: ${member.boundaries}`));
  renderList("#agents", state.agents, (agent) => {
    const project = state.projects.find((item) => item.id === agent.projectId);
    const character = agent.character || {};
    const body = [
      project ? `Workspace: ${project.name}` : "Без отдельного workspace",
      `Ценности: ${(character.values || []).join(", ") || "—"}`,
      `Сильные стороны: ${(character.strengths || []).join(", ") || "—"}`,
      character.voice ? `Голос: ${character.voice}` : "",
      `Инициатива: ${character.initiativeLevel || "balanced"} · риск: ${character.riskPosture || "balanced"} · критика: ${character.critiqueStyle || "direct"}`,
    ].filter(Boolean).join("\n");
    const node = card(agent.name, `${agent.slug} · ${agent.style} · v${agent.identityVersion || 1}`, body);
    node.style.borderTopColor = character.color || "#C62828";
    const use = document.createElement("button"); use.textContent = "Открыть чат"; use.addEventListener("click", () => {
      $("#chat-agent").value = agent.id; state.conversationId = null; loadPanel("chat").catch((error) => notify(error.message, "error"));
    });
    const remove = document.createElement("button"); remove.textContent = "Удалить"; remove.className = "reject"; remove.addEventListener("click", async () => {
      await api(`/v1/agents/${agent.id}?userId=${encodeURIComponent(state.account.id)}`, { method: "DELETE" }); await loadAgents();
    });
    const evolve = document.createElement("button"); evolve.textContent = "Развить личность"; evolve.className = "secondary"; evolve.addEventListener("click", async () => {
      const reason = window.prompt("Почему меняется личность?", "Уточнение владельца"); if (!reason) return;
      const voice = window.prompt("Голос и манера речи", character.voice || ""); if (voice === null) return;
      const values = window.prompt("Ценности через запятую", (character.values || []).join(", ")); if (values === null) return;
      await api(`/v1/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify({
        userId: state.account.id, reason,
        character: { ...character, voice, values: values.split(",").map((item) => item.trim()).filter(Boolean) },
      }) });
      await loadAgents();
    });
    node.append(use, evolve, remove); return node;
  });
}

$("#crisis-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#crisis-status").textContent = "Активация…";
  try {
    await api("/v1/system/crisis/activate", { method: "POST", body: JSON.stringify({
      reason: $("#crisis-reason").value.trim(),
      scope: $("#crisis-scope").value.split(",").map((item) => item.trim()).filter(Boolean),
      ttlMinutes: Number($("#crisis-ttl").value),
    }) });
    $("#crisis-status").textContent = "TEMIR принял временное кризисное командование."; await loadAgents();
  } catch (error) { $("#crisis-status").textContent = `Ошибка: ${error.message}`; }
});

$("#crisis-release").addEventListener("click", async () => {
  await api("/v1/system/crisis/release", { method: "POST", body: JSON.stringify({ reason: "Владелец завершил критическую фазу" }) });
  $("#crisis-status").textContent = "TEMIR перешёл к проверке восстановления."; await loadAgents();
});

$("#crisis-reset").addEventListener("click", async () => {
  await api("/v1/system/crisis/reset", { method: "POST", body: "{}" });
  $("#crisis-status").textContent = "Управление полностью возвращено обычному Barlas."; await loadAgents();
});

$("#agent-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#agent-status").textContent = "Создание…";
  try {
    const data = await api("/v1/agents", { method: "POST", body: JSON.stringify({
      userId: state.account.id, slug: $("#agent-slug").value.trim(), name: $("#agent-name").value.trim(),
      style: $("#agent-style").value, defaultTaskClass: $("#agent-task-class").value,
      projectId: $("#agent-project").value || undefined, instructions: $("#agent-instructions").value.trim(),
      character: {
        values: $("#agent-values").value.split(",").map((item) => item.trim()).filter(Boolean),
        strengths: $("#agent-strengths").value.split(",").map((item) => item.trim()).filter(Boolean),
        voice: $("#agent-voice").value.trim(), initiativeLevel: $("#agent-initiative").value,
        riskPosture: $("#agent-risk").value, critiqueStyle: $("#agent-critique").value,
        color: $("#agent-color").value,
      },
    }) });
    event.target.reset(); $("#agent-status").textContent = `Создан агент: ${data.profile.name}`; await loadAgents();
  } catch (error) { $("#agent-status").textContent = `Ошибка: ${error.message}`; }
});

$("#chat-agent").addEventListener("change", () => { state.conversationId = null; $("#chat-project").disabled = Boolean($("#chat-agent").value); });

async function openProject(id) {
  state.projectId = id;
  const data = await api(`/v1/projects/${id}?userId=${encodeURIComponent(state.account.id)}`);
  $("#project-detail").classList.remove("hidden"); $("#project-title").textContent = data.project.name; $("#project-description-view").textContent = data.project.description;
  const goalOptions = [new Option("Без цели", ""), ...data.goals.map((goal) => new Option(goal.title, goal.id))];
  $("#project-step-goal").replaceChildren(...goalOptions.map((option) => option.cloneNode(true)));
  $("#project-checkpoint-goal").replaceChildren(...goalOptions);
  renderList("#project-goals", data.goals, (item) => projectStatusCard(item.title, `Приоритет ${item.priority}`, item.description, item.status, ["planned", "in_progress", "blocked", "completed"], (status) => updateProjectItem("goals", item.id, status)));
  renderList("#project-steps", data.steps, (item) => projectStatusCard(`${item.position}. ${item.title}`, item.goalId ? "Связано с целью" : "Общий план", "", item.status, ["pending", "in_progress", "blocked", "completed", "skipped"], (status) => updateProjectItem("steps", item.id, status)));
  renderList("#project-checkpoints", data.checkpoints, (item) => card(`${item.progress}% · ${item.title}`, `${item.kind} · ${new Date(item.createdAt).toLocaleString()}`, item.summary));
  renderList("#project-resources", data.resources, (item) => card(item.label || item.id, item.type, item.id));
  renderList("#project-artifacts", data.artifacts, (item) => {
    const node = card(`${item.path} · v${item.version}`, `${item.bytes} байт · ${new Date(item.createdAt).toLocaleString()}`, item.sha256);
    const button = document.createElement("button"); button.textContent = "Восстановить"; button.addEventListener("click", () => restoreArtifact(item.id).catch((error) => notify(error.message, "error"))); node.append(button); return node;
  });
}

function projectStatusCard(title, meta, body, status, statuses, update) {
  const node = card(title, meta, body); const select = document.createElement("select");
  select.replaceChildren(...statuses.map((value) => new Option(value, value, false, value === status)));
  select.addEventListener("change", () => update(select.value).catch((error) => notify(error.message, "error"))); node.append(select); return node;
}

async function updateProjectItem(kind, id, status) {
  await api(`/v1/projects/${state.projectId}/${kind}/${id}`, { method: "PATCH", body: JSON.stringify({ userId: state.account.id, status }) });
  await openProject(state.projectId);
}

$("#project-goal-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!state.projectId) return;
  await api(`/v1/projects/${state.projectId}/goals`, { method: "POST", body: JSON.stringify({ userId: state.account.id, title: $("#project-goal-title").value.trim(), description: $("#project-goal-description").value.trim(), priority: Number($("#project-goal-priority").value) }) });
  event.target.reset(); await openProject(state.projectId);
});

$("#project-step-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!state.projectId) return;
  await api(`/v1/projects/${state.projectId}/steps`, { method: "POST", body: JSON.stringify({ userId: state.account.id, title: $("#project-step-title").value.trim(), goalId: $("#project-step-goal").value || undefined }) });
  event.target.reset(); await openProject(state.projectId);
});

$("#project-checkpoint-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!state.projectId) return;
  await api(`/v1/projects/${state.projectId}/checkpoints`, { method: "POST", body: JSON.stringify({ userId: state.account.id, title: $("#project-checkpoint-title").value.trim(), summary: $("#project-checkpoint-summary").value.trim(), progress: Number($("#project-checkpoint-progress").value), goalId: $("#project-checkpoint-goal").value || undefined }) });
  event.target.reset(); await openProject(state.projectId);
});

$("#project-resource-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!state.projectId) return;
  await api(`/v1/projects/${state.projectId}/resources`, { method: "POST", body: JSON.stringify({ userId: state.account.id, type: $("#project-resource-type").value, resourceId: $("#project-resource-id").value.trim(), label: $("#project-resource-label").value.trim() }) });
  event.target.reset(); await openProject(state.projectId);
});

$("#project-artifact-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!state.projectId) return;
  await api(`/v1/projects/${state.projectId}/artifacts`, { method: "POST", body: JSON.stringify({ userId: state.account.id, path: $("#project-artifact-path").value.trim() }) });
  event.target.reset(); await openProject(state.projectId);
});

async function restoreArtifact(versionId) {
  if (!state.projectId || !confirm("Восстановить эту версию и заменить текущий файл?")) return;
  await api(`/v1/projects/${state.projectId}/artifacts/${versionId}/restore`, { method: "POST", body: JSON.stringify({ userId: state.account.id }) });
  $("#project-status").textContent = "Версия восстановлена."; await openProject(state.projectId);
}

function newConversation(manual = false) {
  state.conversationId = null;
  state.conversationUpdatedAt = null;
  state.manualNewConversation = manual;
  $("#messages").replaceChildren();
  addMessage("agent", "Готов к работе. Чем займёмся?");
}

$("#new-chat").addEventListener("click", () => newConversation(true));

async function loadConversations() {
  const root = $("#conversations");
  const items = (await api(`/v1/conversations?userId=${encodeURIComponent(state.account.id)}`)).conversations;
  root.replaceChildren(...items.map((item) => {
    const button = document.createElement("button");
    button.className = "conversation";
    button.dataset.conversationId = item.id;
    button.classList.toggle("active", item.id === state.conversationId);
    button.textContent = item.title;
    button.title = `${item.messageCount} сообщений`;
    button.addEventListener("click", () => openConversation(item.id));
    return button;
  }));
  return items;
}

async function openConversation(id) {
  const data = await api(`/v1/conversations/${id}?userId=${encodeURIComponent(state.account.id)}`);
  state.conversationId = id;
  state.conversationUpdatedAt = data.conversation.updatedAt;
  state.manualNewConversation = false;
  document.querySelectorAll(".conversation").forEach((button) => button.classList.toggle("active", button.dataset.conversationId === id));
  $("#messages").replaceChildren();
  data.conversation.messages.filter((item) => item.role !== "system").forEach((item) => addMessage(item.role === "assistant" ? "agent" : "user", item.content));
}

let conversationSyncing = false;
async function syncConversations() {
  if (conversationSyncing || !state.account || $("#panel-chat").classList.contains("hidden")) return;
  conversationSyncing = true;
  try {
    const items = await loadConversations();
    const current = items.find((item) => item.id === state.conversationId);
    if (current && current.updatedAt !== state.conversationUpdatedAt) await openConversation(current.id);
    else if (!state.conversationId && !state.manualNewConversation && items[0]) await openConversation(items[0].id);
  } catch (error) {
    console.debug("Conversation sync delayed", error);
  } finally {
    conversationSyncing = false;
  }
}
setInterval(() => { void syncConversations(); }, 1_500);

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
      showDialog(`Шаги запуска ${item.id.slice(0, 8)}`, text, true);
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

async function loadSchedules() {
  const items = (await api(`/v1/schedules?userId=${encodeURIComponent(state.account.id)}`)).schedules;
  renderList("#schedules", items, (item) => {
    const node = card(item.name, `${item.status} · ${item.cronExpression} · ${item.timezone}`, `Следующий запуск: ${new Date(item.nextRunAt).toLocaleString()}${item.lastError ? ` · Ошибка: ${item.lastError}` : ""}`);
    if (item.status !== "disabled") {
      const actions = document.createElement("div"); actions.className = "actions";
      const action = item.status === "active" ? "pause" : "resume";
      const toggle = document.createElement("button"); toggle.textContent = action === "pause" ? "Пауза" : "Возобновить";
      toggle.addEventListener("click", async () => { await updateSchedule(item.id, action); });
      const disable = document.createElement("button"); disable.textContent = "Отключить"; disable.className = "reject";
      disable.addEventListener("click", async () => { await updateSchedule(item.id, "disable"); });
      actions.append(toggle, disable); node.append(actions);
    }
    return node;
  });
}

async function updateSchedule(id, action) {
  await api(`/v1/schedules/${id}/${action}`, { method: "POST", body: JSON.stringify({ userId: state.account.id }) });
  await loadSchedules();
}

$("#schedule-timezone").value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
$("#schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#schedule-error").textContent = "";
  try {
    await api("/v1/schedules", { method: "POST", body: JSON.stringify({
      userId: state.account.id, name: $("#schedule-name").value.trim(), objective: $("#schedule-objective").value.trim(),
      cronExpression: $("#schedule-cron").value.trim(), timezone: $("#schedule-timezone").value.trim(),
      taskClass: $("#schedule-task-class").value, deliveryChannel: $("#schedule-delivery").value,
    }) });
    event.target.reset(); $("#schedule-timezone").value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await loadSchedules();
  } catch (error) { $("#schedule-error").textContent = error.message; }
});

async function loadUsers() {
  const users = (await api("/v1/admin/users")).users;
  renderList("#users", users, (user) => {
    const node = card(user.displayName, `${user.email} · ${user.role}`, user.active ? "Активен" : "Отключён");
    const reset = document.createElement("button"); reset.textContent = "Новый токен"; reset.className = "secondary";
    reset.addEventListener("click", async () => {
      const data = await api(`/v1/admin/users/${user.id}/access-token`, { method: "POST" });
      showDialog("Новый токен пользователя", `Показан один раз. Предыдущие токены отозваны.\n\n${data.token}\n\nДействует до: ${new Date(data.expiresAt).toLocaleString()}`, true);
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
      showDialog(`Участники · ${organization.name}`, data.members.map((member) => `${member.displayName} · ${member.email} · ${member.role}`).join("\n") || "Участников пока нет", true);
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
    const data = await api("/v1/admin/users", { method: "POST", body: JSON.stringify({
      displayName: $("#new-name").value,
      email: $("#new-email").value,
      role: $("#new-role").value,
      ...(languageCode ? { languageCode } : {}),
    }) });
    showDialog("Токен нового пользователя", `Показан один раз.\n\n${data.access.token}\n\nДействует до: ${new Date(data.access.expiresAt).toLocaleString()}`, true);
    event.target.reset(); await loadUsers();
  } catch (error) { $("#user-error").textContent = error.message; }
});

loadLanguages().then(async () => {
  applySetupLanguage(initialPublicLanguage());
  await restore();
}).catch((error) => { $("#login-error").textContent = error.message; });
