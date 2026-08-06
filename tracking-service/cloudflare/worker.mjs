const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const API_RATE_LIMIT = 60;
const PIXEL_RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const TRACK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSPARENT_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="),
  (character) => character.charCodeAt(0)
);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const pixelMatch = url.pathname.match(/^\/o\/([A-Za-z0-9_-]{22,128})\.gif$/);

    if (request.method === "GET" && pixelMatch) {
      const token = pixelMatch[1];
      const id = await deriveTrackId(token);
      const stub = getTrackStub(env, id);
      await stub.fetch("https://open-signal.internal/signal", {
        method: "POST",
        body: JSON.stringify({ tokenHash: await hashHex("token", token) })
      }).catch(() => {});
      return sendGif();
    }

    if (request.method === "POST" && url.pathname === "/v1/tracks") {
      try {
        const credentials = readCredentials(request);
        assertCredentials(credentials);
        const installHash = await hashHex("installation", credentials.installationId);
        const allowed = await takeRegistrationRateLimit(env, installHash);

        if (!allowed) {
          return sendJson(429, { error: "RATE_LIMITED" }, { "Retry-After": "60" });
        }

        const body = await readJsonBody(request);

        if (!TOKEN_PATTERN.test(String(body.token || ""))) {
          return sendJson(400, { error: "INVALID_TOKEN" });
        }

        const id = await deriveTrackId(body.token);
        const stub = getTrackStub(env, id);
        const response = await stub.fetch("https://open-signal.internal/register", {
          method: "POST",
          body: JSON.stringify({
            id,
            tokenHash: await hashHex("token", body.token),
            installationHash: installHash,
            credentialHash: await hashHex("credential", credentials.installationSecret),
            nowMs: Date.now(),
            retentionMs: RETENTION_MS
          })
        });
        return copyJsonResponse(response);
      } catch (error) {
        return handlePublicError(error);
      }
    }

    const trackMatch = url.pathname.match(/^\/v1\/tracks\/([0-9a-f-]{36})(?:\/(arm))?$/i);

    if (trackMatch) {
      try {
        if (!TRACK_ID_PATTERN.test(trackMatch[1])) {
          return sendJson(400, { error: "INVALID_TRACK_ID" });
        }

        const credentials = readCredentials(request);
        assertCredentials(credentials);
        const action = trackMatch[2] === "arm"
          ? "arm"
          : request.method === "GET"
            ? "status"
            : request.method === "DELETE"
              ? "delete"
              : "";

        if (!action || (trackMatch[2] === "arm" && request.method !== "POST")) {
          return sendJson(405, { error: "METHOD_NOT_ALLOWED" });
        }

        const stub = getTrackStub(env, trackMatch[1]);
        const response = await stub.fetch(`https://open-signal.internal/${action}`, {
          method: action === "status" ? "GET" : action === "delete" ? "DELETE" : "POST",
          headers: {
            "X-Credential-Hash": await hashHex("credential", credentials.installationSecret),
            "X-Installation-Hash": await hashHex("installation", credentials.installationId)
          }
        });
        return copyJsonResponse(response);
      } catch (error) {
        return handlePublicError(error);
      }
    }

    return sendJson(404, { error: "NOT_FOUND" });
  }
};

export class OpenSignalTrack {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const nowMs = Date.now();
    let record = await this.ctx.storage.get("record");

    if (record && record.expiresAtMs <= nowMs) {
      await this.ctx.storage.deleteAll();
      record = null;
    }

    if (request.method === "POST" && url.pathname === "/register") {
      if (record) {
        return internalJson(409, { error: "TRACK_EXISTS" });
      }

      const body = await request.json();
      const nextRecord = {
        id: body.id,
        tokenHash: body.tokenHash,
        installationHash: body.installationHash,
        credentialHash: body.credentialHash,
        createdAtMs: body.nowMs,
        expiresAtMs: body.nowMs + body.retentionMs,
        armedAtMs: null,
        firstSignalAtMs: null,
        latestSignalAtMs: null,
        signalCount: 0,
        apiWindow: null,
        pixelWindow: null
      };
      await this.ctx.storage.put("record", nextRecord);
      await this.ctx.storage.setAlarm(nextRecord.expiresAtMs);
      return internalJson(201, toPublicStatus(nextRecord));
    }

    if (request.method === "POST" && url.pathname === "/signal") {
      if (!record || record.armedAtMs === null) {
        return new Response(null, { status: 204 });
      }

      const body = await request.json();

      if (!safeEqual(record.tokenHash, String(body.tokenHash || ""))) {
        return new Response(null, { status: 204 });
      }

      const pixelRate = takeRate(record.pixelWindow, PIXEL_RATE_LIMIT, RATE_WINDOW_MS, nowMs);
      record.pixelWindow = pixelRate.window;

      if (pixelRate.allowed) {
        record.signalCount += 1;
        record.firstSignalAtMs ??= nowMs;
        record.latestSignalAtMs = nowMs;
      }

      await this.ctx.storage.put("record", record);
      return new Response(null, { status: 204 });
    }

