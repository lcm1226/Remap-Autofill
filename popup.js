const SETTINGS_KEY = "remapKeyAdvancedAutoFillSettings";
const DRAFT_KEY = "remapKeyAdvancedAutoFillDraft";

const state = {
  activeTab: null,
  settings: getDefaultSettings(),
  draft: null,
  identity: {
    config: IdentityAutofillCore.getDefaultConfig(),
    profiles: []
  }
};

const activeTabUrl = document.querySelector("#active-tab-url");
const draftCard = document.querySelector("#draft-card");
const draftDescriptor = document.querySelector("#draft-descriptor");
const draftSelector = document.querySelector("#draft-selector");
const status = document.querySelector("#status");
const autofillList = document.querySelector("#autofill-list");
const keyRemapList = document.querySelector("#key-remap-list");

document.querySelector("#start-picker").addEventListener("click", handleStartPicker);
document.querySelector("#apply-now").addEventListener("click", handleApplyNow);
document.querySelector("#clear-draft").addEventListener("click", handleClearDraft);
document.querySelector("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#add-gmail-preset").addEventListener("click", handleAddGmailPreset);
document.querySelector("#autofill-form").addEventListener("submit", handleSaveAutofillRule);
document.querySelector("#key-remap-form").addEventListener("submit", handleSaveKeyRemapRule);
document.querySelector("#identity-active-profile").addEventListener("change", handleIdentityProfileChange);
document.querySelector("#apply-identity-now").addEventListener("click", handleApplyIdentityNow);
document.querySelector("#manage-identity").addEventListener("click", () => chrome.runtime.openOptionsPage());
autofillList.addEventListener("click", handleRuleListClick);
keyRemapList.addEventListener("click", handleRuleListClick);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "DRAFT_UPDATED") {
    loadState().then(render).catch((error) => setStatus(error.message, true));
  }
});

init().catch((error) => setStatus(error.message, true));

async function init() {
  await loadState();
  render();
}

async function loadState() {
  const [tabs, synced, local, identityResponse] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get(DRAFT_KEY),
    chrome.runtime.sendMessage({ type: "IDENTITY_GET_STATE" })
  ]);

  state.activeTab = tabs[0] || null;
  state.settings = normalizeSettings(synced[SETTINGS_KEY]);
  state.draft = local[DRAFT_KEY] || null;
  if (identityResponse?.ok) {
    state.identity = {
      config: identityResponse.config,
      profiles: identityResponse.profiles
    };
  }
}

function render() {
  const pageUrl = state.activeTab?.url || "일반 웹페이지에서 사용하세요.";
  activeTabUrl.textContent = pageUrl;
  renderDraft();
  renderIdentityQuickActions();
  prefillForms();
  renderAutofillList();
  renderKeyRemapList();
}

function renderIdentityQuickActions() {
  const { config, profiles } = state.identity;
  const select = document.querySelector("#identity-active-profile");
  select.innerHTML = profiles.length
    ? profiles.map((profile) => {
      return `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.label || profile.name)}</option>`;
    }).join("")
    : '<option value="">저장된 정보 없음</option>';
  select.value = config.activeProfileId || "";
  document.querySelector("#apply-identity-now").disabled = !config.activeProfileId;
}

async function handleIdentityProfileChange(event) {
  const response = await chrome.runtime.sendMessage({
    type: "IDENTITY_SELECT_PROFILE",
    id: event.target.value
  });

  if (!response?.ok) {
    setStatus(response?.error || "저장된 본인인증 정보를 선택하지 못했습니다.", true);
    return;
  }

  state.identity = {
    config: response.config,
    profiles: response.profiles
  };
  renderIdentityQuickActions();
  setStatus("사용할 본인인증 정보를 변경했습니다.");
}

