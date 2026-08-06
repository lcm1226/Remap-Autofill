(function initializeIdentityAutofillCore(globalScope) {
  "use strict";

  const CARRIERS = Object.freeze([
    "SKT",
    "KT",
    "LGU",
    "SKT_MVNO",
    "KT_MVNO",
    "LGU_MVNO"
  ]);
  const AUTH_METHODS = Object.freeze(["SMS", "PASS"]);
  const GENDERS = Object.freeze(["M", "F"]);

  function getDefaultConfig() {
    return {
      version: 1,
      enabled: false,
      autoApply: true,
      activeProfileId: null
    };
  }

  function normalizeConfig(stored, profiles = []) {
    const validProfiles = Array.isArray(profiles)
      ? profiles
      : [];
    const requestedId = cleanText(stored?.activeProfileId, 120);
    const activeProfileId = validProfiles.some((profile) => profile.id === requestedId)
      ? requestedId
      : validProfiles[0]?.id || null;

    return {
      version: 1,
      enabled: activeProfileId !== null,
      autoApply: true,
      activeProfileId
    };
  }

  function normalizeProfiles(stored) {
    if (!Array.isArray(stored)) {
      return [];
    }

    const ids = new Set();
    const normalized = [];

    stored.forEach((candidate) => {
      try {
        const profile = normalizeProfile(candidate, candidate, false);

        if (!ids.has(profile.id)) {
          ids.add(profile.id);
          normalized.push(profile);
        }
      } catch (error) {
        // Ignore malformed stored entries without exposing their contents.
      }
    });

    return normalized.slice(0, 20);
  }

  function orderProfilesForDisplay(profiles, activeProfileId) {
    const source = Array.isArray(profiles) ? profiles : [];
    const activeProfile = source.find((profile) => profile.id === activeProfileId) || null;
    const sourceOrder = new Map(source.map((profile, index) => [profile.id, index]));
    const inactiveProfiles = source
      .filter((profile) => profile !== activeProfile)
      .sort((left, right) => {
        const createdAtDifference = getTimestamp(right.createdAt) - getTimestamp(left.createdAt);

        if (createdAtDifference !== 0) {
          return createdAtDifference;
        }

        return sourceOrder.get(left.id) - sourceOrder.get(right.id);
      });

    return activeProfile
      ? [activeProfile, ...inactiveProfiles]
      : inactiveProfiles;
  }

  function getProfileDisplayTimestamp(profile) {
    return normalizeTimestamp(profile?.updatedAt)
      || normalizeTimestamp(profile?.createdAt);
  }

  function normalizeProfile(input, existing = null, touchUpdatedAt = true) {
    const now = new Date().toISOString();
    const name = cleanText(input?.name, 80);
    const phone = digitsOnly(input?.phone);
    const birth = digitsOnly(input?.birth);
    const carrier = cleanText(input?.carrier, 20).toUpperCase();
    const gender = cleanText(input?.gender, 10).toUpperCase();
    const authMethod = cleanText(input?.authMethod, 10).toUpperCase();

    if (!name) {
      throw createValidationError("NAME_REQUIRED", "이름을 입력하세요.");
    }

    if (!isValidPhoneNumber(phone)) {
      throw createValidationError("INVALID_PHONE", "휴대폰 번호는 01로 시작하는 10~11자리 숫자여야 합니다.");
    }

    if (!isValidBirthDate(birth)) {
      throw createValidationError("INVALID_BIRTH", "생년월일은 유효한 YYYYMMDD 8자리여야 합니다.");
    }

    if (!CARRIERS.includes(carrier)) {
      throw createValidationError("INVALID_CARRIER", "통신사를 선택하세요.");
    }

    if (!GENDERS.includes(gender)) {
      throw createValidationError("INVALID_GENDER", "성별을 선택하세요.");
    }

    if (!AUTH_METHODS.includes(authMethod)) {
      throw createValidationError("INVALID_AUTH_METHOD", "SMS 또는 PASS 인증방식을 선택하세요.");
    }

    return {
      id: cleanText(input?.id || existing?.id, 120) || createId(),
      label: cleanText(input?.label, 80) || name,
      name,
      phone,
      birth,
      carrier,
      gender,
      foreigner: input?.foreigner === true,
      authMethod,
      enabled: true,
      createdAt: normalizeTimestamp(existing?.createdAt || input?.createdAt) || now,
      updatedAt: touchUpdatedAt
        ? now
        : normalizeTimestamp(input?.updatedAt || existing?.updatedAt) || now
    };
  }

  function sanitizeProfileForContent(profile) {
    if (!profile) {
      return null;
    }

    return {
      id: profile.id,
      name: profile.name,
      phone: profile.phone,
      birth: profile.birth,
      carrier: profile.carrier,
      gender: profile.gender,
      foreigner: profile.foreigner === true,
      authMethod: profile.authMethod
    };
  }

  function maskPhone(value) {
    const phone = digitsOnly(value);

    if (phone.length < 7) {
      return "***";
    }

    return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
  }

  function maskBirth(value) {
    const birth = digitsOnly(value);
    return birth.length === 8 ? `${birth.slice(0, 4)}-**-**` : "****-**-**";
  }

  function deriveIdentityGenderDigit(profile) {
    const birth = digitsOnly(profile?.birth);
    const year = Number(birth.slice(0, 4));
    const male = profile?.gender === "M";
    const foreigner = profile?.foreigner === true;

    if (year >= 1800 && year <= 1899 && !foreigner) {
      return male ? "9" : "0";
    }

    if (year >= 1900 && year <= 1999) {
      if (foreigner) {
        return male ? "5" : "6";
      }

      return male ? "1" : "2";
    }

    if (year >= 2000 && year <= 2099) {
      if (foreigner) {
        return male ? "7" : "8";
      }

      return male ? "3" : "4";
    }

    return "";
  }

  function isValidBirthDate(value) {
    if (!/^\d{8}$/.test(value)) {
      return false;
    }

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));

    return year >= 1800
      && year <= 2099
      && date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  }

  function isValidPhoneNumber(value) {
    return /^01\d{8,9}$/.test(digitsOnly(value));
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function cleanText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function normalizeTimestamp(value) {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function getTimestamp(value) {
    const timestamp = new Date(value || "").getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function createId() {
    if (globalScope.crypto?.randomUUID) {
      return `identity-${globalScope.crypto.randomUUID()}`;
    }

    return `identity-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function createValidationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  globalScope.IdentityAutofillCore = Object.freeze({
    AUTH_METHODS,
    CARRIERS,
    GENDERS,
    deriveIdentityGenderDigit,
    digitsOnly,
    getProfileDisplayTimestamp,
    getDefaultConfig,
    isValidBirthDate,
    isValidPhoneNumber,
    maskBirth,
    maskPhone,
    normalizeConfig,
    orderProfilesForDisplay,
    normalizeProfile,
    normalizeProfiles,
    sanitizeProfileForContent
  });
})(globalThis);
