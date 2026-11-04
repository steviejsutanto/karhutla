# Indonesia wildfire prototype

For moving this project to Windows, the offline launcher, settings export/import,
and keeping both computers updated, see [the Windows and transfer guide](WINDOWS.md).
The maintained playback project excludes local audio masters, generation caches,
diagnostic output, and saved performance state; keep those in a separate backup.

The work is **karhutla**. Its updated program notes appear on the opening
projection and in the phone's About page. The opening instructions are shorter,
and the projected Wi-Fi name and password use larger type.

The performance now has three separate pages: **`/operator`** for all controls,
**`/projection`** for the display, and **`/audience`** for phones.
`/study` and `/study/phone` remain aliases for the projection and audience.
The operator opens in **Performance**, with compact scene cues, countdown,
preview, Main output and audience rain strength. **Mixer** keeps the preview
beside all 13 individual layer levels and five texture-shaping controls;
**Setup** holds scene/ending timings, ground response, audience information,
source updates and the single restart action. Switching views keeps the same
preview and audio engine mounted and does not reset or save performance settings.
Texture shaping is collapsed by default and identifies Automatic or Manual mode.

Use the **speaker button on the operator page** to enable Main sound. Main audio is owned by the
operator's preview engine; the separate projection page carries the image
without a sound button. Main stays audible when switching to the projection
tab. Each audience member enables their own phone sound during the opening
instructions. Preview gestures test the same main sound without a second output.

Each source-fire patch owns one fixed **D♭ major pentatonic** pitch across
**D♭1–D♭7**, gently tuned toward harmonic ratios rather than equal semitones,
and a fixed spatial location. Main tones emerge with ground cooling, gradually clearing an audible filtered-noise halo and rough upper overtones,
leave their pitched part within 2.2 seconds of the completed-area bell while ash/moisture/haze continue their configured transition and fade.
Four ash/moisture recordings and six haze takes, distinct start phases and gentle
rate/filter differences keep nearby extinctions from sharing the same waveform.
The new Main haze uses two lighter Stable Audio 3 Medium takes; the finale uses newly generated continuous heavy rain with a fuller low thunder roll.
Only eight textures can sound at once, with at least 100 ms between admissions.
A stable selection of patches receives a stronger reverb mix. Tone and material headroom
adjusts smoothly as more people and patches sound together.

**Main now carries the C/G extinction bells and generated woodfire quenches.**
Bells span C2/G2–C7/G7, weighted toward the lower registers; higher bells are
quieter and shorter, with 5–14-second decays, sustained inharmonic overtones
and gentle partial motion. Bell and quench levels have separate mixer sliders, with
bells at 160% by default. Each whole rain footprint sounds once when all its source fires are out.
One coupled bell/quench/material transition replaces per-cell strikes. A separate Main-only blob sound answers each new individual patch extinction, with four generated variations and its own Extinction blobs mixer slider. A bounded voice pool and short admission queue keep mass-extinction bursts from accumulating. Existing out terrain and repeated taps stay quiet.
Repeated cooled-area taps do not repeat extinction events. Moving over confirmed out terrain stirs distinct short spatial ash grains on Main, with an independent Ash grains · dragging slider. Existing out terrain is quiet on reload.
The original Db2/Ab2/Eb3 harmonic drone is restored and duplicated. The
original full layer stays fixed; its complete copy gradually descends toward
a perfect fourth as the map cools. At unison the combined level matches the
original drone. Both low-drone banks now carry a little extra second/third/fifth harmonic body. Main burning forest is filtered into a distant low rumble with softer,
less immediate crackles.

Phones carry the macro crackle/cricket field, restored to the original thin
branch/leaf recording. Light natural rain joins it only during an eligible tap or hold,
with a rounded 850 ms entrance, then releases over 2.5 seconds, including transient loss of gesture eligibility. A long held source recovers from device interruption through a fresh soft attack. Crackle is 3 dB louder and touch rain 4.4 dB quieter than the preceding balance; phone cricket playback is 24% slower. Repeated taps and dragging resume the same
recording from its current gain, preserving every interrupted fade. Phones play no bells or quench recordings.
When the speaker button is tapped, supported phone browsers request the playback audio
session so Web Audio can sound under Silent Mode. Unsupported browsers keep
normal gesture activation. Audience instructions also say to turn off Silent
Mode and set a comfortable media volume; physical phone output still needs a
venue check.
Normal participation crickets arrive quietly from a distance and approach
only near full extinction. Finale PA crickets rise through a 30-second overlap with the fading rain,
then hold alone in darkness before transferring to phones on matching native audio-clock curves. Main tone reverb is slightly wetter.

