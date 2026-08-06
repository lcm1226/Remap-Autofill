const OPEN_SIGNAL_MARKER = "data-keyremap-open-signal";
const OPEN_SIGNAL_ID_ATTRIBUTE = "data-keyremap-open-signal-id";
const COMPOSE_SCAN_DELAY_MS = 120;
const SEND_CONFIRM_TIMEOUT_MS = 15000;

const composeStates = new WeakMap();
let composeScanTimer = null;
let configuredServiceBaseUrl = "";
let openSignalConfig = null;

bootstrapGmailOpenSignals();

async function bootstrapGmailOpenSignals() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "OPEN_SIGNAL_GET_STATE" });
    openSignalConfig = response?.config || null;
    configuredServiceBaseUrl = openSignalConfig?.serviceBaseUrl || "";
  } catch (error) {
    openSignalConfig = null;
    configuredServiceBaseUrl = "";
  }

  scanForComposeWindows(document);

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.addedNodes.length > 0)) {
      return;
    }

    window.clearTimeout(composeScanTimer);
    composeScanTimer = window.setTimeout(() => {
      scanForComposeWindows(document);
    }, COMPOSE_SCAN_DELAY_MS);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener("click", handlePossibleSendClick, true);
  document.addEventListener("keydown", handlePossibleKeyboardSend, true);
}

function scanForComposeWindows(root) {
  const candidates = [
    ...(root.matches?.('div[role="dialog"]') ? [root] : []),
    ...root.querySelectorAll?.('div[role="dialog"]') || []
  ];

  candidates.forEach((composeRoot) => {
    if (!findComposeBody(composeRoot) || composeStates.has(composeRoot)) {
      return;
    }

    initializeCompose(composeRoot);
  });
}

function initializeCompose(composeRoot) {
  const state = {
    root: composeRoot,
    button: null,
    status: null,
    active: false,
    pending: false,
    sending: false,
    track: null,
    pixelUrl: ""
  };
  composeStates.set(composeRoot, state);

  const existingPixel = findComposeBody(composeRoot)?.querySelector(`img[${OPEN_SIGNAL_MARKER}]`);

  if (existingPixel) {
    const trackId = existingPixel.getAttribute(OPEN_SIGNAL_ID_ATTRIBUTE);
    state.active = Boolean(trackId);
    state.track = trackId ? { id: trackId } : null;
    state.pixelUrl = existingPixel.src || "";
  }

  mountComposeControl(state);
}

function mountComposeControl(state) {
  const sendButton = findSendButton(state.root);
  const sendGroup = sendButton?.parentElement || null;
  const mountTarget = sendGroup?.parentElement || state.root.querySelector('div[role="toolbar"]');

  if (!mountTarget) {
    window.setTimeout(() => {
      if (state.root.isConnected && !state.button) {
        mountComposeControl(state);
      }
    }, 300);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "kr-open-signal-control";
  wrapper.setAttribute(OPEN_SIGNAL_MARKER, "control");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "kr-open-signal-button";
  button.setAttribute("aria-pressed", String(state.active));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    toggleOpenSignal(state).catch((error) => {
      setComposeStatus(state, error.message || "열람 신호를 켜지 못했습니다.", true);
    });
  });

  const status = document.createElement("span");
  status.className = "kr-open-signal-status";
  status.setAttribute("aria-live", "polite");

  state.button = button;
  state.status = status;
  wrapper.append(button, status);

  if (sendGroup?.parentElement === mountTarget) {
    mountTarget.insertBefore(wrapper, sendGroup.nextSibling);
  } else {
    mountTarget.appendChild(wrapper);
  }
  renderComposeControl(state);
}

