# Auth Autofill Integration Plan (Draft)

## Status and decision

- Status: the clean-room core, device-local multi-profile UI, encrypted profile transfer, fixed background message boundary, bounded observer runtime, and Wave A provider adapters are implemented. The unpacked extension was reloaded and the Gmail key-remap/open-signal UI regression passed; live identity-profile UI and provider fill verification remain pending.
- Decision: integration is technically feasible and fits the extension's broader form-automation purpose.
- Memory conclusion: replacing two extensions with one should reduce some duplicated extension overhead, but an overwhelming reduction is not guaranteed. The larger opportunity is to replace Auth Autofill's all-URL/all-frame script and repeated timers with provider-scoped, event-driven adapters.
- Distribution: Chrome Web Store submission remains deferred until the user explicitly requests it.

## Evidence reviewed

- Chrome Web Store item `picheccdgiofpnkjbkekgkcighblblem`, version 3.0.1, updated 2026-03-09, size 48.52 KiB.
- Public repository `ParkJeongseop/AuthAutoFill`, `master` commit `eb7fedb2f65036291a13392df35af13e403efef0` reviewed on 2026-08-06.
- The source manifest requests only `storage`, injects `autofill.js` on `<all_urls>` at `document_start`, and enables `all_frames`.
- The public behavior covers profiles containing name, phone number, carrier/MVNO, birth date, gender, foreigner status, and preferred SMS/PASS method.
- The source contains provider-specific branches for major Korean identity-verification vendors and many public/financial sites, with repeated polling intervals and automatic clicks for some steps.
- No `LICENSE`, `LICENSE.md`, or `COPYING` file and no repository license declaration were found. Therefore, this project must not copy or adapt the source code without separate permission from its author. The implementation below is a clean-room reimplementation of observed product behavior.

## What must be added

### 1. Separate identity-profile model

Add a storage model independent from the existing selector rules and Gmail tracking state.

Proposed keys:

- `identityAutofillConfig` in `chrome.storage.local`
- `identityAutofillProfiles` in `chrome.storage.local`
- `identityAutofillSession` in `chrome.storage.session` only when an encrypted vault is unlocked

Proposed profile fields:

- `id`, `label`, `name`
- normalized mobile number
- carrier: SKT, KT, LG U+, or the corresponding MVNO
- birth date
- gender and domestic/foreigner status, used only to derive the required identity digit locally
- preferred method: SMS or PASS
- `createdAt`, `updatedAt`

Rules:

- Do not store a complete resident-registration number.
- Do not put identity profiles in `chrome.storage.sync` by default.
- Restrict local storage access to trusted extension contexts where supported; content scripts receive only the selected profile needed for the currently matched provider.
- Do not send profile data to the Gmail open-signal service or any new server.
- Keep identity profiles out of the existing rule JSON export. Provide a separate, explicit profile export/import flow.

Security choice for implementation kickoff:

- Default: device-local storage with a clear explanation that it is not cloud-synced and is protected by the browser/OS profile, not by a separate extension password.
- Optional hardened mode: passphrase-derived AES-GCM encryption, with the derived key kept only in `chrome.storage.session` and a fresh unlock required after browser restart. Never save the passphrase or a reversible key beside the ciphertext.

### 2. Profile manager UI

Extend the existing options page instead of copying Auth Autofill's popup.

- Add a `본인인증 정보` section without separate feature-mode toggles.
- Add create, edit, select-for-automatic-fill, duplicate, and delete actions. Allow up to 20 records and release only the selected record to a provider.
- Mask phone and birth data in lists; reveal full values only while editing.
- Validate dates, mobile-number length, carrier/MVNO choice, and required fields before saving.
- Add a per-profile preferred authentication method.
- Add an explicit `현재 사이트에서 이번 한 번 채우기` action as a safe fallback.
- Add a separate profile import/export panel with an unmistakable sensitive-data warning.
- Keep the current field picker, generic autofill rules, key remaps, and Gmail open-signal controls unchanged.

The popup should gain only a compact status block:

- selected-record selector
- retry-fill button for the active tab
- link to manage profiles

### 3. Provider adapter engine

Do not add the upstream 115 KB script or reproduce its long hostname `if/else` chain. Add a small adapter registry.

Proposed files:

- `identity-profile.js`: schema, normalization, validation, masking, optional encryption
- `identity-background.js`: fixed storage/message operations
- `identity-autofill.js`: frame-safe runtime and DOM observation
- `identity-adapters.js`: adapter registry and shared fill primitives
- `identity-adapters/`: one module per provider family
- `identity-options.js`: profile-manager UI

Each adapter declares:

- exact host/path patterns
- page-stage detector
- fields it can fill
- carrier and authentication-method mappings
- events required by the provider UI
- whether it supports top frame, child frame, popup, or `about:blank` descendant frames
- an idempotency marker so the same step is not repeated indefinitely

Shared fill primitives must:

- use the element's native value setter where necessary
- dispatch the smallest verified sequence of `input`, `change`, `keyup`, and blur events
- support inputs, selects, radio/checkbox controls, and open shadow roots
- use a bounded `MutationObserver` plus short bounded retries, not permanent 500 ms polling
- stop observing after success, navigation, timeout, or when no selected record exists
- never log profile values

### 4. Frame and permission strategy

- Keep the generic `content.js` behavior stable.
- Load the new identity runtime only on an allowlist of supported verification-provider origins.
- Use `all_frames: true` for that narrowly scoped content script because verification UIs commonly live in child frames or popup documents.
- Add `match_origin_as_fallback` only if independently verified for provider-created `about:blank`, `data:`, or `blob:` frames.
- Do not add a broader permission than the project already has. Before any future store submission, reassess whether generic user-created rules justify the existing broad host access and whether identity-provider origins can be optional permissions.
- Do not load remote JavaScript, CSS, fonts, or icons.

