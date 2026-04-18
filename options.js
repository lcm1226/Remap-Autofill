const SETTINGS_KEY = "remapKeyAdvancedAutoFillSettings";
const DRAFT_KEY = "remapKeyAdvancedAutoFillDraft";

const state = {
  settings: getDefaultSettings(),
  draft: null
};

const draftCard = document.querySelector("#draft-card");
const draftDescriptor = document.querySelector("#draft-descriptor");
const draftSelector = document.querySelector("#draft-selector");
const status = document.querySelector("#status");
const autofillList = document.querySelector("#autofill-list");
const keyRemapList = document.querySelector("#key-remap-list");

document.querySelector("#refresh").addEventListener("click", () => init().catch(handleError));
document.querySelector("#use-draft").addEventListener("click", handleUseDraft);
document.querySelector("#clear-draft").addEventListener("click", handleClearDraft);
document.querySelector("#autofill-form").addEventListener("submit", handleSaveAutofillRule);
document.querySelector("#key-remap-form").addEventListener("submit", handleSaveKeyRule);
document.querySelector("#reset-autofill-form").addEventListener("click", resetAutofillForm);
document.querySelector("#reset-key-form").addEventListener("click", resetKeyForm);
document.querySelector("#add-gmail-preset").addEventListener("click", handleAddGmailPreset);
document.querySelector("#export-code").addEventListener("click", handleExportCode);
document.querySelector("#copy-code").addEventListener("click", handleCopyCode);
document.querySelector("#import-code").addEventListener("click", handleImportCode);
autofillList.addEventListener("click", handleAutofillListClick);
keyRemapList.addEventListener("click", handleKeyListClick);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "DRAFT_UPDATED") {
    init().catch(handleError);
  }
});

init().catch(handleError);

async function init() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get(DRAFT_KEY)
  ]);

  state.settings = normalizeSettings(synced[SETTINGS_KEY]);
  state.draft = local[DRAFT_KEY] || null;
  render();
}

function render() {
  renderDraft();
  renderAutofillRules();
  renderKeyRules();
}

function renderDraft() {
  if (!state.draft) {
    draftCard.classList.add("hidden");
    return;
  }

  draftCard.classList.remove("hidden");
  draftDescriptor.textContent = state.draft.descriptor || "선택된 필드";
  draftSelector.textContent = state.draft.selector || "";
}