After Start timed performance, scenes advance automatically over 60 s, 60 s,
600 s and 60 s; Final rain runs through its ending. Each clickable scene overrides
the sequence and resets its timer. Pause freezes the authoritative clock.

The projection shows title/program notes in scene 1 and instructions in scene 2, with the QR alongside both. Participation stays free of persistent text. Phones show a brief welcome, with full notes behind About. Scene 2→3 opens through a shared 12-second crossfade; returning from 4→3 keeps the QR hidden even after refreshing. The fullscreen × is removed. Scene 3 adds a thin layer of haze under its low drone. More mobile side-view haze/fire and brighter copper-orange top smoke retain their geographic anchors.

The operator runs five cues: **Arrival**, **Instructions**, **Participation**,
**Forest takeover**, and **Final rain**. In cue four, audience rain genuinely cools and extinguishes patches while heat keeps returning. A short rest after each extinction and gradual re-ignition let a held gesture produce repeated real out/fire/out cycles. Main interaction remains audible beneath the dominant forest. Final rain begins from the actual wet/cooled state; manual buttons keep their override behavior. The
low drone fades fully out during takeover. Burning forest then crossfades
into heavy rain over an editable 60-second rise, with sparse early drops
and gradually layered spatial rain. Sound, visuals and water follow the same
slow curve. The ground now cools across that full rise, independently of
participation cooling speed. Rain continues smoothly into the Main/projection
fade and recedes with it, rather than stopping in two seconds.
The stage background and retained haze now fade smoothly across that
boundary. Matching participant numbers/colors identify clouds and phones,
and a bright circle at the actual rain brush confirms the real Main bell on projection and phone.
Rain overlaps smoothly into PA crickets over 30 s as the visuals fade. PA crickets then hold alone in darkness for 12 s and transfer to phones over 12 s; the phones hold alone and finally retreat. Settings and
mixer balances persist. See the [sound and scene guide](SOUND_PROTOTYPE.md).

## karhutla · whole Indonesia

`/study` (also `/projection`) is the read-only split performance view. Local map and section gestures are available in the `/operator` preview. The upper view clearly locates source-fire patches across the full Indonesian archipelago: the original operator’s warm Indonesian land colours, burned-tree drawings, fire, embers and smoke. Neighbouring land is omitted. The country fills the clear space above the ground with equal top/ground margins; at 1280×720 it is about 38% wider and its center is 48px lower than the earlier frame. Terrain remains after a source is extinguished. The top map reuses the original procedural forest assets rather than the recent ember-texture flames. The lower half retains an abstract peat cross-section with a brittle surface, restless grain and fissures, and deep granular embers. Literal flame shapes are removed. Small granular ember wisps move continuously above the surface, and slow red-orange haze drifts across the split into the top view. Hot ground makes both more restless; rain visibly quiets movement around the watered locations without changing map coordinates or blocking input.

`/study/phone` is a simple map navigator again. Hold on the map to rain at that geographic position, drag in either direction to move, and lift to stop. The phone and main map use the same 94–142° E, 12° S–7° N rectangle and retain sea gaps. Entirely sea-covered input does not cool another island. The landscape-first phone also works in portrait, without an orientation lock or phone permission. It shows rain and a precise footprint, with a compact Rain/Stop control and fullscreen button. The main view uses a spare symbolic canopy; the phone has no cloud image. Most readings and instructions stay out of the performance image.

The lower section is an abstract west-to-east strip of every current source-fire patch, sorted by longitude, then latitude. Each patch has a stable horizontal slot. Main-section input can select these slots, while the phone directly navigates the map. Vertical depth is visual; it does not select latitude or claim to measure peat depth or geology. The section separates restless surface heat, lingering embers, and out: rain quiets surface grain first, then an uneven cooling front moves downward as confirmed moisture and heat loss increase. Deeper embers persist ahead of that front rather than the whole column dimming at once. The surface uses concentrated, uneven granular glow, fissures and a transparent ember-fibre atlas instead of pointed flame silhouettes. Eight generated texture variants are distributed across 80 emitters with fixed bases. Four joined bands move through the bright surface fibres, with up to 3.5 CSS pixels of horizontal tip curl and 11% height breathing. The static incandescent band is softened so the moving texture remains visible. Only the upper map uses the original operator rendering. It draws every source with the original scale, seeded offsets, full opacity and direct heat/wetness response, followed by the original smoke and three-second extinction tail. There is no extra source cap or fire fading layer. The lower section keeps its ember-fibre texture and motion, and the existing haze still overlaps both views. Local wetness and rain contact reduce both motion speed and amplitude.

