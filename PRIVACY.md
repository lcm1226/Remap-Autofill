# Privacy Policy

Effective date: 2026-08-06

`Remap Key & Advanced AutoFill` stores only the data needed to provide user-configured website automation features. This extension lets users save exact-field autofill rules and URL-based keyboard remap rules for websites they choose.

## What data the extension stores

The extension may store:

- Autofill text that the user explicitly enters, such as names, dates of birth, phone numbers, email addresses, or other form values.
- Website rule metadata chosen by the user, such as URL patterns, CSS selectors, field labels, and field types.
- Keyboard remap rules chosen by the user, such as `Delete -> Shift+3` for Gmail.
- A temporary draft of the most recently selected field while the user is configuring a rule.
- Device-local identity-verification profiles containing a user-provided label, name, mobile number, birth date, carrier/MVNO choice, gender, domestic/foreigner status, and preferred SMS/PASS method.
- Gmail open-signal configuration, an installation credential, and local history labels such as the message subject, recipient count, tracking state, timestamps, and aggregate request count when the user enables that optional feature.

## Where the data is stored

- Saved autofill rules and key remap rules are stored in `chrome.storage.sync` so they can follow the user's signed-in browser profile when browser sync is enabled.
- Temporary field-selection drafts are stored in `chrome.storage.local`.
- Identity-verification profiles and their enablement/default-profile settings are stored separately in `chrome.storage.local`; they are not stored in `chrome.storage.sync` and are excluded from the ordinary rules JSON export.
- Gmail open-signal configuration, credentials, and history are stored in `chrome.storage.local` and are not included in settings JSON export.

Autofill values and key-remap rules are not sent to the open-signal service.

Identity-verification profiles are not sent to the open-signal service or to another developer-operated server. When the extension fills a supported verification form, the selected values become part of that webpage's form and are then handled by the verification site according to that site's own privacy practices. The extension does not automatically submit those forms.

Identity-profile transfer is separate from ordinary settings transfer. The extension derives an encryption key from the user-entered export password with PBKDF2-SHA-256 and encrypts the export with AES-GCM. The password and derived key are not stored. Routine device-local profile storage is not protected by this export password, so users must also protect their operating-system and Chrome profile access.

The extension writes exported JSON to the clipboard only when the user explicitly clicks a copy button. It does not read clipboard contents.

## Optional Gmail open-signal transmission

The Gmail open-signal feature transmits nothing until the user explicitly clicks `열람 신호` for an individual message. The first per-message opt-in activates the documented default service; users can later disable the feature or change the service in extension options. For a tracked message:

- the extension registers a random opaque token with the configured service;
- the outgoing message contains one transparent image URL containing that token;
- the service records the first and latest image-request timestamps and an aggregate request count after the extension detects that the message was sent;
- the configured service receives normal HTTP connection metadata as part of the image request, but this project's service implementation does not intentionally store raw IP addresses or raw User-Agent strings.

The service does not receive the message body, subject, recipient address, or attachments through the tracking API. Subject labels and recipient counts shown in history stay in `chrome.storage.local`.

## How the data is used

Stored data is used only to provide the extension's user-facing features:

- matching saved rules to the current website URL
- applying saved autofill values to user-selected form fields
- filling user-selected identity data on supported verification-provider pages and selecting the configured carrier and SMS/PASS method
- remapping keyboard input according to user-created rules
- helping the user identify and edit saved rules inside the extension UI
- registering per-message Gmail tracking tokens and showing aggregate open signals when the user explicitly enables tracking

The identity-verification feature does not automatically accept terms, request authentication, read or submit CAPTCHA/OTP values, or perform the final verification submission.

## Data sharing

The extension does not sell or share data with advertisers, data brokers, or analytics providers. When Gmail open signals are enabled, the opaque token and image-request events are transmitted to the service URL configured by the user.

The only external storage involved is Chrome's own browser sync infrastructure when the user has chosen to enable sync in their browser account.

## Data retention and user controls

Stored rules remain available until the user edits or deletes them, clears browser sync data, or uninstalls the extension.

Identity-verification profiles remain only on the device until the user edits or deletes them, clears extension local storage, or uninstalls the extension.

The reference open-signal service expires tracking records after 30 days by default. Users can delete a tracking record immediately from the extension options page.

Users can:

- edit or delete rules from the extension options page
- remove temporary draft selections from the popup or options page
- delete local and server-side open-signal records from the options page
- edit or delete device-local identity profiles, and create or import a password-encrypted profile backup
- uninstall the extension at any time

## Security

Stored autofill values and key-remap rules remain local to Chrome storage. Identity profiles are kept in device-local extension storage and are released to content scripts only for explicitly supported HTTPS verification-provider origins. Open-signal operations use HTTPS except for explicitly allowed localhost development testing. Public tracking tokens and installation credentials are randomly generated, and the reference service stores hashes rather than their raw values.

## Contact

Support and issue reports:

- [GitHub repository](https://github.com/lcm1226/Remap-Autofill)
- [GitHub issues](https://github.com/lcm1226/Remap-Autofill/issues)

## Korean Summary

이 확장 프로그램의 자동입력 값과 키 리맵 규칙은 Chrome 저장소에 보관되며 열람 신호 서버로 전송되지 않습니다. 이름·휴대폰 번호·생년월일·통신사 등 본인인증 프로필은 기기 로컬에 별도로 저장되고 지원되는 HTTPS 인증업체 화면에만 전달되며 자동 제출되지 않습니다. 프로필 이동용 JSON은 사용자가 지정한 비밀번호로 암호화됩니다. Gmail 작성창에서 사용자가 개별 메일의 `열람 신호` 버튼을 누른 경우에만 기본 서비스가 활성화되고, 임의 토큰과 원격 이미지 요청 시각·횟수가 처리됩니다. 제목과 수신자 수는 로컬 기록에만 저장됩니다. 열람 신호는 이미지 차단·프록시·보안 검사 등의 영향을 받으므로 확정적인 사람의 읽음 확인이 아닙니다.
