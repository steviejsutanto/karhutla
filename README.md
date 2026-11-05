# karhutla

A participatory performance in which an audience uses their phones to bring rain to a shared Indonesian wildfire landscape, with projected visuals and spatial sound.

## Run on Mac or Windows

1. Download the ZIP for your computer from the [latest release](https://github.com/steviejsutanto/karhutla/releases/latest): **Mac Apple Silicon**, **Mac Intel**, or **Windows**.
2. Extract the whole ZIP into a local folder.
3. Double-click **Start-Karhutla.command** on Mac or **Start-Karhutla.cmd** on Windows. Keep its window open.
4. In Operator, enable Main sound and open Projection on the projector. Audience phones join through the displayed QR code on the same Wi-Fi.

Start the timed performance or select any scene directly. The landscape is prepared automatically on first use.

The download includes the runtime, recordings, visuals and a fire snapshot. It runs offline; fetching new satellite observations needs internet.

## Move settings and install updates

Use **Operator → Setup → Settings file → Export settings**. Copy that file to the other computer, then choose **Import settings** there.

For an update, extract the new release into its own folder and import your settings. Keep the previous rehearsed version available. Settings files include entered Wi-Fi details; keep them private.

## Guides

- [Mac setup and first launch](docs/mac.md)
- [Windows setup, projector, audio and Wi-Fi](docs/windows.md)
- [Sound and performance guide](docs/sound.md)
- [Developing and updating the project](docs/development.md)

Application code is in `app/`, checks in `tests/`, maintenance tools in `scripts/`, and detailed notes in `docs/`.