Rain acknowledges locally at once with an exact footprint and a few drops, before acknowledgment arrives. The visual rain fills over 150 ms, then drains downward and fades for 450 ms after release. Actual water still begins/stops with the gesture. Main map, section and phone use the same caller-clocked visual envelope; rapid repeated presses retain old tails at their original positions. Preview signs never generate drops. Contact also calms the decorative haze immediately; this does not predict heat loss, add water or change extinction. Confirmed wetness sustains the calmer appearance. The side view omits the horizontal rain-impact line; the phone retains its geographic footprint. Persistent changes use only the server's heat, surface wetness, moisture and out state. The depth front is an artistic profile derived from those values, not a second physical heat/water simulation or a measured peat profile. Source observations remain unchanged. Each participant keeps one fixed time-based water budget; overlapping participants add independently.

Unfinished patches recover when local rain stops. The default Fire return is now **four seconds**: the remaining gap from current heat to full heat halves every four seconds, and surface drying is calibrated so the current surface-activity curve recovers halfway in four seconds on hot ground. Heat can therefore become visibly restless again within a few seconds. Custom saved return timings remain available. Fully extinguished patches stay out. Continued deep cooling and out-confirmation settlement require continued local rain; release, moving the brush away or lease expiry clears unfinished settlement. Soil moisture still records prior watering with a 180-second decay time, but no longer continues cooling an unattended unfinished patch. These are performance rules, not measured fire physics.

To review the study without changing the existing performance, run:

```sh
npm run study
```

Open `http://127.0.0.1:4185/operator`, then use its Projection link. This starts a separate LAN-enabled rehearsal room with the cached satellite observations, dry initial conditions, and **no performance-save reads or writes**. Rehearsal progress is temporary and is lost when this preview server stops. `STUDY_PORT` can select another port. The existing server on 4173 is not stopped or reset. Phone and laptop must share the same Wi-Fi; use the opening projection or operator console for the correct phone URL and QR code. Everyone shares the whole country.

On a normal server started with `npm run start:lan`, `/study` and `/study/phone` participate in the real shared performance alongside the original views. Newly added server routes require a server restart to become available. The original live process is deliberately left untouched while reviewing the separate study.

Performance design:

