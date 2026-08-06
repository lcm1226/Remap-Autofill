(function initializeIdentityAutofillRuntime() {
  "use strict";

  const OBSERVER_LIFETIME_MS = 90000;
  const MUTATION_DEBOUNCE_MS = 140;
  const INITIAL_RETRY_DELAYS_MS = [0, 350, 900, 1800, 3200];

  let observer = null;
  let observerStopTimer = null;
  let mutationTimer = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "IDENTITY_APPLY_NOW") {
      return false;
    }

    applyCurrentProfile({ manual: true })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  bootstrap().catch(() => {});

  async function bootstrap() {
    const initialState = await requestActiveProfile();

    if (!initialState.config.enabled || !initialState.config.autoApply || !initialState.profile) {
      return;
    }

    startBoundedObserver();

    for (const delayMs of INITIAL_RETRY_DELAYS_MS) {
      if (delayMs > 0) {
        await delay(delayMs);
      }

      await applyCurrentProfile({ manual: false, state: initialState });
    }
  }

  async function applyCurrentProfile({ manual, state = null }) {
    const current = state || await requestActiveProfile();

    if (!current.config.enabled || !current.profile) {
      return {
        provider: current.provider || null,
        applied: [],
        disabled: true
      };
    }

    return IdentityAutofillAdapters.applyProfile(document, current.profile, {
      overwrite: manual === true
    });
  }

  async function requestActiveProfile() {
    const response = await chrome.runtime.sendMessage({ type: "IDENTITY_GET_ACTIVE_PROFILE" });

    if (!response?.ok) {
      throw new Error(response?.error || "본인인증 프로필을 불러오지 못했습니다.");
    }

    return response;
  }

  function startBoundedObserver() {
    if (observer || !document.documentElement) {
      return;
    }

    observer = new MutationObserver((mutations) => {
      const hasRelevantNodes = mutations.some((mutation) => {
        return Array.from(mutation.addedNodes).some((node) => {
          return node instanceof Element
            && (node.matches("input, textarea, select")
              || Boolean(node.querySelector("input, textarea, select")));
        });
      });

      if (!hasRelevantNodes) {
        return;
      }

      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        applyCurrentProfile({ manual: false }).catch(() => {});
      }, MUTATION_DEBOUNCE_MS);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    observerStopTimer = setTimeout(stopObserver, OBSERVER_LIFETIME_MS);
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
    clearTimeout(observerStopTimer);
    clearTimeout(mutationTimer);
    observerStopTimer = null;
    mutationTimer = null;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
})();