### 5. Safety boundary for automated actions

Version 1 of the integration will fill and select fields only.

Allowed automatically:

- name, birth date, phone number, gender/foreigner field
- carrier/MVNO selection
- SMS/PASS method selection when it is unambiguous
- focus on CAPTCHA or OTP input after the preceding fields are ready

Disallowed automatically by default:

- agreeing to legal terms
- clicking paid-service or marketing consent
- requesting an SMS/PASS authentication transaction
- submitting CAPTCHA or OTP
- reading SMS messages, clipboard contents, or notifications
- completing a final identity-verification submission

Any future `다음` or `인증 요청` automation must be a separate per-provider opt-in with a visible pre-action confirmation.

## Provider rollout

Support should be delivered by provider family, not by every government or commercial site that embeds the same vendor.

### Wave A: core engine and high-value providers

- NICE CheckPlus
- SCI/Siren24
- KCB/OK-Name
- DreamSecurity Mobile-OK

### Wave B: remaining carrier-verification vendors

- KCP
- Mobilians
- Inicis
- KMCert
- Danal, after its current live flow is independently identified

### Wave C: common broker flows

- Any-ID / 민간 간편인증 broker
- mobile-ID broker flows
- payment-specific verification variants only where their behavior differs from the vendor adapter

Site names in the upstream README are used only as a compatibility checklist. Selectors and flow logic must be derived independently from current live pages or synthetic fixtures.

## Migration from the installed Auth Autofill extension

Chrome isolates storage by extension ID, so this extension cannot directly read `picheccdgiofpnkjbkekgkcighblblem` data.

- The reviewed Auth Autofill UI/source does not expose a normal profile-export workflow.
- Initial migration therefore requires recreating the profile once in this extension.
- After that, this project will support its own explicit profile export/import.
- If the upstream author later supplies a documented export format, add a user-initiated importer that validates every field before saving.
- Never request access to the other extension's internal storage or copy data from Chrome profile files.

## Implementation phases

### Phase 0: baseline and non-regression lock

- Record current `verify-fast` result.
- Record a live Gmail `Delete -> Shift+3` regression result.
- Export the current generic rules JSON as a user-held backup.
- Measure the current two-extension memory baseline in Chrome Task Manager across idle, ordinary browsing, Gmail, and one verification popup. Repeat three times and report a range rather than a single number.

### Phase 1: secure profile foundation

- Implement schema, normalization, masked rendering, local-only storage, trusted-context access, and CRUD UI.
- Add unit tests for validation, migration, masking, phone/date normalization, and identity-digit derivation.
- Do not add any site adapters yet.

### Phase 2: adapter runtime

- Implement the registry, frame-safe message contract, event helpers, bounded observation, idempotency, and failure isolation.
- Test against synthetic DOM fixtures for native forms and React/Vue-style controlled inputs.
- Prove that a failing adapter cannot block generic autofill, key remap, or Gmail tracking.

### Phase 3: Wave A providers

- Implement one provider at a time.
- For each provider, verify popup/frame discovery, profile fill, carrier selection, SMS/PASS selection, late DOM insertion, and no submit.
- Use dummy values where accepted; when a live page requires real identity data, inspect only field state and never submit.

### Phase 4: Waves B and C

- Add adapters only after the preceding provider passes its own fixture and live non-submit smoke test.
- Track compatibility by provider version/date because vendor markup changes independently of this extension.

### Phase 5: migration and privacy documentation

- Add the separate profile import/export format and deletion controls.
- Update README, PRIVACY, store disclosure draft, and troubleshooting guidance.
- Clearly disclose local handling of name, phone, birth date, gender/foreigner status, carrier, and authentication preference even when none is sent to a server.

### Phase 6: full regression and memory comparison

- Run syntax, unit, integration, and manifest checks.
- Re-run Gmail key remap, generic picker/autofill, JSON import/export, and Gmail open-signal tests.
- Compare the same Chrome Task Manager scenarios after disabling the standalone Auth Autofill extension.
- Report absolute MB and percentage differences with browser version, tab set, and measurement variance.
- Do not uninstall the standalone extension until the combined implementation passes the agreed provider matrix and the user approves removal.

## Acceptance criteria

- Existing generic autofill rules and key-remap settings survive without schema loss.
- Gmail `Delete -> Shift+3` and Gmail open-signal remain operational.
- Identity data is device-local by default and never reaches the tracking service.
- Profile data is masked in list views and excluded from ordinary rule export.
- No full resident-registration number is stored.
- No CAPTCHA, OTP, consent, authentication request, or final submission is automated by default.
- Adapters run only on their declared origins/frames and stop polling after a bounded interval.
- Every supported provider has fixture coverage and a current live non-submit smoke result.
- The integration uses independently written code or separately licensed code only.
- Memory claims are based on before/after measurements, not extension count alone.
- Chrome Web Store submission remains deferred.

## Open decisions before implementation

Implementation defaults selected for the first release:

1. Routine profiles use device-local storage; profile transfer is encrypted with a user password.
2. Multi-profile support is included from the beginning.
3. Only encrypted profile export/import is provided.
4. Wave A covers NICE CheckPlus, SCI Siren24, KCB OK-Name, and DreamSecurity Mobile-OK.
5. Carrier is explicitly selected by the user; historical phone-prefix carrier guessing is omitted.

Remaining decisions apply only to later waves, optional passphrase-locked at-rest storage, and measured memory optimization.
