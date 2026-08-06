import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_TOKEN_LENGTH = 22;
const MAX_TOKEN_LENGTH = 128;
const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export class OpenSignalError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "OpenSignalError";
    this.code = code;
    this.status = status;
  }
}

export class OpenSignalStore {
  constructor({ pepper, retentionMs = DEFAULT_RETENTION_MS } = {}) {
    if (typeof pepper !== "string" || pepper.length < MIN_SECRET_LENGTH) {
      throw new TypeError(`pepper must be at least ${MIN_SECRET_LENGTH} characters`);
    }

    if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) {
      throw new TypeError("retentionMs must be a positive safe integer");
    }

    this.pepper = pepper;
    this.retentionMs = retentionMs;
    this.recordsById = new Map();
    this.recordIdByTokenHash = new Map();
  }

  register({ token, installationId, installationSecret, nowMs = Date.now() }) {
    assertToken(token);
    assertInstallationCredentials(installationId, installationSecret);
    assertTimestamp(nowMs);

    this.pruneExpired(nowMs);

    const tokenHash = this.hash("token", token);

    if (this.recordIdByTokenHash.has(tokenHash)) {
      throw new OpenSignalError("TRACK_EXISTS", "Tracking token is already registered", 409);
    }

    const record = {
      id: randomUUID(),
      tokenHash,
      installationHash: this.hash("installation", installationId),
      credentialHash: this.hash("credential", installationSecret),
      createdAtMs: nowMs,
      expiresAtMs: nowMs + this.retentionMs,
      armedAtMs: null,
      firstSignalAtMs: null,
      latestSignalAtMs: null,
      signalCount: 0
    };

    this.recordsById.set(record.id, record);
    this.recordIdByTokenHash.set(tokenHash, record.id);

    return toPublicStatus(record);
  }

  recordSignal({ token, nowMs = Date.now() }) {
    if (!isValidToken(token) || !Number.isSafeInteger(nowMs) || nowMs < 0) {
      return { recorded: false };
    }

    const tokenHash = this.hash("token", token);
    const recordId = this.recordIdByTokenHash.get(tokenHash);
    const record = recordId ? this.recordsById.get(recordId) : null;

    if (!record || this.removeIfExpired(record, nowMs) || record.armedAtMs === null) {
      return { recorded: false };
    }

    record.signalCount += 1;
    record.firstSignalAtMs ??= nowMs;
    record.latestSignalAtMs = nowMs;

    return { recorded: true };
  }

  getStatus({ id, installationId, installationSecret, nowMs = Date.now() }) {
    const record = this.getAuthorizedRecord({
      id,
      installationId,
      installationSecret,
      nowMs
    });

    return toPublicStatus(record);
  }

  arm({ id, installationId, installationSecret, nowMs = Date.now() }) {
    const record = this.getAuthorizedRecord({
      id,
      installationId,
      installationSecret,
      nowMs
    });

    record.armedAtMs ??= nowMs;
    return toPublicStatus(record);
  }

  delete({ id, installationId, installationSecret, nowMs = Date.now() }) {
    const record = this.getAuthorizedRecord({
      id,
      installationId,
      installationSecret,
      nowMs
    });

    this.removeRecord(record);
    return { deleted: true };
  }

  pruneExpired(nowMs = Date.now()) {
    assertTimestamp(nowMs);

    for (const record of this.recordsById.values()) {
      this.removeIfExpired(record, nowMs);
    }
  }

  hash(namespace, value) {
    return createHmac("sha256", this.pepper)
      .update(namespace)
      .update("\0")
      .update(String(value))
      .digest("hex");
  }

  getAuthorizedRecord({ id, installationId, installationSecret, nowMs }) {
    assertRecordId(id);
    assertInstallationCredentials(installationId, installationSecret);
    assertTimestamp(nowMs);

    const record = this.recordsById.get(id);

    if (!record || this.removeIfExpired(record, nowMs)) {
      throw new OpenSignalError("TRACK_NOT_FOUND", "Tracking record was not found", 404);
    }

    const installationHash = this.hash("installation", installationId);
    const credentialHash = this.hash("credential", installationSecret);

    if (!safeEqual(record.installationHash, installationHash)
      || !safeEqual(record.credentialHash, credentialHash)) {
      throw new OpenSignalError("UNAUTHORIZED", "Tracking credentials are invalid", 401);
    }

    return record;
  }

  removeIfExpired(record, nowMs) {
    if (record.expiresAtMs > nowMs) {
      return false;
    }

    this.removeRecord(record);
    return true;
  }

  removeRecord(record) {
    this.recordsById.delete(record.id);
    this.recordIdByTokenHash.delete(record.tokenHash);
  }
}

export function createTrackingToken(byteLength = 32) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16 || byteLength > 64) {
    throw new TypeError("byteLength must be an integer from 16 through 64");
  }

  return randomBytes(byteLength).toString("base64url");
}

function toPublicStatus(record) {
  return {
    id: record.id,
    createdAt: new Date(record.createdAtMs).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    armedAt: record.armedAtMs === null
      ? null
      : new Date(record.armedAtMs).toISOString(),
    firstSignalAt: record.firstSignalAtMs === null
      ? null
      : new Date(record.firstSignalAtMs).toISOString(),
    latestSignalAt: record.latestSignalAtMs === null
      ? null
      : new Date(record.latestSignalAtMs).toISOString(),
    requestCount: record.signalCount
  };
}

function isValidToken(token) {
  return typeof token === "string"
    && token.length >= MIN_TOKEN_LENGTH
    && token.length <= MAX_TOKEN_LENGTH
    && TOKEN_PATTERN.test(token);
}

function assertToken(token) {
  if (!isValidToken(token)) {
    throw new OpenSignalError("INVALID_TOKEN", "Tracking token is invalid", 400);
  }
}

function assertInstallationCredentials(installationId, installationSecret) {
  if (typeof installationId !== "string" || installationId.length < 8 || installationId.length > 200) {
    throw new OpenSignalError("INVALID_INSTALLATION", "Installation identifier is invalid", 400);
  }

  if (typeof installationSecret !== "string"
    || installationSecret.length < MIN_SECRET_LENGTH
    || installationSecret.length > MAX_SECRET_LENGTH) {
    throw new OpenSignalError("INVALID_CREDENTIAL", "Installation credential is invalid", 400);
  }
}

function assertRecordId(id) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new OpenSignalError("INVALID_TRACK_ID", "Tracking record identifier is invalid", 400);
  }
}

function assertTimestamp(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("nowMs must be a non-negative safe integer");
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}
