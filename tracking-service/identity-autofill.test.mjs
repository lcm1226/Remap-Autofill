import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(currentDirectory, "..");

describe("identity profile core", () => {
  it("normalizes, masks, and derives identity fields without storing a full identifier", async () => {
    const context = await loadIdentityContext();
    const profile = context.IdentityAutofillCore.normalizeProfile({
      label: "기본",
      name: "홍길동",
      phone: "010-1234-5678",
      birth: "1990-01-02",
      carrier: "skt",
      gender: "m",
      foreigner: false,
      authMethod: "sms"
    });

    assert.equal(profile.phone, "01012345678");
    assert.equal(profile.birth, "19900102");
    assert.equal(profile.carrier, "SKT");
    assert.equal(profile.authMethod, "SMS");
    assert.equal("residentRegistrationNumber" in profile, false);
    assert.equal(context.IdentityAutofillCore.maskPhone(profile.phone), "010-****-5678");
    assert.equal(context.IdentityAutofillCore.maskBirth(profile.birth), "1990-**-**");
    assert.equal(context.IdentityAutofillCore.deriveIdentityGenderDigit(profile), "1");
    assert.equal(context.IdentityAutofillCore.isValidPhoneNumber("010-1234-5678"), true);
    assert.equal(context.IdentityAutofillCore.isValidPhoneNumber("1234"), false);
  });

  it("validates dates and always enables the selected profile for automatic filling", async () => {
    const context = await loadIdentityContext();

    assert.throws(() => context.IdentityAutofillCore.normalizeProfile({
      name: "홍길동",
      phone: "01012345678",
      birth: "20230229",
      carrier: "KT",
      gender: "M",
      authMethod: "PASS"
    }), /생년월일/);

    const profiles = [
      { id: "first", enabled: false },
      { id: "second", enabled: true }
    ];
    const config = context.IdentityAutofillCore.normalizeConfig({
      enabled: false,
      autoApply: false,
      activeProfileId: "second"
    }, profiles);
    assert.equal(config.activeProfileId, "second");
    assert.equal(config.enabled, true);
    assert.equal(config.autoApply, true);

    const emptyConfig = context.IdentityAutofillCore.normalizeConfig(config, []);
    assert.equal(emptyConfig.activeProfileId, null);
    assert.equal(emptyConfig.enabled, false);
  });

  it("pins the active profile first and orders the remaining profiles by newest creation time", async () => {
    const context = await loadIdentityContext();
    const profiles = [
      { id: "older", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "active", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "newest", createdAt: "2026-03-01T00:00:00.000Z" },
      { id: "newer", createdAt: "2026-02-01T00:00:00.000Z" }
    ];

    const ordered = context.IdentityAutofillCore.orderProfilesForDisplay(profiles, "active");

    assert.deepEqual(Array.from(ordered, (profile) => profile.id), [
      "active",
      "newest",
      "newer",
      "older"
    ]);
  });

  it("uses the edited timestamp in place of the original creation timestamp", async () => {
    const context = await loadIdentityContext();

    assert.equal(
      context.IdentityAutofillCore.getProfileDisplayTimestamp({
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-03T00:00:00.000Z"
      }),
      "2026-02-03T00:00:00.000Z"
    );
    assert.equal(
      context.IdentityAutofillCore.getProfileDisplayTimestamp({
        createdAt: "2026-01-01T00:00:00.000Z"
      }),
      "2026-01-01T00:00:00.000Z"
    );
  });

  it("classifies provider fields while excluding CAPTCHA and OTP inputs", async () => {
    const context = await loadIdentityContext();
    const provider = context.IdentityAutofillAdapters.getProvider("nice.checkplus.co.kr");

    assert.equal(context.IdentityAutofillAdapters.classifyFieldDescriptor({ id: "userName" }, provider), "name");
    assert.equal(context.IdentityAutofillAdapters.classifyFieldDescriptor({ id: "myNum1", maxLength: 6 }, provider), "birth6");
    assert.equal(context.IdentityAutofillAdapters.classifyFieldDescriptor({ id: "myNum2", maxLength: 1 }, provider), "identityDigit");
    assert.equal(context.IdentityAutofillAdapters.classifyFieldDescriptor({ id: "mobileNo" }, provider), "phone");
    assert.equal(context.IdentityAutofillAdapters.classifyFieldDescriptor({ ariaLabel: "통신사 선택", type: "select" }, provider), "carrier");
    assert.equal(context.IdentityAutofillAdapters.classifyFieldDescriptor({ id: "captchaAnswer" }, provider), null);
    assert.equal(context.IdentityAutofillAdapters.classifyFieldDescriptor({ ariaLabel: "SMS 인증번호" }, provider), null);
  });

  it("fills a staged provider form but leaves CAPTCHA and submission controls untouched", async () => {
    const context = await loadIdentityContextWithFakeDom();
    const document = new FakeDocument("nice.checkplus.co.kr", context);
    const name = document.add(new FakeInput(document, { id: "userName" }));
    const birth = document.add(new FakeInput(document, { id: "myNum1", maxLength: 6 }));
    const identityDigit = document.add(new FakeInput(document, { id: "myNum2", maxLength: 1 }));
    const phone = document.add(new FakeInput(document, { id: "mobileNo" }));
    const captcha = document.add(new FakeInput(document, { id: "captchaAnswer" }));
    const carrier = document.add(new FakeSelect(document, {
      ariaLabel: "통신사 선택",
      options: [
        new FakeOption("", "선택"),
        new FakeOption("S", "SKT"),
        new FakeOption("K", "KT"),
        new FakeOption("L", "LG U+")
      ]
    }));
    const method = document.add(new FakeInput(document, {
      type: "radio",
      value: "PASS",
      label: "PASS 앱 인증"
    }));

    const result = context.IdentityAutofillAdapters.applyProfile(document, {
      name: "홍길동",
      phone: "01012345678",
      birth: "19900102",
      carrier: "KT",
      gender: "M",
      foreigner: false,
      authMethod: "PASS"
    });

    assert.equal(name.value, "홍길동");
    assert.equal(birth.value, "900102");
    assert.equal(identityDigit.value, "1");
    assert.equal(phone.value, "01012345678");
    assert.equal(carrier.value, "K");
    assert.equal(method.checked, true);
    assert.equal(captcha.value, "");
    assert.equal(result.provider, "nice-checkplus");
    assert.equal(result.applied.includes("authMethod"), true);
  });
});

