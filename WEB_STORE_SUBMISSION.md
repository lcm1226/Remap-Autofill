# Chrome Web Store Submission Pack

Prepared on: 2026-04-18

## Store listing assets

- Extension icon: `store-assets/icons/icon-128.png`
- Small promotional image: `store-assets/promo/promo-small-440x280.png`
- Screenshot 1: `store-assets/screenshots/01-quick-save-popup.png`
- Screenshot 2: `store-assets/screenshots/02-rules-manager.png`
- Screenshot 3: `store-assets/screenshots/03-gmail-key-remap.png`
- Privacy policy URL after push: `https://github.com/lcm1226/Remap-Autofill/blob/main/PRIVACY.md`

## Recommended category

- Productivity

## Single purpose

Automate repeated website interactions by letting users save URL-specific autofill rules for exact form fields and URL-specific keyboard remap rules.

## Short description

Save exact-field autofill rules and URL-based key remaps for websites like Gmail, government forms, ticketing pages, and more.

## Detailed description

`Remap Key & Advanced AutoFill` helps users automate repeated website actions without depending on fragile text guessing.

Users can open the field picker, click the exact input or dropdown they want on the current page, and save a rule that fills only that field on matching URLs. This works well for repeated forms such as sign-in prompts, booking pages, and government verification pages.

The extension also supports per-site keyboard remaps. Users can define rules like `Delete -> Shift+3` for Gmail or any other website-specific shortcut they want to normalize.

All rules are user-controlled. Saved settings stay in Chrome storage, can be edited from the options page, and can be exported/imported as JSON between devices.

## Permissions justification

### `storage`

Stores user-created autofill rules, URL patterns, selectors, keyboard remap rules, and temporary field-selection state.

### `tabs`

Reads the current active tab URL for rule suggestions in the popup and sends messages to the active tab when the user starts field picking or runs autofill manually.

### `http://*/*` and `https://*/*`

Required so the extension can:

- let the user pick exact fields on the current page
- match saved rules against the current site URL
- apply autofill values to user-selected fields
- intercept configured keyboard shortcuts on supported pages

The extension does not request access to browser pages such as `chrome://`.

## Remote code

- No remote code is used.
- No remotely hosted JavaScript is executed.

## Recommended privacy practices answers

### Data types handled

- Personal info and form data: only when the user explicitly saves autofill values
- Active page URL and page structure needed for field selection and rule matching
- User-defined keyboard remap rules

### Data usage statement

- Data is used only for the extension's single purpose of website-specific automation.
- Data is not sold.
- Data is not transferred to third parties except Chrome sync when enabled by the user.
- Data is not used for advertising, profiling, or credit-related decisions.

## Reviewer quick test

No account or paid subscription is required.

Suggested review flow:

1. Open any standard `https://` web page with text inputs or dropdowns.
2. Open the extension popup and click `필드 선택 시작`.
3. Click an input or dropdown on the page, return to the popup, enter a value, and save the rule.
4. Click `지금 자동입력 실행` to confirm the saved value is applied.
5. For key remap testing, open Gmail and confirm the included preset maps `Delete` to `Shift+3`.

