// Original LiliumOS refrigerator; rebuild with node scripts/build-kitchen-model.mjs.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, Shape, ExtrudeGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { transform } from 'esbuild';

const { code } = await transform(await fs.readFile(new URL('../utils/clayTokens.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { F, HUE } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const specCode = await transform(await fs.readFile(new URL('../utils/kitchenFridgeSpec.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { FRIDGE_SHELVES, FRIDGE_DOOR_RACKS, fridgeDoorParent } = await import(`data:text/javascript;base64,${Buffer.from(specCode.code).toString('base64')}`);
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
};
const enamel = new MeshPhysicalMaterial({ name: 'Satin enamel', color: F.surfaceRaised, roughness: 0.27, metalness: 0.12, clearcoat: 0.5, clearcoatRoughness: 0.2 });
const liner = new MeshStandardMaterial({ name: 'Moulded liner', color: F.surfaceRaised, roughness: 0.4 });
const recess = new MeshStandardMaterial({ name: 'Recessed liner', color: HUE.gray.tint, roughness: 0.65 });
const metal = new MeshStandardMaterial({ name: 'Brushed aluminium', color: F.surfaceRaised, roughness: 0.3, metalness: 0.88 });
const seal = new MeshStandardMaterial({ name: 'Rubber seal', color: HUE.gray.soft, roughness: 0.92 });
const glass = new MeshPhysicalMaterial({ name: 'Clear crisper plastic', color: F.surfaceRaised, transparent: true, opacity: 0.22, roughness: 0.13, metalness: 0.05, clearcoat: 1, depthWrite: false });
const edge = new MeshPhysicalMaterial({ name: 'Polished plastic rim', color: HUE.gray.main, transparent: true, opacity: 0.46, roughness: 0.18, metalness: 0.5, depthWrite: false });
const lamp = new MeshStandardMaterial({ name: 'Interior lamp', color: F.surfaceRaised, emissive: F.surfaceRaised, emissiveIntensity: 0.7 });
const root = new Group(); root.name = 'LiliumRoundedFridge';
const geometryCache = new Map();
function box(parent, name, size, position, material, radius = 0.012) {
  const key = [...size, radius].join(':');
  if (!geometryCache.has(key)) geometryCache.set(key, new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(v => v / 2))));
  const mesh = new Mesh(geometryCache.get(key), material);
  mesh.name = name; mesh.position.set(...position); parent.add(mesh); return mesh;
}
// Rounded outline independent of panel depth: visible corners stay softly curved.
function outline(width, height, radius) {
  const shape = new Shape(), x = -width / 2, y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y); shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}