    if (!record) {
      return internalJson(404, { error: "TRACK_NOT_FOUND" });
    }

    const installationHash = request.headers.get("X-Installation-Hash") || "";
    const credentialHash = request.headers.get("X-Credential-Hash") || "";

    if (!safeEqual(record.installationHash, installationHash)
      || !safeEqual(record.credentialHash, credentialHash)) {
      return internalJson(401, { error: "UNAUTHORIZED" });
    }

    const apiRate = takeRate(record.apiWindow, API_RATE_LIMIT, RATE_WINDOW_MS, nowMs);
    record.apiWindow = apiRate.window;

    if (!apiRate.allowed) {
      await this.ctx.storage.put("record", record);
      return internalJson(429, { error: "RATE_LIMITED" });
    }

    if (request.method === "POST" && url.pathname === "/arm") {
      record.armedAtMs ??= nowMs;
      await this.ctx.storage.put("record", record);
      return internalJson(200, toPublicStatus(record));
    }

    if (request.method === "GET" && url.pathname === "/status") {
      await this.ctx.storage.put("record", record);
      return internalJson(200, toPublicStatus(record));
    }

    if (request.method === "DELETE" && url.pathname === "/delete") {
      await this.ctx.storage.deleteAll();
      return internalJson(200, { deleted: true });
    }

    return internalJson(404, { error: "NOT_FOUND" });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export class ApiRateLimiter {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    const nowMs = Date.now();
    const previous = await this.ctx.storage.get("window");
    const result = takeRate(previous, API_RATE_LIMIT, RATE_WINDOW_MS, nowMs);
    await this.ctx.storage.put("window", result.window);
    return new Response(null, { status: result.allowed ? 204 : 429 });
  }
}

async function takeRegistrationRateLimit(env, installationHash) {
  const id = env.API_LIMITERS.idFromName(installationHash);
  const response = await env.API_LIMITERS.get(id).fetch("https://open-signal.internal/take", {
    method: "POST"
  });
  return response.status === 204;
}

function getTrackStub(env, id) {
  return env.TRACKS.get(env.TRACKS.idFromName(id));
}

function readCredentials(request) {
  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/);
  return {
    installationId: request.headers.get("X-Installation-Id") || "",
    installationSecret: bearer?.[1] || ""
  };
}

function assertCredentials(credentials) {
  if (credentials.installationId.length < 8 || credentials.installationId.length > 200) {
    throw publicError(400, "INVALID_INSTALLATION");
  }

  if (credentials.installationSecret.length < 32 || credentials.installationSecret.length > 512) {
    throw publicError(400, "INVALID_CREDENTIAL");
  }
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);

  if (contentLength > MAX_BODY_BYTES) {
    throw publicError(413, "BODY_TOO_LARGE");
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw publicError(413, "BODY_TOO_LARGE");
  }

  try {
    return JSON.parse(text || "{}");
  } catch (error) {
    throw publicError(400, "INVALID_JSON");
  }
}

async function deriveTrackId(token) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function hashHex(namespace, value) {
  const input = new TextEncoder().encode(`${namespace}\0${String(value)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function takeRate(previous, limit, windowMs, nowMs) {
  if (!previous || previous.resetAtMs <= nowMs) {
    return {
      allowed: true,
      window: { count: 1, resetAtMs: nowMs + windowMs }
    };
  }

  const window = {
    count: previous.count + 1,
    resetAtMs: previous.resetAtMs
  };
  return {
    allowed: window.count <= limit,
    window
  };
}

function toPublicStatus(record) {
  return {
    id: record.id,
    createdAt: new Date(record.createdAtMs).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    armedAt: record.armedAtMs === null ? null : new Date(record.armedAtMs).toISOString(),
    firstSignalAt: record.firstSignalAtMs === null ? null : new Date(record.firstSignalAtMs).toISOString(),
    latestSignalAt: record.latestSignalAtMs === null ? null : new Date(record.latestSignalAtMs).toISOString(),
    requestCount: record.signalCount
  };
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");

  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

function sendGif() {
  return withCors(new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Content-Type": "image/gif",
      Expires: "0",
      Pragma: "no-cache"
    }
  }));
}

function sendJson(status, payload, extraHeaders = {}) {
  return withCors(new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  }));
}

function internalJson(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function copyJsonResponse(response) {
  return sendJson(response.status, await response.json());
}

function withCors(response) {
  const next = new Response(response.body, response);
  next.headers.set("Access-Control-Allow-Origin", "*");
  next.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  next.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Installation-Id");
  next.headers.set("Access-Control-Max-Age", "600");
  return next;
}

function publicError(status, code) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  return error;
}

function handlePublicError(error) {
  return sendJson(error.status || 500, {
    error: error.code || "INTERNAL_ERROR"
  });
}
