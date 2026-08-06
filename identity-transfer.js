(function initializeIdentityAutofillTransfer(globalScope) {
  "use strict";

  const FORMAT = "keyremap-identity-profiles";
  const ITERATIONS = 250000;

  async function encrypt(payload, passphrase) {
    assertPassphrase(passphrase);
    const salt = globalScope.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalScope.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = await globalScope.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

    return {
      format: FORMAT,
      version: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: ITERATIONS,
        salt: bytesToBase64Url(salt)
      },
      cipher: {
        name: "AES-GCM",
        iv: bytesToBase64Url(iv),
        data: bytesToBase64Url(new Uint8Array(ciphertext))
      }
    };
  }

  async function decrypt(envelope, passphrase) {
    assertPassphrase(passphrase);

    if (envelope?.format !== FORMAT
      || envelope?.version !== 1
      || envelope?.kdf?.name !== "PBKDF2"
      || envelope?.kdf?.hash !== "SHA-256"
      || envelope?.cipher?.name !== "AES-GCM") {
      throw new Error("지원하지 않는 본인인증 프로필 형식입니다.");
    }

    const iterations = Number(envelope.kdf.iterations);

    if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 1000000) {
      throw new Error("키 파생 설정이 올바르지 않습니다.");
    }

    const salt = base64UrlToBytes(envelope.kdf.salt);
    const iv = base64UrlToBytes(envelope.cipher.iv);
    const ciphertext = base64UrlToBytes(envelope.cipher.data);

    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) {
      throw new Error("암호화된 프로필 데이터가 올바르지 않습니다.");
    }

    const key = await deriveKey(passphrase, salt, iterations);
    const plaintext = await globalScope.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  async function deriveKey(passphrase, salt, iterations) {
    const material = await globalScope.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return globalScope.crypto.subtle.deriveKey({
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    }, material, {
      name: "AES-GCM",
      length: 256
    }, false, ["encrypt", "decrypt"]);
  }

  function assertPassphrase(passphrase) {
    if (String(passphrase || "").length < 8) {
      throw new Error("암호화 비밀번호는 8자 이상이어야 합니다.");
    }
  }

  function bytesToBase64Url(bytes) {
    let binary = "";

    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToBytes(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  globalScope.IdentityAutofillTransfer = Object.freeze({
    FORMAT,
    ITERATIONS,
    decrypt,
    encrypt
  });
})(globalThis);
