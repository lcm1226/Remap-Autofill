# Gmail Open Signal Plan

## Status

- Decision: technically viable as an approximate open-signal feature.
- Product wording: use `열람 신호` rather than guaranteed `읽음 확인` or exact read counts.
- Implementation state: the Gmail compose toggle, tracking pixel, send arming, background API client, options UI, local service contract, and public Cloudflare Worker are implemented. A Gmail-to-Naver real-recipient test recorded exactly one signal and was cleaned up successfully.
- Migration gate result: Gmail key remap passed in Chrome and Government24 autofill passed in Comet. The previous extension ID and the literal JSON transfer action remain unverified because internal extension pages cannot be automated under the browser-control security policy.
- External deployment gate: approved by the user and completed as a claimable Cloudflare preview deployment. Chrome Web Store submission remains explicitly deferred.

## Implementation checkpoint

- Added an in-memory service store and HTTP contract under `tracking-service/`.
- Implemented opaque-token registration, hashed installation credentials, GIF signal recording, aggregate status, expiry, authenticated deletion, and independent API/pixel rate limiting.
- Added nine local automated tests covering aggregation, authentication failure, expiry, deletion, duplicate/malformed tokens, HTTP endpoints, independent rate limits, unknown-token GIF responses, and the extension background's full configure/register/arm/refresh/delete flow.
- Added Gmail compose discovery, a per-message toggle, one-pixel insertion, send confirmation, server arming, and local status history in the extension.
- Added options-page service configuration, explicit consent, refresh, and deletion controls.
- Deployed a SQLite-backed Durable Objects Worker at `https://keyremap-gmail-open-signal.phantom-cinnamon-008.workers.dev` with 30-day expiry, authenticated aggregate status/deletion, and independent registration/API/pixel rate limits.
- Verified the public endpoint with cryptographically random test data through register, arm, GIF request, one-signal status, deletion, and post-delete 404. The test record was deleted.
- A controlled Gmail-to-Naver message verified compose/MIME survival, one recipient-side 1x1 image load, an aggregate count of one, authenticated tracking-record deletion, and test-message cleanup. The broader multi-provider/client validation matrix remains future hardening work rather than a release blocker for personal use.

## Competitive validation

The recommended design matches the core mechanism documented by established Gmail tracking products.

| Product | Documented mechanism | Gmail UX | Documented limitations or notable behavior |
| --- | --- | --- | --- |
| Mailsuite (Mailtrack) | Adds a tracking pixel and records the request on Mailsuite servers | Check marks, alerts, activity dashboard | Image blocking, plain-text email, forwards, self-opens, and automatic image downloads can make tracking incomplete or inaccurate |
| Streak | Inserts a small tracking image; the recipient's provider requests it from Streak | Per-compose toggle, Gmail indicators, notifications, recent views | Results depend on client settings and devices; blockers can block the tracking domain |
| Mixmax | Uses a tracking pixel for opens and redirect URLs for clicks | Gmail tracking controls, live feed, notifications, CRM sync | Image blocking and privacy tools reduce open accuracy; click signals are independent and usually stronger |
| HubSpot Sales | Inserts a hidden 1x1 image into tracked Gmail messages | Track checkbox, activity feed, real-time notifications | Plain-text mode is unsupported; extension conflicts, VPNs, and blockers can prevent tracking |

Primary references:

- Mailsuite tracking mechanism: https://mailsuite.com/hc/en-us/articles/360013900257-How-to-track-email-opens
- Mailsuite reliability limits: https://mailsuite.com/hc/en-us/articles/360005941217-How-accurate-and-reliable-is-Mailtrack-s-email-tracking-technology
- Mailsuite false positives: https://mailsuite.com/hc/en-us/articles/360005926978-Open-alerts-received-immediately-after-sending-a-mail
- Streak tracking mechanism: https://support.streak.com/en/articles/2447759-how-does-email-tracking-work
- Mixmax tracking overview: https://success.mixmax.com/en/articles/8002136-tracking-overview
- HubSpot pixel verification and limitations: https://knowledge.hubspot.com/connected-email/troubleshooting-the-hubspot-sales-chrome-extension