async function toggleOpenSignal(state) {
  if (state.pending || state.sending) {
    return;
  }

  if (state.active) {
    state.pending = true;
    renderComposeControl(state);
    removeProjectPixels(findComposeBody(state.root));

    if (state.track?.id) {
      try {
        await chrome.runtime.sendMessage({
          type: "OPEN_SIGNAL_DELETE",
          id: state.track.id
        });
      } catch (error) {
        // The draft remains untracked even if server cleanup is temporarily unavailable.
      }
    }

    state.active = false;
    state.track = null;
    state.pixelUrl = "";
    state.pending = false;
    setComposeStatus(state, "열람 신호 꺼짐");
    renderComposeControl(state);
    return;
  }

  const body = findComposeBody(state.root);

  if (!body) {
    throw new Error("HTML 작성창에서만 열람 신호를 사용할 수 있습니다.");
  }

  if (!(await ensureOpenSignalActivated())) {
    return;
  }

  state.pending = true;
  setComposeStatus(state, "추적 준비 중…");
  renderComposeControl(state);

  const response = await chrome.runtime.sendMessage({
    type: "OPEN_SIGNAL_REGISTER",
    compose: readComposeMetadata(state.root)
  });

  if (!response?.ok) {
    state.pending = false;
    renderComposeControl(state);
    throw new Error(response?.error || "열람 신호 서버에 연결하지 못했습니다.");
  }

  configuredServiceBaseUrl = deriveServiceBaseUrlFromPixel(response.pixelUrl);
  state.track = response.track;
  state.pixelUrl = response.pixelUrl;
  state.active = true;
  state.pending = false;
  ensureTrackingPixel(state);
  setComposeStatus(state, "전송 후 열람 신호 대기");
  renderComposeControl(state);
}

async function ensureOpenSignalActivated() {
  if (openSignalConfig?.enabled && openSignalConfig?.consentAccepted) {
    return true;
  }

  const response = await chrome.runtime.sendMessage({ type: "OPEN_SIGNAL_ACTIVATE" });

  if (!response?.ok) {
    throw new Error(response?.error || "열람 신호 기능을 활성화하지 못했습니다.");
  }

  openSignalConfig = response.config;
  configuredServiceBaseUrl = openSignalConfig?.serviceBaseUrl || configuredServiceBaseUrl;
  return true;
}

function ensureTrackingPixel(state) {
  const body = findComposeBody(state.root);

  if (!body || !state.pixelUrl || !state.track?.id) {
    return false;
  }

  removeProjectPixels(body);

  const pixel = document.createElement("img");
  pixel.src = state.pixelUrl;
  pixel.alt = "";
  pixel.width = 1;
  pixel.height = 1;
  pixel.setAttribute("aria-hidden", "true");
  pixel.setAttribute(OPEN_SIGNAL_MARKER, "pixel");
  pixel.setAttribute(OPEN_SIGNAL_ID_ATTRIBUTE, state.track.id);
  pixel.style.cssText = "width:1px;height:1px;opacity:0.01;border:0;display:inline-block;overflow:hidden;";
  body.appendChild(pixel);
  return true;
}

function removeProjectPixels(body) {
  if (!body) {
    return;
  }

  body.querySelectorAll("img").forEach((image) => {
    if (image.hasAttribute(OPEN_SIGNAL_MARKER) || isConfiguredTrackingPixel(image.src)) {
      image.remove();
    }
  });
}

function isConfiguredTrackingPixel(source) {
  if (!configuredServiceBaseUrl || !source) {
    return false;
  }

  try {
    const base = new URL(configuredServiceBaseUrl);
    const candidate = new URL(source);
    const basePath = base.pathname.replace(/\/+$/, "");
    return candidate.origin === base.origin
      && new RegExp(`^${escapeRegex(basePath)}\\/o\\/[A-Za-z0-9_-]+\\.gif$`).test(candidate.pathname);
  } catch (error) {
    return false;
  }
}

