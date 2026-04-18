const SETTINGS_KEY = "remapKeyAdvancedAutoFillSettings";
const AUTO_APPLY_RETRY_LIMIT = 12;
const AUTO_APPLY_RETRY_DELAY_MS = 700;
const SHIFTED_CHAR_BY_DIGIT = {
  "0": ")",
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "("
};
const CHAR_DESCRIPTOR_MAP = {
  "!": { code: "Digit1", keyCode: 49, shiftKey: true },
  "@": { code: "Digit2", keyCode: 50, shiftKey: true },
  "#": { code: "Digit3", keyCode: 51, shiftKey: true },
  "$": { code: "Digit4", keyCode: 52, shiftKey: true },
  "%": { code: "Digit5", keyCode: 53, shiftKey: true },
  "^": { code: "Digit6", keyCode: 54, shiftKey: true },
  "&": { code: "Digit7", keyCode: 55, shiftKey: true },
  "*": { code: "Digit8", keyCode: 56, shiftKey: true },
  "(": { code: "Digit9", keyCode: 57, shiftKey: true },
  ")": { code: "Digit0", keyCode: 48, shiftKey: true },
  "-": { code: "Minus", keyCode: 189, shiftKey: false },
  "_": { code: "Minus", keyCode: 189, shiftKey: true },
  "=": { code: "Equal", keyCode: 187, shiftKey: false },
  "+": { code: "Equal", keyCode: 187, shiftKey: true },
  "[": { code: "BracketLeft", keyCode: 219, shiftKey: false },
  "{": { code: "BracketLeft", keyCode: 219, shiftKey: true },
  "]": { code: "BracketRight", keyCode: 221, shiftKey: false },
  "}": { code: "BracketRight", keyCode: 221, shiftKey: true },
  ";": { code: "Semicolon", keyCode: 186, shiftKey: false },
  ":": { code: "Semicolon", keyCode: 186, shiftKey: true },
  "'": { code: "Quote", keyCode: 222, shiftKey: false },
  "\"": { code: "Quote", keyCode: 222, shiftKey: true },
  ",": { code: "Comma", keyCode: 188, shiftKey: false },
  "<": { code: "Comma", keyCode: 188, shiftKey: true },
  ".": { code: "Period", keyCode: 190, shiftKey: false },
  ">": { code: "Period", keyCode: 190, shiftKey: true },
  "/": { code: "Slash", keyCode: 191, shiftKey: false },
  "?": { code: "Slash", keyCode: 191, shiftKey: true },
  "\\": { code: "Backslash", keyCode: 220, shiftKey: false },
  "|": { code: "Backslash", keyCode: 220, shiftKey: true },
  "`": { code: "Backquote", keyCode: 192, shiftKey: false },
  "~": { code: "Backquote", keyCode: 192, shiftKey: true }
};
const NAMED_KEY_DESCRIPTOR_MAP = {
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Space: { key: " ", code: "Space", keyCode: 32 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 }
};
const pickerState = {
  active: false,
  currentTarget: null,
  outline: null,
  badge: null,
  banner: null,
  cleanup: []
};

let settingsCache = getDefaultSettings();
let syntheticDispatchDepth = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_PICKER") {
    startPicker();
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "APPLY_AUTOFILL_NOW") {
    applyMatchingAutofill({ retry: true, manual: true })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[SETTINGS_KEY]) {
    return;
  }

  settingsCache = normalizeSettings(changes[SETTINGS_KEY].newValue);
});

bootstrap();

async function bootstrap() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  settingsCache = normalizeSettings(stored[SETTINGS_KEY]);
  document.addEventListener("keydown", handleKeyRemap, true);
  await applyMatchingAutofill({ retry: true, manual: false });
}

async function applyMatchingAutofill({ retry, manual }) {
  let lastResult = { applied: [] };

  for (let attempt = 0; attempt < (retry ? AUTO_APPLY_RETRY_LIMIT : 1); attempt += 1) {
    lastResult = applyAutofillRulesNow({ manual });

    if (lastResult.applied.length > 0 || !retry) {
      return lastResult;
    }

    await delay(AUTO_APPLY_RETRY_DELAY_MS);
  }

  return lastResult;
}

