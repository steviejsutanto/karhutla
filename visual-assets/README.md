# Wildfire visual assets

## Current study: Below the ash

Open `/study` for the split main display: a readable Indonesian fire map in the upper half and an abstract peat section in the lower half. Open `/study/phone` for a simple map navigator. Both maps show the same source locations and geographic frame. Hold to rain, drag in either direction to move geographically, and release to stop. The phone stays landscape-first with portrait fallback. Its interface is minimal: rain, a footprint, Rain/Stop, fullscreen, and connection feedback. The main map uses a spare symbolic canopy; the phone has no cloud.

`peat-surface.js` exports `PeatSurface`, the Canvas 2D map renderer shared by main and phone. Quiet nearblack sea, charcoal/ash islands and thin coastlines keep the archipelago readable. The top main map now instantiates `OperatorForest`, reusing the main operator page’s actual `drawMapForest` terrain/fire artwork: burned trees, logs, ash, animated fire and embers. Its original smoke layer is retained, and the existing shared orange haze stays intact above it. Only the top renderer changes. The lower section retains its current ember atlas and motion. Original operator forest glyphs identify every main-map fire, ember and burned-remains source; confirmed out sites become gray ash scars. Rounded zero heat is not treated as extinction and retains a dim rust point until the server's out flag is true. The main map omits circular glow cores and static fissure stamps; operator forest artwork and local orange-red granular haze retain the current material direction without hiding fire locations in country-wide fog. Every source retains a geographic marker even when decorative detail is capped. Phone maps retain their earlier lightweight cores and glow. There are no repeated smoke sprites or particle lifetimes.

The map's low-resolution atmosphere runs at up to 640 pixels on its longer side and 12 updates per second, or 360 pixels/eight updates in Economy. `derivePeatState` reads authoritative heat, surface wetness and explicit extinction; smoothing affects drawing only. Optional `PeatSurface` constructor options `maxPixels`, `maxPixelRatio`, `materialUrl` and `contactOverlay: false` allow the lighter phone setup. `setSelection([x, y])` marks a normalized geographic brush position; `.mapRect` provides the aspect-fitted input frame.

`peat-section.js` exports `PeatSection`, `derivePeatDepthState`, and the `orderedSectionPatches`, `sectionPointAt`, `sectionXForGeo` helpers. Every current source-fire patch occupies a horizontal slot in stable longitude-then-latitude order in the main section. Depth is an artistic profile, not latitude, measured peat depth or geology. The restless surface → ember → out sequence uses abstract concentrated grain, fissures and moving ember-fibre textures instead of literal flame silhouettes. Surface wetness quiets that grain first, then confirmed moisture and heat loss move a softly irregular cooling front downward while local rain continues. Deeper red embers remain ahead of the front, avoiding uniform whole-column dimming. Only explicit extinction permits out. The depth profile comes entirely from server values; it is not a second physical water/heat simulation. The national phone field still uses seven-value rows `[key, longitude, latitude, heat, out, surfaceWetness, moisture]`.

`OperatorForest` is exported from the existing `surface-heat.js` module and dynamically imports the original `map-forest.js` only for the main map. It requests no bitmap and adds no operator-module download to phones. Its standalone painter caches all source terrain and draws all source fire then all source smoke exactly like `app.js`: full alpha/source-over, original seed offsets, no scale clamp, no 192-source cap, no extra heat/wetness smoothing or opacity fades. Raw source states and the absolute caller clock drive the original curves. `operatorMapScale` supplies the original CSS pixels per degree; reduced motion freezes animation time. Extinguished sources keep terrain and the original three-second smoke tail. Direct Canvas trace tests compare its geometry, colors, alpha and order with original `drawMapForest` calls.

The top `PeatSurface` branch uses the original full Indonesian coastline, warm land colors and island labels. Neighbouring geometry is neither requested nor painted. `studyMapRect` gives a20% closer canonical country frame, capped to 24–34px safe margins; the original `operatorMapRect` remains unchanged for direct comparisons; `countryInputAt` continues to invert it into the shared phone geography. `setWetCells` supplies the entire received field for the original clipped wet/moisture wash before terrain/fire. The generated material background, copper crack markers, old round dots and local map-haze layer are absent from this branch. Both the main live canvas and cached geography use alpha:true from their first context request. Sea stays transparent, and the live canvas clears before each frame to prevent fire/smoke ghosts. The stage owns one continuous warm gradient and one static 128 px operator-grain overlay above both views and their haze. The section sky blends into that backdrop; its material/fire algorithm is unchanged. The separate stage-wide haze remains unchanged above it. Phone maps keep the previous light material renderer and simplified coastline. The old SurfaceHeat atlas-map API remains for archived comparisons and tests; the lower section still uses SurfaceHeat normally.

