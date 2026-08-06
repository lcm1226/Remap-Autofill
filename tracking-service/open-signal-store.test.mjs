import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { once } from "node:events";
import {
  OpenSignalError,
  OpenSignalStore,
  createTrackingToken
} from "./open-signal-store.mjs";
import { createOpenSignalServer } from "./open-signal-server.mjs";

const PEPPER = "test-pepper-that-is-at-least-thirty-two-characters";
const INSTALLATION_ID = "installation-test-001";
const INSTALLATION_SECRET = "installation-secret-that-is-long-enough-001";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("OpenSignalStore", () => {
  it("records only aggregate signal timestamps and counts", () => {
    const store = new OpenSignalStore({ pepper: PEPPER });
    const token = createTrackingToken();
    const registered = store.register({
      token,
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_000
    });

    assert.equal(registered.requestCount, 0);
    assert.equal(registered.firstSignalAt, null);
    assert.deepEqual(store.recordSignal({ token, nowMs: 1_500 }), { recorded: false });
    store.arm({
      id: registered.id,
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_900
    });
    assert.deepEqual(store.recordSignal({ token, nowMs: 2_000 }), { recorded: true });
    assert.deepEqual(store.recordSignal({ token, nowMs: 3_000 }), { recorded: true });

    const status = store.getStatus({
      id: registered.id,
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 3_000
    });

    assert.equal(status.requestCount, 2);
    assert.equal(status.firstSignalAt, "1970-01-01T00:00:02.000Z");
    assert.equal(status.latestSignalAt, "1970-01-01T00:00:03.000Z");
    assert.equal(JSON.stringify(status).includes(token), false);
    assert.equal(JSON.stringify([...store.recordsById.values()]).includes(INSTALLATION_SECRET), false);
  });

  it("rejects the wrong installation credential", () => {
    const store = new OpenSignalStore({ pepper: PEPPER });
    const registered = store.register({
      token: createTrackingToken(),
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_000
    });

    assert.throws(() => store.getStatus({
      id: registered.id,
      installationId: INSTALLATION_ID,
      installationSecret: "wrong-secret-that-is-still-long-enough-000",
      nowMs: 1_000
    }), (error) => error instanceof OpenSignalError && error.code === "UNAUTHORIZED");
  });

  it("expires and deletes records", () => {
    const expiringStore = new OpenSignalStore({ pepper: PEPPER, retentionMs: 100 });
    const expired = expiringStore.register({
      token: createTrackingToken(),
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_000
    });

    assert.throws(() => expiringStore.getStatus({
      id: expired.id,
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_100
    }), (error) => error.code === "TRACK_NOT_FOUND");

    const deletingStore = new OpenSignalStore({ pepper: PEPPER });
    const active = deletingStore.register({
      token: createTrackingToken(),
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_000
    });

    assert.deepEqual(deletingStore.delete({
      id: active.id,
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_000
    }), { deleted: true });
    assert.throws(() => deletingStore.getStatus({
      id: active.id,
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_000
    }), (error) => error.code === "TRACK_NOT_FOUND");
  });

  it("rejects malformed and duplicate public tokens", () => {
    const store = new OpenSignalStore({ pepper: PEPPER });
    const token = createTrackingToken();
    const parameters = {
      token,
      installationId: INSTALLATION_ID,
      installationSecret: INSTALLATION_SECRET,
      nowMs: 1_000
    };

    store.register(parameters);
    assert.throws(() => store.register(parameters), (error) => error.code === "TRACK_EXISTS");
    assert.throws(() => store.register({ ...parameters, token: "too-short" }), (error) => {
      return error.code === "INVALID_TOKEN";
    });
  });
});

describe("open-signal HTTP contract", () => {
  it("registers, records a pixel request, reads status, and deletes", async () => {
    const store = new OpenSignalStore({ pepper: PEPPER });
    const server = await listen(createOpenSignalServer({ store }));
    const baseUrl = serverBaseUrl(server);
    const token = createTrackingToken();
    const headers = credentialHeaders();

    const registrationResponse = await fetch(`${baseUrl}/v1/tracks`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const registration = await registrationResponse.json();

    assert.equal(registrationResponse.status, 201);

    const ignoredPixelResponse = await fetch(`${baseUrl}/o/${token}.gif?cache=before-send`);
    assert.equal(ignoredPixelResponse.status, 200);

    const beforeArmResponse = await fetch(`${baseUrl}/v1/tracks/${registration.id}`, { headers });
    assert.equal((await beforeArmResponse.json()).requestCount, 0);

    const armResponse = await fetch(`${baseUrl}/v1/tracks/${registration.id}/arm`, {
      method: "POST",
      headers
    });
    assert.equal(armResponse.status, 200);

    const pixelResponse = await fetch(`${baseUrl}/o/${token}.gif?cache=1`);
    assert.equal(pixelResponse.status, 200);
    assert.equal(pixelResponse.headers.get("content-type"), "image/gif");
    assert.equal(pixelResponse.headers.get("cache-control").includes("no-store"), true);
    assert.equal((await pixelResponse.arrayBuffer()).byteLength > 0, true);

    const statusResponse = await fetch(`${baseUrl}/v1/tracks/${registration.id}`, { headers });
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(status.requestCount, 1);

    const deleteResponse = await fetch(`${baseUrl}/v1/tracks/${registration.id}`, {
      method: "DELETE",
      headers
    });
    assert.equal(deleteResponse.status, 200);

    const missingResponse = await fetch(`${baseUrl}/v1/tracks/${registration.id}`, { headers });
    assert.equal(missingResponse.status, 404);
  });

  it("rate-limits API and pixel recording independently", async () => {
    let nowMs = 1_000;
    const store = new OpenSignalStore({ pepper: PEPPER });
    const server = await listen(createOpenSignalServer({
      store,
      now: () => nowMs,
      apiRateLimit: { limit: 3, windowMs: 60_000 },
      pixelRateLimit: { limit: 1, windowMs: 60_000 }
    }));
    const baseUrl = serverBaseUrl(server);
    const token = createTrackingToken();
    const headers = credentialHeaders();

    const registrationResponse = await fetch(`${baseUrl}/v1/tracks`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const registration = await registrationResponse.json();

    await fetch(`${baseUrl}/v1/tracks/${registration.id}/arm`, {
      method: "POST",
      headers
    });

    await fetch(`${baseUrl}/o/${token}.gif?cache=1`);
    await fetch(`${baseUrl}/o/${token}.gif?cache=2`);

    const statusResponse = await fetch(`${baseUrl}/v1/tracks/${registration.id}`, { headers });
    const status = await statusResponse.json();
    assert.equal(status.requestCount, 1);

    const limitedResponse = await fetch(`${baseUrl}/v1/tracks/${registration.id}`, { headers });
    assert.equal(limitedResponse.status, 429);

    nowMs += 60_000;
    const resetResponse = await fetch(`${baseUrl}/v1/tracks/${registration.id}`, { headers });
    assert.equal(resetResponse.status, 200);
  });

  it("returns an indistinguishable GIF for unknown tokens", async () => {
    const store = new OpenSignalStore({ pepper: PEPPER });
    const server = await listen(createOpenSignalServer({ store }));
    const response = await fetch(`${serverBaseUrl(server)}/o/${createTrackingToken()}.gif`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/gif");
  });
});

function credentialHeaders() {
  return {
    Authorization: `Bearer ${INSTALLATION_SECRET}`,
    "X-Installation-Id": INSTALLATION_ID
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
