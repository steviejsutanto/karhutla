karhutla 1.1.8 brings the latest sound refinements, a smoother phone transition from Scene 2 to Scene 3, and fire-data transfer for offline hosts.

- **Sound:** exact overtone tuning, an earlier descent into lower tones, darker bells with longer reverb, softer rain and haze midrange, less forest bass boost, and a gentler final cricket fade.
- **Phones:** the opening landscape fade stays smooth between venue updates, through delayed Wi-Fi packets, and after reconnecting or restarting a scene.
- **Fire data:** use **Operator → Setup → Fire data** to fetch and export observations on a computer with internet. Send the JSON file to the host or a paired remote controller, review its dates and observation count, then import it over rehearsal Wi-Fi. The host returns to paused Arrival and keeps its mixer, timings and audience information.
- **Reliable imports:** invalid files, failed saves and delayed reads preserve the last successfully saved landscape.

Downloads are available for **Windows x64**, **Mac Apple Silicon**, and **Mac Intel**, each with its launcher and offline runtime. Packages are built and checked on their matching platforms. The source suite passed 919 checks with no failures and one Windows-only check skipped on Mac.

To update:

1. In your current Operator, use **Setup → Settings file → Export settings**. To keep the exact current fire observations too, also choose **Setup → Fire data → Export fire data**.
2. Stop the old server with **Ctrl+C in its Terminal or command window**.
3. Extract the new download into a new folder and open **Start-Karhutla.cmd** on Windows or **Start-Karhutla.command** on Mac.
4. Import your settings through **Setup → Settings file**. Import any saved fire-data file through **Setup → Fire data**.

Settings files and fire-data files are separate. If your older version has no fire-data export button, keep its folder and use its `data/fire-snapshot.json` file for the new Fire data import.

The saved rehearsal preset and illustrated Mac setup guide are included. Export your current settings to carry your latest adjustments. On Mac, installed Node.js 22 or later is preferred, and macOS may still require first-open approval for the unsigned launcher; see the [simple Mac setup instructions](https://github.com/steviejsutanto/karhutla/blob/main/docs/mac.md). Remote Main sound and automatic in-app Projection fullscreen remain available with:

```sh
node scripts/start-karhutla.mjs --remote-sound
```
