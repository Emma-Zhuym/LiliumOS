import * as THREE from 'three';
import { F, HUE } from './clayTokens';

// Decorative room only: inventory and the future pantry keep their own objects.
// All meshes are owned by this group so the scene's normal teardown releases them.
export function createKitchenBackdrop() {
  const room = new THREE.Group();
  room.name = 'KitchenBackdrop';
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({
    color: new THREE.Color(HUE.blue.soft).lerp(new THREE.Color(HUE.cyan.soft), 0.3), roughness: 0.95,
  }));
  wall.position.set(0, 5.972, -1.15);
  wall.receiveShadow = true;
  room.add(wall);

  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = woodCanvas.height = 512;
  const context = woodCanvas.getContext('2d');
  let wood: THREE.CanvasTexture | undefined;
  if (context) {
    context.fillStyle = HUE.brown.soft;
    context.fillRect(0, 0, 512, 512);
    // Stable grain and staggered joints; reopening the fridge never changes the floor.
    let seed = 42;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let plank = 0; plank < 4; plank++) {
      context.globalAlpha = 0.12 + random() * 0.22;
      context.fillStyle = HUE.brown.tint;
      context.fillRect(plank * 128, 0, 128, 512);
      context.strokeStyle = HUE.brown.main;
      for (let grain = 0; grain < 70; grain++) {
        const x = plank * 128 + 3 + random() * 122;
        const y = random() * 512;
        context.globalAlpha = 0.06 + random() * 0.18;
        context.lineWidth = 0.4 + random() * 0.8;
        context.beginPath();
        context.moveTo(x, y);
        context.bezierCurveTo(x + 3, y + 25, x - 3, y + 70, x, y + 120);
        context.stroke();
      }
      context.globalAlpha = 0.3;
      context.fillStyle = HUE.brown.ink;
      context.fillRect(plank * 128, 0, 2, 512);
      context.fillRect(plank * 128, [64, 320, 160, 416][plank], 128, 2);
    }
    wood = new THREE.CanvasTexture(woodCanvas);
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(12, 6);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({
    color: wood ? F.surfaceRaised : HUE.brown.soft, map: wood ?? null, roughness: 0.8,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.028, 4.85);
  floor.receiveShadow = true;
  room.add(floor);

  const skirting = new THREE.Mesh(new THREE.BoxGeometry(16, 0.075, 0.025), new THREE.MeshStandardMaterial({
    color: F.surfaceRaised, roughness: 0.7,
  }));
  skirting.position.set(0, 0.0095, -1.13);
  room.add(skirting);
  // Backdrop surfaces must never intercept food, door or drawer clicks.
  room.traverse(object => { if (object instanceof THREE.Mesh) object.raycast = () => {}; });
  return room;
}
