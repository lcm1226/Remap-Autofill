const SETTINGS_KEY = "remapKeyAdvancedAutoFillSettings";
const DRAFT_KEY = "remapKeyAdvancedAutoFillDraft";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);

  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: getDefaultSettings()
    });
  }
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

  return false;
});

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