function applyAutofillRulesNow({ manual }) {
  const url = window.location.href;
  const rules = settingsCache.autofillRules.filter((rule) => {
    return rule.enabled !== false
      && (manual || rule.autoApply !== false)
      && matchesUrlPattern(rule.urlPattern, url);
  });

  const applied = [];

  rules.forEach((rule) => {
    let element = null;

    try {
      element = document.querySelector(rule.selector);
    } catch (error) {
      element = null;
    }

    if (!element || !isPickableField(element)) {
      return;
    }

    if (!setFieldValue(element, rule.value)) {
      return;
    }

    applied.push({
      id: rule.id,
      label: rule.label || rule.descriptor || rule.selector
    });
  });

  return { applied };
}

function handleKeyRemap(event) {
  if (pickerState.active || syntheticDispatchDepth > 0 || !event.isTrusted) {
    return;
  }

  if (isEditableTarget(event.target)) {
    return;
  }

  const url = window.location.href;
  const normalizedEventKey = normalizeChordString(eventToChord(event));

  if (!normalizedEventKey) {
    return;
  }

  const matchingRule = settingsCache.keyRemapRules.find((rule) => {
    return rule.enabled !== false
      && matchesUrlPattern(rule.urlPattern, url)
      && normalizeChordString(rule.fromKey) === normalizedEventKey;
  });

  if (!matchingRule) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
  dispatchRemappedChord(matchingRule.toKey, event.target);
}

function dispatchRemappedChord(chordInput, originalTarget) {
  const parsed = parseChord(chordInput);
  const descriptor = toKeyboardDescriptor(parsed);

  if (!descriptor) {
    return;
  }

  const target = getDispatchTarget(originalTarget);
  const eventTypes = descriptor.isPrintable ? ["keydown", "keypress", "keyup"] : ["keydown", "keyup"];

  syntheticDispatchDepth += 1;

  try {
    eventTypes.forEach((eventType) => {
      dispatchSyntheticKeyboardEvent(target, descriptor, eventType);

      if (target !== document) {
        dispatchSyntheticKeyboardEvent(document, descriptor, eventType);
      }
    });
  } finally {
    syntheticDispatchDepth -= 1;
  }
}

function dispatchSyntheticKeyboardEvent(target, descriptor, eventType) {
  const keyboardEvent = new KeyboardEvent(eventType, {
    key: descriptor.key,
    code: descriptor.code,
    ctrlKey: descriptor.ctrlKey,
    altKey: descriptor.altKey,
    shiftKey: descriptor.shiftKey,
    metaKey: descriptor.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true
  });

  decorateKeyboardEvent(keyboardEvent, descriptor, eventType);
  target.dispatchEvent(keyboardEvent);
}

function decorateKeyboardEvent(event, descriptor, eventType) {
  const charCode = eventType === "keypress" && descriptor.isPrintable ? descriptor.key.charCodeAt(0) : 0;

  try {
    Object.defineProperties(event, {
      keyCode: {
        get: () => descriptor.keyCode
      },
      which: {
        get: () => descriptor.keyCode
      },
      charCode: {
        get: () => charCode
      }
    });
  } catch (error) {
    // Ignore if the browser blocks redefining readonly fields.
  }
}

function getDispatchTarget(originalTarget) {
  if (originalTarget instanceof Element || originalTarget === document) {
    return originalTarget;
  }

  if (document.activeElement instanceof Element) {
    return document.activeElement;
  }

  return document;
}

