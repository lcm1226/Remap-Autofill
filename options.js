const SETTINGS_KEY = "remapKeyAdvancedAutoFillSettings";
const DRAFT_KEY = "remapKeyAdvancedAutoFillDraft";
const OPEN_SIGNAL_DEFAULT_SERVICE_BASE_URL = "https://keyremap-gmail-open-signal.phantom-cinnamon-008.workers.dev";

const state = {
  settings: getDefaultSettings(),
  draft: null,
  identity: {
    config: IdentityAutofillCore.getDefaultConfig(),
    profiles: []
  },
  openSignal: {
    config: {
      enabled: false,
      consentAccepted: false,
      serviceBaseUrl: OPEN_SIGNAL_DEFAULT_SERVICE_BASE_URL
    },
    history: []
  }
};

const draftCard = document.querySelector("#draft-card");
const draftDescriptor = document.querySelector("#draft-descriptor");
const draftSelector = document.querySelector("#draft-selector");
const status = document.querySelector("#status");
const autofillList = document.querySelector("#autofill-list");
const keyRemapList = document.querySelector("#key-remap-list");
const openSignalHistory = document.querySelector("#open-signal-history");
const identityProfileList = document.querySelector("#identity-profile-list");
const identityProfileStatus = document.querySelector("#identity-profile-status");
const identityTransferStatus = document.querySelector("#identity-transfer-status");
const identityProfileForm = document.querySelector("#identity-profile-form");
const identityValidatedFields = [
  "identity-name",
  "identity-phone",
  "identity-birth",
  "identity-carrier",
  "identity-gender",
  "identity-auth-method"
].map((id) => document.querySelector(`#${id}`));

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
document.querySelector("#open-signal-form").addEventListener("submit", handleSaveOpenSignalConfig);
document.querySelector("#refresh-open-signals").addEventListener("click", handleRefreshOpenSignals);
identityProfileForm.addEventListener("submit", handleSaveIdentityProfile);
document.querySelector("#identity-phone").addEventListener("input", handleIdentityNumericInput);
document.querySelector("#identity-birth").addEventListener("input", handleIdentityNumericInput);
identityValidatedFields.forEach((field) => {
  field.addEventListener("blur", () => validateIdentityField(field, true));
  field.addEventListener("input", () => refreshIdentityFieldValidity(field));
  field.addEventListener("change", () => refreshIdentityFieldValidity(field));
});
document.querySelector("#reset-identity-profile").addEventListener("click", resetIdentityProfileForm);
document.querySelector("#export-identity-profiles").addEventListener("click", handleExportIdentityProfiles);
document.querySelector("#copy-identity-profiles").addEventListener("click", handleCopyIdentityProfiles);
document.querySelector("#import-identity-profiles").addEventListener("click", handleImportIdentityProfiles);
autofillList.addEventListener("click", handleAutofillListClick);
keyRemapList.addEventListener("click", handleKeyListClick);
openSignalHistory.addEventListener("click", handleOpenSignalHistoryClick);
identityProfileList.addEventListener("click", handleIdentityProfileListClick);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "DRAFT_UPDATED") {
    init().catch(handleError);
  }
});

init().catch(handleError);

async function init() {
  const [synced, local, openSignalResponse, identityResponse] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get(DRAFT_KEY),
    chrome.runtime.sendMessage({ type: "OPEN_SIGNAL_GET_STATE" }),
    chrome.runtime.sendMessage({ type: "IDENTITY_GET_STATE" })
  ]);

  state.settings = normalizeSettings(synced[SETTINGS_KEY]);
  state.draft = local[DRAFT_KEY] || null;
  if (openSignalResponse?.ok) {
    state.openSignal = {
      config: openSignalResponse.config,
      history: openSignalResponse.history
    };
  }
  if (identityResponse?.ok) {
    state.identity = {
      config: identityResponse.config,
      profiles: identityResponse.profiles
    };
  }
  render();
}

function render() {
  renderDraft();
  renderAutofillRules();
  renderKeyRules();
  renderIdentityProfiles();
  renderOpenSignals();
}

