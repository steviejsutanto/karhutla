import { DEFAULT_PARAMETERS, RainSimulation } from './simulation.js';
import { DEFAULT_SCENE_SETTINGS, DEFAULT_SOUND_SETTINGS, sceneSettingsPatch, soundSettingsPatch } from './performance-scenes.mjs';

export const SETTINGS_PRESET_FORMAT = 'wildfire-settings';
export const SETTINGS_PRESET_VERSION = 1;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function completeObject(value, keys, label) {
  if (!object(value) || Reflect.ownKeys(value).length !== keys.length || !Reflect.ownKeys(value).every(key => keys.includes(key))) fail(`The ${label} must contain exactly the supported settings.`);
}

// A preset is deliberately separate from a running-performance save. Complete
// objects prevent a partial import from depending on the destination computer.
export function validateSettingsPreset(preset) {
  completeObject(preset, ['format', 'schemaVersion', 'strength', 'parameters', 'sceneSettings', 'soundSettings'], 'settings preset');
  if (preset.format !== SETTINGS_PRESET_FORMAT || preset.schemaVersion !== SETTINGS_PRESET_VERSION) fail('Unsupported settings preset format or version.');
  if (typeof preset.strength !== 'number' || !Number.isFinite(preset.strength) || preset.strength < 0 || preset.strength > 1) fail('Rain strength must be between zero and one.');
  completeObject(preset.parameters, Object.keys(DEFAULT_PARAMETERS), 'simulation timing');
  const simulation = new RainSimulation();
  if (!simulation.setParameters(preset.parameters)) fail('Performance timing parameters are invalid.');
  completeObject(preset.sceneSettings, Object.keys(DEFAULT_SCENE_SETTINGS), 'scene settings');
  completeObject(preset.soundSettings, Object.keys(DEFAULT_SOUND_SETTINGS), 'sound settings');
  if (Object.values(preset.soundSettings).some(value => value === undefined)) fail('Every sound setting must have a value.');
  completeObject(preset.soundSettings.macros, Object.keys(DEFAULT_SOUND_SETTINGS.macros), 'sound macros');
  completeObject(preset.soundSettings.mixer, Object.keys(DEFAULT_SOUND_SETTINGS.mixer), 'sound mixer');
  // Patch validators also enforce every value's type, range, and text limits.
  const sceneSettings = sceneSettingsPatch(DEFAULT_SCENE_SETTINGS, preset.sceneSettings);
  const soundSettings = soundSettingsPatch(DEFAULT_SOUND_SETTINGS, preset.soundSettings);
  return { format: SETTINGS_PRESET_FORMAT, schemaVersion: SETTINGS_PRESET_VERSION,
    strength: preset.strength, parameters: { ...simulation.parameters }, sceneSettings, soundSettings };
}

export function createSettingsPreset({ strength, parameters, sceneSettings, soundSettings }) {
  return validateSettingsPreset({ format: SETTINGS_PRESET_FORMAT, schemaVersion: SETTINGS_PRESET_VERSION,
    strength, parameters, sceneSettings, soundSettings });
}
