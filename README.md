# karhutla

A participatory performance in which an audience uses their phones to bring rain to a shared Indonesian wildfire landscape, with projected visuals and spatial sound.

## Mac setup

1. Install [Node.js LTS](https://nodejs.org/en/download) once using its **macOS Installer (.pkg)**. Skip this if you already have Node 22 or newer installed.
2. Download **Mac Apple Silicon** or **Mac Intel** from the [latest release](https://github.com/steviejsutanto/karhutla/releases/latest) and extract the whole ZIP into a local folder.
3. Double-click **Start-Karhutla.command**. It uses your installed Node and opens Operator. Keep Terminal open; press **Ctrl+C** there to stop and save.

If macOS blocks the launcher, try opening it once, then use **System Settings → Privacy & Security → Open Anyway**. Installing Node does not remove this launcher approval. Without a compatible installed Node, Karhutla uses its included runtime, which may need its own first-open approval.

See the [Mac guide with pictures](docs/mac-setup.md) or [printable PDF](docs/mac-setup.pdf) for the approval screens.

## Windows setup

Download **Windows** from the [latest release](https://github.com/steviejsutanto/karhutla/releases/latest), extract the whole ZIP and double-click **Start-Karhutla.cmd**. Keep its window open. No separate Node installation is needed.

In Operator, enable Main sound and open Projection on the projector. Phones join through the displayed QR code on the same Wi-Fi. Start the timed performance or select a scene directly; the landscape is prepared automatically.

The downloads include recordings, visuals and a fire snapshot. Performances run offline; fetching new satellite observations needs internet.

## Control from another device

Connect the second device to the same Wi-Fi and scan the audience QR code. In its browser address, replace `/audience` with `/operator-remote`. Enter the six-digit PIN shown on the host in **Operator → Setup → Remote control**. Scene cues, mixer changes and setup edits stay synchronized across the operator pages.

Bookmark the remote address; the browser remembers access. Updates on the same computer and user account retain the PIN and remembered devices automatically. **Reset PIN & devices** replaces these shared credentials for future updates too. Another computer or user account has its own PIN. If the host's network address changes, use **Refresh address** and update the bookmark. Both devices must still share the same network.

The remote speaker button enables and disables Main sound on the host. On a Mac, use [remote sound mode](docs/mac.md#enable-main-sound-from-the-remote-page) to let the remote button start sound without a first click on the host. Keep the host's Operator page open; audio stays on that computer and the remote device stays silent. Keep the PIN private.

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
