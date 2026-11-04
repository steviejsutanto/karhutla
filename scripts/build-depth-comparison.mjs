// Read-only review artifact. It advances an isolated simulation in memory,
// records actual samples, then embeds the unchanged product renderer locally.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RainSimulation } from '../simulation.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const position = [114.125, -.125];
const simulation = new RainSimulation().seed([{ longitude: position[0], latitude: position[1] }]);
const labels = ['Dry', 'Surface quenched', 'Front descending', 'Deep embers', 'Out'];
const samples = [];
let previous = 0;
for (const [index, seconds] of [0, 1, 5, 10, 30].entries()) {
  if (seconds > previous) simulation.step(seconds - previous, [{ path: [position], strength: 1 }]);
  samples.push({ seconds, label: labels[index], patch: simulation.sample(...position) });
  previous = seconds;
}
const sectionSource = await readFile(path.join(root, 'visual-assets/peat-section.js'), 'utf8');
const atlas = await readFile(path.join(root, 'visual-assets/surface-heat-atlas.webp'));
const heatSource = (await readFile(path.join(root, 'visual-assets/surface-heat.js'), 'utf8')).replace(/const ATLAS_URL = .*?;/, `const ATLAS_URL = 'data:image/webp;base64,${atlas.toString('base64')}';`).replace(/^export /gm, '');
const source = `const SurfaceHeat = (() => {\n${heatSource}\nreturn SurfaceHeat;\n})();\n${sectionSource.replace("import { SurfaceHeat } from './surface-heat.js';", '')}`;
if (source.includes('</script')) throw new Error('Renderer source requires script-safe embedding.');
const cards = samples.map(({ seconds, label, patch }, index) => `<article><header><h2>${label}</h2><p>${seconds} s</p></header><canvas id="depth-${index}" role="img" aria-label="${label}: peat state after ${seconds} seconds of actual simulated rain"></canvas><dl><div><dt>Heat</dt><dd>${Math.round(patch.heat * 100)}%</dd></div><div><dt>Surface wet</dt><dd>${Math.round(patch.surfaceWetness * 100)}%</dd></div><div><dt>Moisture</dt><dd>${Math.round(patch.moisture * 100)}%</dd></div></dl></article>`).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#120806"><title>Below the ash · depth progression</title>
<style>
:root{color-scheme:dark;background:#120806;color:#dfbc98;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}*{box-sizing:border-box}body{margin:0;padding:24px}h1,h2,p{margin:0}h1{font:normal 25px/1.3 Georgia,serif;margin-bottom:8px}.intro{max-width:1000px;color:#bb9375}.panels{display:grid;grid-template-columns:repeat(5,minmax(190px,1fr));gap:12px;margin-top:24px;min-width:1030px}article{min-width:0;background:#190a06;border:1px solid #63402d55}article header{height:66px;padding:12px 13px}h2{font:normal 15px/1.3 Georgia,serif}header p{font-size:10px;color:#b68c6e;margin-top:4px}canvas{display:block;width:100%;height:350px}dl{display:flex;justify-content:space-between;gap:5px;padding:12px;margin:0;border-top:1px solid #63402d55;font-size:9px}dt{color:#ad8062}dd{margin:3px 0 0;color:#efd0ae}footer{margin-top:18px;max-width:1100px;color:#ad8062;font-size:10px}code{color:#dcb58e}#verification{margin-top:8px;color:#af8b71}
</style></head><body><h1>Below the ash · depth progression</h1><p class="intro">The same held rain, at five moments. The surface quenches first; deeper red embers remain until the cooling front reaches them.</p><main class="panels">${cards}</main><footer><p>This is an artistic depth profile, not measured peat physics. Each panel repeats one actual server-model sample across 32 source columns so the depth response is easy to compare. Values come from an isolated RainSimulation with its default timings and a continuous full-strength hold. No performance state or source observations are read or changed.</p><p id="verification">Preparing the unchanged product renderer…</p></footer>
<script type="module">
${source}
const samples = ${JSON.stringify(samples)};
const renderers = samples.map(async (sample,index)=>{
  const element=document.getElementById('depth-'+index);
  const renderer=new PeatSection(element,{reducedMotion:true,maxPixelRatio:1.5});
  const patches=Array.from({length:32},(_,column)=>({...sample.patch,key:(440+column)+',-1',geo:[110.125+column*.25,-.125]}));
  renderer.setPatches(patches);
  await renderer.ready();
  const draw=()=>{const box=element.getBoundingClientRect();renderer.resize(box.width,box.height);renderer.draw(0);};
  draw();
  new ResizeObserver(draw).observe(element);
  return renderer;
});
await Promise.all(renderers);
document.getElementById('verification').textContent='Five actual model samples · same product renderer · reduced motion · no live connection';
document.body.dataset.ready='true';
</script></body></html>`;
const output = path.join(root, 'output/coordination/depth-progression.html');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), samples: samples.map(({seconds,patch})=>({ seconds, heat:patch.heat, surfaceWetness:patch.surfaceWetness, moisture:patch.moisture, out:patch.extinguished })) }));
