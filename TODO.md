# TODO

## Public release gate

- Live-check the version `1.2.1` encrypted identity export, clipboard copy, and import flow in Comet or Chrome.
- Load the generated `dist/Remap-Key-Advanced-AutoFill-1.2.1.zip` as an unpacked extension and run a final smoke test before creating a GitHub Release.

## Chrome Web Store — explicitly deferred

Do not submit to the Chrome Web Store unless the user explicitly requests it again.

When resumed:

- Rebuild the current-version ZIP with `pnpm run release:build`.
- Recheck `WEB_STORE_SUBMISSION.md`, `PRIVACY.md`, permissions, screenshots, and promotional assets against the current feature set.
- Set the privacy policy URL to `https://github.com/lcm1226/Remap-Autofill/blob/main/PRIVACY.md`.
- Upload and submit only after a new explicit user request.