function renderIdentityProfiles() {
  const { config, profiles } = state.identity;

  if (!profiles.length) {
    identityProfileList.className = "rule-list empty-state";
    identityProfileList.textContent = "저장된 본인인증 정보가 없습니다.";
    return;
  }

  const orderedProfiles = IdentityAutofillCore.orderProfilesForDisplay(
    profiles,
    config.activeProfileId
  );
  const hasInactiveProfiles = orderedProfiles.some((profile) => profile.id !== config.activeProfileId);
  identityProfileList.className = profiles.length >= 4
    ? "rule-list identity-profile-list-scrollable"
    : "rule-list";
  identityProfileList.innerHTML = orderedProfiles.map((profile) => {
    const active = config.activeProfileId === profile.id;
    const carrier = formatCarrier(profile.carrier);
    const method = profile.authMethod === "PASS" ? "PASS 앱" : "SMS";
    const savedTimestamp = IdentityAutofillCore.getProfileDisplayTimestamp(profile);
    const savedDate = formatIdentityProfileDate(savedTimestamp);

    return `
      <article class="rule-card${active ? " identity-profile-card-active" : ""}">
        <div class="rule-meta">
          <strong class="card-title">${escapeHtml(profile.label || profile.name)}</strong>
          ${active ? '<span class="active-profile-chip">자동 입력에 사용 중</span>' : ""}
          <div class="profile-detail-row">
            <div class="profile-summary">
              <span>${escapeHtml(profile.name.slice(0, 1))}**</span>
              <span>${escapeHtml(IdentityAutofillCore.maskPhone(profile.phone))}</span>
              <span>${escapeHtml(IdentityAutofillCore.maskBirth(profile.birth))}</span>
              <span>${escapeHtml(carrier)}</span>
              <span>${escapeHtml(method)}</span>
            </div>
            ${savedDate ? `<time class="profile-saved-date" datetime="${escapeHtml(savedTimestamp)}" aria-label="마지막 저장 날짜 ${escapeHtml(savedDate)}">${escapeHtml(savedDate)}</time>` : ""}
          </div>
        </div>
        <div class="inline-actions">
          ${active ? "" : `<button class="secondary" data-identity-action="select" data-id="${escapeHtml(profile.id)}" type="button">자동 입력에 사용</button>`}
          <button class="secondary" data-identity-action="edit" data-id="${escapeHtml(profile.id)}" type="button">편집</button>
          <button class="danger" data-identity-action="delete" data-id="${escapeHtml(profile.id)}" type="button">삭제</button>
        </div>
      </article>
      ${active && hasInactiveProfiles ? '<div class="identity-profile-divider" role="separator" aria-label="자동 입력 정보와 나머지 저장 정보 구분"></div>' : ""}
    `;
  }).join("");
}

function formatIdentityProfileDate(value) {
  const date = new Date(value || "");

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(date);
}

async function handleSaveIdentityProfile(event) {
  event.preventDefault();
  setIdentityProfileStatus("");

  if (!validateIdentityProfileForm()) {
    return;
  }

  const profile = {
    id: document.querySelector("#identity-profile-id").value.trim(),
    label: document.querySelector("#identity-profile-label").value.trim(),
    name: document.querySelector("#identity-name").value.trim(),
    phone: document.querySelector("#identity-phone").value,
    birth: document.querySelector("#identity-birth").value,
    carrier: document.querySelector("#identity-carrier").value,
    gender: document.querySelector("#identity-gender").value,
    foreigner: document.querySelector("#identity-foreigner").value === "foreigner",
    authMethod: document.querySelector("#identity-auth-method").value,
    enabled: true
  };
  const response = await chrome.runtime.sendMessage({
    type: "IDENTITY_SAVE_PROFILE",
    profile
  });

  if (!response?.ok) {
    const message = response?.error || "본인인증 정보를 저장하지 못했습니다.";
    markIdentityBackgroundError(response?.code);
    setIdentityProfileStatus(message, true);
    setStatus(message, true);
    return;
  }

  state.identity = {
    config: response.config,
    profiles: response.profiles
  };
  resetIdentityProfileForm();
  renderIdentityProfiles();
  setIdentityProfileStatus("본인인증 정보를 저장했습니다.");
  setStatus("본인인증 정보를 이 기기에 저장했습니다.");
}

