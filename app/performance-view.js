// Shared, DOM-free presentation rules. Scene timing always comes from the venue.
import { computeSceneScore, scoreDurations } from './scene-score.js';
export const PERFORMANCE_SCENES = Object.freeze(['arrival', 'instructions', 'participation', 'forest-takeover', 'final-rain', 'afterglow', 'ended']);
export const WORK_TITLE = 'karhutla';
export const DEFAULT_PROGRAM_NOTES = 'Drawing on recent Indonesian wildfires, this participatory audiovisual work brings collective action into tension with the persistence of heat. The effort to extinguish the fires is also a confrontation with the human choices that have fed them. The audience becomes a temporary ensemble, its gestures gathering into a shared field of sound and rain. This shared effort unfolds alongside the hope for relief from forces beyond our control.';
export function sceneAllowsRain(scene) { return ['participation', 'forest-takeover'].includes(scene?.id) && !scene.paused; }
export function scenePresentation(scene, { phone = false } = {}) {
  const score = computeSceneScore(scene || { id: 'arrival', elapsedMs: 0 });
  const gain = phone ? score.phoneVisualGain : score.visualGain;
  const opening = scene?.id === 'arrival' || scene?.id === 'instructions';
  // The authority identifies the initial entrance. A later return to scene 3
  // must agree across existing displays, late joins, and refreshed phones.
  const enteringFromOpening = scene?.id === 'participation' && scene.participationOpening !== false;
  const landscapeEntranceGain = opening || scene?.id === 'waiting' ? 0 : enteringFromOpening ? score.mix.phoneField : 1;
  const openingOverlayGain = opening ? 1 : enteringFromOpening ? 1 - landscapeEntranceGain : 0;
  return { ...score, gain, blackout: gain <= 0, opening, landscapeEntranceGain, openingOverlayGain,
    showProgramNotes: scene?.id === 'arrival', showInstructions: scene?.id === 'instructions',
    showWifiJoin: opening || enteringFromOpening && openingOverlayGain > 0,
    showJoinCode: opening || enteringFromOpening && openingOverlayGain > 0,
    showOpeningInstructions: scene?.id === 'instructions' || enteringFromOpening && openingOverlayGain > 0,
    cueScene: scene?.id === 'afterglow' || scene?.id === 'ended' ? 'final-rain' : scene?.id };
}
export function sceneClock(scene) {
  const seconds = Math.max(0, Math.floor((scene?.elapsedMs || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function sceneRemaining(scene) {
  const score = computeSceneScore(scene || { id: 'arrival', elapsedMs: 0 });
  const durations = scoreDurations(scene?.settings);
  const timedDuration = ({ arrival: durations.arrivalMs, instructions: durations.instructionsMs,
    participation: durations.participationMs, 'forest-takeover': Math.max(durations.forestTakeoverMs, durations.forestRiseMs) })[scene?.id];
  if (timedDuration !== undefined) return Math.max(0, Math.ceil((Number.isFinite(scene.autoAdvanceRemainingMs) ? scene.autoAdvanceRemainingMs : timedDuration - (scene.elapsedMs || 0)) / 1000));
  if (scene?.id === 'final-rain') return Math.max(0, Math.ceil((score.finalRainRampDurationMs - (scene.elapsedMs || 0)) / 1000));
  return Math.max(0, Math.ceil(((score.phaseDurationMs || 0) - (score.phaseElapsedMs || 0)) / 1000));
}
export function scenePhaseReadout(scene) {
  if (!scene) return 'Waiting for the venue';
  const score = computeSceneScore(scene), remaining = sceneRemaining(scene);
  const labels = { title: 'Title, program notes · 1 Wi-Fi → 2 QR · Main haze', instructions: 'QR & instructions on Projection and phones · Haze → distant burning forest', participation: 'Participation · Soft tones + Main bells', 'forest-rise': (scene.forestRestorationComplete ?? score.forestTakeoverProgress >= 1) ? 'Forest takeover · Burning forest at 100% · Rain cools; fire keeps returning' : 'Forest takeover · Rain cools; fire keeps returning · Burning forest rising', rain: score.finalRainProgress < 1 ? `Final rain · Burning forest → heavy rain · ${Math.round(score.finalRainProgress * 100)}% · Cooling every source fire` : 'Final rain · Heavy rain · Cooling every source fire', 'rain-cricket-overlap': `Rain → PA crickets · ${score.visualGain > 0 ? 'Screens fading' : 'All screens black'}`, 'projection-fade': 'PA crickets + distant orangutan · Screens fading · Rain stopped', 'pa-crickets': 'PA crickets + distant orangutan · All screens black · Rain stopped', 'cricket-handoff': 'PA → phone crickets · Sparse birds · Faint Main orangutan · All screens black', 'phone-only': 'Phone cricket hold · Sparse birds · Faint Main orangutan · All screens black', 'phone-fade': 'Phones fading · Crickets + sparse birds · Faint Main orangutan · All screens black', ended: 'Ended · All screens black · Silence' };
  const next = ({ arrival: 'Instructions', instructions: 'Participation', participation: 'Forest takeover', 'forest-takeover': 'Final rain' })[scene.id];
  if (next) return `${labels[score.phase]} · ${next} in ${remaining} s${scene.paused ? ' · Timer paused' : ' · Automatic'}`;
  const timed = score.phaseDurationMs > 0 || scene.id === 'final-rain';
  return `${labels[score.phase] || score.phase}${timed ? remaining ? ` · ${remaining} s remaining` : ' · Transition complete' : ''}`;
}
export function sceneInstruction(scene) {
  if (!scene) return 'Connecting to the performance…';
  if (scene.paused && !['arrival', 'instructions'].includes(scene.id)) return 'The performance is paused. Listen and wait.';
  return ({ arrival: 'Tap the speaker button and keep your media volume comfortable. Your phone stays silent until Scene 3 (Participation) begins. If you still cannot hear sound then, try turning Silent Mode off.', instructions: 'Tap the speaker button and keep your media volume comfortable. Your phone stays silent until the next scene begins. If you still cannot hear sound then, try turning Silent Mode off. When the landscape opens, hold over a fire to rain. Drag to move; lift to stop.', participation: 'Hold over a fire to rain. Drag to move; lift to stop. Light rain joins your phone sound while you hold. A C or G bell in the room marks the fires across your rain area going out.', 'forest-takeover': 'Keep bringing rain. Your rain still cools and extinguishes fires, but the heat keeps returning.', 'final-rain': 'The final rain is gathering across the whole landscape. Listen.', afterglow: 'The fires are out. Listen.', ended: '' })[scene.id] ?? 'Listen to the room.';
}
const sharedSoundCache = new WeakMap();
export function applySharedSound(engine, settings, { phone = false } = {}) {
  if (!engine || !settings) return;
  const signature = JSON.stringify({ phone, settings });
  if (sharedSoundCache.get(engine) === signature) return;
  sharedSoundCache.set(engine, signature);
  if (settings.macros) engine.setMacros(settings.macros);
  if (!phone && settings.mixer) engine.setMixer?.(settings.mixer);
  // setMacros intentionally selects manual mode, so restore the shared switch last.
  engine.setAutomation?.(phone ? true : settings.automation !== false);
  if (!phone && Number.isFinite(settings.level)) engine.setLevel(settings.level);
}
