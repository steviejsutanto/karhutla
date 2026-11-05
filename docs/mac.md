# karhutla on Mac

## Choose your download

Open the [latest release](https://github.com/steviejsutanto/karhutla/releases/latest) while signed in to GitHub:

- **macos-arm64.zip** is for Apple Silicon Macs, including M1 and later M-series chips.
- **macos-x64.zip** is for Intel Macs.

Use **Apple menu → About This Mac** to check your chip or processor. Each ZIP includes the matching Node runtime, libraries, recordings, visuals and a saved fire snapshot. You do not need to install Node, Homebrew, Python or audio-generation models to run it.

## Start the performance

1. Download the matching Mac ZIP and double-click it in Finder to extract it.
2. Move the whole extracted folder to a writable local location, such as a Performances folder inside Documents. Keep each version in its own folder.
3. Double-click **Start-Karhutla.command**. Terminal opens and the launcher starts the server, checks it, then opens Operator in your default browser. Keep Terminal open while performing.
4. Start the timed performance or select any scene directly when ready. First use prepares the landscape automatically; no separate initialization step is needed.
5. Enable Main sound in Operator. Select the correct Mac audio output and check its level through your speakers or audio interface.
6. Use Operator's **Open projection** link, move that window to the projector, then make it fullscreen. Keep Operator open: it produces Main audio while Projection displays the image.
7. Connect the Mac and phones to the same router. Phones use the displayed QR code and audience address. Enable sound on each phone, then start the timed performance when ready.

If the browser does not open, use the Operator address printed in Terminal, normally <http://127.0.0.1:4173/operator>. If macOS asks about local-network or firewall access, allow it on your trusted performance network. Router client isolation must be disabled. Ethernet from the Mac to the router is preferable when available.

Press **Ctrl+C in Terminal** to stop and save. Restarting opens a paused Arrival scene while retaining saved settings and landscape progress. **Restart performance** resets the landscape and keeps your settings. An occupied port produces an error; the launcher leaves the other program alone.

The included performance works offline. **Fetch latest fires** requires internet and replaces the source landscape.

## First-open approval

macOS may ask you to approve the downloaded launcher. If it blocks opening, first try launching it, then follow **System Settings → Privacy & Security → Open Anyway** when that option is offered for this file. Approve only the package you obtained from this private project's release. [Apple's first-open instructions](https://support.apple.com/en-us/102445) explain the available prompts.

The launcher is a Terminal script, rather than a notarized Mac application. The package does not remove quarantine flags or change your security settings. Automated tests check executable permissions and runtime startup; first-open behavior after a browser download can vary with your Mac's security settings.

## Move settings and update

Use **Operator → Setup → Settings file → Export settings** on the source computer. Copy the JSON file to the Mac, then choose **Import settings** in the same section. The same settings file works on Windows and Mac. It transfers mixer balances, texture controls, timings, ground response, rain strength, program notes and entered Wi-Fi details. It leaves the current scene position and landscape progress alone.

Keep that file private because it includes entered Wi-Fi details. Browser sound activation and the computer's selected audio output must be set on each machine. Saved performance state and exported settings stay outside GitHub and release downloads.

For an update, stop the old version with Ctrl+C, extract the new release into its own folder, and import your settings there. Keep the previous rehearsed ZIP available. Rehearse with the actual router, projector, PA and audience phones before an event.

## Compatibility and development

The bundled Node 24.22.2 runtime has a technical minimum of **macOS 13.5** for both architectures; use a macOS version still supported by Apple. See [Node's pinned platform requirements](https://github.com/nodejs/node/blob/v24.22.2/BUILDING.md#platform-list). Native package verification uses macOS 15 runners for Apple Silicon and Intel.

The source checkout uses the same launcher with an installed Node 22 or newer when no bundled runtime is present. See [the development guide](development.md) for setup and packaging commands.