## Product decision

### What the feature may claim

- A remote image request was detected.
- The first and latest signal timestamps.
- The number of server requests received for the tracking image.
- Whether the result may have been affected by a proxy, scanner, blocker, or privacy feature.

### What the feature must not claim

- That the recipient definitely read or understood the email.
- That the displayed request count is an exact human read count.
- Which person opened a message sent to multiple recipients unless the recipients received individually generated messages.
- Who opened a forwarded message.

## Recommended MVP scope

- Gmail web only.
- Personal Gmail supported without Gmail API authorization.
- Rich-text messages only.
- Manual opt-in for each compose window; default off.
- One recipient is the supported high-confidence case.
- Multi-recipient messages show only `한 명 이상의 클라이언트에서 신호 감지`.
- Open signals only; tracked-link redirects are deferred.
- No browser or email notifications in the first MVP.
- No Chrome Web Store submission as part of this work.

## Architecture

### Extension

1. Detect Gmail compose windows with a `MutationObserver`.
2. Add a small `열람 신호` toggle to each compose toolbar.
3. On first use, show a prominent disclosure and require affirmative consent.
4. Generate a cryptographically random tracking ID.
5. Register the ID through the extension service worker.
6. Insert exactly one remote 1x1 image into the current rich-text message.
7. Store recipient and subject labels only in `chrome.storage.local` for the sender's local history.
8. Query and delete aggregate tracking status through the service worker.

### Tracking service

Proposed endpoints:

- `POST /v1/tracks`: register an opaque tracking ID.
- `POST /v1/tracks/{id}/arm`: activate counting only after Gmail send confirmation so the compose-time image request is not counted.
- `GET /o/{token}.gif`: record a signal and return a transparent GIF.
- `GET /v1/tracks/{id}`: return aggregate status to the authenticated extension installation.
- `DELETE /v1/tracks/{id}`: delete server-side status.

Server-side data should be limited to:

- hashed tracking token;
- hashed installation identifier;
- created and expiry timestamps;
- first and latest signal timestamps;
- aggregate request count;
- coarse, non-identifying client classification only if proven necessary.

The service must not store message bodies, subjects, recipient addresses, attachments, raw IP addresses, or raw User-Agent strings.

### Authentication and security

- Generate an installation secret and keep it in `chrome.storage.local`, not sync storage.
- Use at least 128 bits of randomness for public pixel tokens.
- Store token and installation identifiers as hashes on the server.
- Use HTTPS only.
- Rate-limit pixel and API endpoints independently.
- Do not log sensitive path parameters.
- Default retention: 30 days, with immediate user-triggered deletion.
- Treat tracking-service failure as fail-open for email sending; it must never prevent Gmail from sending an untracked email.
- Keep all executable extension logic inside the packaged extension. The service returns only GIF and JSON data.

## Expected repository changes after the gates pass

- `manifest.json`
  - Add a narrowly scoped HTTPS host permission for the chosen tracking service.
  - Load Gmail-specific tracking code only on `https://mail.google.com/*`.
- `gmail-tracking.js` (new)
  - Compose discovery, per-compose state, toolbar toggle, pixel insertion and removal.
- `gmail-tracking.css` (new)
  - Gmail-integrated toggle and disclosure styling.
- `background.js`
  - Fixed-operation tracking API messages; never accept arbitrary fetch URLs from content scripts.
- `options.html`, `options.css`, `options.js`
  - Consent, service status, local history, aggregate signals, deletion, and limitations.
- `popup.html`, `popup.css`, `popup.js`
  - Optional recent-status summary only after the options-page flow is stable.
- `PRIVACY.md`
  - Replace the current no-server claim with accurate collection, transmission, retention, and deletion details.
- `README.md`
  - Document the feature as an estimate and describe its limitations.
- `PROGRESS.md`
  - Record each completed implementation and verification milestone.