async function handleIdentityProfileListClick(event) {
  const button = event.target.closest("button[data-identity-action]");

  if (!button) {
    return;
  }

  const id = button.dataset.id;
  const profile = state.identity.profiles.find((candidate) => candidate.id === id);

  if (!profile) {
    return;
  }

  if (button.dataset.identityAction === "edit") {
    document.querySelector("#identity-profile-id").value = profile.id;
    document.querySelector("#identity-profile-label").value = profile.label || "";
    document.querySelector("#identity-name").value = profile.name || "";
    document.querySelector("#identity-phone").value = profile.phone || "";
    document.querySelector("#identity-birth").value = profile.birth || "";
    document.querySelector("#identity-carrier").value = profile.carrier || "";
    document.querySelector("#identity-gender").value = profile.gender || "";
    document.querySelector("#identity-foreigner").value = profile.foreigner ? "foreigner" : "domestic";
    document.querySelector("#identity-auth-method").value = profile.authMethod || "SMS";
    document.querySelector("#save-identity-profile").textContent = "수정 내용 저장";
    setIdentityProfileStatus("저장된 정보를 수정한 뒤 ‘수정 내용 저장’을 누르세요.");
    document.querySelector("#identity-name").focus();
    setStatus("저장된 본인인증 정보를 편집 중입니다.");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: button.dataset.identityAction === "delete"
      ? "IDENTITY_DELETE_PROFILE"
      : "IDENTITY_SELECT_PROFILE",
    id
  });

  if (!response?.ok) {
    setStatus(response?.error || "저장된 본인인증 정보를 처리하지 못했습니다.", true);
    return;
  }

  state.identity = {
    config: response.config,
    profiles: response.profiles
  };
  renderIdentityProfiles();
  setStatus(button.dataset.identityAction === "delete" ? "저장된 본인인증 정보를 삭제했습니다." : "사용할 본인인증 정보를 변경했습니다.");
}

function resetIdentityProfileForm() {
  document.querySelector("#identity-profile-id").value = "";
  document.querySelector("#identity-profile-label").value = "";
  document.querySelector("#identity-name").value = "";
  document.querySelector("#identity-phone").value = "";
  document.querySelector("#identity-birth").value = "";
  document.querySelector("#identity-carrier").value = "";
  document.querySelector("#identity-gender").value = "";
  document.querySelector("#identity-foreigner").value = "domestic";
  document.querySelector("#identity-auth-method").value = "SMS";
  document.querySelector("#save-identity-profile").textContent = "새 본인인증 정보 저장";
  identityValidatedFields.forEach(clearIdentityFieldInvalid);
  setIdentityProfileStatus("");
}

function handleIdentityNumericInput(event) {
  const maxLength = event.target.id === "identity-birth" ? 8 : 11;
  const digits = IdentityAutofillCore.digitsOnly(event.target.value).slice(0, maxLength);

  if (event.target.value !== digits) {
    event.target.value = digits;
  }
}

function validateIdentityProfileForm() {
  const invalid = identityValidatedFields
    .map((field) => ({ field, message: getIdentityFieldError(field) }))
    .filter((result) => result.message);

  identityValidatedFields.forEach((field) => {
    const result = invalid.find((candidate) => candidate.field === field);
    setIdentityFieldInvalid(field, result?.message || "");
  });

  if (!invalid.length) {
    return true;
  }

  const message = invalid[0].message;
  setIdentityProfileStatus(message, true);
  setStatus(message, true);
  invalid[0].field.focus();
  return false;
}

function validateIdentityField(field, showMessage) {
  const message = getIdentityFieldError(field);
  setIdentityFieldInvalid(field, message);

  if (message && showMessage) {
    setIdentityProfileStatus(message, true);
  }

  return !message;
}

