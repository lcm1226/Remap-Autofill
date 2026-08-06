if (typeof importScripts === "function") {
  importScripts("identity-profile.js");
}

const SETTINGS_KEY = "remapKeyAdvancedAutoFillSettings";
const DRAFT_KEY = "remapKeyAdvancedAutoFillDraft";
const IDENTITY_CONFIG_KEY = "identityAutofillConfig";
const IDENTITY_PROFILES_KEY = "identityAutofillProfiles";
const IDENTITY_ALLOWED_HOSTS = new Set([
  "nice.checkplus.co.kr",
  "pcc.siren24.com",
  "safe.ok-name.co.kr",
  "cert.mobile-ok.com"
]);
const OPEN_SIGNAL_CONFIG_KEY = "gmailOpenSignalConfig";
const OPEN_SIGNAL_CREDENTIALS_KEY = "gmailOpenSignalCredentials";
const OPEN_SIGNAL_HISTORY_KEY = "gmailOpenSignalHistory";
const OPEN_SIGNAL_HISTORY_LIMIT = 100;
const OPEN_SIGNAL_REQUEST_TIMEOUT_MS = 10000;
const OPEN_SIGNAL_DEFAULT_SERVICE_BASE_URL = "https://keyremap-gmail-open-signal.phantom-cinnamon-008.workers.dev";

let openSignalHistoryQueue = Promise.resolve();
let openSignalCredentialsPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  const [stored, identityStored] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get([IDENTITY_CONFIG_KEY, IDENTITY_PROFILES_KEY])
  ]);

  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: getDefaultSettings()
    });
  }

  const profiles = IdentityAutofillCore.normalizeProfiles(identityStored[IDENTITY_PROFILES_KEY]);
  const config = IdentityAutofillCore.normalizeConfig(identityStored[IDENTITY_CONFIG_KEY], profiles);
  await chrome.storage.local.set({
    [IDENTITY_CONFIG_KEY]: config,
    [IDENTITY_PROFILES_KEY]: profiles
  });
  await restrictLocalStorageAccess();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "start-field-picker") {
    return;
  }

  await startPickerOnActiveTab();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_PICKER") {
    startPickerOnActiveTab()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "PICKER_COMPLETE") {
    chrome.storage.local.set({ [DRAFT_KEY]: message.selection || null })
      .then(async () => {
        await notifyDraftUpdated();
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CLEAR_DRAFT") {
    chrome.storage.local.remove(DRAFT_KEY)
      .then(async () => {
        await notifyDraftUpdated();
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (String(message?.type || "").startsWith("IDENTITY_")) {
    handleIdentityMessage(message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        code: error.code || "IDENTITY_ERROR",
        error: error.message || "본인인증 자동입력 요청을 처리하지 못했습니다."
      }));
    return true;
  }

  if (String(message?.type || "").startsWith("OPEN_SIGNAL_")) {
    handleOpenSignalMessage(message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        code: error.code || "OPEN_SIGNAL_ERROR",
        error: error.message || "열람 신호 요청을 처리하지 못했습니다."
      }));
    return true;
  }

  return false;
});