- Main scene drawing is capped at 24 frames per second; rain feedback is separate and can respond immediately, with continuing animation capped at 30 fps. Static geography, material, grain and section fibres are cached. The top scene/contact canvases are each capped at 1920×1080 pixels and density 1.5; Economy uses at most 1280×720 and density 1. The section uses at most 1280×720 and density 1.5, or 720×480 and density 1 in Economy.
- The top map uses the original operator's flat Indonesian land colours, island labels and clipped wet/moisture wash. A separate study frame centres the country at 118°E/2.5°S and fits the clear space above the section's highest sampled ground point, constrained to 24–34px healthy margins. The map's transparent canvas extends below the original halfway split; the side view retains its exact lower-half size and ground profile. Only the full Indonesian geometry (about 441 KB) is loaded. Its sea is transparent over a shared warm backdrop. One static 128 px grain tile spans the entire stage above map, haze and peat; a soft section-sky mask removes the half-view seam. All source terrain is cached and all current source fire/smoke effects are painted without a decorative source cap. Quality controls still reduce canvas density and side/haze field work; they do not hide source fires. The existing stage-owned orange haze continues to overlap both views. Phone projection, assets and payload remain unchanged.
- The abstract section uses a diffuse field of at most 360×160 pixels, updated at most 12 times per second, plus cached fibres and granular surface textures. Its new main-only `surface-heat-atlas.webp` is about 107 KB. A single decode-time emissive extraction suppresses pale diffuse pixels and retains red/copper carbon fibres in a cached atlas. The surface draws at most 80 continuously moving sprites in this setup, with a hard renderer limit of 96. There are no literal flame paths or repeated smoke-puff lifetimes. Economy uses at most 240×112 and eight updates per second. A depth-dependent cooling front gives wet surface, lingering deep ember and out distinct appearances. A single caller-owned drawing loop drives each view; renderers create no independent timers or animation loops.
- The shared main-screen haze reuses a cached 480×192 field (320×128 in Economy), updated at most 12 times per second (eight in Economy), and a stage-wide overlay capped at 1280×720 pixels. Continuous slow advection and integrated local phases make hot areas restless while wet or actively watered areas visibly settle. A fixed 64×32 two-dimensional calming mask follows actual map rain locations and their corresponding section positions; the section has a separate 96-bin motion field. These decorative fields never move source geography or predict cooling. Soft edges blend across the divide. The overlay accepts no input and has no independent animation loop. Reduced motion freezes drift while still showing received wetness and contact calming.
- Phones cap map drawing at 20 fps and 1280×720 pixels with density 1.5. Reduced motion uses static states and redraws for received changes. A separate 320×240 CSS-pixel rain canvas draws at most 24 fps while active and during a 450 ms release tail. Input feedback does not wait for the scene clock or network. Release, cancellation, hiding, blur and rotation stop a phone's contribution; reconnecting requires a fresh press.
- Rain decoration is bounded independently of audience size. Up to 64 individual symbolic canopy/rain effects are drawn on the top map, with lightweight geographic footprint markers for additional accepted participants. The operator takes priority. Reducing decorative detail never removes anyone's authoritative water contribution.
- The main view loads approximately 441 KB of country geometry and the existing 107 KB side-view ember atlas, about 548 KB combined. Neighbouring geometry is no longer requested. The top map no longer downloads the 499 KB material image. The phone uses the 129 KB material derivative and the same 93 KB coastline: approximately 222 KB combined. Rain, depth and haze are procedural; moving surface wisps use the local cached atlas. Neither study view loads the old cloud or smoke image assets. The new atlas was generated with built-in ImageGen; its master and exact prompt are in `visual-assets/surface-heat-atlas.png` and `visual-assets/surface-heat-prompts.txt`. Original creative sources remain archived in `visual-assets/`. No image service is contacted during a performance. The overview geometry preserves all 264 polygons and has at most 0.025° outline simplification error; rebuild it with `python3 scripts/build-country-overview.py`.
- The 20 Hz server clock, 10 Hz main-state updates, input rates, persistence rules and source observations are retained. Continuing unexpired holds queue movement within the existing 50 ms physics interval while position feedback and acknowledgments remain immediate. Starts, releases, expiry, connections and settings still flush exact elapsed time. Pending paths retain the interval origin and latest endpoint, capped at 66 points. This does not add a packet-based water bonus.
- National phones request `scope=indonesia` on their WebSocket and send `space:country` normalized coordinates from the same geographic map rectangle as the main display. They receive a shared sparse `country-v1` source field about twice per second, with seven-value rows `[key, longitude, latitude, heat, out, surfaceWetness, moisture]`; they never receive the full simulation or other participants. The read-only operator layout `/api/study-region?region=indonesia` supplies stable source locations and land keys. `/api/qr.svg?view=peat` encodes the national phone URL. Legacy `/` and `/join` remain compatible with the original regional protocol.

The study's source-coordinate and state checks are included in `npm test`. Runtime drawing metrics are exposed as `data-*` attributes on the canvases and as bounded diagnostic records on `window.__peatStudyMetrics` / `window.__peatPhoneMetrics`. These report browser drawing commands, not physical touch-to-photon latency. Actual IdeaPad, router, projector and audience-device testing remains necessary before a performance.

The revised recovery model was checked on the development M1 Pro with 10 and 50 synthetic moving national phones for three seconds each. At 50, acknowledgment p95 was 30.2 ms, release p95 30.2 ms and main-state delivery 9.96 Hz; no rejected controls or holds remained active. Audience output was about 2.34 MB/s total (46.7 KB/s per phone), plus 0.81 MB/s for the display. This is a server-only loopback measurement, not a physical router/device or crowd-rendering benchmark. Results: `output/coordination/restless-recovery-load.json`. Earlier load reports are historical.

## Original map and regional phone view

A local participatory performance prototype using NASA FIRMS NOAA-20 VIIRS thermal observations inside Indonesia. Fetch a fresh snapshot, inspect original observations, and apply a geographic rainfall brush to a separate performance model.

## Run locally

Requires Node.js 20+, Python 3, and system curl. Install the small WebSocket and local QR-code dependencies once:

```sh
npm install
```

```sh
npm start
```

Open `http://127.0.0.1:4173/operator` and choose **Fetch latest fires** if a new snapshot is needed. The local server downloads the public NASA feed, filters it against the Indonesia boundary, saves the result, and returns it to the browser. Refreshes share a single in-progress request. Failed requests retain the previous successful snapshot. The original `/` map remains available as a legacy view.