The section prepares its coarse field, grain and unique fibres locally, and uses the local `surface-heat-atlas.webp` for moving surface texture. Its field is at most 360×160 pixels and updates at most 12 times per second; Economy uses 240×112 and eight updates per second. The granular surface is cached and bounded; it draws no pointed flame paths. `surface-heat.js` exports `SurfaceHeat`, which distributes eight atlas variants across 80 deterministic emitters, with a hard limit of 96. `surfaceHeatPose` fixes each base exactly while four joined texture bands bend through the bright body. Horizontal tip curl is bounded by `SURFACE_HEAT_MAX_TIP_MOTION` (3.5 CSS pixels), with separate height breathing up to 11% and hot phase speed 1.5–1.9 radians/second. The bright body at row .68 bends by up to 2.8 CSS pixels; the .82 base and lower band stay fixed. The background surface band paints at .38 alpha so its almost stationary glow does not drown out the moving fibres. Hot activity increases motion; local calming reduces speed, amplitude and opacity smoothly. There are no particle respawns or texture-frame jumps. `drawSites` uses the same source artwork at exact map positions, with at most 192 persistent sprite slots (128 in Economy), including retiring tails. Geographic selection plus a small incumbent heat bias stabilizes assignments. All sources retain an independent exact crack. Map textures stay 24–36 CSS pixels tall and paint after the map haze. The map-only `mapHeatPose` joins four source bands at rows 0, .45, .68, .82 and 1; the .82 geographic base and lower band stay fixed. The map uses a quieter profile: horizontal tip curl at most two CSS pixels, body curl up to 1.88 pixels, height breathing up to 6.5%, and hot phase speed 1.0–1.3 radians/second. Opacity eases in with a .30-second time constant and out with .75 seconds. Eased activity and calm prevent a shape snap under rain. Existing explicit-out textures can only retire, never reacquire a hot slot. Reduced motion uses fixed geometry and received states immediately. Each texture costs four cached image draws, with no independent loop or per-frame pixel processing. Map and section share one source decode; the map lazily caches an additional copper extraction that retains visible lower fibres without the pale upper smoke. The section keeps its previous emissive extraction; the phone's `contactOverlay:false` does not instantiate or load it. A one-time decode-time emissive extraction suppresses pale diffuse pixels and tints the retained generated carbon fibres red/copper. Painting then uses the cached atlas, with no per-frame image processing. `ready()` waits for the local image; a faint procedural fragment fallback preserves interaction if it is unavailable. Heat rises ease over 0.4 seconds while heat loss eases over 1.4 seconds, allowing confirmed returning heat to become visible promptly. Main scene drawing is capped at 24 fps and phone map drawing at 20 fps. Both use capped Canvas pixel density/resolution and caller-owned clocks; the renderers create no animation loop. Reduced motion presents static confirmed states.

`PeatSection.drawAtmosphere(context, {x, y, width, height, now, alpha})` paints the section's air into the parent-owned stage overlay. A cached 480×192 field (320×128 in Economy) slowly advects prepared grain fields and updates at most 12 Hz (eight in Economy). Integrated motion phases prevent jumps when heat or wetness changes. A 64×32 two-dimensional calming mask follows actual map rain locations and matching section positions; the section also has a 96-bin motion field. Hot ground increases agitation, while wet ground or active contact visibly slows and thins the local haze. Contact calming is immediate decorative feedback, not a prediction of cooling or extinction; confirmed wetness maintains the quieting. The overlay is capped at 1280×720 pixels, crosses the main-view divide, accepts no input and uses the existing scene clock. Source geography stays fixed and the map's precise fire markers remain visible. Reduced motion freezes drift while retaining state and contact response.

