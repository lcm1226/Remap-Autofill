# Local open-signal service contract

This directory is a local-only implementation spike for the Gmail open-signal plan. It is not configured in the extension, exposed to the internet, or suitable for deployment as-is.

Implemented locally:

- opaque tracking-token registration;
- hashed token, installation ID, and installation credential storage;
- transparent GIF signal endpoint;
- authenticated post-send arming so compose-time image requests are not counted;
- first/latest timestamps and aggregate request counts;
- independent API and pixel rate limits;
- 30-day default expiry and authenticated deletion;
- deliberately indistinguishable GIF responses for registered and unknown tokens.

The in-memory store intentionally loses all data when the process exits. A later approved deployment phase must choose durable storage, secrets management, hosting region, log redaction, monitoring, and an HTTPS endpoint. None of those deployment choices are made here.

Run the local tests from the repository folder:

```powershell
node --test .\tracking-service\open-signal-store.test.mjs .\tracking-service\background-open-signal.test.mjs
```

Run a local development server:

```powershell
node .\tracking-service\start-local.mjs
```

Then set the extension's Gmail open-signal service URL to `http://127.0.0.1:8787`. This local address is only for extension UI and contract testing; recipients outside this computer cannot reach it. Real recipient signals require an approved HTTPS deployment.