To refresh without the browser:

```sh
npm run refresh
```

Set `PORT` to use a different local port. `npm start` listens on the loopback interface only.

## Try an audience phone on local Wi-Fi

```sh
npm run start:lan
```

Keep the operator display at http://127.0.0.1:4173. Expand **Audience** for the actual laptop LAN join URL and its locally generated QR code. Put the phone on the same Wi-Fi and open that URL (ending in `/join`). `localhost` and `127.0.0.1` on a phone refer to the phone itself and cannot reach the laptop. The LAN address can change when networks change; use the current Audience section.

Each phone is assigned a participant number and one region: Sumatra, Java, Kalimantan, Sulawesi, Bali & Nusa Tenggara, Maluku, or Papua. New participants go to the region with the fewest currently connected participants; ties favor regions with more source fire patches. A returning participant keeps their assigned region. The browser keeps its participant identity in local storage, and the server saves its number and assignment with the performance. Reopening or reconnecting the same browser preserves that identity; clearing browser storage creates a new one. Opening another tab with the same identity replaces the earlier tab without a reconnect loop.

The phone is a full-screen rain instrument: grainy orange-red patches that fade independently through muted rust to charcoal as their corresponding geographic fire patches cool, a region name, cloud number, a few regional model stats, and connection/acknowledgment status. It loads no full map, forest scene, snapshot, or simulation. Optional sound starts only after the phone’s speaker button is pressed. **Hold anywhere to pour; drag to move rain within your region; lift to stop.** Every screen position, including the edges, maps to a permitted regional patch. Touch immediately draws the same cloud/rain asset used on the main display, following the finger on a lightweight weather-only canvas. The rain is local feedback; “venue confirmed” means the server accepted the contribution. The canvas draws at most 24 times per second with capped pixel density, runs only during a hold and a short release tail, and has no idle animation loop. Reduced motion uses a static rain indication. Grain is a small bitmap generated once, not per-frame noise. Each source-fire patch uses the existing normalized island input mapping: north at the top, east to the right within each occupied land row, with sea gaps omitted. Cooling the upper-right geographic area therefore cools that same upper-right phone area. Patch targets come only from authoritative local heat and out state, with a 1.4-second opacity transition. Each unfinished patch keeps a faint ember tint; out patches become charcoal. Empty regions have a separate label. Disconnection preserves the last verified palette and marks the reading stale; reduced motion disables fades. **Start rain without holding** is an accessible toggle, with Enter/Space and Escape support.

Numbered clouds and overlapping rain appear on the main map. Joined/pouring counts exclude the operator mouse. **Fit active rain** brings active brush areas into view; offscreen contributions are also counted explicitly. Phone statistics always show assigned-region averages, including while pressing or dragging: wetness and moisture are means across the region's modeled land patches; heat averages the current source fire patches. Moving the rain does not change the scope or temporarily blank the readings. Spatial background cooling still follows each individual fire patch. The out count and pouring count refer to that region. These are performance-model values, not live field measurements.

LAN mode binds this one prototype to `0.0.0.0`; it does not configure a tunnel, router forwarding, or other services. Wi-Fi client isolation can prevent phone-to-laptop access. If the operating system blocks incoming Node connections, allow this prototype's local-network connection. No phone app, login, microphone permission, or certificate is needed for this HTTP/WebSocket control test. Audio remains a later stage.

## Shared authority and preservation

The laptop's Node server owns the only advancing `RainSimulation`. It advances at 20 Hz even with the display hidden. The main display receives an initial full baseline followed by compact changes at 10 Hz, published immediately after every second simulation tick; each change references the preceding delivered revision. A reconnect, reset, or synchronization gap establishes a fresh baseline. Changed display cells update in place and interpolate, while projected geography and static forest terrain are cached until the view or source changes. The main display uses an immediate local rain overlay so its own pointer feedback does not wait for a network state update; water, moisture, and heat still come only from the server. Drawing and readouts share one controlled frame scheduler.

Small priority updates carry accepted participant positions and hold states to the operator display at up to 30 Hz, separately from the 10 Hz cell changes. Phones send normalized screen coordinates and use their assignment, regional summary, sparse source-patch heat field, and contribution state at about 2 Hz, plus immediate control acknowledgments. They ignore the compatibility brush-summary field. They never receive full cell state or other participants' positions. A slow socket gets at most one state update in flight: obsolete updates are skipped, and the next display change is computed from that socket's last delivered baseline. Hold acknowledgments bypass the periodic update schedule.