async function handleIdentityMessage(message, sender) {
  if (message.type === "IDENTITY_GET_ACTIVE_PROFILE") {
    const providerHost = assertIdentityProviderSender(sender);
    const { config, profiles } = await getIdentityState();
    const profile = config.enabled
      ? profiles.find((candidate) => candidate.id === config.activeProfileId) || null
      : null;

    return {
      config,
      profile: IdentityAutofillCore.sanitizeProfileForContent(profile),
      provider: providerHost
    };
  }

  assertIdentityUiSender(sender);

  if (message.type === "IDENTITY_GET_STATE") {
    return getIdentityState();
  }

  if (message.type === "IDENTITY_SAVE_CONFIG") {
    const { profiles } = await getIdentityState();
    const config = IdentityAutofillCore.normalizeConfig(message.config, profiles);
    await chrome.storage.local.set({ [IDENTITY_CONFIG_KEY]: config });
    return getIdentityState();
  }

  if (message.type === "IDENTITY_SAVE_PROFILE") {
    const state = await getIdentityState();
    const requestedId = String(message.profile?.id || "").trim();
    const existing = state.profiles.find((candidate) => candidate.id === requestedId) || null;
    const profile = IdentityAutofillCore.normalizeProfile(message.profile, existing);

    if (!existing && state.profiles.length >= 20) {
      throw createIdentityError("TOO_MANY_PROFILES", "본인인증 정보는 최대 20개까지 저장할 수 있습니다.");
    }

    const profiles = existing
      ? state.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate)
      : [profile, ...state.profiles];
    const requestedConfig = message.config && typeof message.config === "object"
      ? { ...state.config, ...message.config }
      : state.config;
    const config = IdentityAutofillCore.normalizeConfig({
      ...requestedConfig,
      activeProfileId: requestedConfig.activeProfileId || profile.id
    }, profiles);
    await chrome.storage.local.set({
      [IDENTITY_CONFIG_KEY]: config,
      [IDENTITY_PROFILES_KEY]: profiles
    });
    return { config, profiles };
  }

  if (message.type === "IDENTITY_DELETE_PROFILE") {
    const state = await getIdentityState();
    const id = String(message.id || "");
    const profiles = state.profiles.filter((profile) => profile.id !== id);
    const config = IdentityAutofillCore.normalizeConfig(state.config, profiles);
    await chrome.storage.local.set({
      [IDENTITY_CONFIG_KEY]: config,
      [IDENTITY_PROFILES_KEY]: profiles
    });
    return { config, profiles };
  }

  if (message.type === "IDENTITY_SELECT_PROFILE") {
    const state = await getIdentityState();
    const id = String(message.id || "");

    if (!state.profiles.some((profile) => profile.id === id)) {
      throw createIdentityError("PROFILE_NOT_FOUND", "선택할 프로필을 찾지 못했습니다.");
    }

    const config = IdentityAutofillCore.normalizeConfig({
      ...state.config,
      activeProfileId: id
    }, state.profiles);
    await chrome.storage.local.set({ [IDENTITY_CONFIG_KEY]: config });
    return { config, profiles: state.profiles };
  }

  if (message.type === "IDENTITY_REPLACE_PROFILES") {
    assertIdentityOptionsSender(sender);
    const candidates = Array.isArray(message.profiles) ? message.profiles : [];

    if (candidates.length > 20) {
      throw createIdentityError("TOO_MANY_PROFILES", "프로필은 최대 20개까지 가져올 수 있습니다.");
    }

    const profiles = candidates.map((candidate) => IdentityAutofillCore.normalizeProfile(candidate, candidate));
    const ids = new Set(profiles.map((profile) => profile.id));

    if (ids.size !== profiles.length) {
      throw createIdentityError("DUPLICATE_PROFILE_ID", "중복된 프로필 ID가 있습니다.");
    }

    const config = IdentityAutofillCore.normalizeConfig(message.config, profiles);
    await chrome.storage.local.set({
      [IDENTITY_CONFIG_KEY]: config,
      [IDENTITY_PROFILES_KEY]: profiles
    });
    return { config, profiles };
  }

  throw createIdentityError("UNKNOWN_MESSAGE", "지원하지 않는 본인인증 자동입력 요청입니다.");
}

async function getIdentityState() {
  const stored = await chrome.storage.local.get([IDENTITY_CONFIG_KEY, IDENTITY_PROFILES_KEY]);
  const profiles = IdentityAutofillCore.normalizeProfiles(stored[IDENTITY_PROFILES_KEY]);
  const config = IdentityAutofillCore.normalizeConfig(stored[IDENTITY_CONFIG_KEY], profiles);
  return { config, profiles };
}

function assertIdentityUiSender(sender) {
  const extensionRoot = chrome.runtime.getURL("");

  if (!String(sender.url || "").startsWith(extensionRoot)) {
    throw createIdentityError("EXTENSION_UI_ONLY", "확장 프로그램 화면에서만 프로필을 관리할 수 있습니다.");
  }
}

function assertIdentityOptionsSender(sender) {
  if (!String(sender.url || "").startsWith(chrome.runtime.getURL("options.html"))) {
    throw createIdentityError("OPTIONS_ONLY", "옵션 화면에서만 프로필 전체를 가져올 수 있습니다.");
  }
}

function assertIdentityProviderSender(sender) {
  let parsed;

  try {
    parsed = new URL(sender.url || "");
  } catch (error) {
    throw createIdentityError("PROVIDER_ONLY", "지원하는 본인인증 화면에서만 프로필을 사용할 수 있습니다.");
  }

  if (parsed.protocol !== "https:" || !IDENTITY_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw createIdentityError("PROVIDER_ONLY", "지원하는 본인인증 화면에서만 프로필을 사용할 수 있습니다.");
  }

  return parsed.hostname;
}

