import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { F, HUE, R, S, SP } from '../../utils/clayTokens';
import type { KitchenFood, KitchenLot, KitchenFridgePlacement } from '../../utils/kitchenDb';
import { fridgePlacementOptions, fridgeDoorParent } from '../../utils/kitchenFridgeSpec';
import { eggVisibleCount, fridgeLayout } from '../../utils/kitchenSceneLayout';

interface Props {
  lots: KitchenLot[];
  foods: KitchenFood[];
  onOpenLot: (id: string) => void;
  busy?: boolean;
  onMoveLot: (id: string, placement: KitchenFridgePlacement) => Promise<void>;
}

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

const KitchenFridgeScene: React.FC<Props> = ({ lots, foods, onOpenLot, onMoveLot, busy }) => {
  const [doorsOpen, setDoorsOpen] = useState({ fridge: false, freezer: false });
  const [drawersOpen, setDrawersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [markers, setMarkers] = useState<{ lotId: string; x: number; y: number }[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const selectionPanel = useRef<HTMLDivElement>(null);
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
  const selected = layout.entries.find(entry => entry.lot.id === selectedId);
  const isOpen = (zone: string) => zone === 'freezer' ? doorsOpen.freezer : doorsOpen.fridge;
  const toggleDoor = (zone: 'fridge' | 'freezer') => setDoorsOpen(value => ({ ...value, [zone]: !value[zone] }));
  useEffect(() => {
    if (selectedId) selectionPanel.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [selectedId]);

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
    let targetAngle = openRef.current.fridge ? -Math.PI * 0.62 : 0;
    let freezerAngle = openRef.current.freezer ? -Math.PI * 0.62 : 0;
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
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentMap = pmrem.fromScene(environment, 0.04);
    scene.environment = environmentMap.texture;
    scene.environmentIntensity = 0.4;
    environment.dispose();
    pmrem.dispose();
    const camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 30);
    camera.position.set(1.5, 2.5, 6);
    camera.lookAt(-0.12, 1.19, 0);
    scene.add(new THREE.HemisphereLight(F.surfaceRaised, HUE.gray.soft, 0.5));
    const light = new THREE.DirectionalLight(F.surfaceRaised, 2.4);
    light.position.set(-2, 7, 3);
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
    // Interior fill is deliberately unshadowed: only the exterior key renders a shadow map.
    for (const y of [1.6, 2.21]) {
      const fill = new THREE.PointLight(F.surfaceRaised, 0.25, 1.4, 2);
      fill.position.set(0, y, 0.2); scene.add(fill);
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
    const loaded: THREE.Object3D[] = [ground];
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
      renderer.render(scene, camera);
      setMarkers(foodSlots.map(slot => {
        const point = slot.object.localToWorld(new THREE.Vector3(0, slot.object.userData.markerHeight, 0)).project(camera);
        return { lotId: slot.id, x: (point.x + 1) * element.clientWidth / 2, y: (1 - point.y) * element.clientHeight / 2 };
      }));
      if ((door && door.rotation.y !== targetAngle) || (freezerDoor && freezerDoor.rotation.y !== freezerAngle)
        || drawers.some(drawer => drawer.position.z !== drawerTarget)) frame = requestAnimationFrame(draw);
    };
    const invalidate = () => {
      if (!disposed && !frame && !failed) frame = requestAnimationFrame(draw);
    };
    controller.current = {
      setOpen: value => { targetAngle = value.fridge ? -Math.PI * 0.62 : 0; freezerAngle = value.freezer ? -Math.PI * 0.62 : 0; invalidate(); },
      setDrawers: value => { drawerTarget = value ? 0.3 : 0; invalidate(); },
    };
    const resize = () => {
      if (disposed) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const halfHeight = Math.max(1.4, 1.4 / aspect);
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
        if (object.userData.lotId && openRef.current[object.userData.zone as 'fridge' | 'freezer']) { setSelectedId(object.userData.lotId); return; }
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
    minHeight: 44, padding: `${SP[1]}px ${SP[2]}px`, borderRadius: R.button,
    background: F.surfaceRaised, color: HUE.green.ink, boxShadow: S.raisedSoft, fontSize: 13,
  };
  return (
    <section aria-label="冰箱可视化" style={{ marginBottom: SP[3], padding: SP[2], borderRadius: R.bigCard, background: F.surfaceSunken }}>
      <div className="flex items-center justify-between" style={{ gap: SP[2] }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>冰箱 · {layout.total} 条库存</span>
        <span style={{ fontSize: 12, color: F.textSecondary }}>点哪扇门，就开哪一层</span>
      </div>
      {(['fridge', 'freezer'] as const).map(value => <button key={value} type="button" disabled={status !== 'ready'}
        className="sr-only focus:not-sr-only" aria-pressed={doorsOpen[value]} style={buttonStyle}
        onClick={() => toggleDoor(value)}>{doorsOpen[value] ? '关闭' : '打开'}{value === 'fridge' ? '冷藏门' : '冷冻门'}</button>)}
      <div className="relative" style={{ height: 420 }}>
        <div ref={host} className="absolute inset-0" />
        {status !== 'ready' && <div role="status" className="absolute inset-0 flex items-center justify-center text-center"
          style={{ padding: SP[3], color: F.textSecondary, fontSize: 13 }}>
          {status === 'loading' ? '正在整理冰箱…' : '冰箱画面暂时打不开，可以继续使用下面的食材列表。切回列表后重试。'}
        </div>}
        {status === 'ready' && layout.entries.map((entry, index) => {
          if (!isOpen(entry.lot.storageZone)) return null;
          const marker = markers.find(item => item.lotId === entry.lot.id);
          if (!marker) return null;
          return <button key={entry.lot.id} type="button"
            aria-label={`选中${entry.name}`}
            onClick={() => setSelectedId(entry.lot.id)}
            className="absolute flex items-center justify-center"
            style={{ left: marker.x - 22, top: marker.y - 22, width: 44, height: 44 }}>
            <span style={{ background: F.surfaceRaised, color: HUE.green.ink, borderRadius: R.pill,
              width: 24, height: 24, lineHeight: '24px', fontSize: 12, boxShadow: S.raisedSoft }}>{index + 1}</span>
          </button>;
        })}
      </div>
      {status === 'ready' && doorsOpen.fridge && <button type="button" aria-pressed={drawersOpen} style={{ ...buttonStyle, marginBottom: SP[2] }}
        onClick={() => setDrawersOpen(value => !value)}>{drawersOpen ? '推回保鲜抽屉' : '拉开保鲜抽屉'}</button>}
      <p style={{ color: F.textSecondary, fontSize: 12, marginBottom: SP[2] }}>
        {layout.total === 0 ? '冰箱里还没有食材，可以先添加冷藏或冷冻库存。' : '点食材可以查看详情或移动；门内置物架随各自的门一起开合。'}
      </p>
      {selected && <div ref={selectionPanel} aria-label="选中食材" style={{ padding: SP[2], marginBottom: SP[2], borderRadius: R.medium, background: F.surfaceSunken, boxShadow: S.sunken }}>
        <strong style={{ fontSize: 14 }}>{selected.name}</strong>
        <button type="button" style={{ ...buttonStyle, marginLeft: SP[2] }} onClick={() => onOpenLot(selected.lot.id)}>查看详情</button>
        {(selected.lot.storageZone === 'fridge' || selected.lot.storageZone === 'freezer') && <>
          <p style={{ fontSize: 12, marginTop: SP[2], marginBottom: SP[1], color: F.textSecondary }}>放到哪里？</p>
          <div className="grid grid-cols-2" style={{ gap: SP[1] }}>
            {fridgePlacementOptions(selected.lot.storageZone).map(option =>
              <button type="button" key={option.value} disabled={busy || selected.placement === option.value}
                className="flex-1 disabled:opacity-40" style={buttonStyle}
                onClick={() => { void onMoveLot(selected.lot.id, option.value); }}>{option.label}</button>)}
          </div>
        </>}
      </div>}
      <div className="grid grid-cols-3" style={{ gap: SP[1] }}>
        {layout.entries.map((entry, index) => <button key={entry.lot.id} type="button" style={buttonStyle}
          className="min-w-0 text-left" onClick={() => { setSelectedId(entry.lot.id); setDoorsOpen(value => ({ ...value, [entry.lot.storageZone]: true })); }}>
          <span className="block truncate">{index + 1}. {entry.name}</span>
          <span style={{ color: F.textSecondary, fontSize: 11 }}>{entry.placement === 'shelf' ? (entry.lot.storageZone === 'freezer' ? '冷冻层板' : '冷藏层板') : `${entry.lot.storageZone === 'freezer' ? '冷冻' : '冷藏'}门${entry.placement === 'door-upper' ? '上层' : entry.placement === 'door-middle' ? '中层' : '下层'}`}</span>
        </button>)}
      </div>
    </section>
  );
};

export default KitchenFridgeScene;
