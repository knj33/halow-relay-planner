# Relay Engine Bridge (optional browser extension)

The planner does **not** need this extension. It talks to the native helper directly
(`http://127.0.0.1:8765`) and falls back to the browser terrain loader when the helper is
not running. This extension is a small convenience layer:

- shows whether the native engine is alive and how many threads it uses;
- badges the toolbar icon `ON` / `OFF`;
- can mark an already-open planner tab as engine-aware (`documentElement.dataset.halowEngineExtension`).

## Load it

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and pick `manifest.json` in this folder.
3. For a permanent install, sign it with `web-ext sign` or use Firefox Developer Edition with
   `xpinstall.signatures.required` set to `false`.
4. Pin the extension, open the planner, and use the popup's **Detect engine** button.

The content script only matches `http://localhost/*` and `http://127.0.0.1/*`. For a hosted
planner, open the popup on that tab and press **Mark this tab as engine-aware**; the
extension asks for one-time tab access instead of requesting broad host permissions.

## Host permissions

`host_permissions` is limited to `http://127.0.0.1:8765/*` so the popup can probe
`/health`. Nothing is sent anywhere else, and no browsing data is collected.