## Implementation phases

### Phase 0: migration smoke test

- Confirm a settings JSON export exists for the previous unpacked extension.
- Load the extension from the new active path.
- Compare old and new extension IDs.
- Import settings if the new extension has no rules.
- Verify Gmail `Delete -> Shift+3`.
- Verify Government24 name, birth date, and phone autofill.
- Verify the Government24 carrier select when possible.
- Separate failures from untested cases.

Runtime code remains unchanged until this phase passes or the user explicitly overrides the gate after reviewing the failures.

### Phase 1: compose and MIME feasibility spike

- Use controlled sender and recipient accounts; do not test with personal content.
- Verify that an inserted external image survives normal send, keyboard send, draft reopen, scheduled send, reply, and forward.
- Inspect Gmail `Show original` to confirm exactly one pixel URL is present.
- Verify that plain-text mode is detected and tracking is disabled with an explanation.
- Verify that old pixels from quoted replies or forwards are removed only when they use this project's tracker domain.

Go criteria:

- A unique external image survives Gmail sending consistently.
- It does not alter visible message layout.
- Multiple compose windows remain isolated.
- Original key-remap and autofill behavior remains unchanged.

### Phase 2: local service contract

- Implement the endpoint contract behind an in-process or local test double.
- Add tests for token validation, authentication, rate limiting, expiry, deletion, and aggregate status.
- Do not select or deploy a hosting provider in this phase.

### Phase 3: extension integration

- Implement the Gmail compose toggle behind a disabled experimental setting.
- Route all remote operations through fixed background message types.
- Persist local-only metadata and migration-safe settings.
- Add consent and limitations UI.

### Phase 4: controlled public-endpoint test

This phase requires explicit approval because it creates or uses externally reachable infrastructure.

- Select the hosting provider and region.
- Deploy a minimal test endpoint.
- Send controlled test emails to Gmail, Naver Mail, Outlook, and Apple Mail.
- Measure false positives, false negatives, proxy behavior, self-opens, and blocker behavior.
- Decide whether the feature is fit for personal use and whether a public product needs to be split into a separate extension.

### Phase 5: hardening and documentation

- Complete privacy disclosures and affirmative consent.
- Add retention and full-delete controls.
- Run syntax, manifest, local unit, and manual Gmail regression checks.
- Update README and PROGRESS.
- Keep Chrome Web Store submission deferred.

## Validation matrix

- New message, reply, and forward.
- Multiple simultaneous compose windows.
- Send button, keyboard send, scheduled send, undo send, and discarded draft.
- Rich text and plain text.
- Single recipient and To/CC/BCC combinations.
- Gmail images enabled and `Ask before displaying external images`.
- Gmail web and mobile.
- Naver Mail and Outlook web.
- Apple Mail with privacy protection enabled.
- Tracking blocker, ad blocker, VPN, and offline tracking service.
- Self-open suppression and sender-side Sent-folder previews.

## Acceptance criteria

- No tracking without per-message opt-in and prior disclosure consent.
- Exactly one project-owned tracking pixel per tracked outgoing message.
- No subject, body, attachment, or recipient address stored on the tracking service.
- First signal, latest signal, and request count are clearly labelled as estimates.
- Plain-text and blocked-image limitations are visible in the UI.
- Local and server-side delete operations succeed.
- Existing settings migrate without loss.
- Autofill, picker, JSON import/export, and Gmail key remap pass regression checks.
- No remote executable code and no broad new host permission.
- No deployment or Chrome Web Store submission without explicit approval.

## Open decisions before Phase 4

- Whether the feature is only for personal unpacked use or intended for eventual public distribution.
- Which serverless or hosted platform is acceptable.
- Required hosting region and retention period.
- Whether recipient-facing disclosure text should be appended to tracked emails.
- Whether link-click tracking is desirable after open-signal accuracy is measured.
- Whether public-store distribution should use a separate Gmail-focused extension to reduce single-purpose policy risk.
