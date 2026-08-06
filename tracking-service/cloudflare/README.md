# Cloudflare deployment

This Worker is the public HTTPS counterpart for the Gmail open-signal extension. It uses SQLite-backed Durable Objects and stores one tracking record per opaque token-derived ID.

Stored fields are limited to hashed token/installation credentials, creation and expiry timestamps, arming state, first/latest signal timestamps, aggregate request count, and rate-limit windows. The Worker never reads or stores the email body, subject, recipient address, attachment, raw IP address, or raw User-Agent string.

Deployment commands from the repository folder:

```powershell
pnpm run open-signal:deploy
```

The deployment wrapper keeps Wrangler's configuration and temporary credentials under the repository-local `.wrangler-config/` directory so the workflow does not write deployment state outside this project.

For an unauthenticated preview that must be claimed in Cloudflare within 60 minutes:

```powershell
pnpm run open-signal:deploy:temporary
```

After deployment, configure the resulting `https://...workers.dev` URL in the extension options page. Chrome Web Store submission is a separate, deferred task.

Current preview endpoint: `https://keyremap-gmail-open-signal.phantom-cinnamon-008.workers.dev`. The temporary Cloudflare account must be claimed before its claim window expires to retain the deployment.