function panel(parent, name, width, height, depth, position, material, radius = 0.07, border = 0) {
  const shape = outline(width, height, radius);
  if (border) shape.holes.push(outline(width - border * 2, height - border * 2, Math.max(0.008, radius - border)));
  const bevel = border ? Math.min(border / 4, 0.005) : 0.012;
  const mesh = new Mesh(new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2,
    steps: 1, curveSegments: 6, bevelSize: bevel, bevelThickness: bevel }), material);
  mesh.name = name; mesh.position.set(position[0], position[1], position[2] - depth / 2); parent.add(mesh);
  return mesh;
}
box(root, 'Back shell', [1.3, 2.32, 0.1], [0, 1.21, -0.42], enamel, 0.05);
for (const x of [-0.61, 0.61]) {
  box(root, 'Rounded side', [0.1, 2.32, 0.88], [x, 1.21, -0.02], enamel, 0.045);
  box(root, 'Side liner', [0.018, 2.13, 0.72], [x * 0.91, 1.21, -0.01], liner, 0.008);
}
box(root, 'Crown', [1.3, 0.12, 0.88], [0, 2.31, -0.02], enamel, 0.05);
box(root, 'Base', [1.3, 0.12, 0.88], [0, 0.11, -0.02], enamel, 0.035);
box(root, 'Inner back', [1.1, 2.12, 0.022], [0, 1.21, -0.352], recess);
box(root, 'Freezer divider', [1.15, 0.09, 0.78], [0, 1.73, 0], liner, 0.022);
for (const x of [-0.49, 0.49]) for (const z of [-0.28, 0.28]) box(root, 'Foot', [0.13, 0.09, 0.15], [x, 0.035, z], seal, 0.02);
for (let i = 0; i < 7; i++) box(root, 'Rear cooling channel', [0.78, 0.012, 0.008], [0, 0.65 + i * 0.135, -0.334], liner, 0.004);
box(root, 'Air control housing', [0.32, 0.2, 0.048], [0, 1.57, -0.305], liner, 0.02);
for (let i = 0; i < 5; i++) box(root, 'Vent slot', [0.19, 0.008, 0.003], [0, 1.525 + i * 0.02, -0.278], seal, 0.003);
box(root, 'Lamp lens', [0.3, 0.026, 0.12], [0, 1.66, 0.14], lamp);
box(root, 'Freezer lamp lens', [0.22, 0.022, 0.1], [0, 2.235, 0.1], lamp);
for (const top of [...FRIDGE_SHELVES.fridge, ...FRIDGE_SHELVES.freezer]) {
  box(root, `Shelf-${top}`, [1.1, 0.018, 0.4], [0, top - 0.009, -0.14], glass, 0.006);
  box(root, 'Shelf front trim', [1.11, 0.03, 0.035], [0, top - 0.01, 0.06], metal, 0.01);
  for (const x of [-0.537, 0.537]) box(root, 'Shelf support', [0.028, 0.025, 0.38], [x, top - 0.026, -0.14], liner, 0.008);
}
// Hollow, separate crisper drawers. Clear walls, stronger rims and recessed grips.
for (const [name, x] of [['CrisperLeft', -0.28], ['CrisperRight', 0.28]]) {
  const drawer = new Group(); drawer.name = name; drawer.position.set(x, 0.18, 0); root.add(drawer);
  box(drawer, 'Transparent base', [0.51, 0.015, 0.4], [0, 0, -0.14], glass, 0.006);
  box(drawer, 'Transparent front', [0.51, 0.31, 0.016], [0, 0.15, 0.06], glass, 0.007);
  box(drawer, 'Transparent back', [0.51, 0.29, 0.012], [0, 0.14, -0.34], glass, 0.005);
  for (const side of [-0.249, 0.249]) {
    box(drawer, 'Transparent side', [0.012, 0.3, 0.4], [side, 0.15, -0.14], glass, 0.005);
    box(drawer, 'Side rim', [0.014, 0.018, 0.4], [side, 0.3, -0.14], edge, 0.006);
  }
  box(drawer, 'Top rim', [0.51, 0.025, 0.026], [0, 0.3, 0.06], edge, 0.01);
  box(drawer, 'Drawer grip', [0.27, 0.036, 0.05], [0, 0.265, 0.083], edge, 0.014);
}
function door(name, bottom, height) {
  const pivot = new Group(); pivot.name = name; pivot.position.set(-0.62, 0, 0.43); root.add(pivot);
  const center = bottom + height / 2;
  panel(pivot, 'Sculpted enamel door', 1.27, height - 0.01, 0.1, [0.62, center, 0.073], enamel, 0.075);
  for (const [inset, z] of [[0, 0], [0.027, -0.016]])
    panel(pivot, 'Door gasket', 1.22 - inset, height - 0.05 - inset, 0.014, [0.62, center, z], seal, 0.065, 0.018);
  panel(pivot, 'Inset door liner', 1.1, height - 0.17, 0.022, [0.62, center, -0.029], liner, 0.065);
  panel(pivot, 'Moulded door ridge', 1.04, height - 0.23, 0.015, [0.62, center, -0.044], liner, 0.05, 0.026);
  const handleY = name === 'FreezerDoorPivot' ? bottom + 0.16 : bottom + height - 0.32;
  for (const offset of [-0.1, 0.1]) box(pivot, 'Handle mount', [0.048, 0.05, 0.075], [1.08, handleY + offset, 0.16], metal, 0.018);
  box(pivot, 'Rounded metal handle', [0.058, name === 'FreezerDoorPivot' ? 0.31 : 0.55, 0.065], [1.08, handleY, 0.207], metal, 0.025);
  return pivot;
}
for (const zone of ['fridge', 'freezer']) {
  const pivot = zone === 'fridge' ? door(fridgeDoorParent(zone), 0.13, 1.6) : door(fridgeDoorParent(zone), 1.75, 0.6);
  for (const { baseY: y, wallHeight: h, placement } of FRIDGE_DOOR_RACKS[zone]) {
    const bin = new Group(); bin.name = `${zone}-${placement}`; pivot.add(bin);
    box(bin, 'Door bin base', [0.94, 0.028, 0.3], [0.62, y, -0.18], glass);
    box(bin, 'Clear door bin', [0.94, h, 0.015], [0.62, y + 0.014 + h / 2, -0.33], glass, 0.006);
    box(bin, 'Bin rim', [0.94, 0.014, 0.018], [0.62, y + 0.014 + h, -0.33], edge, 0.006);
    box(bin, 'Bin lower edge', [0.94, 0.014, 0.018], [0.62, y + 0.014, -0.33], edge, 0.006);
    for (const x of [0.155, 1.085]) {
      box(bin, 'Bin end', [0.018, h, 0.3], [x, y + 0.014 + h / 2, -0.18], glass, 0.008);
      box(bin, 'Bin side rim', [0.018, 0.014, 0.3], [x, y + 0.014 + h, -0.18], edge, 0.006);
    }
  }
}
// Visible hinges and shelf-height mouldings read at phone size.
for (const y of [0.16, 1.73, 2.32]) box(root, 'Hinge cap', [0.075, 0.04, 0.16], [-0.6, y, 0.42], metal, 0.014);
for (const x of [-0.538, 0.538]) for (const y of [0.6, 0.82, 1.04, 1.26, 1.48, 1.9, 2.12])
  box(root, 'Liner shelf notch', [0.018, 0.034, 0.07], [x, y, -0.23], enamel, 0.006);
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
  json.materials.find(item => item.name === materialName).normalTexture = { index, scale: brushed ? 0.05 : 0.08 };
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