function refreshIdentityFieldValidity(field) {
  if (field.getAttribute("aria-invalid") === "true") {
    validateIdentityField(field, false);

    if (!identityValidatedFields.some((candidate) => candidate.getAttribute("aria-invalid") === "true")) {
      setIdentityProfileStatus("");
    }
  }
}

function getIdentityFieldError(field) {
  const value = field.value.trim();

  if (field.id === "identity-name") {
    return value ? "" : "이름을 입력하세요.";
  }

  if (field.id === "identity-phone") {
    return IdentityAutofillCore.isValidPhoneNumber(value)
      ? ""
      : "휴대폰 번호는 01로 시작하는 10~11자리 숫자여야 합니다.";
  }

  if (field.id === "identity-birth") {
    return IdentityAutofillCore.isValidBirthDate(value)
      ? ""
      : "생년월일은 유효한 YYYYMMDD 8자리여야 합니다.";
  }

  if (field.id === "identity-carrier") {
    return value ? "" : "통신사를 선택하세요.";
  }

  if (field.id === "identity-gender") {
    return value ? "" : "성별을 선택하세요.";
  }

  if (field.id === "identity-auth-method") {
    return ["SMS", "PASS"].includes(value) ? "" : "인증방식을 선택하세요.";
  }

  return "";
}

function setIdentityFieldInvalid(field, message) {
  field.closest(".field")?.classList.toggle("field-invalid", Boolean(message));

  if (message) {
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-errormessage", "identity-profile-status");
  } else {
    clearIdentityFieldInvalid(field);
  }
}

function clearIdentityFieldInvalid(field) {
  field.closest(".field")?.classList.remove("field-invalid");
  field.removeAttribute("aria-invalid");
  field.removeAttribute("aria-errormessage");
}

function markIdentityBackgroundError(code) {
  const fieldByCode = {
    NAME_REQUIRED: "identity-name",
    INVALID_PHONE: "identity-phone",
    INVALID_BIRTH: "identity-birth",
    INVALID_CARRIER: "identity-carrier",
    INVALID_GENDER: "identity-gender",
    INVALID_AUTH_METHOD: "identity-auth-method"
  };
  const id = fieldByCode[code];

  if (id) {
    setIdentityFieldInvalid(document.querySelector(`#${id}`), "invalid");
  }
}

function formatCarrier(value) {
  const labels = {
    SKT: "SKT",
    KT: "KT",
    LGU: "LG U+",
    SKT_MVNO: "SKT 알뜰폰",
    KT_MVNO: "KT 알뜰폰",
    LGU_MVNO: "LG U+ 알뜰폰"
  };
  return labels[value] || value || "-";
}

function renderOpenSignals() {
  const { config, history } = state.openSignal;
  document.querySelector("#open-signal-service-url").value = config.serviceBaseUrl || "";
  document.querySelector("#open-signal-enabled").checked = config.enabled === true;
  document.querySelector("#open-signal-consent").checked = config.consentAccepted === true;

  if (!history.length) {
    openSignalHistory.className = "rule-list empty-state";
    openSignalHistory.textContent = "아직 추적한 메일이 없습니다.";
    return;
  }

  openSignalHistory.className = "rule-list";
  openSignalHistory.innerHTML = history.map((track) => {
    const detected = track.requestCount > 0;
    const stateLabel = detected
      ? `열람 신호 ${track.requestCount}회`
      : track.armedAt
        ? "전송됨 · 신호 대기"
        : "초안 · 전송 전";
    const timestamps = [
      track.firstSignalAt ? `최초 ${formatDateTime(track.firstSignalAt)}` : "",
      track.latestSignalAt ? `최근 ${formatDateTime(track.latestSignalAt)}` : ""
    ].filter(Boolean);

    return `
      <article class="rule-card">
        <div class="rule-meta">
          <strong class="card-title">${escapeHtml(track.subjectLabel || "(제목 없음)")}</strong>
          <span class="signal-chip ${detected ? "detected" : ""}">${escapeHtml(stateLabel)}</span>
          <div class="open-signal-meta">
            <span>수신자 ${Number(track.recipientCount || 0)}명</span>
            <span>생성 ${escapeHtml(formatDateTime(track.createdAt))}</span>
            ${timestamps.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}
          </div>
        </div>
        <div class="inline-actions">
          <button class="secondary" data-open-signal-action="refresh" data-id="${escapeHtml(track.id)}" type="button">조회</button>
          <button class="danger" data-open-signal-action="delete" data-id="${escapeHtml(track.id)}" type="button">삭제</button>
        </div>
      </article>
    `;
  }).join("");
}