Unfinished heat now recovers authoritatively after local rain stops: with the four-second default Fire return, half of the remaining gap to full heat returns every four seconds. Surface drying is calibrated to the current `(1 - wetness)^2.2` activity curve. Continued local watering is required for continued deep cooling and out settlement; when local rain stops, unfinished settlement resets. The remembered moisture still decays over 180 seconds, but cannot continue cooling an unattended unfinished source. Only an explicit out flag remains permanently cold. The section's cooling front retreats as confirmed heat returns; neither renderer invents reheating.

`rain-feedback.js` exports `RainFeedback` and `RainContactTransitions`. The latter keeps a bounded 256-contact visual history, with 150 ms entrance and 450 ms release envelopes. An immediate footprint and a few drops acknowledge each press; release keeps a non-wrapping cohort that falls out of the column. Same-ID hover previews remain separate from rain tails, and previews never pour. Main and section share the same sampled visual contacts while raw contacts alone control calming/water. The phone uses up to four small 320×240 surfaces during rapid distant represses, and removes them as tails finish. All animation uses caller clocks; no private timers are created. Reduced motion shows immediate static states. Passing `cloud: false` draws rain alone, as on the phone and section. The separate small overlay responds immediately on press/drag and fades on release without adding water. Phone rain is capped at 24 fps. The side-view call disables the horizontal impact line; the phone keeps its true geographic footprint. Geographic footprints remain anchored even when the main canopy must move inward at an edge. Canopies use their original target positions; the experimental spacing and fan-shaped rain are reverted.

The main view loads `indonesia.geojson` (about 441 KB) and the lower section’s `surface-heat-atlas.webp` (about107KB), approximately 548 KB combined. It no longer requests `surrounding-land.geojson`. The new atlas was made with built-in ImageGen; the generated master is `surface-heat-atlas.png` (1774×887, RGBA) and the optimized delivery is 768×384, RGBA, with eight 192×192 cells. Delivery uses proportional resize and WebP compression only, preserving alpha. The exact prompt and runtime tinting provenance are in `surface-heat-prompts.txt`. The phone loads `peat-material-phone.webp` (about 129 KB) and the same outline, about 222 KB combined. Neither loads `peat-smoke.webp` or `rain-cloud.webp`; their masters, derivatives and prompt records remain archived as earlier creative sources. The phone does not load the ember atlas. No external image, font or cloud service is needed at runtime.

The source observations, moisture/heat model and regional legacy views remain separate from these artistic renderers. Runtime metrics measure drawing commands, not physical screen latency. Historical synthetic server load reports predating the recovery change do not benchmark the revised model or establish real-device performance.

## Earlier lo-fi asset preview