function deriveServiceBaseUrlFromPixel(pixelUrl) {
  try {
    const parsed = new URL(pixelUrl);
    const basePath = parsed.pathname.replace(/\/o\/[A-Za-z0-9_-]+\.gif$/, "");
    return `${parsed.origin}${basePath}`;
  } catch (error) {
    return "";
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function handlePossibleSendClick(event) {
  const button = event.target instanceof Element
    ? event.target.closest('[role="button"], button')
    : null;

  if (!button || !isSendButton(button)) {
    return;
  }

  const composeRoot = button.closest('div[role="dialog"]');
  const state = composeRoot ? composeStates.get(composeRoot) : null;

  if (state?.active) {
    prepareTrackedSend(state);
  }
}

function handlePossibleKeyboardSend(event) {
  if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) {
    return;
  }

  const composeRoot = event.target instanceof Element
    ? event.target.closest('div[role="dialog"]')
    : null;
  const state = composeRoot ? composeStates.get(composeRoot) : null;

  if (state?.active) {
    prepareTrackedSend(state);
  }
}

function prepareTrackedSend(state) {
  if (state.sending || !ensureTrackingPixel(state)) {
    return;
  }

  state.sending = true;
  setComposeStatus(state, "전송 확인 중…");
  renderComposeControl(state);
  waitForSendConfirmation(state.root, SEND_CONFIRM_TIMEOUT_MS).then(async (sent) => {
    if (!sent) {
      state.sending = false;
      setComposeStatus(state, "전송되지 않음 — 추적 유지", true);
      renderComposeControl(state);
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "OPEN_SIGNAL_ARM",
      id: state.track.id
    });

    if (!response?.ok) {
      return;
    }

    state.track = response.track;
  }).catch(() => {});
}

function waitForSendConfirmation(composeRoot, timeoutMs) {
  if (!composeRoot.isConnected) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const previousStatusText = new Map(
      [...document.querySelectorAll('[role="alert"], [role="status"]')]
        .map((element) => [element, String(element.textContent || "").trim()])
    );
    const observer = new MutationObserver(() => {
      if (!composeRoot.isConnected || hasNewGmailSentConfirmation(previousStatusText)) {
        observer.disconnect();
        window.clearTimeout(timeoutId);
        resolve(true);
      }
    });
    const timeoutId = window.setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeoutMs);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function hasNewGmailSentConfirmation(previousStatusText) {
  return [...document.querySelectorAll('[role="alert"], [role="status"]')].some((element) => {
    const text = String(element.textContent || "").trim();
    const previousText = previousStatusText.get(element);
    return /메시지를 보냈|메일을 보냈|message sent/i.test(text)
      && text !== previousText;
  });
}

function findComposeBody(composeRoot) {
  return composeRoot.querySelector(
    '[aria-label="Message Body"][contenteditable="true"], '
      + '[aria-label="메시지 본문"][contenteditable="true"], '
      + '[role="textbox"][contenteditable="true"]'
  );
}

function findSendButton(composeRoot) {
  return [...composeRoot.querySelectorAll('[role="button"], button')].find(isSendButton) || null;
}

function isSendButton(element) {
  const label = [
    element.getAttribute("aria-label"),
    element.getAttribute("data-tooltip"),
    element.textContent
  ].filter(Boolean).join(" ").trim();

  if (/예약|schedule|보내기 옵션|send options|more options/i.test(label)) {
    return false;
  }

  return /(^|\s)(보내기|send)(\s|$|\()/i.test(label);
}

function readComposeMetadata(composeRoot) {
  const subjectInput = composeRoot.querySelector('input[name="subjectbox"]');
  const recipientTokens = new Set();

  composeRoot.querySelectorAll("[email]").forEach((element) => {
    const value = element.getAttribute("email");
    if (value) recipientTokens.add(value.toLowerCase());
  });

  composeRoot.querySelectorAll('input[aria-label*="recipient" i], input[aria-label*="수신"], textarea[name="to"]').forEach((element) => {
    String(element.value || "").split(/[,;\s]+/).filter(Boolean).forEach((value) => {
      recipientTokens.add(value.toLowerCase());
    });
  });

  return {
    subjectLabel: subjectInput?.value || "(제목 없음)",
    recipientCount: recipientTokens.size
  };
}

function renderComposeControl(state) {
  if (!state.button) {
    return;
  }

  state.button.disabled = state.pending || state.sending;
  state.button.classList.toggle("is-active", state.active);
  state.button.setAttribute("aria-pressed", String(state.active));
  state.button.textContent = state.pending
    ? "열람 신호 준비 중"
    : state.active
      ? "열람 신호 켜짐"
      : "열람 신호";
  state.button.title = "상대 메일 앱의 원격 이미지 요청을 열람 신호로 집계합니다. 정확한 사람의 읽음 횟수를 보장하지 않습니다.";
}

function setComposeStatus(state, message, isError = false) {
  if (!state.status) {
    return;
  }

  state.status.textContent = message;
  state.status.classList.toggle("is-error", isError);
}
