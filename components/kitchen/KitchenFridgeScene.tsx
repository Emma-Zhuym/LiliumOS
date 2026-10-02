import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { F, HUE, R, SP } from '../../utils/clayTokens';
import { KITCHEN_PAPER as PAPER } from '../../utils/kitchenPaperTokens';
import type { KitchenFood, KitchenLot } from '../../utils/kitchenDb';
import { FRIDGE_SHELVES, fridgeDoorParent } from '../../utils/kitchenFridgeSpec';
import { eggVisibleCount, fridgeLayout } from '../../utils/kitchenSceneLayout';
import { createKitchenBackdrop } from '../../utils/kitchenBackdrop';
import { spaceKitchenMarkers } from '../../utils/kitchenSceneMarkers';

interface Props {
  lots: KitchenLot[];
  foods: KitchenFood[];
  onOpenLot: (id: string) => void;
}

const DOOR_OPEN_ANGLE = -THREE.MathUtils.degToRad(112);

function disposeObjects(objects: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const object of objects) object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
  textures.forEach(value => value.dispose());
}

const KitchenFridgeScene: React.FC<Props> = ({ lots, foods, onOpenLot }) => {
  const [doorsOpen, setDoorsOpen] = useState({ fridge: true, freezer: true });
  const [drawersOpen, setDrawersOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [markers, setMarkers] = useState<{ lotId: string; x: number; y: number }[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const onOpenLotRef = useRef(onOpenLot);
  onOpenLotRef.current = onOpenLot;
  const controller = useRef<{ setOpen: (value: typeof doorsOpen) => void; setDrawers: (value: boolean) => void }>();
  const openRef = useRef(doorsOpen);
  const drawersRef = useRef(drawersOpen);
  drawersRef.current = drawersOpen;
  openRef.current = doorsOpen;
  const layout = useMemo(() => {
    const cold = fridgeLayout(lots, foods);
    const frozen = fridgeLayout(lots, foods, 'freezer');
    return { entries: [...frozen.entries, ...cold.entries], total: cold.total + frozen.total };
  }, [lots, foods]);
  const isOpen = (zone: string) => zone === 'freezer' ? doorsOpen.freezer : doorsOpen.fridge;
  const toggleDoor = (zone: 'fridge' | 'freezer') => setDoorsOpen(value => ({ ...value, [zone]: !value[zone] }));

  useEffect(() => { controller.current?.setOpen(doorsOpen); }, [doorsOpen]);
  useEffect(() => { controller.current?.setDrawers(doorsOpen.fridge && drawersOpen); }, [doorsOpen.fridge, drawersOpen]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let failed = false;
    let frame = 0;
    let door: THREE.Object3D | undefined;
    let freezerDoor: THREE.Object3D | undefined;
    let drawers: THREE.Object3D[] = [];
    let drawerTarget = openRef.current.fridge && drawersRef.current ? 0.3 : 0;
    let targetAngle = openRef.current.fridge ? DOOR_OPEN_ANGLE : 0;
    let freezerAngle = openRef.current.freezer ? DOOR_OPEN_ANGLE : 0;
    const foodSlots: { id: string; object: THREE.Group }[] = [];
    let inView = true;
    let renderer: THREE.WebGLRenderer;
    setStatus('loading');
    setMarkers([]);
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus('error');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('aria-hidden', 'true');
    element.appendChild(canvas);
    const scene = new THREE.Scene();
    const backdrop = createKitchenBackdrop();
    scene.add(backdrop);
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentMap = pmrem.fromScene(environment, 0.04);
    scene.environment = environmentMap.texture;
    scene.environmentIntensity = 0.32;
    environment.dispose();
    pmrem.dispose();
    const camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 30);
    camera.position.set(-0.12, 1.65, 6);
    camera.lookAt(-0.12, 1.3, 0);
    scene.add(new THREE.HemisphereLight(F.surfaceRaised, HUE.gray.soft, 0.3));
    const light = new THREE.DirectionalLight(F.surfaceRaised, 2.7);
    light.position.set(-3, 5, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.radius = 4;
    light.shadow.blurSamples = 8;
    light.shadow.camera.left = -2.4; light.shadow.camera.right = 2.4;
    light.shadow.camera.top = 2.6; light.shadow.camera.bottom = -2.6;
    light.shadow.camera.near = 0.1; light.shadow.camera.far = 12;
    light.shadow.normalBias = 0.015; light.shadow.bias = -0.0003;
    light.target.position.set(-0.2, 1.1, 0);
    scene.add(light, light.target);
    const rimLight = new THREE.DirectionalLight(HUE.blue.tint, 0.6);
    rimLight.position.set(3, 3, -1);
    scene.add(rimLight);
    // Interior fill follows each door. Only the exterior key renders a shadow map.
    const interiorLights: THREE.PointLight[] = [];
    for (const y of [1.6, 2.41]) {
      const fill = new THREE.PointLight(F.surfaceRaised, 0, 1.6, 2);
      fill.position.set(0, y, 0.12); scene.add(fill);
      interiorLights.push(fill);
    }
    // Soft contact shading stays inexpensive and anchors items on transparent shelves.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 64;
    const shadowContext = shadowCanvas.getContext('2d')!;
    const gradient = shadowContext.createRadialGradient(32, 32, 4, 32, 32, 32);
    gradient.addColorStop(0, F.textPrimary);
    gradient.addColorStop(1, `${F.textPrimary}00`);
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 64, 64);
    const contactTexture = new THREE.CanvasTexture(shadowCanvas);
    contactTexture.colorSpace = THREE.SRGBColorSpace;
    const contactShadow = (width: number, depth: number, opacity: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({
        map: contactTexture, transparent: true, opacity, depthWrite: false, toneMapped: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.raycast = () => {};
      return mesh;
    };
    const ground = contactShadow(2.7, 1.5, 0.22);
    ground.position.y = -0.012;
    scene.add(ground);
    const loaded: THREE.Object3D[] = [ground, backdrop];
    const raycaster = new THREE.Raycaster();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const draw = () => {
      frame = 0;
      if (disposed || failed || !inView || document.hidden) return;
      if (door && !(targetAngle === 0 && drawers.some(drawer => drawer.position.z > 0.002))) {
        const difference = targetAngle - door.rotation.y;
        door.rotation.y = reducedMotion.matches || Math.abs(difference) < 0.002
          ? targetAngle : door.rotation.y + difference * 0.16;
      }
      if (freezerDoor) {
        const delta = freezerAngle - freezerDoor.rotation.y;
        freezerDoor.rotation.y = reducedMotion.matches || Math.abs(delta) < 0.002 ? freezerAngle : freezerDoor.rotation.y + delta * 0.16;
      }
      for (const drawer of drawers) {
        const delta = drawerTarget - drawer.position.z;
        drawer.position.z = reducedMotion.matches || Math.abs(delta) < 0.002 ? drawerTarget : drawer.position.z + delta * 0.16;
      }
      interiorLights.forEach((fill, index) => {
        const angle = (index === 0 ? door : freezerDoor)?.rotation.y ?? 0;
        fill.intensity = (index === 0 ? 0.38 : 0.18) * Math.min(1, Math.abs(angle) / 0.5);
      });
      renderer.render(scene, camera);
      setMarkers(spaceKitchenMarkers(foodSlots.filter(slot => openRef.current[slot.object.userData.zone as 'fridge' | 'freezer']).map(slot => {
        const point = slot.object.localToWorld(new THREE.Vector3(0, slot.object.userData.markerHeight, 0)).project(camera);
        return { lotId: slot.id, x: (point.x + 1) * element.clientWidth / 2, y: (1 - point.y) * element.clientHeight / 2 };
      }), element.clientWidth, element.clientHeight));
      if ((door && door.rotation.y !== targetAngle) || (freezerDoor && freezerDoor.rotation.y !== freezerAngle)
        || drawers.some(drawer => drawer.position.z !== drawerTarget)) frame = requestAnimationFrame(draw);
    };
    const invalidate = () => {
      if (!disposed && !frame && !failed) frame = requestAnimationFrame(draw);
    };
    controller.current = {
      setOpen: value => { targetAngle = value.fridge ? DOOR_OPEN_ANGLE : 0; freezerAngle = value.freezer ? DOOR_OPEN_ANGLE : 0; invalidate(); },
      setDrawers: value => { drawerTarget = value ? 0.3 : 0; invalidate(); },
    };
    const resize = () => {
      if (disposed) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const halfHeight = Math.max(1.4, 1.2 / aspect);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      invalidate();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);
    const visibilityObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; invalidate(); });
    visibilityObserver.observe(element);
    document.addEventListener('visibilitychange', invalidate);
    const contextLost = (event: Event) => {
      event.preventDefault();
      failed = true;
      cancelAnimationFrame(frame);
      setStatus('error');
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    let pointerStart: { x: number; y: number } | null = null;
    const pointerDown = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) return;
      pointerStart = null;
      const bounds = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1,
        -(event.clientY - bounds.top) / bounds.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects(scene.children, true)[0];
      if (!hit) return;
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (object.userData.lotId && openRef.current[object.userData.zone as 'fridge' | 'freezer']) { onOpenLotRef.current(object.userData.lotId); return; }
        if (object.name === 'DoorPivot') { toggleDoor('fridge'); return; }
        if (object.name === 'FreezerDoorPivot') { toggleDoor('freezer'); return; }
        if (object.name.startsWith('Crisper') && openRef.current.fridge) { setDrawersOpen(value => !value); return; }
        object = object.parent;
      }
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointerup', pointerUp);
    const loader = new GLTFLoader();
    const load = async (name: string) => {
      const result = await loader.loadAsync(`${import.meta.env.BASE_URL}kitchen/models/${name}.glb`);
      if (disposed) { disposeObjects([result.scene]); return null; }
      loaded.push(result.scene);
      return result.scene;
    };
    const build = async () => {
      const results = await Promise.allSettled([load('fridge'), ...layout.entries.map(entry => load(entry.model))]);
      if (disposed) return;
      const fridgeResult = results[0];
      if (fridgeResult.status !== 'fulfilled' || !fridgeResult.value) throw new Error('Fridge unavailable');
      const fridge = fridgeResult.value;
      door = fridge.getObjectByName('DoorPivot');
      freezerDoor = fridge.getObjectByName('FreezerDoorPivot');
      if (!door || !freezerDoor) throw new Error('Door unavailable');
      drawers = ['CrisperLeft', 'CrisperRight'].map(name => fridge.getObjectByName(name)).filter((object): object is THREE.Object3D => !!object);
      drawers.forEach(drawer => { drawer.position.z = drawerTarget; });
      door.rotation.y = targetAngle;
      freezerDoor.rotation.y = freezerAngle;
      fridge.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        node.castShadow = !material.transparent;
        // Thin internal mouldings self-shadow noisily at mobile shadow-map resolution.
        node.receiveShadow = !material.transparent && ['Sculpted enamel door', 'Rounded side', 'Crown'].includes(node.name);
      });
      // Broad, feathered contact masks on the liner imply recess depth without
      // shadow-map acne on thin mouldings. They never participate in picking.
      const linerShade = (width: number, height: number, opacity: number,
        position: [number, number, number], rotationY = 0) => {
        const shade = contactShadow(width, height, opacity);
        shade.rotation.set(0, rotationY, 0);
        shade.position.set(...position);
        fridge.add(shade);
      };
      for (const [bottom, top] of [[0.18, 1.68], [1.79, 2.45]]) {
        const center = (bottom + top) / 2;
        for (const side of [-1, 1]) {
          linerShade(0.2, top - bottom, 0.26, [side * 0.46, center, -0.338]);
          linerShade(0.3, top - bottom, 0.2, [side * 0.546, center, -0.22], -side * Math.PI / 2);
        }
        linerShade(1.06, 0.16, 0.28, [0, top - 0.06, -0.338]);
      }
      for (const top of [...FRIDGE_SHELVES.fridge, ...FRIDGE_SHELVES.freezer]) {
        linerShade(1.05, 0.12, 0.26, [0, top - 0.045, -0.338]);
      }
      for (const drawer of drawers) {
        const shade = contactShadow(0.56, 0.46, 0.32);
        shade.position.set(0, -0.008, -0.14);
        drawer.add(shade);
      }
      scene.add(fridge);
      layout.entries.forEach((entry, index) => {
        const result = results[index + 1];
        let object: THREE.Object3D;
        if (result.status === 'fulfilled' && result.value) {
          object = result.value;
          const bounds = new THREE.Box3().setFromObject(object);
          const size = bounds.getSize(new THREE.Vector3());
          const scale = entry.model === 'egg-carton' ? Math.min(1, entry.maxHeight / size.y) : Math.min(0.27 / size.x, entry.maxHeight / size.y, (entry.placement === 'shelf' ? 0.3 : 0.24) / size.z);
          if (entry.model === 'egg-carton') object.traverse(node => {
            if (/^Egg-\d+$/.test(node.name)) node.visible = Number(node.name.slice(4)) < eggVisibleCount(entry.lot);
          });
          object.scale.multiplyScalar(scale);
          const center = bounds.getCenter(new THREE.Vector3());
          object.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
        } else {
          // A missing decorative model must not hide real inventory.
          object = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.23, 0.2), new THREE.MeshStandardMaterial({ color: HUE.green.soft }));
          object.position.y = 0.115;
          loaded.push(object);
        }
        const slot = new THREE.Group();
        slot.userData.lotId = entry.lot.id;
        slot.userData.zone = entry.lot.storageZone;
        slot.position.set(...entry.position);
        slot.userData.markerHeight = new THREE.Box3().setFromObject(object).max.y + 0.045;
        object.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
        slot.scale.setScalar(entry.scale);
        slot.add(object);
        const footprint = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
        const contact = contactShadow(footprint.x * 1.12, footprint.z * 1.12, 0.2);
        contact.position.y = 0.002;
        slot.add(contact); loaded.push(contact);
        if (entry.placement !== 'shelf') fridge.getObjectByName(fridgeDoorParent(entry.lot.storageZone as 'fridge' | 'freezer'))!.add(slot);
        else scene.add(slot);
        foodSlots.push({ id: entry.lot.id, object: slot });
      });
      setStatus('ready');
      resize();
    };
    void build().catch(() => { if (!disposed) { failed = true; setStatus('error'); } });
    resize();
    return () => {
      disposed = true;
      controller.current = undefined;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', invalidate);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
      disposeObjects(loaded);
      light.shadow.map?.dispose();
      light.shadow.mapPass?.dispose();
      environmentMap.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [layout]);

  const buttonStyle: React.CSSProperties = {
    minHeight: 44,
    padding: `${SP[1]}px ${SP[2]}px`,
    borderRadius: R.button,
    color: PAPER.blueInk,
    fontSize: 12,
    fontWeight: 500,
  };
  return (
    <section className="kitchen-scene" aria-label="冰箱可视化">
      <div className="relative" style={{ aspectRatio: '1 / 1.18', maxHeight: 420,
        overflow: 'hidden', background: HUE.blue.tint }}>
        <div ref={host} className="absolute inset-0" />
        {status !== 'ready' && <div role="status" className="absolute inset-0 flex items-center justify-center text-center"
          style={{ padding: SP[3], color: PAPER.muted, fontSize: 13 }}>
          {status === 'loading' ? '正在整理冰箱…' : '冰箱画面暂时打不开，请从「食材清单」继续记录。'}
        </div>}
        {status === 'ready' && layout.entries.map((entry, index) => {
          if (!isOpen(entry.lot.storageZone)) return null;
          const marker = markers.find(item => item.lotId === entry.lot.id);
          if (!marker) return null;
          return <button key={entry.lot.id} type="button"
            aria-label={`查看${entry.name}`}
            onClick={() => onOpenLot(entry.lot.id)}
            className="absolute flex items-center justify-center"
            style={{ left: marker.x - 22, top: marker.y - 22, width: 44, height: 44 }}>
            <span style={{ background: PAPER.surface, color: PAPER.blueInk, borderRadius: R.pill,
              border: `1px solid ${PAPER.line}`, width: 24, height: 24, lineHeight: '22px', fontSize: 12 }}>{index + 1}</span>
          </button>;
        })}
      </div>
      <div className="flex items-center justify-center flex-wrap" style={{ gap: SP[1], padding: `${SP[1]}px ${SP[2]}px` }}>
        {(['freezer', 'fridge'] as const).map(value => <button key={value} type="button"
          disabled={status !== 'ready'} aria-pressed={doorsOpen[value]}
          className="disabled:opacity-40" style={buttonStyle}
          onClick={() => toggleDoor(value)}>
          {doorsOpen[value] ? '关上' : '打开'}{value === 'fridge' ? '冷藏门' : '冷冻门'}
        </button>)}
        <button type="button" disabled={status !== 'ready' || !doorsOpen.fridge}
          aria-pressed={doorsOpen.fridge && drawersOpen} className="disabled:opacity-40" style={buttonStyle}
          onClick={() => setDrawersOpen(value => !value)}>
          {drawersOpen ? '推回抽屉' : '拉开抽屉'}
        </button>
      </div>
      <p style={{ color: PAPER.muted, fontSize: 12, textAlign: 'center', padding: `0 ${SP[3]}px ${SP[3]}px` }}>
        {layout.total === 0 ? '冰箱还空着，把新买的食物放进来吧。' : '点食材，记下还剩多少 · 也可以打开食材清单'}
      </p>
    </section>
  );
};

export default KitchenFridgeScene;
