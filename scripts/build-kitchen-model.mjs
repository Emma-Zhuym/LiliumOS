// Original LiliumOS refrigerator; rebuild with node scripts/build-kitchen-model.mjs.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { transform } from 'esbuild';

const { code } = await transform(await fs.readFile(new URL('../utils/clayTokens.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { F, HUE } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
};
const enamel = new MeshPhysicalMaterial({ name: 'Satin enamel', color: F.surfaceWarm, roughness: 0.32, metalness: 0.18, clearcoat: 0.3, clearcoatRoughness: 0.25 });
const liner = new MeshStandardMaterial({ name: 'Moulded liner', color: F.surface, roughness: 0.48 });
const metal = new MeshStandardMaterial({ name: 'Brushed aluminium', color: F.borderStrong, roughness: 0.28, metalness: 0.8 });
const seal = new MeshStandardMaterial({ name: 'Rubber seal', color: F.textSecondary, roughness: 0.95 });
const glass = new MeshPhysicalMaterial({ name: 'Clear crisper plastic', color: HUE.green.tint, transparent: true, opacity: 0.28, roughness: 0.12, depthWrite: false });
const edge = new MeshPhysicalMaterial({ name: 'Polished plastic rim', color: HUE.green.soft, transparent: true, opacity: 0.58, roughness: 0.18 });
const lamp = new MeshStandardMaterial({ name: 'Interior lamp', color: F.surfaceRaised, emissive: F.surfaceRaised, emissiveIntensity: 0.7 });
const root = new Group(); root.name = 'LiliumRoundedFridge';
function box(parent, name, size, position, material, radius = 0.012) {
  const mesh = new Mesh(new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(v => v / 2))), material);
  mesh.name = name; mesh.position.set(...position); parent.add(mesh); return mesh;
}
box(root, 'Back shell', [1.3, 2.32, 0.1], [0, 1.21, -0.42], enamel, 0.05);
for (const x of [-0.61, 0.61]) {
  box(root, 'Rounded side', [0.1, 2.32, 0.88], [x, 1.21, -0.02], enamel, 0.045);
  box(root, 'Side liner', [0.018, 2.13, 0.72], [x * 0.91, 1.21, -0.01], liner, 0.008);
}
box(root, 'Crown', [1.3, 0.12, 0.88], [0, 2.31, -0.02], enamel, 0.05);
box(root, 'Base', [1.3, 0.12, 0.88], [0, 0.11, -0.02], enamel, 0.035);
box(root, 'Inner back', [1.1, 2.12, 0.022], [0, 1.21, -0.352], liner);
box(root, 'Freezer divider', [1.15, 0.09, 0.78], [0, 1.73, 0], liner, 0.022);
for (const x of [-0.49, 0.49]) for (const z of [-0.28, 0.28]) box(root, 'Foot', [0.13, 0.09, 0.15], [x, 0.035, z], seal, 0.02);
for (let i = 0; i < 7; i++) box(root, 'Rear cooling channel', [0.78, 0.012, 0.008], [0, 0.65 + i * 0.135, -0.334], enamel, 0.004);
box(root, 'Air control housing', [0.32, 0.2, 0.048], [0, 1.57, -0.305], enamel, 0.02);
for (let i = 0; i < 5; i++) box(root, 'Vent slot', [0.19, 0.008, 0.003], [0, 1.525 + i * 0.02, -0.278], seal, 0.003);
box(root, 'Lamp lens', [0.025, 0.14, 0.14], [-0.535, 1.56, 0.02], lamp);
box(root, 'Freezer shelf', [1.08, 0.025, 0.68], [0, 1.84, 0], liner);
for (const top of [0.56, 0.93, 1.3]) {
  box(root, `Shelf-${top}`, [1.1, 0.018, 0.66], [0, top - 0.009, 0.005], glass, 0.006);
  box(root, 'Shelf front trim', [1.11, 0.03, 0.035], [0, top - 0.01, 0.335], metal, 0.01);
  for (const x of [-0.537, 0.537]) box(root, 'Shelf support', [0.028, 0.025, 0.62], [x, top - 0.026, -0.005], liner, 0.008);
}
// Hollow, separate crisper drawers. Clear walls, stronger rims and recessed grips.
for (const [name, x] of [['CrisperLeft', -0.28], ['CrisperRight', 0.28]]) {
  const drawer = new Group(); drawer.name = name; drawer.position.set(x, 0.18, 0); root.add(drawer);
  box(drawer, 'Transparent base', [0.51, 0.015, 0.65], [0, 0, 0], glass, 0.006);
  box(drawer, 'Transparent front', [0.51, 0.31, 0.016], [0, 0.15, 0.325], glass, 0.007);
  box(drawer, 'Transparent back', [0.51, 0.29, 0.012], [0, 0.14, -0.325], glass, 0.005);
  for (const side of [-0.249, 0.249]) {
    box(drawer, 'Transparent side', [0.012, 0.3, 0.65], [side, 0.15, 0], glass, 0.005);
    box(drawer, 'Side rim', [0.014, 0.018, 0.65], [side, 0.3, 0], edge, 0.006);
  }
  box(drawer, 'Top rim', [0.51, 0.025, 0.026], [0, 0.3, 0.325], edge, 0.01);
  box(drawer, 'Drawer grip', [0.25, 0.036, 0.045], [0, 0.265, 0.348], liner, 0.014);
}
function door(name, bottom, height) {
  const pivot = new Group(); pivot.name = name; pivot.position.set(-0.62, 0, 0.43); root.add(pivot);
  const center = bottom + height / 2;
  box(pivot, 'Door gasket', [1.22, height - 0.025, 0.045], [0.62, center, 0], seal, 0.025);
  box(pivot, 'Sculpted enamel door', [1.3, height, 0.12], [0.62, center, 0.073], enamel, 0.055);
  box(pivot, 'Inset door liner', [1.12, height - 0.13, 0.022], [0.62, center, -0.029], liner, 0.02);
  const handleY = name === 'FreezerDoorPivot' ? bottom + 0.16 : bottom + height - 0.32;
  for (const offset of [-0.1, 0.1]) box(pivot, 'Handle mount', [0.048, 0.05, 0.075], [1.08, handleY + offset, 0.16], metal, 0.018);
  box(pivot, 'Rounded metal handle', [0.055, 0.29, 0.065], [1.08, handleY, 0.207], metal, 0.025);
  return pivot;
}
const lower = door('DoorPivot', 0.13, 1.6);
door('FreezerDoorPivot', 1.75, 0.6);
for (const y of [0.42, 0.94]) {
  box(lower, 'Door bin base', [0.94, 0.028, 0.15], [0.62, y, -0.105], liner);
  box(lower, 'Clear door bin', [0.94, 0.12, 0.015], [0.62, y + 0.066, -0.177], glass, 0.006);
  box(lower, 'Bin rim', [0.94, 0.018, 0.018], [0.62, y + 0.126, -0.177], edge, 0.008);
  for (const x of [0.155, 1.085]) box(lower, 'Bin end', [0.018, 0.12, 0.15], [x, y + 0.06, -0.105], liner, 0.008);
}
box(root, 'Toe kick', [1.04, 0.047, 0.024], [0, 0.084, 0.42], seal, 0.01);

