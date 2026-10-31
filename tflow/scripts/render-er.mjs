// Temporary rendering dependencies are deliberately separate from application deps.
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir } from 'node:fs/promises';
const dependencyDir = process.argv[2];
if (!dependencyDir) throw new Error('Usage: node scripts/render-er.mjs /tmp/tflow-er-tools');
const require = createRequire(`${dependencyDir}/package.json`);
const { instance } = require('@viz-js/viz');
const { Resvg } = require('@resvg/resvg-js');
const viz = await instance();
const directory = new URL('../docs/er/', import.meta.url);
for (const file of (await readdir(directory)).filter(f => f.endsWith('.dot')).sort()) {
  const svg = viz.renderString(await readFile(new URL(file, directory), 'utf8'), { format: 'svg', engine: 'dot' });
  const stem = file.slice(0, -4);
  await writeFile(new URL(`${stem}.svg`, directory), svg);
  const image = new Resvg(svg, { fitTo: { mode: 'zoom', value: 1.6 }, font: { defaultFontFamily: 'DejaVu Sans', loadSystemFonts: true } }).render();
  await writeFile(new URL(`${stem}.png`, directory), image.asPng());
  console.log(`${stem}: ${image.width}x${image.height}`);
}