function startPicker() {
  if (pickerState.active) {
    return;
  }

  pickerState.active = true;
  pickerState.currentTarget = null;
  pickerState.outline = createOverlayElement("div", {
    position: "fixed",
    zIndex: "2147483646",
    border: "2px solid #f97316",
    background: "rgba(249, 115, 22, 0.14)",
    borderRadius: "10px",
    pointerEvents: "none",
    display: "none",
    boxSizing: "border-box"
  });
  pickerState.badge = createOverlayElement("div", {
    position: "fixed",
    zIndex: "2147483647",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#111827",
    color: "#f9fafb",
    fontSize: "12px",
    fontFamily: "Segoe UI, sans-serif",
    pointerEvents: "none",
    maxWidth: "320px",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.25)"
  });
  pickerState.banner = createOverlayElement("div", {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    padding: "10px 14px",
    borderRadius: "999px",
    background: "#0f172a",
    color: "#f8fafc",
    fontSize: "13px",
    fontFamily: "Segoe UI, sans-serif",
    boxShadow: "0 18px 36px rgba(15, 23, 42, 0.35)"
  });
  pickerState.banner.textContent = "Click an input, textarea, or select field. Press Esc to cancel.";

  const handleMouseMove = (event) => {
    const nextTarget = resolvePickableTarget(event.target);
    pickerState.currentTarget = nextTarget;
    updatePickerHighlight(nextTarget, event.clientX, event.clientY);
  };

  const handleClick = async (event) => {
    if (!pickerState.active) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    const selectedTarget = resolvePickableTarget(event.target);

    if (!selectedTarget) {
      showBannerMessage("Only inputs, textareas, and select fields can be selected.");
      return;
    }

    const selection = {
      selector: buildSelector(selectedTarget),
      descriptor: describeElement(selectedTarget),
      fieldKind: selectedTarget.tagName.toLowerCase(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      hostname: window.location.hostname,
      urlPattern: makeWildcardPattern(window.location.href),
      selectedAt: new Date().toISOString()
    };

    await chrome.runtime.sendMessage({
      type: "PICKER_COMPLETE",
      selection
    });

    showToast("Field saved. Reopen the extension to attach an autofill value.");
    stopPicker();
  };

  const handleKeyDown = async (event) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    stopPicker();
    showToast("Field picking cancelled.");
  };

  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  pickerState.cleanup = [
    () => document.removeEventListener("mousemove", handleMouseMove, true),
    () => document.removeEventListener("click", handleClick, true),
    () => document.removeEventListener("keydown", handleKeyDown, true)
  ];

  document.documentElement.style.cursor = "crosshair";
}

function stopPicker() {
  pickerState.active = false;
  pickerState.currentTarget = null;
  pickerState.cleanup.forEach((cleanup) => cleanup());
  pickerState.cleanup = [];
  [pickerState.outline, pickerState.badge, pickerState.banner].forEach((element) => {
    if (element?.parentNode) {
      element.parentNode.removeChild(element);
    }
  });
  pickerState.outline = null;
  pickerState.badge = null;
  pickerState.banner = null;
  document.documentElement.style.cursor = "";
}

function updatePickerHighlight(target, clientX, clientY) {
  if (!pickerState.outline || !pickerState.badge) {
    return;
  }

  if (!target) {
    pickerState.outline.style.display = "none";
    pickerState.badge.textContent = "Move over a text field";
    pickerState.badge.style.top = `${Math.max(16, clientY + 18)}px`;
    pickerState.badge.style.left = `${Math.max(16, clientX + 18)}px`;
    return;
  }

  const rect = target.getBoundingClientRect();
  pickerState.outline.style.display = "block";
  pickerState.outline.style.top = `${rect.top}px`;
  pickerState.outline.style.left = `${rect.left}px`;
  pickerState.outline.style.width = `${rect.width}px`;
  pickerState.outline.style.height = `${rect.height}px`;
  pickerState.badge.textContent = describeElement(target);
  pickerState.badge.style.top = `${Math.max(16, rect.top - 42)}px`;
  pickerState.badge.style.left = `${Math.max(16, rect.left)}px`;
}

function showBannerMessage(message) {
  if (!pickerState.banner) {
    return;
  }

  pickerState.banner.textContent = message;
}

function createOverlayElement(tagName, styles) {
  const element = document.createElement(tagName);
  Object.assign(element.style, styles);
  document.documentElement.appendChild(element);
  return element;
}

function resolvePickableTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (isPickableField(target)) {
    return target;
  }

  const labelTarget = target.closest("label");

  if (labelTarget?.control && isPickableField(labelTarget.control)) {
    return labelTarget.control;
  }

  const ancestorField = target.closest("input, textarea, select");
  return isPickableField(ancestorField) ? ancestorField : null;
}

function isPickableField(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  if (element instanceof HTMLTextAreaElement) {
    return isVisible(element) && !element.readOnly && !element.disabled;
  }

  if (element instanceof HTMLSelectElement) {
    return isVisible(element) && !element.disabled;
  }

  if (!(element instanceof HTMLInputElement)) {
    return false;
  }

  const type = (element.type || "text").toLowerCase();
  const allowedTypes = new Set(["text", "email", "tel", "search", "url", "number", "password"]);
  return allowedTypes.has(type) && isVisible(element) && !element.readOnly && !element.disabled;
}