// Original deterministic micro-normal maps, embedded so Blender and the app share textures.
function png(width, height, pixels) {
  const crc = bytes => {
    let c = 0xffffffff;
    for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, bytes) => {
    const data = Buffer.concat([Buffer.from(name), bytes]);
    const head = Buffer.alloc(4); head.writeUInt32BE(bytes.length);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(data));
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const exported = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true }));
const jsonLength = exported.readUInt32LE(12);
const json = JSON.parse(exported.toString('utf8', 20, 20 + jsonLength));
let binary = exported.subarray(28 + jsonLength);
json.images = []; json.textures = []; json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
for (const [materialName, brushed] of [['Satin enamel', false], ['Brushed aluminium', true]]) {
  const pixels = Buffer.alloc(128 * 128 * 3);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 3;
    const noise = ((x * 73856093 ^ y * 19349663) >>> 0) % 17 - 8;
    pixels[i] = 128 + (brushed ? 0 : noise);
    pixels[i + 1] = 128 + (brushed ? Math.round(Math.sin(y * 2.4) * 15) : noise);
    pixels[i + 2] = 255;
  }
  const image = png(128, 128, pixels);
  const index = json.images.length;
  json.images.push({ mimeType: 'image/png', bufferView: json.bufferViews.length });
  json.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: image.length });
  json.textures.push({ sampler: 0, source: index });
  json.materials.find(item => item.name === materialName).normalTexture = { index, scale: brushed ? 0.22 : 0.14 };
  binary = Buffer.concat([binary, image, Buffer.alloc((4 - image.length % 4) % 4)]);
}
json.buffers[0].byteLength = binary.length;
const serialized = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.concat([serialized, Buffer.alloc((4 - serialized.length % 4) % 4, 32)]);
const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
await fs.writeFile(new URL('../public/kitchen/models/fridge.glb', import.meta.url), Buffer.concat([header, jsonChunk, binHeader, binary]));
console.log(`Original fridge: ${json.meshes.length} meshes, ${binary.length} binary bytes, two doors and two transparent drawers.`);
