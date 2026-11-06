# karhutla

A participatory performance in which an audience uses their phones to bring rain to a shared Indonesian wildfire landscape, with projected visuals and spatial sound.

## Run on Mac or Windows

1. Download the ZIP for your computer from the [latest release](https://github.com/steviejsutanto/karhutla/releases/latest): **Mac Apple Silicon**, **Mac Intel**, or **Windows**.
2. Extract the whole ZIP into a local folder.
3. Double-click **Start-Karhutla.command** on Mac or **Start-Karhutla.cmd** on Windows. Keep its window open.
4. In Operator, enable Main sound and open Projection on the projector. Audience phones join through the displayed QR code on the same Wi-Fi.

Start the timed performance or select any scene directly. The landscape is prepared automatically on first use.

The download includes the runtime, recordings, visuals and a fire snapshot. It runs offline; fetching new satellite observations needs internet.

## Control from another device

Connect the second device to the same Wi-Fi and scan the audience QR code. In its browser address, replace `/audience` with `/operator-remote`. Enter the six-digit PIN shown on the host in **Operator → Setup → Remote control**. Scene cues, mixer changes and setup edits stay synchronized across the operator pages.

Bookmark the simple remote address to return later. The browser remembers access for one year, including across browser and server restarts. **Reset PIN & devices** disconnects remembered controllers and replaces the PIN. If the host's network address changes, use **Refresh address** and update the bookmark. Both devices must still use the same network. Existing long private operator links also work.

Keep the host's Operator page open with Main sound enabled; audio continues through that computer. The remote device stays silent. Keep the operator PIN and long private links private.

## Move settings and install updates

Use **Operator → Setup → Settings file → Export settings**. Copy that file to the other computer, then choose **Import settings** there.

The [current rehearsal settings](presets/current-performance.json) are included in every download. Import that file to use the saved performance mix and timings; Wi-Fi details are blank.

For an update, extract the new release into its own folder and import your settings. Keep the previous rehearsed version available. Settings files include entered Wi-Fi details; keep them private.

## Guides

- [Mac setup and first launch](docs/mac.md)
- [Windows setup, projector, audio and Wi-Fi](docs/windows.md)
- [Sound and performance guide](docs/sound.md)
- [Developing and updating the project](docs/development.md)

Application code is in `app/`, checks in `tests/`, maintenance tools in `scripts/`, and detailed notes in `docs/`.