Movement controls are event-driven and capped at 10 Hz: the first movement after an idle hold sends immediately, and continuous movement coalesces to the latest path without waiting for a separate polling cycle. Hold start and release send immediately; stationary holds renew every 500 ms. Each participant has one primary brush; extra fingers, faster sweeping, and more input events cannot increase its fixed per-second water budget. Release, cancellation, lost pointer capture, blur, or hiding stops the local gesture, and the server expires a brush after 2 seconds without renewal. An expired or reconnected brush needs a fresh press; old sequences, epochs, and old connections cannot resume it.

Moisture, heat, timing, strength, and participant number/region assignments save atomically to `data/performance-state.json` separately from the NASA snapshot. Holds and connections are never persisted. At the first shared-server start, the operator can explicitly restore the previous browser-saved performance or choose **Start fresh**. Joining phones cannot bootstrap or change operator settings. Later starts restore the server file and account for elapsed drying while the server was stopped. The operator alone can fetch/reset/change strength or timing. Source observations remain immutable.

## Data

- Source: https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv
- Documentation: https://firms.modaps.eosdis.nasa.gov/
- Normalized snapshot: `data/fire-snapshot.json`.
- Original downloaded CSV: `data/raw-noaa20-24h.csv`.
- Country and context outlines: Natural Earth; public-domain attribution and URLs in `data/geography-metadata.json`.

The source is a rolling 24-hour feed, not continuous ground truth. Always use the actual acquisition times recorded in the snapshot. Hotspots include thermal anomalies and are not distinct fire counts, burned areas, or fire perimeters. FRP is fire radiative power in megawatts. Forest drawings are schematic, not measured vegetation or fire extent. Country filtering is approximate because generalized coastlines can omit small islands and coastal detections.