// Open 2 × 6 carton, physical size 0.84 × 0.24; each egg remains a separate node.
const carton = new Group(); carton.name = 'EggCarton12';
const pulp = new MeshStandardMaterial({ color: F.borderStrong, roughness: 1 });
const shell = new MeshStandardMaterial({ color: F.surfaceWarm, roughness: 0.65 });
box(carton, 'Pulp tray', [0.84, 0.04, 0.24], [0, 0.02, 0], pulp, 0.02);
for (const z of [-0.116, 0.116]) box(carton, 'Long rim', [0.84, 0.04, 0.012], [0, 0.052, z], pulp, 0.005);
for (const x of [-0.414, 0.414]) box(carton, 'End rim', [0.012, 0.04, 0.24], [x, 0.052, 0], pulp, 0.005);
for (let i = 0; i < 12; i++) {
  const x = (i % 6 - 2.5) * 0.133;
  const z = i < 6 ? -0.056 : 0.056;
  const cup = new Mesh(new TorusGeometry(0.047, 0.006, 6, 16), pulp);
  cup.name = `Cup-${i}`; cup.rotation.x = Math.PI / 2; cup.position.set(x, 0.049, z); carton.add(cup);
  const egg = new Mesh(new SphereGeometry(1, 16, 12), shell);
  egg.name = `Egg-${i}`; egg.scale.set(0.047, 0.065, 0.044); egg.position.set(x, 0.089, z); carton.add(egg);
}
await fs.writeFile(new URL('../public/kitchen/models/egg-carton.glb', import.meta.url), Buffer.from(await new GLTFExporter().parseAsync(carton, { binary: true })));
