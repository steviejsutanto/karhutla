// One audience instruction source for Main and phones. The content is fixed
// application copy; Wi-Fi credentials and other received text never enter HTML.
export const AUDIENCE_INSTRUCTIONS_HTML = '<li>Scan the QR code to join the performance.</li><li>Tap the <strong>speaker button</strong> and set a comfortable media volume. After enabling sound, your phone stays silent until the <strong>next scene</strong> begins. If you still cannot hear sound then, try turning <strong>Silent Mode</strong> off.</li><li>Hold over a fire to rain. Drag to move; lift to stop. Or use <strong>Rain</strong> to pour without holding. Rain pauses when your water runs out. Release to refill.</li><li>A bell marks the fires across your rain area going out.</li><li>Keep this page open, even in darkness.</li>';

export function mountAudienceInstructions(list) {
  if (list) list.innerHTML = AUDIENCE_INSTRUCTIONS_HTML;
}