async function restrictLocalStorageAccess() {
  if (typeof chrome.storage.local.setAccessLevel !== "function") {
    return;
  }

  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (error) {
    // Chrome 114 supports this API; keep older compatible runtimes fail-safe.
  }
}

function createIdentityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function handleOpenSignalMessage(message, sender) {
  if (message.type === "OPEN_SIGNAL_GET_STATE") {
    assertOpenSignalUiOrGmailSender(sender);
    return getOpenSignalState();
  }

  if (message.type === "OPEN_SIGNAL_CONFIGURE") {
    if (!String(sender.url || "").startsWith(chrome.runtime.getURL("options.html"))) {
      throw createOpenSignalError("OPTIONS_ONLY", "옵션 화면에서만 설정을 변경할 수 있습니다.");
    }

    const config = normalizeOpenSignalConfig(message.config);
    await chrome.storage.local.set({ [OPEN_SIGNAL_CONFIG_KEY]: config });
    return getOpenSignalState();
  }

  if (message.type === "OPEN_SIGNAL_ACTIVATE") {
    assertGmailSender(sender);
    await activateOpenSignalFromGmail();
    return getOpenSignalState();
  }

  if (message.type === "OPEN_SIGNAL_REGISTER") {
    assertGmailSender(sender);
    await activateOpenSignalFromGmail();
    return registerOpenSignal(message.compose || {});
  }

  if (message.type === "OPEN_SIGNAL_ARM") {
    assertGmailSender(sender);
    return armOpenSignal(message.id);
  }

  if (message.type === "OPEN_SIGNAL_REFRESH") {
    assertOpenSignalOptionsSender(sender);
    return refreshOpenSignal(message.id);
  }

  if (message.type === "OPEN_SIGNAL_REFRESH_ALL") {
    assertOpenSignalOptionsSender(sender);
    return refreshAllOpenSignals();
  }

  if (message.type === "OPEN_SIGNAL_DELETE") {
    assertOpenSignalUiOrGmailSender(sender);
    return deleteOpenSignal(message.id);
  }

  throw createOpenSignalError("UNKNOWN_MESSAGE", "지원하지 않는 열람 신호 요청입니다.");
}

async function activateOpenSignalFromGmail() {
  const current = await getOpenSignalConfig();

  if (current.enabled && current.consentAccepted) {
    return current;
  }

  const config = normalizeOpenSignalConfig({
    ...current,
    enabled: true,
    consentAccepted: true,
    consentAcceptedAt: current.consentAcceptedAt || new Date().toISOString()
  });
  await chrome.storage.local.set({ [OPEN_SIGNAL_CONFIG_KEY]: config });
  return config;
}

async function registerOpenSignal(compose) {
  const config = await getOpenSignalConfig();
  assertOpenSignalReady(config);

  const credentials = await getOpenSignalCredentials();
  const token = createRandomBase64Url(32);
  const registration = await requestOpenSignalJson(config, "/v1/tracks", {
    method: "POST",
    credentials,
    body: { token }
  });
  const track = {
    id: registration.id,
    token,
    subjectLabel: sanitizeSubject(compose.subjectLabel),
    recipientCount: sanitizeRecipientCount(compose.recipientCount),
    serviceBaseUrl: config.serviceBaseUrl,
    createdAt: registration.createdAt,
    expiresAt: registration.expiresAt,
    armedAt: registration.armedAt || null,
    firstSignalAt: registration.firstSignalAt || null,
    latestSignalAt: registration.latestSignalAt || null,
    requestCount: registration.requestCount || 0,
    state: "draft"
  };

  await mutateOpenSignalHistory((history) => [track, ...history].slice(0, OPEN_SIGNAL_HISTORY_LIMIT));

  return {
    track: sanitizeTrackForUi(track),
    pixelUrl: `${config.serviceBaseUrl}/o/${token}.gif?c=${createRandomBase64Url(8)}`
  };
}

async function armOpenSignal(id) {
  const track = await findOpenSignalTrack(id);
  const config = await getOpenSignalConfigForTrack(track);
  const credentials = await getOpenSignalCredentials();
  const status = await requestOpenSignalJson(config, `/v1/tracks/${encodeURIComponent(track.id)}/arm`, {
    method: "POST",
    credentials
  });

  const updated = await updateOpenSignalTrack(track.id, (current) => ({
    ...current,
    ...status,
    state: "sent"
  }));
  return { track: sanitizeTrackForUi(updated) };
}