Open the [interactive preview](http://127.0.0.1:4173/visual-assets/) while the local prototype is running (`npm start` from the project folder). Click the cloud for a short shower, hold for continued rain, or play and scrub the forest transition. Space and Enter also trigger rain. Reduced-motion settings offer static states.

The visual language uses spare ink silhouettes, low flames at ground level, thin blue rain strokes, and drifting gray smoke. Charred trunks, fallen branches, and ash remain visible after the heat is gone. Cooling does not restore trees or turn burned ground green.

## Files

| File in `exports/` | Use |
| --- | --- |
| `asset-sheet.png` | Overview of rainfall and all forest states |
| `rainfall.png` | Transparent cloud and rain frame |
| `surface-fire.png` | Transparent forest, low flames, and smoke |
| `embers.png` | Transparent forest, residual glow, and smoke |
| `out-burned-remains.png` | Transparent burned forest and land, without fire or glow |
| `rainfall.gif` | 4.2-second rain loop |
| `forest-transition.gif` | Plays once: 18-second cooling transition, 3-second smoke tail, then 1.5 seconds holding the burned remains |
| `forest-transition-spritesheet.png` | 12 frames in reading order, 4 columns × 3 rows; each cell is 640 × 360 pixels |
| `wildfire-lofi-assets.zip` | Packaged asset handoff |

The PNG files preserve transparency. GIFs use a paper-colored background; use `renderer.js` when smooth timing and transparency are required. The 18-second sequence is an asset demonstration, not the duration of cooling in the performance simulation.

## Reusable renderer

`renderer.js` is an ES module with no external dependencies. It exports `drawForest`, `drawCloudRain`, and the frozen `palette` object. Both drawing functions accept a Canvas 2D context, preserve its state, and clip their output to the supplied rectangle. They do not clear the canvas. Clear it before each animation frame; call repeatedly from `requestAnimationFrame` with time in seconds.

```js
import { drawForest, drawCloudRain } from './visual-assets/renderer.js';

drawCloudRain(ctx, {
  x: 0, y: 0, width: 640, height: 360,
  time: performance.now() / 1000, amount: 1,
});

drawForest(ctx, {
  x: 0, y: 0, width: 640, height: 360,
  time: performance.now() / 1000, progress: 0.62,
});
```

Shared options are `x`, `y`, `width`, `height`, `time`, `seed`, and `background`. `background` defaults to `false` for transparency; use `true` for the palette's paper color or supply a CSS color. Stable seeds keep particle positions consistent across frames. Geometry uses a 640 × 360 coordinate space scaled into the requested rectangle.

`drawCloudRain` defaults to a 320 × 300 box. `amount` ranges from 0 to 1 and controls active rain. On release, set `amount: 0` and reduce `tail` from 1 to 0 over about 0.8 seconds so the remaining drops settle. The cloud remains visible when idle. Its silhouette occupies approximately the central half of the rectangle's width; drops fall below it.

`drawForest` defaults to a 640 × 360 box. Supply `progress` for an art-directed sequence: `0` is surface fire, approximately `0.55–0.62` is embers, and `1` is out. `smokeTail` ranges from 1 to 0 for lingering smoke at the end; the preview fades it over 3 seconds. Keep it at 0 for a fully still out frame.

For live performance state, omit `progress`:

```js
drawForest(ctx, {
  width: 640, height: 360, time: performance.now() / 1000,
  heat: cell.heat,
  surfaceWetness: cell.surfaceWetness,
  extinguished: cell.extinguished,
  smokeTail: 0,
});
```

`heat` and `surfaceWetness` range from 0 to 1. Wetness suppresses surface flames quickly; residual heat continues to drive ember glow and smoke. `extinguished: true` removes all flame and ember glow. A caller-controlled `smokeTail` can then let smoke fade away. The burned structure stays fixed through wetting, drying, and reheating.

## Palette and prototype integration

Core colors are paper `#faf9f5`, ink `#333632`, charcoal `#393b38`, ash `#c5c3bc`, smoke `#8e938e`, fire `#a44832`, ember `#ba852b`, and rain `#548fb7`. Shapes carry the state alongside color: rising flames, low glowing marks, then ash and charred remains.

The main map replaces thermal-detection dots with one forest-and-land glyph per source-containing 0.25-degree simulation cell. Each glyph follows its own heat, wetness, and extinction state directly where rain falls. Nearby cells are not averaged into a shared visual state. Original observation details remain available for inspection.

`map-forest.js` exports `drawMapForest(ctx, {x, y, scale, time, heat, surfaceWetness, extinguished, smokeTail, tailHeat, seed, layer})` and `forestPatchBounds({x, y, scale, seed, layer})`. Here `scale` is projected pixels per degree, and `x/y` is the projected cell center. Stable seeds vary organic ground shapes, tree placement, height, lean, branching, and stumps. Terrain grows with zoom; fire and smoke keep a gentle minimum readable size in wide views. Paint all patches' `terrain` layers first, then their `fire` layers, then `smoke`, to avoid neighboring ground hiding the effects. Omit `layer` or use `all` to draw one complete patch. Use terrain bounds for hit testing and full bounds for culling. On extinction, retain the previous heat in `tailHeat` and fade `smokeTail` from 1 to 0 over three seconds; model heat itself becomes zero.

`map-weather.js` exports `drawBrushRain(ctx, {x, y, radius, time, amount, tail, tailAmount, seed})` and `brushRainBounds({x, y, radius})`. Set `radius` to the projected geographic brush radius. The cloud spans the circle above it; rain falls freely as a full-width curtain, with wind drift and varied landings beyond the circle. `brushRainBounds` returns the exact brush `footprint` separately from the expanded `rain` and cloud bounds. On release, set `amount: 0`, retain the released strength in `tailAmount`, and fade `tail` from 1 to 0 over 0.8 seconds.

Forest imagery is a schematic performance layer: it does not assert that a satellite detection is forest, define a real fire boundary, or measure burned extent. Source observations and the cooling simulation remain separate.