async function handleApplyIdentityNow() {
  if (!state.activeTab?.id) {
    setStatus("활성 탭을 찾지 못했습니다.", true);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(state.activeTab.id, { type: "IDENTITY_APPLY_NOW" });

    if (!response?.ok) {
      setStatus(response?.error || "현재 인증창에 본인인증 정보를 채우지 못했습니다.", true);
      return;
    }

    const count = response.result?.applied?.length || 0;
    setStatus(count > 0 ? `${count}개 종류의 본인인증 정보를 채웠습니다.` : "현재 인증창에서 채울 수 있는 빈 입력란을 찾지 못했습니다.");
  } catch (error) {
    setStatus("휴대폰 본인인증 창에서만 사용할 수 있습니다.", true);
  }
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

function prefillForms() {
  const defaultPattern = makeWildcardPattern(state.activeTab?.url);

  document.querySelector("#autofill-url-pattern").value = state.draft?.urlPattern || defaultPattern;
  document.querySelector("#autofill-selector").value = state.draft?.selector || "";
  document.querySelector("#autofill-label").value = state.draft?.descriptor || "";
  document.querySelector("#autofill-value").value = "";
  document.querySelector("#autofill-enabled").checked = true;
  document.querySelector("#autofill-auto-apply").checked = true;

  document.querySelector("#key-url-pattern").value = state.activeTab?.url?.includes("mail.google.com")
    ? "*://mail.google.com/*"
    : defaultPattern;
  document.querySelector("#key-label").value = "";
  document.querySelector("#from-key").value = "";
  document.querySelector("#to-key").value = "";
  document.querySelector("#key-enabled").checked = true;
}

function renderAutofillList() {
  const pageUrl = state.activeTab?.url || "";
  const rules = state.settings.autofillRules.filter((rule) => matchesUrlPattern(rule.urlPattern, pageUrl));

  if (rules.length === 0) {
    autofillList.className = "rule-list empty-state";
    autofillList.textContent = "아직 저장된 규칙이 없습니다.";
    return;
  }

  autofillList.className = "rule-list";
  autofillList.innerHTML = rules.map((rule) => {
    return `
      <article class="rule-item">
        <div class="rule-copy">
          <strong>${escapeHtml(rule.label || rule.descriptor || rule.selector)}</strong>
          <span class="small">${escapeHtml(rule.value)}</span>
          <span class="mono xsmall">${escapeHtml(rule.selector)}</span>
        </div>
        <button class="danger" data-rule-type="autofill" data-id="${escapeHtml(rule.id)}" type="button">삭제</button>
      </article>
    `;
  }).join("");
}

function renderKeyRemapList() {
  const pageUrl = state.activeTab?.url || "";
  const rules = state.settings.keyRemapRules.filter((rule) => matchesUrlPattern(rule.urlPattern, pageUrl));

  if (rules.length === 0) {
    keyRemapList.className = "rule-list empty-state";
    keyRemapList.textContent = "아직 저장된 리맵 규칙이 없습니다.";
    return;
  }

  keyRemapList.className = "rule-list";
  keyRemapList.innerHTML = rules.map((rule) => {
    return `
      <article class="rule-item">
        <div class="rule-copy">
          <strong>${escapeHtml(rule.label || `${rule.fromKey} -> ${rule.toKey}`)}</strong>
          <span class="small">${escapeHtml(rule.fromKey)} -> ${escapeHtml(rule.toKey)}</span>
          <span class="mono xsmall">${escapeHtml(rule.urlPattern)}</span>
        </div>
        <button class="danger" data-rule-type="key-remap" data-id="${escapeHtml(rule.id)}" type="button">삭제</button>
      </article>
    `;
  }).join("");
}

async function handleStartPicker() {
  const result = await chrome.runtime.sendMessage({ type: "START_PICKER" });

  if (!result?.ok) {
    setStatus(result?.error || "필드 선택을 시작하지 못했습니다.", true);
    return;
  }

  setStatus("페이지에서 필드를 클릭하세요. 팝업은 닫아도 됩니다.");
  window.setTimeout(() => window.close(), 450);
}

async function handleApplyNow() {
  if (!state.activeTab?.id) {
    setStatus("활성 탭을 찾지 못했습니다.", true);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(state.activeTab.id, { type: "APPLY_AUTOFILL_NOW" });
    const appliedCount = response?.result?.applied?.length || 0;
    setStatus(appliedCount > 0 ? `${appliedCount}개 필드에 값을 넣었습니다.` : "적용된 필드가 없습니다.");
  } catch (error) {
    setStatus("페이지에 연결하지 못했습니다. 탭을 새로고침한 뒤 다시 시도하세요.", true);
  }
}

async function handleClearDraft() {
  await chrome.runtime.sendMessage({ type: "CLEAR_DRAFT" });
  state.draft = null;
  renderDraft();
  document.querySelector("#autofill-selector").value = "";
  document.querySelector("#autofill-label").value = "";
  setStatus("선택된 필드를 비웠습니다.");
}

async function handleSaveAutofillRule(event) {
  event.preventDefault();

  const selector = document.querySelector("#autofill-selector").value.trim();
  const value = document.querySelector("#autofill-value").value;

  if (!selector || !value) {
    setStatus("selector와 자동입력 값은 꼭 필요합니다.", true);
    return;
  }

  const nextRule = {
    id: createId("autofill"),
    label: document.querySelector("#autofill-label").value.trim(),
    urlPattern: document.querySelector("#autofill-url-pattern").value.trim() || makeWildcardPattern(state.activeTab?.url),
    selector,
    descriptor: state.draft?.descriptor || document.querySelector("#autofill-label").value.trim(),
    fieldKind: state.draft?.fieldKind || "input",
    value,
    enabled: document.querySelector("#autofill-enabled").checked,
    autoApply: document.querySelector("#autofill-auto-apply").checked
  };

  state.settings.autofillRules.unshift(nextRule);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings });

  if (state.draft) {
    await chrome.runtime.sendMessage({ type: "CLEAR_DRAFT" });
    state.draft = null;
  }

  render();
  document.querySelector("#autofill-value").value = "";
  setStatus("자동입력 규칙을 저장했습니다.");
}

