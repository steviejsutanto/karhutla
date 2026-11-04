# Developing karhutla

Use Node.js **24.22.2**, pinned in the repository's `.nvmrc`, and run commands from the project root. Node 22 or newer is required. The Windows performance ZIP includes its own runtime.

```sh
npm ci
npm test
npm run launch
```

`npm run launch` starts the shared LAN server and opens Operator after its startup check. `npm start` runs a loopback-only server; `npm run start:lan` runs the shared LAN server without opening a browser. `npm run study` starts a separate temporary rehearsal on port 4185, with no saved-performance reads or writes. `npm run refresh` fetches a new satellite snapshot using Node; it does not require Python.

## Folder layout

| Folder or file | Purpose |
|---|---|
| `app/` | Server, shared logic, browser modules, pages and styles |
| `tests/` | Automated simulation, networking, audio, UI-source and packaging checks |
| `scripts/` | Launching, packaging, data refresh and creative maintenance tools |
| `docs/` | Windows instructions, performance/sound guide and technical notes |
| `audio-assets/` | Finished recordings, manifests, source attribution and generation notes |
| `visual-assets/` | Finished visuals and their drawing modules/previews |
| `data/` | Geographic data, the satellite snapshot and local performance save |
| `Start-Karhutla.cmd` | Windows launcher |
| `package.json`, `package-lock.json` | Commands and locked dependencies |

Source files moved into `app/`, while browser addresses such as `/operator`, `/projection` and `/audience` remain the same. The server maps public addresses to disk files explicitly. Keep those mappings, Node imports, test fixtures and package inclusion rules aligned when moving or adding files.

## Work between computers

Use GitHub Desktop to pull before starting work, then review, commit and push finished changes. Pull on the other computer before continuing there. After pulling, stop the server, run `npm ci` if dependencies changed, and restart. Export/import shared settings separately; Git does not synchronize local settings or running performance state.

Do not commit `data/performance-state.json`, exported settings, model caches, WAV masters or diagnostic output. Keep a separate backup of the creative masters and other ignored working files. A complete landscape backup pairs the stopped server's save with its matching fire snapshot.

## Validate and release

Run `npm test` after application changes. The test suite uses isolated servers and temporary saves. GitHub also runs it on Windows, macOS and Linux. The Windows release workflow builds an offline ZIP, verifies the official Node runtime checksum and package contents, then starts the package on Windows and checks pages, recordings, QR generation and a settings round-trip.

For a local Windows build:

```sh
npm run package:windows
node scripts/smoke-windows-package.mjs dist
```

On a Mac, the smoke check uses the host Node runtime. GitHub's Windows runner uses the bundled Windows executable. Neither replaces an on-device check of double-click launching, browser audio, firewall access, projector routing and physical phones.

To publish an update, increase the version in `package.json` and `package-lock.json`, update [release notes](release-notes.md), commit and push, then push an annotated matching tag such as `v1.0.2`. A successful release workflow publishes the versioned Windows ZIP and checksum. Do not move an existing release tag or replace a rehearsed package silently.

## Further notes

- [Windows use, settings transfer and packaging details](windows.md)
- [Sound and performance design](sound.md)
- [Detailed application, simulation and historical verification notes](technical.md)
- [Visual design review](design-qa.md)

Some creative asset-generation tools under `scripts/` require Python, FFmpeg, MLX or local model weights. These tools are separate from the Node/browser performance runtime. Older diagnostic helper scripts may refer to ignored local reports under `output/`.