describe("identity profile encrypted transfer", () => {
  it("round-trips profile data and rejects the wrong passphrase", async () => {
    const context = vm.createContext({
      crypto: webcrypto,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      btoa(value) {
        return Buffer.from(value, "binary").toString("base64");
      },
      atob(value) {
        return Buffer.from(value, "base64").toString("binary");
      }
    });
    const source = await readFile(resolve(projectDirectory, "identity-transfer.js"), "utf8");
    vm.runInContext(source, context, { filename: "identity-transfer.js" });
    const payload = {
      version: 1,
      profiles: [{ id: "profile-1", name: "홍길동", phone: "01012345678" }]
    };
    const envelope = await context.IdentityAutofillTransfer.encrypt(payload, "correct horse battery staple");
    const restored = await context.IdentityAutofillTransfer.decrypt(envelope, "correct horse battery staple");

    assert.equal(restored.profiles[0].phone, "01012345678");
    assert.equal(envelope.format, "keyremap-identity-profiles");
    assert.equal(JSON.stringify(envelope).includes("01012345678"), false);
    await assert.rejects(
      context.IdentityAutofillTransfer.decrypt(envelope, "incorrect passphrase"),
      /operation-specific|decrypt|The operation failed/i
    );
  });
});

async function loadIdentityContext() {
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    Date,
    Math
  });
  const profileSource = await readFile(resolve(projectDirectory, "identity-profile.js"), "utf8");
  const adaptersSource = await readFile(resolve(projectDirectory, "identity-adapters.js"), "utf8");
  vm.runInContext(profileSource, context, { filename: "identity-profile.js" });
  vm.runInContext(adaptersSource, context, { filename: "identity-adapters.js" });
  return context;
}

async function loadIdentityContextWithFakeDom() {
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    Date,
    Math,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: FakeSelect
  });
  const profileSource = await readFile(resolve(projectDirectory, "identity-profile.js"), "utf8");
  const adaptersSource = await readFile(resolve(projectDirectory, "identity-adapters.js"), "utf8");
  vm.runInContext(profileSource, context, { filename: "identity-profile.js" });
  vm.runInContext(adaptersSource, context, { filename: "identity-adapters.js" });
  return context;
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles === true;
  }
}

class FakeControl {
  constructor(document, attributes = {}) {
    this.ownerDocument = document;
    this.id = attributes.id || "";
    this.tagName = attributes.tagName || "INPUT";
    this.type = attributes.type || "text";
    this.maxLength = attributes.maxLength ?? -1;
    this.disabled = false;
    this.readOnly = false;
    this.checked = false;
    this.labels = attributes.label ? [{ textContent: attributes.label }] : [];
    this.attributes = new Map([
      ["name", attributes.name || ""],
      ["type", attributes.type || "text"],
      ["aria-label", attributes.ariaLabel || ""],
      ["placeholder", attributes.placeholder || ""]
    ]);
    this.value = attributes.value || "";
    this.events = [];
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  getBoundingClientRect() {
    return { width: 120, height: 24 };
  }

  getClientRects() {
    return [{}];
  }

  closest() {
    return null;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }

  click() {
    this.checked = true;
    this.events.push("click");
  }
}

class FakeInput extends FakeControl {}
class FakeTextArea extends FakeControl {}

class FakeSelect extends FakeControl {
  constructor(document, attributes = {}) {
    super(document, { ...attributes, tagName: "SELECT", type: "select-one" });
    this.options = attributes.options || [];
  }
}

class FakeOption {
  constructor(value, textContent) {
    this.value = value;
    this.textContent = textContent;
  }
}

class FakeDocument {
  constructor(hostname, context) {
    this.location = { hostname };
    this.controls = [];
    this.defaultView = {
      Event: FakeEvent,
      KeyboardEvent: FakeEvent,
      HTMLInputElement: FakeInput,
      HTMLTextAreaElement: FakeTextArea,
      HTMLSelectElement: FakeSelect,
      getComputedStyle() {
        return { display: "block", visibility: "visible" };
      }
    };
    context.HTMLInputElement = FakeInput;
    context.HTMLTextAreaElement = FakeTextArea;
    context.HTMLSelectElement = FakeSelect;
  }

  add(control) {
    this.controls.push(control);
    return control;
  }

  querySelectorAll() {
    return this.controls;
  }
}
