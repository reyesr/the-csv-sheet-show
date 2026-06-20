# Webview UI

Run the webview outside VS Code with the built-in extension emulator:

```bash
npm run dev:webview
```

The emulator loads `/test-data.csv`, which maps to:

```text
webview-ui/test-data.csv
```

Use a different fixture with `webview-ui/.env.development.local`:

```env
VITE_WEBVIEW_FIXTURE_CSV=/fixtures/big.csv
```

Then place the file at:

```text
webview-ui/fixtures/big.csv
```

PowerShell one-off override:

```powershell
$env:VITE_WEBVIEW_FIXTURE_CSV="/fixtures/big.csv"; npm run dev:webview
```

Bash one-off override:

```bash
VITE_WEBVIEW_FIXTURE_CSV=/fixtures/big.csv npm run dev:webview
```

The fixture parser is intentionally simple: comma-separated CSV with normal line endings and basic quoted-cell support.
