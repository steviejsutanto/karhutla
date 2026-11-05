# karhutla on Windows

## Run the performance download

1. Download the Windows ZIP from the [latest release](https://github.com/steviejsutanto/karhutla/releases/latest) in the private repository. Choose the Windows asset, rather than GitHub's automatically generated Source code ZIP.
2. Extract the whole ZIP to a local folder, for example `C:\Performances\karhutla-1.0.3`. Do not launch from inside the ZIP or put the running folder in OneDrive.
3. Double-click **Start-Karhutla.cmd**. The package includes Node.js and the required libraries; no installation or internet connection is needed to use the included fire snapshot.
4. If Windows Firewall asks, allow this app on your trusted **Private** performance network. The laptop and audience phones must use the same router, with client isolation disabled. Ethernet from the laptop to the router is preferable when available.
5. Operator opens at <http://127.0.0.1:4173/operator>. Click **Enable main sound**, select the correct Windows audio output, and check its level through the PA.
6. Use Operator's **Projection** link, move that window to the projector, and make it fullscreen. Keep Operator open: it produces Main audio while Projection displays the image.
7. Phones join using the current QR code and audience address. Enable phone sound on each device. Start the timed performance when everyone is ready. You can also select any scene directly, including Forest takeover and Final rain. First use prepares the landscape automatically; no separate setup step is needed.

Keep the launcher console open. Press Ctrl+C there to stop the server cleanly. The normal server saves settings and landscape progress locally. Starting it again opens a paused Arrival scene; it does not resume the previous scene clock. **Restart performance** resets the landscape and retains settings.

If the port is occupied, the launcher reports it and leaves the existing process alone. Close a previous karhutla console before starting a different version. Never run two live copies on the same port.

The included snapshot, sounds, visuals, QR code and audience interaction work without internet. **Fetch latest fires** needs internet and changes the source landscape. Python, FFmpeg and audio-generation models are not required to run the performance.

## Transfer your settings

On the source computer, open **Operator → Setup → Settings file → Export settings**. Save any pending timing or audience edits first. Copy that JSON file to the other computer, then choose **Import settings** in the same section.

The file transfers all shared mixer balances, Main level, texture controls, sound source choices, scene and ending timings, ground response, audience rain strength, program notes and entered Wi-Fi details. Import replaces those settings and saves them. It leaves the current scene position, pause state, landscape, satellite observations and participant assignments alone. Browser sound activation and the Windows audio output must be set on each computer.

The exported file contains entered Wi-Fi details. Keep it with your private performance materials. Exported settings and `data/performance-state.json` are excluded from GitHub and release packages. A local `karhutla-settings-current.json` sidecar, if supplied separately, contains the settings copied from the original computer during packaging.

To preserve an entire landscape for transfer or rollback, stop the server and back up `data/performance-state.json` together with its matching `data/fire-snapshot.json`. These are different from a settings preset. A new release folder begins with its bundled snapshot and a fresh landscape; import your settings there.

## Work on the project from either computer

Install GitHub Desktop and Node.js **24.22.2** (the version in `.nvmrc`), then clone the private repository. In the project folder run:

```sh
npm ci
npm test
npm run launch
```

You can also double-click `Start-Karhutla.cmd` after `npm ci`; the source checkout uses installed Node when no bundled runtime is present. Node 22 or newer is required; release builds and automated tests use the pinned Node 24 version.

Before starting work, fetch and pull changes using GitHub Desktop. After making changes, review them, commit, and push. Pull those commits on the other computer, stop its server, run `npm ci` if dependencies changed, and restart. Use one computer at a time for overlapping changes. GitHub transfers committed changes when you push and pull; unsaved local edits do not appear on the other computer automatically.

Automated checks run on Windows, macOS and Linux. Keep a rehearsed release ZIP as the performance copy and the previous working release as a fallback. Rehearse a new version before using it for an event. The computer, projector, router, PA and physical audience phones still need a venue test.

## Build a Windows download

From a clean checkout with the pinned Node runtime:

```sh
npm ci
npm test
npm run package:windows
```

The builder downloads the exact official Node Windows x64 runtime, verifies its SHA-256 checksum, installs production dependencies from `package-lock.json`, rejects native/platform-specific packages, and writes a ZIP plus checksum and a per-file manifest under `dist/`. It includes the Node license and dependency licenses. Build-time downloads need internet; the completed package does not.

For a build using a previously downloaded official runtime:

```sh
node scripts/build-windows-package.mjs --runtime-archive /path/to/node-v24.22.2-win-x64.zip --runtime-checksums /path/to/SHASUMS256.txt --out dist
```

WAV masters, rejected/source recordings, model weights/cache, generated reports, saved performance state and exported settings remain outside the package. Keep a separate backup of those creative working files; the repository is the maintained playback/development project.

The release workflow tests the project, builds the Windows package, and checks the bundled Windows runtime before publishing a tagged release. See [the development guide](development.md) for the folder layout and future releases. Never update a package while a performance is running.
