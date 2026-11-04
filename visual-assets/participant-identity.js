// Shared visual identity only. The venue's persistent participant number is
// the key on both screens, so reconnecting or moving never changes the color.
export function participantRainIdentity(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  let hash = 2166136261;
  for (const character of String(number)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const hue = (hash >>> 0) % 360;
  return { number, label: String(number), color: `hsl(${hue} 64% 78%)` };
}
