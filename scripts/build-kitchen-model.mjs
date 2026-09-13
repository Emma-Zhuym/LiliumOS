// Rebuild with: node scripts/build-kitchen-model.mjs
// Kenney's OBJ is Y-up and preserves the door's closed position (unlike the FBX import).
import fs from 'node:fs/promises';
import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { transform } from 'esbuild';

const { code } = await transform(await fs.readFile(new URL('../utils/clayTokens.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { F, HUE } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

// GLTFExporter needs FileReader for binary buffers even when there are no images.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};
const root = new Group();
root.name = 'KitchenFridge';
const source = new OBJLoader().parse(await fs.readFile(new URL('../assets/kitchen-source/kitchenFridgeSmall.obj', import.meta.url), 'utf8'));
const transformModel = new Matrix4().makeTranslation(-0.645, 0, 0.423)
  .multiply(new Matrix4().makeScale(3, 3, 3))
  .multiply(new Matrix4().makeRotationY(Math.PI));
const colors = { metalLight: F.surface, metalDark: F.textSecondary, glass: HUE.green.tint, metal: F.borderStrong };
const hinge = new Group();
hinge.name = 'DoorPivot';
hinge.position.set(-0.565, 0, 0.423);
root.add(hinge);
source.traverse(object => {
  if (!object.isMesh) return;
  const mesh = object.clone();
  mesh.geometry = object.geometry.clone().applyMatrix4(transformModel);
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  const converted = materials.map(material => new MeshStandardMaterial({ color: colors[material.name] ?? F.surface, roughness: 0.8 }));
  mesh.material = Array.isArray(object.material) ? converted : converted[0];
  if (object.name === 'doorFridge') {
    mesh.geometry.translate(-hinge.position.x, 0, -hinge.position.z);
    hinge.add(mesh);
  } else root.add(mesh);
});
// Shelf tops define the placement contract shared with kitchenSceneLayout.ts.
for (const top of [0.3, 0.76, 1.22]) {
  const shelf = new Mesh(new BoxGeometry(1.1, 0.025, 0.6), new MeshStandardMaterial({ color: HUE.green.tint, roughness: 0.7 }));
  shelf.name = `Shelf-${top}`;
  shelf.position.set(0, top - 0.0125, 0.01);
  root.add(shelf);
}
const binary = await new GLTFExporter().parseAsync(root, { binary: true });
await fs.writeFile(new URL('../public/kitchen/models/fridge.glb', import.meta.url), Buffer.from(binary));
console.log(`fridge.glb: ${binary.byteLength} bytes`);