function renderAutofillRules() {
  if (state.settings.autofillRules.length === 0) {
    autofillList.className = "rule-list empty-state";
    autofillList.textContent = "아직 자동입력 규칙이 없습니다.";
    return;
  }

  autofillList.className = "rule-list";
  autofillList.innerHTML = state.settings.autofillRules.map((rule) => {
    return `
      <article class="rule-card">
        <div class="rule-meta">
          <strong class="card-title">${escapeHtml(rule.label || rule.descriptor || rule.selector)}</strong>
          <span>${escapeHtml(rule.value)}</span>
          <span class="mono small">${escapeHtml(rule.selector)}</span>
          <span class="mono small">${escapeHtml(rule.urlPattern)}</span>
        </div>
        <div class="inline-actions">
          <button class="secondary" data-action="edit-autofill" data-id="${escapeHtml(rule.id)}" type="button">편집</button>
          <button class="danger" data-action="delete-autofill" data-id="${escapeHtml(rule.id)}" type="button">삭제</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderKeyRules() {
  if (state.settings.keyRemapRules.length === 0) {
    keyRemapList.className = "rule-list empty-state";
    keyRemapList.textContent = "아직 키 리맵 규칙이 없습니다.";
    return;
  }

  keyRemapList.className = "rule-list";
  keyRemapList.innerHTML = state.settings.keyRemapRules.map((rule) => {
    return `
      <article class="rule-card">
        <div class="rule-meta">
          <strong class="card-title">${escapeHtml(rule.label || `${rule.fromKey} -> ${rule.toKey}`)}</strong>
          <span>${escapeHtml(rule.fromKey)} -> ${escapeHtml(rule.toKey)}</span>
          <span class="mono small">${escapeHtml(rule.urlPattern)}</span>
        </div>
        <div class="inline-actions">
          <button class="secondary" data-action="edit-key" data-id="${escapeHtml(rule.id)}" type="button">편집</button>
          <button class="danger" data-action="delete-key" data-id="${escapeHtml(rule.id)}" type="button">삭제</button>
        </div>
      </article>
    `;
  }).join("");
}

function handleUseDraft() {
  if (!state.draft) {
    setStatus("사용할 선택 필드가 없습니다.", true);
    return;
  }

  document.querySelector("#autofill-label").value = state.draft.descriptor || "";
  document.querySelector("#autofill-url-pattern").value = state.draft.urlPattern || "";
  document.querySelector("#autofill-selector").value = state.draft.selector || "";
  document.querySelector("#autofill-value").focus();
  setStatus("자동입력 폼에 선택된 필드를 채웠습니다.");
}

async function handleClearDraft() {
  await chrome.runtime.sendMessage({ type: "CLEAR_DRAFT" });
  state.draft = null;
  renderDraft();
  setStatus("선택 필드를 비웠습니다.");
}

async function handleSaveAutofillRule(event) {
  event.preventDefault();

  const selector = document.querySelector("#autofill-selector").value.trim();
  const value = document.querySelector("#autofill-value").value;

  if (!selector || !value) {
    setStatus("selector와 입력할 값은 꼭 필요합니다.", true);
    return;
  }

  const id = document.querySelector("#autofill-id").value.trim() || createId("autofill");
  const rule = {
    id,
    label: document.querySelector("#autofill-label").value.trim(),
    urlPattern: document.querySelector("#autofill-url-pattern").value.trim() || "*://*/*",
    selector,
    descriptor: state.draft?.descriptor || document.querySelector("#autofill-label").value.trim(),
    fieldKind: state.draft?.fieldKind || "input",
    value,
    enabled: document.querySelector("#autofill-enabled").checked,
    autoApply: document.querySelector("#autofill-auto-apply").checked
  };

  upsertRule(state.settings.autofillRules, rule);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings });
  resetAutofillForm();
  await init();
  setStatus("자동입력 규칙을 저장했습니다.");
}

async function handleSaveKeyRule(event) {
  event.preventDefault();

  const fromKey = document.querySelector("#from-key").value.trim();
  const toKey = document.querySelector("#to-key").value.trim();

  if (!fromKey || !toKey) {
    setStatus("원래 키와 바꿀 키를 모두 입력하세요.", true);
    return;
  }

  const id = document.querySelector("#key-id").value.trim() || createId("key");
  const rule = {
    id,
    label: document.querySelector("#key-label").value.trim(),
    urlPattern: document.querySelector("#key-url-pattern").value.trim() || "*://*/*",
    fromKey,
    toKey,
    enabled: document.querySelector("#key-enabled").checked
  };

  upsertRule(state.settings.keyRemapRules, rule);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings });
  resetKeyForm();
  await init();
  setStatus("키 리맵 규칙을 저장했습니다.");
}

async function handleAddGmailPreset() {
  const exists = state.settings.keyRemapRules.some((rule) => {
    return rule.urlPattern === "*://mail.google.com/*"
      && normalizeChord(rule.fromKey) === "Delete"
      && normalizeChord(rule.toKey) === "Shift+3";
  });

  if (exists) {
    setStatus("이미 Gmail preset이 있습니다.");
    return;
  }

  state.settings.keyRemapRules.unshift({
    id: "gmail-delete-to-shift-3",
    label: "Gmail Delete -> Shift+3",
    urlPattern: "*://mail.google.com/*",
    fromKey: "Delete",
    toKey: "Shift+3",
    enabled: true
  });
  await chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings });
  await init();
  setStatus("Gmail preset을 추가했습니다.");
}

function handleExportCode() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings
  };
  document.querySelector("#sync-code").value = JSON.stringify(payload, null, 2);
  setStatus("설정을 JSON으로 내보냈습니다.");
}

async function handleCopyCode() {
  const textarea = document.querySelector("#sync-code");

  if (!textarea.value.trim()) {
    setStatus("먼저 설정을 내보내주세요.", true);
    return;
  }

  await navigator.clipboard.writeText(textarea.value);
  setStatus("설정 JSON을 클립보드에 복사했습니다.");
}

async function handleImportCode() {
  const raw = document.querySelector("#sync-code").value.trim();

  if (!raw) {
    setStatus("가져올 설정 JSON을 먼저 붙여넣어주세요.", true);
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    const nextSettings = normalizeSettings(parsed.settings);
    await chrome.storage.sync.set({ [SETTINGS_KEY]: nextSettings });
    state.settings = nextSettings;
    await init();
    setStatus("설정 JSON을 가져왔습니다. 현재 기기 설정을 교체했습니다.");
  } catch (error) {
    setStatus("설정 JSON 형식을 읽지 못했습니다.", true);
  }
}

async function handleAutofillListClick(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const ruleId = button.dataset.id;
  const rule = state.settings.autofillRules.find((item) => item.id === ruleId);

  if (!rule) {
    return;
  }

  if (button.dataset.action === "edit-autofill") {
    document.querySelector("#autofill-id").value = rule.id;
    document.querySelector("#autofill-label").value = rule.label || "";
    document.querySelector("#autofill-url-pattern").value = rule.urlPattern || "";
    document.querySelector("#autofill-selector").value = rule.selector || "";
    document.querySelector("#autofill-value").value = rule.value || "";
    document.querySelector("#autofill-enabled").checked = rule.enabled !== false;
    document.querySelector("#autofill-auto-apply").checked = rule.autoApply !== false;
    setStatus("자동입력 규칙을 편집 중입니다.");
    return;
  }

  if (button.dataset.action === "delete-autofill") {
    state.settings.autofillRules = state.settings.autofillRules.filter((item) => item.id !== ruleId);
    await chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings });
    await init();
    setStatus("자동입력 규칙을 삭제했습니다.");
  }
}

async function handleKeyListClick(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const ruleId = button.dataset.id;
  const rule = state.settings.keyRemapRules.find((item) => item.id === ruleId);

  if (!rule) {
    return;
  }

  if (button.dataset.action === "edit-key") {
    document.querySelector("#key-id").value = rule.id;
    document.querySelector("#key-label").value = rule.label || "";
    document.querySelector("#key-url-pattern").value = rule.urlPattern || "";
    document.querySelector("#from-key").value = rule.fromKey || "";
    document.querySelector("#to-key").value = rule.toKey || "";
    document.querySelector("#key-enabled").checked = rule.enabled !== false;
    setStatus("키 리맵 규칙을 편집 중입니다.");
    return;
  }

  if (button.dataset.action === "delete-key") {
    state.settings.keyRemapRules = state.settings.keyRemapRules.filter((item) => item.id !== ruleId);
    await chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings });
    await init();
    setStatus("키 리맵 규칙을 삭제했습니다.");
  }
}

function resetAutofillForm() {
  document.querySelector("#autofill-id").value = "";
  document.querySelector("#autofill-label").value = "";
  document.querySelector("#autofill-url-pattern").value = "";
  document.querySelector("#autofill-selector").value = "";
  document.querySelector("#autofill-value").value = "";
  document.querySelector("#autofill-enabled").checked = true;
  document.querySelector("#autofill-auto-apply").checked = true;
}

function resetKeyForm() {
  document.querySelector("#key-id").value = "";
  document.querySelector("#key-label").value = "";
  document.querySelector("#key-url-pattern").value = "";
  document.querySelector("#from-key").value = "";
  document.querySelector("#to-key").value = "";
  document.querySelector("#key-enabled").checked = true;
}

function upsertRule(list, nextRule) {
  const index = list.findIndex((rule) => rule.id === nextRule.id);

  if (index >= 0) {
    list[index] = nextRule;
    return;
  }

  list.unshift(nextRule);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#b42318" : "";
}

function handleError(error) {
  setStatus(error.message || "알 수 없는 오류가 발생했습니다.", true);
}

function normalizeSettings(stored) {
  const defaults = getDefaultSettings();
  return {
    version: 1,
    autofillRules: Array.isArray(stored?.autofillRules) ? stored.autofillRules : defaults.autofillRules,
    keyRemapRules: Array.isArray(stored?.keyRemapRules) ? stored.keyRemapRules : defaults.keyRemapRules
  };
}

function getDefaultSettings() {
  return {
    version: 1,
    autofillRules: [],
    keyRemapRules: [
      {
        id: "gmail-delete-to-shift-3",
        label: "Gmail Delete -> Shift+3",
        urlPattern: "*://mail.google.com/*",
        fromKey: "Delete",
        toKey: "Shift+3",
        enabled: true
      }
    ]
  };
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeChord(input) {
  const rawTokens = String(input || "")
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  const result = [];
  let base = "";

  rawTokens.forEach((token) => {
    const lowered = token.toLowerCase();

    if (lowered === "ctrl" || lowered === "control") {
      result.push("Ctrl");
      return;
    }

    if (lowered === "alt" || lowered === "option") {
      result.push("Alt");
      return;
    }

    if (lowered === "shift") {
      result.push("Shift");
      return;
    }

    if (lowered === "meta" || lowered === "cmd" || lowered === "command" || lowered === "win") {
      result.push("Meta");
      return;
    }

    base = token.length === 1 && /[a-z]/i.test(token) ? token.toUpperCase() : token;
  });

  return [...result, base].filter(Boolean).join("+");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