function setFieldValue(element, value) {
  if (!isPickableField(element)) {
    return false;
  }

  if (element instanceof HTMLSelectElement) {
    const normalizedValue = normalizeComparableValue(value);
    const matchingOption = [...element.options].find((option) => {
      return normalizeComparableValue(option.value) === normalizedValue
        || normalizeComparableValue(option.textContent || "") === normalizedValue;
    });

    if (!matchingOption) {
      return false;
    }

    element.value = matchingOption.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const nativeSetter = getNativeValueSetter(element);

  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
  return true;
}

function getNativeValueSetter(element) {
  if (element instanceof HTMLInputElement) {
    return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  }

  if (element instanceof HTMLTextAreaElement) {
    return Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  }

  return null;
}

function buildSelector(element) {
  const directIdSelector = element.id ? `#${CSS.escape(element.id)}` : "";

  if (directIdSelector && isUniqueSelector(directIdSelector)) {
    return directIdSelector;
  }

  const segments = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    segments.unshift(buildSegment(current));
    const selector = segments.join(" > ");

    if (isUniqueSelector(selector)) {
      return selector;
    }

    current = current.parentElement;
  }

  return segments.join(" > ");
}

function buildSegment(element) {
  const tagName = element.tagName.toLowerCase();
  const name = element.getAttribute("name");
  const type = element.getAttribute("type");
  const dataTestId = element.getAttribute("data-testid") || element.getAttribute("data-test");
  const ariaLabel = element.getAttribute("aria-label");
  const placeholder = element.getAttribute("placeholder");

  if (element.id) {
    return `${tagName}#${CSS.escape(element.id)}`;
  }

  if (name) {
    return `${tagName}[name="${escapeAttributeValue(name)}"]${type ? `[type="${escapeAttributeValue(type)}"]` : ""}`;
  }

  if (dataTestId) {
    return `${tagName}[data-testid="${escapeAttributeValue(dataTestId)}"]`;
  }

  if (ariaLabel) {
    return `${tagName}[aria-label="${escapeAttributeValue(ariaLabel)}"]`;
  }

  if (placeholder) {
    return `${tagName}[placeholder="${escapeAttributeValue(placeholder)}"]`;
  }

  const position = getNthOfTypeIndex(element);
  return `${tagName}:nth-of-type(${position})`;
}

function escapeAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function getNthOfTypeIndex(element) {
  if (!element.parentElement) {
    return 1;
  }

  const siblings = [...element.parentElement.children].filter((candidate) => {
    return candidate.tagName === element.tagName;
  });

  return siblings.indexOf(element) + 1;
}

function isUniqueSelector(selector) {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch (error) {
    return false;
  }
}

function describeElement(element) {
  const labelText = getAssociatedLabelText(element);
  const placeholder = element.getAttribute("placeholder");
  const name = element.getAttribute("name");
  const ariaLabel = element.getAttribute("aria-label");
  const type = element instanceof HTMLInputElement
    ? (element.type || "text").toLowerCase()
    : element instanceof HTMLSelectElement
      ? "select"
      : "textarea";
  const candidate = labelText || ariaLabel || placeholder || name || element.id || `${element.tagName.toLowerCase()} field`;
  return `${candidate} (${type})`;
}

function getAssociatedLabelText(element) {
  const texts = [];

  if (element.id) {
    document.querySelectorAll(`label[for="${CSS.escape(element.id)}"]`).forEach((label) => {
      texts.push(label.textContent?.trim() || "");
    });
  }

  if (element.labels?.length) {
    [...element.labels].forEach((label) => {
      texts.push(label.textContent?.trim() || "");
    });
  }

  return texts.find(Boolean) || "";
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0
    && rect.height > 0
    && style.visibility !== "hidden"
    && style.display !== "none";
}

function matchesUrlPattern(pattern, url) {
  if (!pattern) {
    return true;
  }

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${escaped}$`, "i").test(url);
}

function makeWildcardPattern(url) {
  try {
    const parsed = new URL(url);
    return `*://${parsed.host}/*`;
  } catch (error) {
    return "*://*/*";
  }
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

function parseChord(input) {
  const rawTokens = String(input || "")
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);

  const chord = {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    base: ""
  };

  rawTokens.forEach((token) => {
    const lowered = token.toLowerCase();

    if (lowered === "ctrl" || lowered === "control") {
      chord.ctrlKey = true;
      return;
    }

    if (lowered === "alt" || lowered === "option") {
      chord.altKey = true;
      return;
    }

    if (lowered === "shift") {
      chord.shiftKey = true;
      return;
    }

    if (lowered === "meta" || lowered === "cmd" || lowered === "command" || lowered === "win") {
      chord.metaKey = true;
      return;
    }

    chord.base = canonicalizeBaseToken(token);
  });

  return chord;
}

