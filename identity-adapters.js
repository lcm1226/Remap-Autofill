(function initializeIdentityAdapters(globalScope) {
  "use strict";

  const CORE = globalScope.IdentityAutofillCore;
  const PROVIDERS = Object.freeze([
    {
      id: "nice-checkplus",
      label: "NICE CheckPlus",
      hosts: ["nice.checkplus.co.kr"],
      aliases: {
        name: ["userName"],
        birth: ["myNum1"],
        identityDigit: ["myNum2"],
        phone: ["mobileNo"]
      }
    },
    {
      id: "siren24",
      label: "SCI Siren24",
      hosts: ["pcc.siren24.com"],
      aliases: {
        name: ["userName"],
        birth: ["myNum1"],
        identityDigit: ["myNum2"],
        phone: ["mobileNo"]
      }
    },
    {
      id: "ok-name",
      label: "KCB OK-Name",
      hosts: ["safe.ok-name.co.kr"],
      aliases: {
        name: ["nm"],
        birth: ["ssn6"],
        identityDigit: ["ssn1"],
        phone: ["mbphn_no"]
      }
    },
    {
      id: "mobile-ok",
      label: "DreamSecurity Mobile-OK",
      hosts: ["cert.mobile-ok.com"],
      aliases: {}
    }
  ]);
  const BLOCKED_TOKENS = [
    "captcha",
    "보안문자",
    "인증번호",
    "verificationcode",
    "verifycode",
    "otp",
    "password",
    "passwd"
  ];

  function getProvider(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return PROVIDERS.find((provider) => provider.hosts.includes(normalized)) || null;
  }

  function classifyFieldDescriptor(descriptor, provider = null) {
    const type = String(descriptor?.type || "text").toLowerCase();
    const maxLength = Number(descriptor?.maxLength || 0);
    const tokens = normalizeTokens([
      descriptor?.id,
      descriptor?.name,
      descriptor?.ariaLabel,
      descriptor?.placeholder,
      descriptor?.label,
      descriptor?.text
    ].join(" "));

    if (BLOCKED_TOKENS.some((token) => tokens.includes(normalizeTokens(token)))) {
      return null;
    }

    const aliases = provider?.aliases || {};

    if (matchesAlias(tokens, aliases.identityDigit)
      || includesAny(tokens, ["mynum2", "ssn1", "genderdigit", "주민번호뒷", "뒷자리첫"])) {
      return "identityDigit";
    }

    if (matchesAlias(tokens, aliases.birth)
      || includesAny(tokens, ["birth", "birthday", "생년월일", "mynum1", "ssn6", "주민번호앞"])) {
      return maxLength === 6 || includesAny(tokens, ["6자리", "mynum1", "ssn6"])
        ? "birth6"
        : "birth8";
    }

    if (includesAny(tokens, ["carrier", "telecom", "telcom", "agency", "통신사", "이동통신사"])) {
      return "carrier";
    }

    if (includesAny(tokens, ["authmethod", "authway", "인증방식", "인증수단", "sms", "pass앱"])) {
      return "authMethod";
    }

    if (includesAny(tokens, ["foreigner", "nationality", "내외국인", "외국인", "국적"])) {
      return "foreigner";
    }

    if (includesAny(tokens, ["gender", "sex", "성별"])) {
      return "gender";
    }

    if (matchesAlias(tokens, aliases.phone)
      || includesAny(tokens, ["mobile", "phone", "휴대폰", "휴대전화", "mbphn", "핸드폰"])) {
      if (maxLength === 3 || includesAny(tokens, ["phone1", "tel1", "앞3자리"])) {
        return "phonePrefix";
      }

      if ((maxLength >= 7 && maxLength <= 8) || includesAny(tokens, ["phone2", "tel2", "뒤8자리"])) {
        return "phoneSuffix";
      }

      return "phone";
    }

    if (matchesAlias(tokens, aliases.name)
      || includesAny(tokens, ["username", "fullname", "name", "성명", "이름", "본인명"])) {
      return "name";
    }

    if (type === "radio") {
      if (includesAny(tokens, ["skt", "kt", "lgu", "알뜰폰"])) {
        return "carrier";
      }

      if (includesAny(tokens, ["sms", "pass"])) {
        return "authMethod";
      }
    }

    return null;
  }

  function applyProfile(documentRef, profile, options = {}) {
    const provider = getProvider(documentRef?.location?.hostname);

    if (!provider || !profile) {
      return {
        provider: provider?.id || null,
        applied: []
      };
    }

    const applied = [];
    const controls = Array.from(documentRef.querySelectorAll("input, textarea, select"));

    controls.forEach((element) => {
      if (!isUsableControl(element, documentRef.defaultView)) {
        return;
      }

      const descriptor = describeControl(element);
      const kind = classifyFieldDescriptor(descriptor, provider);

      if (!kind) {
        return;
      }

      const changed = isChoiceControl(element)
        ? applyChoiceControl(element, kind, profile)
        : applyTextControl(element, kind, profile, options);

      if (changed) {
        applied.push(kind);
      }
    });

    return {
      provider: provider.id,
      applied: [...new Set(applied)]
    };
  }

  function describeControl(element) {
    return {
      id: element.id,
      name: element.getAttribute("name"),
      type: element.getAttribute("type") || element.tagName,
      maxLength: element.maxLength,
      ariaLabel: element.getAttribute("aria-label"),
      placeholder: element.getAttribute("placeholder"),
      label: getControlLabel(element),
      text: element instanceof HTMLSelectElement
        ? Array.from(element.options).map((option) => option.textContent || "").join(" ")
        : ""
    };
  }

  function applyTextControl(element, kind, profile, options) {
    const value = valueForKind(kind, profile);

    if (!value) {
      return false;
    }

    const current = String(element.value || "").trim();

    if (current && options.overwrite !== true) {
      return false;
    }

    if (current === value) {
      return false;
    }

    const windowRef = element.ownerDocument.defaultView;
    const prototype = element instanceof windowRef.HTMLTextAreaElement
      ? windowRef.HTMLTextAreaElement.prototype
      : windowRef.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }

    dispatchFillEvents(element, ["input", "change", "keyup", "blur"]);
    return true;
  }

  function applyChoiceControl(element, kind, profile) {
    const aliases = choiceAliases(kind, profile);

    if (!aliases.length) {
      return false;
    }

    if (element instanceof element.ownerDocument.defaultView.HTMLSelectElement) {
      const option = Array.from(element.options).find((candidate) => {
        const candidateValue = normalizeTokens(candidate.value);
        const candidateText = normalizeTokens(candidate.textContent || "");
        return aliases.some((alias) => {
          const normalizedAlias = normalizeTokens(alias);
          return candidateValue === normalizedAlias
            || (kind === "carrier"
              ? candidateText === normalizedAlias
              : normalizedAlias.length > 1 && candidateText.includes(normalizedAlias));
        });
      });

      if (!option || element.value === option.value) {
        return false;
      }

      element.value = option.value;
      dispatchFillEvents(element, ["input", "change"]);
      return true;
    }

    if (element.type === "radio") {
      const candidateValue = normalizeTokens(element.value);
      const candidateLabel = normalizeTokens(getControlLabel(element));
      const matches = aliases.some((alias) => {
        const normalizedAlias = normalizeTokens(alias);
        return candidateValue === normalizedAlias
          || (kind === "carrier"
            ? candidateLabel === normalizedAlias
            : normalizedAlias.length > 1 && candidateLabel.includes(normalizedAlias));
      });

      if (!matches || element.checked) {
        return false;
      }

      element.click();
      return true;
    }

    return false;
  }

  function valueForKind(kind, profile) {
    if (kind === "name") {
      return profile.name;
    }

    if (kind === "birth8") {
      return profile.birth;
    }

    if (kind === "birth6") {
      return profile.birth.slice(2);
    }

    if (kind === "identityDigit") {
      return CORE.deriveIdentityGenderDigit(profile);
    }

    if (kind === "phonePrefix") {
      return profile.phone.slice(0, 3);
    }

    if (kind === "phoneSuffix") {
      return profile.phone.slice(3);
    }

    if (kind === "phone") {
      return profile.phone;
    }

    return "";
  }

  function choiceAliases(kind, profile) {
    if (kind === "carrier") {
      const aliases = {
        SKT: ["SKT", "SK텔레콤", "S"],
        KT: ["KT", "K"],
        LGU: ["LGU+", "LG U+", "LG유플러스", "L"],
        SKT_MVNO: ["SKT 알뜰폰", "SKT MVNO", "알뜰폰 SKT"],
        KT_MVNO: ["KT 알뜰폰", "KT MVNO", "알뜰폰 KT"],
        LGU_MVNO: ["LGU+ 알뜰폰", "LG U+ 알뜰폰", "LGU MVNO", "알뜰폰 LGU"]
      };
      return aliases[profile.carrier] || [];
    }

    if (kind === "authMethod") {
      return profile.authMethod === "PASS"
        ? ["PASS", "패스", "앱 인증", "간편인증"]
        : ["SMS", "문자", "문자인증", "휴대폰 문자"];
    }

    if (kind === "gender") {
      return profile.gender === "M" ? ["남", "남성", "male", "1"] : ["여", "여성", "female", "2"];
    }

    if (kind === "foreigner") {
      return profile.foreigner ? ["외국인", "foreign", "1"] : ["내국인", "domestic", "0"];
    }

    return [];
  }

  function isChoiceControl(element) {
    return element instanceof element.ownerDocument.defaultView.HTMLSelectElement
      || element.type === "radio";
  }

  function isUsableControl(element, windowRef) {
    if (!element || element.disabled || element.readOnly) {
      return false;
    }

    const type = String(element.type || "").toLowerCase();

    if (["hidden", "password", "file", "submit", "button", "checkbox"].includes(type)) {
      return false;
    }

    const style = windowRef.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && (rect.width > 0 || rect.height > 0 || element.getClientRects().length > 0);
  }

  function getControlLabel(element) {
    const parts = [];

    if (element.labels?.length) {
      Array.from(element.labels).forEach((label) => parts.push(label.textContent || ""));
    }

    const parentLabel = element.closest?.("label");

    if (parentLabel) {
      parts.push(parentLabel.textContent || "");
    }

    return parts.join(" ").trim();
  }

  function dispatchFillEvents(element, eventTypes) {
    eventTypes.forEach((eventType) => {
      const event = eventType === "keyup"
        ? new element.ownerDocument.defaultView.KeyboardEvent(eventType, { bubbles: true })
        : new element.ownerDocument.defaultView.Event(eventType, { bubbles: true });
      element.dispatchEvent(event);
    });
  }

  function matchesAlias(tokens, aliases) {
    return Array.isArray(aliases)
      && aliases.some((alias) => tokens.includes(normalizeTokens(alias)));
  }

  function includesAny(tokens, candidates) {
    return candidates.some((candidate) => tokens.includes(normalizeTokens(candidate)));
  }

  function normalizeTokens(value) {
    return String(value || "").toLowerCase().replace(/[\s_\-+().:[\]{}]/g, "");
  }

  globalScope.IdentityAutofillAdapters = Object.freeze({
    PROVIDERS,
    applyProfile,
    classifyFieldDescriptor,
    getProvider,
    normalizeTokens,
    valueForKind
  });
})(globalThis);
