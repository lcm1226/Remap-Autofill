# Privacy Policy

Effective date: 2026-04-18

`Remap Key & Advanced AutoFill` stores only the data needed to provide user-configured website automation features. This extension lets users save exact-field autofill rules and URL-based keyboard remap rules for websites they choose.

## What data the extension stores

The extension may store:

- Autofill text that the user explicitly enters, such as names, dates of birth, phone numbers, email addresses, or other form values.
- Website rule metadata chosen by the user, such as URL patterns, CSS selectors, field labels, and field types.
- Keyboard remap rules chosen by the user, such as `Delete -> Shift+3` for Gmail.
- A temporary draft of the most recently selected field while the user is configuring a rule.

## Where the data is stored

- Saved autofill rules and key remap rules are stored in `chrome.storage.sync` so they can follow the user's signed-in browser profile when browser sync is enabled.
- Temporary field-selection drafts are stored in `chrome.storage.local`.

The extension does not send this data to the developer's servers.

## How the data is used

Stored data is used only to provide the extension's user-facing features:

- matching saved rules to the current website URL
- applying saved autofill values to user-selected form fields
- remapping keyboard input according to user-created rules
- helping the user identify and edit saved rules inside the extension UI

## Data sharing

The extension does not sell, transfer, or share user data with advertisers, data brokers, analytics providers, or other third parties.

The only external storage involved is Chrome's own browser sync infrastructure when the user has chosen to enable sync in their browser account.

## Data retention and user controls

Stored rules remain available until the user edits or deletes them, clears browser sync data, or uninstalls the extension.

Users can:

- edit or delete rules from the extension options page
- remove temporary draft selections from the popup or options page
- uninstall the extension at any time

## Security

The extension operates locally in the browser and does not transmit stored autofill values or key remap rules to developer-operated services.

## Contact

Support and issue reports:

- [GitHub repository](https://github.com/lcm1226/Remap-Autofill)
- [GitHub issues](https://github.com/lcm1226/Remap-Autofill/issues)

## Korean Summary

이 확장 프로그램은 사용자가 직접 저장한 자동입력 값, URL 패턴, selector, 키 리맵 규칙만 저장하며, 이 정보는 확장 기능 제공 목적에만 사용됩니다. 저장 위치는 `chrome.storage.sync`와 `chrome.storage.local`이며, 개발자 서버로 전송되지 않습니다. 사용자는 옵션 페이지에서 언제든 규칙을 수정하거나 삭제할 수 있습니다.