function normalizeChordString(input) {
  const parsed = parseChord(input);

  if (!parsed.base) {
    return "";
  }

  const parts = [];

  if (parsed.ctrlKey) parts.push("Ctrl");
  if (parsed.altKey) parts.push("Alt");
  if (parsed.shiftKey) parts.push("Shift");
  if (parsed.metaKey) parts.push("Meta");
  parts.push(parsed.base);
  return parts.join("+");
}

function canonicalizeBaseToken(token) {
  const normalized = String(token || "").trim();
  const lowered = normalized.toLowerCase();
  const aliases = {
    del: "Delete",
    delete: "Delete",
    backspace: "Backspace",
    esc: "Escape",
    escape: "Escape",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    space: "Space",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown"
  };

  if (aliases[lowered]) {
    return aliases[lowered];
  }

  if (normalized.length === 1 && /[a-z]/i.test(normalized)) {
    return normalized.toUpperCase();
  }

  return normalized;
}

function eventToChord(event) {
  const parts = [];

  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  const base = eventToBaseToken(event);

  if (!base) {
    return "";
  }

  parts.push(base);
  return parts.join("+");
}

function eventToBaseToken(event) {
  if (event.key === " ") {
    return "Space";
  }

  if (NAMED_KEY_DESCRIPTOR_MAP[event.key]) {
    return event.key === " " ? "Space" : event.key;
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.slice(-1);
  }

  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(-1);
  }

  if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
    return event.key.toUpperCase();
  }

  if (event.key.length === 1) {
    return event.key;
  }

  return canonicalizeBaseToken(event.key);
}

function toKeyboardDescriptor(parsedChord) {
  if (!parsedChord.base) {
    return null;
  }

  const named = NAMED_KEY_DESCRIPTOR_MAP[parsedChord.base];

  if (named) {
    return {
      key: named.key,
      code: named.code,
      keyCode: named.keyCode,
      ctrlKey: parsedChord.ctrlKey,
      altKey: parsedChord.altKey,
      shiftKey: parsedChord.shiftKey,
      metaKey: parsedChord.metaKey,
      isPrintable: false
    };
  }

  if (/^[0-9]$/.test(parsedChord.base)) {
    const key = parsedChord.shiftKey ? SHIFTED_CHAR_BY_DIGIT[parsedChord.base] || parsedChord.base : parsedChord.base;
    return {
      key,
      code: `Digit${parsedChord.base}`,
      keyCode: parsedChord.base.charCodeAt(0),
      ctrlKey: parsedChord.ctrlKey,
      altKey: parsedChord.altKey,
      shiftKey: parsedChord.shiftKey,
      metaKey: parsedChord.metaKey,
      isPrintable: true
    };
  }

  if (/^[A-Z]$/.test(parsedChord.base)) {
    const key = parsedChord.shiftKey ? parsedChord.base : parsedChord.base.toLowerCase();
    return {
      key,
      code: `Key${parsedChord.base}`,
      keyCode: parsedChord.base.charCodeAt(0),
      ctrlKey: parsedChord.ctrlKey,
      altKey: parsedChord.altKey,
      shiftKey: parsedChord.shiftKey,
      metaKey: parsedChord.metaKey,
      isPrintable: true
    };
  }

  if (parsedChord.base.length === 1 && CHAR_DESCRIPTOR_MAP[parsedChord.base]) {
    const charDescriptor = CHAR_DESCRIPTOR_MAP[parsedChord.base];
    return {
      key: parsedChord.base,
      code: charDescriptor.code,
      keyCode: charDescriptor.keyCode,
      ctrlKey: parsedChord.ctrlKey,
      altKey: parsedChord.altKey,
      shiftKey: parsedChord.shiftKey || charDescriptor.shiftKey,
      metaKey: parsedChord.metaKey,
      isPrintable: true
    };
  }

  return null;
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }

  return target.isContentEditable || Boolean(target.closest("[contenteditable=\"true\"]"));
}

function showToast(message) {
  const toast = createOverlayElement("div", {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    padding: "12px 14px",
    borderRadius: "14px",
    background: "#111827",
    color: "#f9fafb",
    fontSize: "13px",
    fontFamily: "Segoe UI, sans-serif",
    boxShadow: "0 18px 36px rgba(15, 23, 42, 0.35)"
  });

  toast.textContent = message;
  window.setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 2800);
}

function delay(timeMs) {
  return new Promise((resolve) => window.setTimeout(resolve, timeMs));
}

function normalizeComparableValue(value) {
  return String(value || "").trim().toLowerCase();
}