async function handleSaveOpenSignalConfig(event) {
  event.preventDefault();
  const config = {
    serviceBaseUrl: document.querySelector("#open-signal-service-url").value.trim(),
    enabled: document.querySelector("#open-signal-enabled").checked,
    consentAccepted: document.querySelector("#open-signal-consent").checked,
    consentAcceptedAt: state.openSignal.config.consentAcceptedAt || new Date().toISOString()
  };

  if (config.enabled && !config.consentAccepted) {
    setStatus("열람 신호를 켜려면 데이터 전송과 정확도 한계에 동의해야 합니다.", true);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "OPEN_SIGNAL_CONFIGURE",
    config
  });

  if (!response?.ok) {
    setStatus(response?.error || "열람 신호 설정을 저장하지 못했습니다.", true);
    return;
  }

  state.openSignal = {
    config: response.config,
    history: response.history
  };
  renderOpenSignals();
  setStatus("Gmail 열람 신호 설정을 저장했습니다.");
}

async function handleRefreshOpenSignals() {
  setStatus("열람 신호 상태를 확인하고 있습니다.");
  const response = await chrome.runtime.sendMessage({ type: "OPEN_SIGNAL_REFRESH_ALL" });

  if (!response?.ok) {
    setStatus(response?.error || "열람 신호 상태를 조회하지 못했습니다.", true);
    return;
  }

  state.openSignal = {
    config: response.config,
    history: response.history
  };
  renderOpenSignals();
  setStatus("열람 신호 상태를 새로고침했습니다.");
}