The main display uses a restrained red haze, static grain, ash-colored land and burned forest drawings. Satellite observation dates and provenance stay separate from simulated rain and suppression. The material direction was informed by Kemenhut’s [24 October 2026 report](https://www.kehutanan.go.id/news/menhut-pimpin-operasi-di-kalimantan-barat-omc-diperkuat) describing operations and 23 October observations, and BMKG Maluku’s [14 October 2026 smoke forecast](https://staklim-maluku.bmkg.go.id/berita/maluku-terkepung-kabut-asap-karhutla-kepulauan-aru-masuk-zona-merah-warga-diimbau-waspada) covering 14–17 October. These are design context, not this app’s data feed. No news photograph is embedded.

The app uses a saved snapshot immediately and fetches from NASA only when the operator requests it (or when the operator has no saved snapshot). Phone participation works with the cached snapshot without contacting NASA. Local Web Audio supplies fixed participant notes on the main output and the shared crackle/cricket landscape on phones; see [sound rehearsal](SOUND_PROTOTYPE.md) for controls, architecture and audio credits.

## Rainfall interaction

- **Operator rain:** hold the mouse or a finger over the main map; drag while holding to sweep the geographic brush. **Phone rain:** hold anywhere on the phone's color background, or use its accessible toggle; drag to move within the assigned region. Each participant has one primary brush; extra fingers do not multiply that participant's water. Different participants' contributions add.
- **Forest and land:** each source-containing simulation cell has one drawing directly on the map. Stable geographic seeds vary its irregular ground, tree shapes, heights, lean, stumps, and fallen wood. Flames shrink with local surface wetness, while residual heat drives embers and filled smoke plumes. Terrain, fire, and smoke paint in separate passes so nearby ground cannot hide the effects. Wide views preserve readable flame and smoke sizes. Out patches retain charred trees and ash.
- **Cloud and rain (main display):** both use the projected geographic brush radius. Pale blue rain falls freely beneath the cloud with uneven landing heights. A thin circle shows where water is applied; it has no center crosshair. The original pointer hides while pouring and returns on release or cancellation. Selection boxes stay hidden. Pan, zoom, and resizing preserve the geographic anchor. Last drops fade after release without adding water.
- **Move map (main display):** drag to pan. Zoom and Reset map change the view, not the geographic water state. Changing mode, zooming, or resizing ends active rainfall.
- **Strength (operator control):** changes the fixed per-second output. Sweeping redistributes the same budget along an interpolated geographic path; more input events or greater speed do not create extra water.
- **Timing controls:** Fire return sets the recovery speed after local rain stops (default 4 s): unfinished heat closes half its remaining gap to full heat over that interval, while the surface dries. Fully out patches remain dark. Rain response sets the approximate time to halve surface flames under 50% rain (default 1.5 s, minimum 0.5 s). Ember cooling controls how slowly soaked residual heat fades (default 10 s, minimum 2 s). Out confirmation is the continued-rain, cool-and-wet hold before extinction (default 4 s). Lower Fire return values restore unfinished heat and surface activity sooner after release; that control does not speed extinction while holding. Sliders apply live, save with the performance, and keep current wetness and heat. Reset timing restores these defaults; Reset simulation retains the chosen timing.
- **Main-display brush readout:** shows surface wetness, moisture, and heat averaged over the entire circular footprint, weighted by each patch's intersecting area. Uninitialized patches contribute zeros. Outside the bounded model, only the intersecting modeled area contributes and its coverage is shown. This averaging does not create cells or change simulation state.
- **Next point:** inspect immutable NASA observations and the current performance patch. With the map focused, hold Space to rain at the selected point; release or Escape stops it.
- **Reset simulation:** clears wetness, moisture, and cooling, then reseeds the currently loaded observations. The NASA snapshot remains unchanged.

Reloading a display/controller retrieves the same shared landscape. Hiding a phone stops its contribution; hiding the display does not pause the shared simulation. The old browser save is retained solely for one-time operator migration and is no longer advanced or overwritten by clients.

## Performance model

`simulation.js` owns geographic 0.25-degree patches and a 0.85-degree brush radius. This schematic scale is an artistic choice. On the main display, blue wetness is visually clipped to the Indonesian country outline.

`regions.mjs` defines seven discrete island-region masks from these land cells, using the existing generalized Indonesia outline. Shoreline cells and source observation cells are included; the masks describe coarse performance patches, not precise coastlines. Screen `y` selects occupied rows from north to south; screen `x` selects occupied cells from west to east within that row, skipping sea gaps. This makes the whole phone screen usable, including small or separated islands. Movement is discrete at the model's patch scale and can jump across sea gaps.

The server owns the assignment and maps normalized phone positions itself; a participant cannot send arbitrary geographic coordinates or choose another region. It constrains both the moving brush center and every receiving brush cell to the assigned mask. At region edges, the allowed footprint weights are renormalized to preserve the same fixed water budget. Sweeping across gaps, clipping a brush, sending more events, or adding fingers does not create extra water. Two participants assigned to the same region can overlap and contribute additively.

Operator rain retains its geographic brush behavior: its modeled map-boundary clipping is unchanged, and rain over sea or outside the bounded model is not redirected onto regional land cells. Participant rain uses the constrained, budget-preserving regional mapping described above.

Moisture obeys `dM/dt = r/1.2 - M/180`, clamped to [0,1]. At stationary half strength, a fully covered interior patch reaches moisture 0.8 in about 2 seconds. With constant 50% rain, a dry, hot central patch reaches out in about 25 seconds at default timing and 5.5 seconds at minimum timing (previously about 304 and 137 seconds). With every slider, including Strength, at minimum (10% rain), it takes about 12 seconds; the old model never reached the moisture threshold at that strength. These are model measurements, not field estimates; region edges and overlapping participants affect local rates. Timing controls translate the displayed half-flame durations into separate surface wetting and drying responses; light rain never dries a patch faster than no rain. Ember cooling sets the heat-decay time for fully soaked ground. Extinction requires moisture >= 0.8 and heat <= 0.15 continuously for the chosen out-confirmation duration. Overlapping sources add local rain rates. Extinguished patches remain out until Reset simulation, even if timing is changed.

Model saves use schema version 3 with timing parameters. Schema 1 saves adopt the current defaults. Schema 2 saves retain their cells and total water and migrate old stock timing values: rain response 4→1.5 s or 1→0.5 s, ember cooling 90→10 s or 15→2 s, out confirmation 20→4 s. Other valid custom values remain unchanged. A deliberate custom value identical to an old stock endpoint cannot be distinguished and also migrates. Migration happens once and needs no reset. Invalid parameter updates and invalid saves are rejected without changing current state.

This is a **peat-inspired performance model**, not peatland classification, peat-fire physics, a fire forecast, or a real suppression tool. Not all Indonesian hotspots are peat fires. The original source coordinates, acquisition times, FRP, and provenance are kept separate from performance state.

Run `npm test` for physics, authority, persistence, browser transport, and actual HTTP/WebSocket integration checks, including stable assignments, regional bounds, water conservation, summary/delta synchronization, fresh baselines, independent controllers, additive overlap, expiry/renewal, reconnects, resets, and malformed/replayed messages. These automated/controller checks do not constitute a test on a physical phone.

## Animated visual assets

Open [the asset preview](http://127.0.0.1:4173/visual-assets/) for a clickable cloud, rainfall, and an 18-second surface-fire → embers → out study. The final state retains charred trunks, ash, and fallen wood; smoke fades over three seconds. The preview includes playback, scrubbing, keyboard input, reduced motion, and transparent PNG exports.

On the map, forest and land drawings replace detection dots. Observations in the same 0.25-degree performance cell share its drawing and respond to that cell's own wetness, heat, and extinction state. Drawings stay in place through surface fire, embers, and out, with a brief smoke tail after extinction. The authoritative simulation and original observation details are retained.

Reusable drawing functions, transparent frames, GIF previews, a sprite sheet, and usage notes are in `visual-assets/`; see `visual-assets/README.md`. Download the complete kit from the preview.

## Local API

- `GET /api/snapshot`: current saved snapshot.
- `POST /api/snapshot/refresh`: download, filter, save, and return a fresh snapshot. Send `Content-Type: application/json`.
- `GET /api/health`: server and refresh status.
- `GET /api/session`: current LAN join URL and room information.
- `GET /api/qr.svg`: QR code generated locally for that URL.
- `WS /ws?role=participant&clientId=...`: normalized `space: "region"` hold controls, assigned-region summaries, and acknowledgments.
- `WS /ws?role=operator&clientId=...`: local operator geographic hold controls and a full baseline followed by revisioned state deltas; `resync` requests a fresh baseline.
- `POST /api/bootstrap`: one-time local operator migration or fresh start.
- `POST /api/reset`, `/api/strength`, `/api/parameters`: local operator actions.

## Local verification · 29 October 2026

The isolated server timing comparison found active state age at publication fall from a median 42.6 ms (p95 48.2 ms) to 0.46 ms (p95 1.57 ms) after coupling 10 Hz publication to the 20 Hz simulation tick. This removes stale sampling; the next publication can still be up to 100 ms away. It does not measure Wi-Fi or device-to-photon latency.

At 1440×1100, the main map's warm canvas work stayed around 4 ms. With incoming WebSocket callbacks artificially delayed 250 ms, 31 automated pointer events reached the local footprint drawing command at median 0.2 ms, p95 0.4 ms, with one footprint and no delayed self echo. Automated input can align with animation frames; these values do not represent physical touch latency. Before the spatial-phone refinement, combined phone-browser holds reached the server-confirmed out state in about 24.9 s at defaults/50% strength and 12.2 s with all controls at minimum/10% strength, including summary delivery delay. Full measurements and limitations are in `output/coordination/integrated-2026-10-29.json` and the linked reports.

The spatial-phone refinement is verified separately against the production SharedRoom method: independently cooling opposite areas, reset/source refresh, and reduced motion. Since 30 October, the three numeric readouts always show assigned-region averages while idle, pressing, dragging, or using the rain toggle. A final real-time run with this spatial implementation reached out in 24.8 s at default timing/50% rain, and stopped adding water on release. Its per-region field is sparse (only current source-fire patches) and reused across participants; the phone still loads no full map, global cells, or simulation. The updated evidence is in `output/playwright/phone-spatial-check.json`; earlier uniform-background screenshots are superseded.

## Sound level and quick touches

Main output receives 9 dB and phones retain 12 dB of fixed makeup, independent of saved volume settings, with bounded peak protection. Transient-limited Main recordings receive up to 1.5 dB of local crest treatment; phones retain 3 dB. Natural rain retains constant gain. Brief released taps now reveal a finite tone when real ground cooling arrives, even if Main missed the held actor frame. Early tones remain hazy; the haze clears with deep cooling. Low assigned pitches retain their fundamental and gain a quiet audible octave partial.

Scene 4 rain is reduced to 60% of the operator strength. Its clear pitched parts gradually disappear into a diffuse hazy response as the forest rises. Orange source smoke is 25% more transparent, with a lighter shared veil. Main dynamics are gentler, with 3 dB less drive; phone dynamics retain their previous balance.

Phones now use a speaker symbol with distinct enabled, muted, paused and starting states, plus accessible action labels. The operator uses the same symbol beside Main status. New after-extinction ash/moisture/haze tails choose normal, -3 or +4 semitones once per lifecycle; the transposition chance falls with real macro heat. Existing tails keep their chosen pitch and their independent morph/fade clock.
