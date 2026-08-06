import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { OpenSignalError } from "./open-signal-store.mjs";

const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64"
);
const MAX_BODY_BYTES = 16 * 1024;

export function createOpenSignalServer({
  store,
  apiRateLimit = { limit: 60, windowMs: 60_000 },
  pixelRateLimit = { limit: 120, windowMs: 60_000 },
  now = () => Date.now()
}) {
  if (!store) {
    throw new TypeError("store is required");
  }

  const apiLimiter = new FixedWindowRateLimiter(apiRateLimit);
  const pixelLimiter = new FixedWindowRateLimiter(pixelRateLimit);

  return createServer(async (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url || "/", "http://localhost");

    try {
      const pixelMatch = requestUrl.pathname.match(/^\/o\/([A-Za-z0-9_-]+)\.gif$/);

      if (request.method === "GET" && pixelMatch) {
        const token = pixelMatch[1];
        const allowed = pixelLimiter.take(hashRateKey("pixel", token), now());

        if (allowed) {
          store.recordSignal({ token, nowMs: now() });
        }

        sendGif(response);
        return;
      }

      if (!requestUrl.pathname.startsWith("/v1/tracks")) {
        sendJson(response, 404, { error: "NOT_FOUND" });
        return;
      }

      const credentials = readCredentials(request);
      const apiKey = hashRateKey("api", credentials.installationId || request.socket.remoteAddress || "unknown");

      if (!apiLimiter.take(apiKey, now())) {
        sendJson(response, 429, { error: "RATE_LIMITED" }, { "Retry-After": "60" });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/v1/tracks") {
        const body = await readJsonBody(request);
        const status = store.register({
          token: body.token,
          installationId: credentials.installationId,
          installationSecret: credentials.installationSecret,
          nowMs: now()
        });
        sendJson(response, 201, status);
        return;
      }

      const trackMatch = requestUrl.pathname.match(/^\/v1\/tracks\/([0-9a-f-]{36})(?:\/(arm))?$/i);

      if (!trackMatch) {
        sendJson(response, 404, { error: "NOT_FOUND" });
        return;
      }

      const parameters = {
        id: trackMatch[1],
        installationId: credentials.installationId,
        installationSecret: credentials.installationSecret,
        nowMs: now()
      };

      if (request.method === "POST" && trackMatch[2] === "arm") {
        sendJson(response, 200, store.arm(parameters));
        return;
      }

      if (trackMatch[2]) {
        response.setHeader("Allow", "POST");
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }

      if (request.method === "GET") {
        sendJson(response, 200, store.getStatus(parameters));
        return;
      }

      if (request.method === "DELETE") {
        sendJson(response, 200, store.delete(parameters));
        return;
      }

      response.setHeader("Allow", "GET, POST, DELETE");
      sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    } catch (error) {
      if (error instanceof OpenSignalError) {
        sendJson(response, error.status, { error: error.code });
        return;
      }

      if (error?.code === "INVALID_JSON" || error?.code === "BODY_TOO_LARGE") {
        sendJson(response, error.status, { error: error.code });
        return;
      }

      sendJson(response, 500, { error: "INTERNAL_ERROR" });
    }
  });
}

class FixedWindowRateLimiter {
  constructor({ limit, windowMs }) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError("rate limit must be a positive safe integer");
    }

    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new TypeError("rate-limit window must be a positive safe integer");
    }

    this.limit = limit;
    this.windowMs = windowMs;
    this.windows = new Map();
  }

  take(key, nowMs) {
    const existing = this.windows.get(key);

    if (!existing || existing.resetAtMs <= nowMs) {
      this.windows.set(key, { count: 1, resetAtMs: nowMs + this.windowMs });
      return true;
    }

    existing.count += 1;
    return existing.count <= this.limit;
  }
}

function readCredentials(request) {
  const installationId = String(request.headers["x-installation-id"] || "");
  const authorization = String(request.headers.authorization || "");
  const bearerMatch = authorization.match(/^Bearer ([A-Za-z0-9._~-]+)$/);

  return {
    installationId,
    installationSecret: bearerMatch?.[1] || ""
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let byteLength = 0;

  for await (const chunk of request) {
    byteLength += chunk.length;

    if (byteLength > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.code = "BODY_TOO_LARGE";
      error.status = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (cause) {
    const error = new Error("Request body is not valid JSON", { cause });
    error.code = "INVALID_JSON";
    error.status = 400;
    throw error;
  }
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Installation-Id");
  response.setHeader("Access-Control-Max-Age", "600");
}

function sendGif(response) {
  response.writeHead(200, {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Content-Length": String(TRANSPARENT_GIF.length),
    "Content-Type": "image/gif",
    Expires: "0",
    Pragma: "no-cache"
  });
  response.end(TRANSPARENT_GIF);
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": String(body.length),
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(body);
}

function hashRateKey(namespace, value) {
  return createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(String(value))
    .digest("hex");
}