async function handleOpenSignalHistoryClick(event) {
  const button = event.target.closest("button[data-open-signal-action]");

  if (!button) {
    return;
  }

  const type = button.dataset.openSignalAction === "delete"
    ? "OPEN_SIGNAL_DELETE"
    : "OPEN_SIGNAL_REFRESH";
  const response = await chrome.runtime.sendMessage({
    type,
    id: button.dataset.id
  });

  if (!response?.ok) {
    setStatus(response?.error || "열람 신호 기록을 처리하지 못했습니다.", true);
    return;
  }

  if (type === "OPEN_SIGNAL_DELETE") {
    state.openSignal = {
      config: response.config,
      history: response.history
    };
  } else {
    state.openSignal.history = state.openSignal.history.map((track) => {
      return track.id === response.track.id ? response.track : track;
    });
  }

  renderOpenSignals();
  setStatus(type === "OPEN_SIGNAL_DELETE" ? "열람 신호 기록을 삭제했습니다." : "열람 신호를 조회했습니다.");
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
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

async function handleExportIdentityProfiles() {
  const passphrase = document.querySelector("#identity-export-passphrase").value;
  const exportButton = document.querySelector("#export-identity-profiles");
  setIdentityTransferStatus("");

  if (passphrase.length < 8) {
    const message = "내보내기 비밀번호는 8자 이상이어야 합니다.";
    setIdentityTransferStatus(message, true);
    setStatus(message, true);
    return;
  }

  if (!state.identity.profiles.length) {
    const message = "내보낼 본인인증 정보가 없습니다.";
    setIdentityTransferStatus(message, true);
    setStatus(message, true);
    return;
  }

  exportButton.disabled = true;
  setIdentityTransferStatus("본인인증 정보를 암호화하고 있습니다.");

  try {
    const encrypted = await IdentityAutofillTransfer.encrypt({
      version: 1,
      exportedAt: new Date().toISOString(),
      config: state.identity.config,
      profiles: state.identity.profiles
    }, passphrase);
    document.querySelector("#identity-sync-code").value = JSON.stringify(encrypted, null, 2);
    setIdentityTransferStatus("암호화된 JSON을 만들었습니다. ‘암호화 JSON 복사’를 누르세요.");
    setStatus("본인인증 정보를 암호화해 내보냈습니다.");
  } catch (error) {
    const message = "본인인증 정보를 암호화하지 못했습니다. 이 브라우저의 암호화 기능을 확인하세요.";
    setIdentityTransferStatus(message, true);
    setStatus(message, true);
  } finally {
    exportButton.disabled = false;
  }
}

async function handleCopyIdentityProfiles() {
  const textarea = document.querySelector("#identity-sync-code");
  setIdentityTransferStatus("");

  if (!textarea.value.trim()) {
    const message = "먼저 본인인증 정보를 암호화해 내보내세요.";
    setIdentityTransferStatus(message, true);
    setStatus(message, true);
    return;
  }

  try {
    await copyTextToClipboard(textarea.value, textarea);
    setIdentityTransferStatus("암호화된 JSON을 클립보드에 복사했습니다.");
    setStatus("암호화된 본인인증 정보 JSON을 클립보드에 복사했습니다.");
  } catch (error) {
    textarea.focus();
    textarea.select();
    const message = "자동 복사가 차단됐습니다. 선택된 JSON을 Ctrl+C로 복사하세요.";
    setIdentityTransferStatus(message, true);
    setStatus(message, true);
  }
}

async function handleImportIdentityProfiles() {
  const raw = document.querySelector("#identity-sync-code").value.trim();
  const passphrase = document.querySelector("#identity-export-passphrase").value;
  const importButton = document.querySelector("#import-identity-profiles");
  setIdentityTransferStatus("");

  if (!raw || passphrase.length < 8) {
    const message = "암호화된 JSON과 8자 이상의 비밀번호를 입력하세요.";
    setIdentityTransferStatus(message, true);
    setStatus(message, true);
    return;
  }

  importButton.disabled = true;
  setIdentityTransferStatus("암호화된 JSON을 확인하고 있습니다.");

  try {
    const envelope = JSON.parse(raw);
    const payload = await IdentityAutofillTransfer.decrypt(envelope, passphrase);

    if (payload?.version !== 1 || !Array.isArray(payload.profiles)) {
      throw new Error("Invalid identity export payload");
    }

    const response = await chrome.runtime.sendMessage({
      type: "IDENTITY_REPLACE_PROFILES",
      config: payload.config,
      profiles: payload.profiles
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Import failed");
    }

    state.identity = {
      config: response.config,
      profiles: response.profiles
    };
    resetIdentityProfileForm();
    renderIdentityProfiles();
    setIdentityTransferStatus("본인인증 정보를 가져왔습니다.");
    setStatus("암호화된 본인인증 정보를 가져와 현재 저장 정보를 교체했습니다.");
  } catch (error) {
    const message = "본인인증 정보 JSON 또는 비밀번호가 올바르지 않습니다.";
    setIdentityTransferStatus(message, true);
    setStatus(message, true);
  } finally {
    importButton.disabled = false;
  }
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

  try {
    await copyTextToClipboard(textarea.value, textarea);
    setStatus("설정 JSON을 클립보드에 복사했습니다.");
  } catch (error) {
    textarea.focus();
    textarea.select();
    setStatus("자동 복사가 차단됐습니다. 선택된 JSON을 Ctrl+C로 복사하세요.", true);
  }
}

async function copyTextToClipboard(value, fallbackElement) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch (error) {
    fallbackElement.focus();
    fallbackElement.select();

    if (document.execCommand("copy")) {
      return;
    }

    throw error;
  }
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

function setIdentityProfileStatus(message, isError = false) {
  identityProfileStatus.textContent = message;
  identityProfileStatus.style.color = isError ? "#b42318" : "";
}

function setIdentityTransferStatus(message, isError = false) {
  identityTransferStatus.textContent = message;
  identityTransferStatus.style.color = isError ? "#b42318" : "";
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
