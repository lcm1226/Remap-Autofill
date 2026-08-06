import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { once } from "node:events";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OpenSignalStore } from "./open-signal-store.mjs";
import { createOpenSignalServer } from "./open-signal-server.mjs";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const backgroundPath = resolve(currentDirectory, "..", "background.js");
const identityProfilePath = resolve(currentDirectory, "..", "identity-profile.js");
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("extension background open-signal integration", () => {
  it("activates the fixed service from Gmail without opening extension options", async () => {
    const context = await loadBackgroundContext();
    const activated = await context.handleOpenSignalMessage({
      type: "OPEN_SIGNAL_ACTIVATE"
    }, gmailSender());

    assert.equal(activated.config.enabled, true);
    assert.equal(activated.config.consentAccepted, true);
    assert.match(activated.config.consentAcceptedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(
      activated.config.serviceBaseUrl,
      "https://keyremap-gmail-open-signal.phantom-cinnamon-008.workers.dev"
    );

    await assert.rejects(
      context.handleOpenSignalMessage({ type: "OPEN_SIGNAL_ACTIVATE" }, {}),
      /Gmail/
    );
  });

  it("configures, registers, arms, reads, and deletes a tracking record", async () => {
    const server = await listen(createOpenSignalServer({
      store: new OpenSignalStore({
        pepper: "background-integration-test-pepper-000000000"
      })
    }));
    const serviceBaseUrl = serverBaseUrl(server);
    const context = await loadBackgroundContext();

    const configured = await context.handleOpenSignalMessage({
      type: "OPEN_SIGNAL_CONFIGURE",
      config: {
        enabled: false,
        consentAccepted: false,
        serviceBaseUrl
      }
    }, {
      url: "chrome-extension://test-extension/options.html"
    });

    assert.equal(configured.config.enabled, false);
    assert.equal(configured.config.consentAccepted, false);
    assert.equal(configured.config.serviceBaseUrl, serviceBaseUrl);

    const registered = await context.handleOpenSignalMessage({
      type: "OPEN_SIGNAL_REGISTER",
      compose: {
        subjectLabel: "integration subject",
        recipientCount: 1
      }
    }, gmailSender());

    assert.equal(registered.track.requestCount, 0);
    assert.equal(registered.track.state, "draft");
    assert.match(registered.pixelUrl, new RegExp(`^${escapeRegex(serviceBaseUrl)}/o/`));

    const activatedState = await context.handleOpenSignalMessage({
      type: "OPEN_SIGNAL_GET_STATE"
    }, gmailSender());
    assert.equal(activatedState.config.enabled, true);
    assert.equal(activatedState.config.consentAccepted, true);

    await fetch(registered.pixelUrl);
    const beforeArm = await context.handleOpenSignalMessage({
      type: "OPEN_SIGNAL_REFRESH",
      id: registered.track.id
    }, optionsSender());
    assert.equal(beforeArm.track.requestCount, 0);

    const armed = await context.handleOpenSignalMessage({
      type: "OPEN_SIGNAL_ARM",
      id: registered.track.id
    }, gmailSender());
    assert.equal(armed.track.state, "sent");
    assert.equal(Boolean(armed.track.armedAt), true);

    await fetch(`${registered.pixelUrl}&after-send=1`);
    const refreshed = await context.handleOpenSignalMessage({
      type: "OPEN_SIGNAL_REFRESH",
      id: registered.track.id
    }, optionsSender());
    assert.equal(refreshed.track.requestCount, 1);
    assert.equal(Boolean(refreshed.track.firstSignalAt), true);

    const deleted = await context.handleOpenSignalMessage({
      type: "OPEN_SIGNAL_DELETE",
      id: registered.track.id
    }, gmailSender());
    assert.equal(deleted.history.length, 0);

    await assert.rejects(
      context.handleOpenSignalMessage({ type: "OPEN_SIGNAL_GET_STATE" }, {
        url: "https://example.com/"
      }),
      /Gmail/
    );
  });

  it("allows localhost HTTP but rejects a non-local HTTP service", async () => {
    const context = await loadBackgroundContext();
    assert.equal(context.normalizeServiceBaseUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
    assert.equal(context.normalizeServiceBaseUrl("https://signals.example.com/base/"), "https://signals.example.com/base");
    assert.throws(() => context.normalizeServiceBaseUrl("http://signals.example.com"), /HTTPS/);
  });
});

describe("extension background identity-profile boundary", () => {
  it("stores validated profiles locally and releases only the active profile to supported providers", async () => {
    const context = await loadBackgroundContext();
    const saved = await context.handleIdentityMessage({
      type: "IDENTITY_SAVE_PROFILE",
      profile: {
        label: "기본",
        name: "홍길동",
        phone: "01012345678",
        birth: "19900102",
        carrier: "KT",
        gender: "M",
        foreigner: false,
        authMethod: "PASS",
        enabled: true
      },
      config: {
        enabled: false,
        autoApply: false
      }
    }, optionsSender());

    assert.equal(saved.profiles.length, 1);
    assert.equal(saved.config.activeProfileId, saved.profiles[0].id);
    assert.equal(saved.config.enabled, true);
    assert.equal(saved.config.autoApply, true);

    const second = await context.handleIdentityMessage({
      type: "IDENTITY_SAVE_PROFILE",
      profile: {
        label: "두 번째",
        name: "김테스트",
        phone: "01098765432",
        birth: "20000102",
        carrier: "SKT",
        gender: "F",
        foreigner: false,
        authMethod: "SMS"
      }
    }, optionsSender());
    assert.equal(second.profiles.length, 2);
    assert.equal(second.config.activeProfileId, saved.profiles[0].id);

    const firstActive = await context.handleIdentityMessage({
      type: "IDENTITY_GET_ACTIVE_PROFILE"
    }, providerSender("nice.checkplus.co.kr"));
    assert.equal(firstActive.profile.name, "홍길동");
    assert.equal(firstActive.profile.phone, "01012345678");
    assert.equal("label" in firstActive.profile, false);
    assert.equal("createdAt" in firstActive.profile, false);

    const secondProfile = second.profiles.find((profile) => profile.name === "김테스트");
    const selected = await context.handleIdentityMessage({
      type: "IDENTITY_SELECT_PROFILE",
      id: secondProfile.id
    }, popupSender());
    assert.equal(selected.config.activeProfileId, secondProfile.id);

    const secondActive = await context.handleIdentityMessage({
      type: "IDENTITY_GET_ACTIVE_PROFILE"
    }, providerSender("nice.checkplus.co.kr"));
    assert.equal(secondActive.profile.name, "김테스트");
    assert.equal(secondActive.profile.phone, "01098765432");

    await assert.rejects(
      context.handleIdentityMessage({
        type: "IDENTITY_SAVE_PROFILE",
        profile: {
          name: "형식 오류",
          phone: "1234",
          birth: "아무 값",
          carrier: "KT",
          gender: "M",
          authMethod: "PASS"
        }
      }, optionsSender()),
      /휴대폰 번호/
    );

    await assert.rejects(
      context.handleIdentityMessage({ type: "IDENTITY_GET_ACTIVE_PROFILE" }, providerSender("example.com")),
      /지원하는 본인인증 화면/
    );
    await assert.rejects(
      context.handleIdentityMessage({
        type: "IDENTITY_SAVE_PROFILE",
        profile: saved.profiles[0]
      }, providerSender("nice.checkplus.co.kr")),
      /확장 프로그램 화면/
    );
  });
});

async function loadBackgroundContext() {
  const localData = {};
  const syncData = {};
  const chrome = {
    commands: {
      onCommand: { addListener() {} }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test-extension/${path}`;
      },
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      async sendMessage() {}
    },
    storage: {
      local: createStorageArea(localData),
      sync: createStorageArea(syncData)
    },
    tabs: {
      async query() { return []; },
      async sendMessage() {}
    }
  };
  const context = vm.createContext({
    AbortController,
    URL,
    btoa,
    chrome,
    clearTimeout,
    console,
    crypto: webcrypto,
    fetch,
    setTimeout
  });
  const source = await readFile(backgroundPath, "utf8");
  const identityProfileSource = await readFile(identityProfilePath, "utf8");
  vm.runInContext(identityProfileSource, context, { filename: identityProfilePath });
  vm.runInContext(source, context, { filename: backgroundPath });
  return context;
}

function createStorageArea(data) {
  return {
    async get(keys) {
      if (keys === undefined || keys === null) {
        return { ...data };
      }

      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      requested.forEach((key) => delete data[key]);
    }
  };
}

function gmailSender() {
  return {
    tab: {
      url: "https://mail.google.com/mail/u/0/#inbox"
    }
  };
}

function optionsSender() {
  return {
    url: "chrome-extension://test-extension/options.html"
  };
}

function popupSender() {
  return {
    url: "chrome-extension://test-extension/popup.html"
  };
}

function providerSender(hostname) {
  return {
    url: `https://${hostname}/verification/frame`,
    tab: {
      url: `https://${hostname}/verification`
    }
  };
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return server;
}

async function closeServer(server) {
  server.close();
  await once(server, "close");
}

function serverBaseUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