async function refreshOpenSignal(id) {
  const track = await findOpenSignalTrack(id);
  const config = await getOpenSignalConfigForTrack(track);
  const credentials = await getOpenSignalCredentials();
  const status = await requestOpenSignalJson(config, `/v1/tracks/${encodeURIComponent(track.id)}`, {
    method: "GET",
    credentials
  });
  const updated = await updateOpenSignalTrack(track.id, (current) => ({
    ...current,
    ...status,
    state: status.armedAt ? "sent" : current.state
  }));
  return { track: sanitizeTrackForUi(updated) };
}

async function refreshAllOpenSignals() {
  const { history } = await getOpenSignalState();

  for (const track of history) {
    try {
      await refreshOpenSignal(track.id);
    } catch (error) {
      // Keep the remaining history refreshes independent.
    }
  }

  return getOpenSignalState();
}

async function deleteOpenSignal(id) {
  const track = await findOpenSignalTrack(id);
  const config = await getOpenSignalConfigForTrack(track);
  const credentials = await getOpenSignalCredentials();

  try {
    await requestOpenSignalJson(config, `/v1/tracks/${encodeURIComponent(track.id)}`, {
      method: "DELETE",
      credentials
    });
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  await mutateOpenSignalHistory((history) => history.filter((item) => item.id !== track.id));
  return getOpenSignalState();
}

async function getOpenSignalState() {
  const stored = await chrome.storage.local.get([
    OPEN_SIGNAL_CONFIG_KEY,
    OPEN_SIGNAL_HISTORY_KEY
  ]);
  const config = normalizeOpenSignalConfig(stored[OPEN_SIGNAL_CONFIG_KEY]);
  const history = Array.isArray(stored[OPEN_SIGNAL_HISTORY_KEY])
    ? stored[OPEN_SIGNAL_HISTORY_KEY].map(sanitizeTrackForUi)
    : [];

  return { config, history };
}

async function getOpenSignalConfig() {
  const stored = await chrome.storage.local.get(OPEN_SIGNAL_CONFIG_KEY);
  return normalizeOpenSignalConfig(stored[OPEN_SIGNAL_CONFIG_KEY]);
}

async function getOpenSignalConfigForTrack(track) {
  const config = await getOpenSignalConfig();
  return {
    ...config,
    serviceBaseUrl: normalizeServiceBaseUrl(track.serviceBaseUrl || config.serviceBaseUrl)
  };
}

function normalizeOpenSignalConfig(stored) {
  const serviceBaseUrl = normalizeServiceBaseUrl(
    stored?.serviceBaseUrl || OPEN_SIGNAL_DEFAULT_SERVICE_BASE_URL
  );
  return {
    enabled: stored?.enabled === true,
    consentAccepted: stored?.consentAccepted === true,
    consentAcceptedAt: stored?.consentAccepted === true
      ? (stored.consentAcceptedAt || new Date().toISOString())
      : null,
    serviceBaseUrl
  };
}

function normalizeServiceBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");

  if (!raw) {
    return "";
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch (error) {
    throw createOpenSignalError("INVALID_SERVICE_URL", "열람 신호 서버 주소가 올바르지 않습니다.");
  }

  const isLocalHttp = parsed.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);

  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw createOpenSignalError("INSECURE_SERVICE_URL", "공개 열람 신호 서버는 HTTPS 주소여야 합니다.");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw createOpenSignalError("INVALID_SERVICE_URL", "서버 주소에는 인증정보, 쿼리, 또는 해시를 넣을 수 없습니다.");
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function assertOpenSignalReady(config) {
  if (!config.enabled) {
    throw createOpenSignalError("FEATURE_DISABLED", "옵션에서 Gmail 열람 신호 기능을 먼저 켜세요.");
  }

  if (!config.consentAccepted) {
    throw createOpenSignalError("CONSENT_REQUIRED", "옵션에서 열람 신호의 한계와 데이터 전송에 동의해야 합니다.");
  }

  if (!config.serviceBaseUrl) {
    throw createOpenSignalError("SERVICE_URL_REQUIRED", "옵션에서 열람 신호 서버 주소를 설정하세요.");
  }
}

async function getOpenSignalCredentials() {
  if (!openSignalCredentialsPromise) {
    openSignalCredentialsPromise = (async () => {
      const stored = await chrome.storage.local.get(OPEN_SIGNAL_CREDENTIALS_KEY);
      const existing = stored[OPEN_SIGNAL_CREDENTIALS_KEY];

      if (existing?.installationId && existing?.installationSecret) {
        return existing;
      }

      const credentials = {
        installationId: crypto.randomUUID(),
        installationSecret: createRandomBase64Url(32)
      };
      await chrome.storage.local.set({ [OPEN_SIGNAL_CREDENTIALS_KEY]: credentials });
      return credentials;
    })();
  }

  return openSignalCredentialsPromise;
}

async function requestOpenSignalJson(config, path, { method, credentials, body }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPEN_SIGNAL_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.serviceBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.installationSecret}`,
        "Content-Type": "application/json",
        "X-Installation-Id": credentials.installationId
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = createOpenSignalError(payload.error || "SERVICE_ERROR", "열람 신호 서버 요청에 실패했습니다.");
      error.status = response.status;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createOpenSignalError("SERVICE_TIMEOUT", "열람 신호 서버가 응답하지 않습니다.");
    }

    if (error.code) {
      throw error;
    }

    throw createOpenSignalError("SERVICE_UNREACHABLE", "열람 신호 서버에 연결하지 못했습니다.");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function findOpenSignalTrack(id) {
  const stored = await chrome.storage.local.get(OPEN_SIGNAL_HISTORY_KEY);
  const history = Array.isArray(stored[OPEN_SIGNAL_HISTORY_KEY])
    ? stored[OPEN_SIGNAL_HISTORY_KEY]
    : [];
  const track = history.find((item) => item.id === id);

  if (!track) {
    throw createOpenSignalError("TRACK_NOT_FOUND", "열람 신호 기록을 찾지 못했습니다.");
  }

  return track;
}

async function updateOpenSignalTrack(id, updater) {
  let updated = null;
  await mutateOpenSignalHistory((history) => history.map((track) => {
    if (track.id !== id) {
      return track;
    }

    updated = updater(track);
    return updated;
  }));

  if (!updated) {
    throw createOpenSignalError("TRACK_NOT_FOUND", "열람 신호 기록을 찾지 못했습니다.");
  }

  return updated;
}

function mutateOpenSignalHistory(mutator) {
  openSignalHistoryQueue = openSignalHistoryQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(OPEN_SIGNAL_HISTORY_KEY);
    const history = Array.isArray(stored[OPEN_SIGNAL_HISTORY_KEY])
      ? stored[OPEN_SIGNAL_HISTORY_KEY]
      : [];
    const nextHistory = mutator(history);
    await chrome.storage.local.set({ [OPEN_SIGNAL_HISTORY_KEY]: nextHistory });
    return nextHistory;
  });

  return openSignalHistoryQueue;
}

function sanitizeTrackForUi(track) {
  return {
    id: String(track.id || ""),
    subjectLabel: sanitizeSubject(track.subjectLabel),
    recipientCount: sanitizeRecipientCount(track.recipientCount),
    createdAt: track.createdAt || null,
    expiresAt: track.expiresAt || null,
    armedAt: track.armedAt || null,
    firstSignalAt: track.firstSignalAt || null,
    latestSignalAt: track.latestSignalAt || null,
    requestCount: Number.isSafeInteger(track.requestCount) ? track.requestCount : 0,
    state: track.state === "sent" ? "sent" : "draft"
  };
}

function sanitizeSubject(value) {
  return String(value || "(제목 없음)").trim().slice(0, 200) || "(제목 없음)";
}

function sanitizeRecipientCount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function assertGmailSender(sender) {
  if (!sender.tab?.url?.startsWith("https://mail.google.com/")) {
    throw createOpenSignalError("GMAIL_ONLY", "Gmail 작성창에서만 열람 신호를 만들 수 있습니다.");
  }
}

function assertOpenSignalOptionsSender(sender) {
  if (!String(sender.url || "").startsWith(chrome.runtime.getURL("options.html"))) {
    throw createOpenSignalError("OPTIONS_ONLY", "옵션 화면에서만 열람 신호 기록을 조회할 수 있습니다.");
  }
}

function assertOpenSignalUiOrGmailSender(sender) {
  const extensionRoot = chrome.runtime.getURL("");

  if (String(sender.url || "").startsWith(extensionRoot)) {
    return;
  }

  assertGmailSender(sender);
}

function createRandomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createOpenSignalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function startPickerOnActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    return { ok: false, error: "No active tab is available." };
  }

  if (!/^https?:/i.test(tab.url || "")) {
    return { ok: false, error: "Field picking only works on regular web pages." };
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: "Could not reach the page. Refresh the tab and try again."
    };
  }
}

async function notifyDraftUpdated() {
  try {
    await chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" });
  } catch (error) {
    // Ignore when no popup or options page is listening.
  }
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