async function handleSaveKeyRemapRule(event) {
  event.preventDefault();

  const fromKey = document.querySelector("#from-key").value.trim();
  const toKey = document.querySelector("#to-key").value.trim();

  if (!fromKey || !toKey) {
    setStatus("원래 키와 바꿀 키를 모두 입력하세요.", true);
    return;
  }

  const nextRule = {
    id: createId("key"),
    label: document.querySelector("#key-label").value.trim(),
    urlPattern: document.querySelector("#key-url-pattern").value.trim() || makeWildcardPattern(state.activeTab?.url),
    fromKey,
    toKey,
    enabled: document.querySelector("#key-enabled").checked
  };

  state.settings.keyRemapRules.unshift(nextRule);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings });
  render();
  setStatus("키 리맵 규칙을 저장했습니다.");
}

async function handleAddGmailPreset() {
  const alreadyExists = state.settings.keyRemapRules.some((rule) => {
    return rule.urlPattern === "*://mail.google.com/*"
      && normalizeChord(rule.fromKey) === "Delete"
      && normalizeChord(rule.toKey) === "Shift+3";
  });

  if (alreadyExists) {
    setStatus("이미 Gmail Delete preset이 있습니다.");
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
  render();
  setStatus("Gmail Delete preset을 추가했습니다.");
}

async function handleRuleListClick(event) {
  const button = event.target.closest("button[data-id]");

  if (!button) {
    return;
  }

  const ruleType = button.dataset.ruleType;
  const ruleId = button.dataset.id;

  if (ruleType === "autofill") {
    state.settings.autofillRules = state.settings.autofillRules.filter((rule) => rule.id !== ruleId);
  }

  if (ruleType === "key-remap") {
    state.settings.keyRemapRules = state.settings.keyRemapRules.filter((rule) => rule.id !== ruleId);
  }

  await chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings });
  render();
  setStatus("규칙을 삭제했습니다.");
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#b42318" : "";
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

function matchesUrlPattern(pattern, url) {
  if (!pattern) {
    return true;
  }

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${escaped}$`, "i").test(url || "");
}

function makeWildcardPattern(url) {
  if (!url) {
    return "*://*/*";
  }

  try {
    const parsed = new URL(url);
    return `*://${parsed.host}/*`;
  } catch (error) {
    return "*://*/*";
  }
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
