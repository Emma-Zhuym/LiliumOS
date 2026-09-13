import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { F, HUE, R, S, SP } from '../../utils/clayTokens';
import type { KitchenFood, KitchenLot } from '../../utils/kitchenDb';
import { fridgePage } from '../../utils/kitchenSceneLayout';

interface Props {
  lots: KitchenLot[];
  foods: KitchenFood[];
  onOpenLot: (id: string) => void;
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

const KitchenFridgeScene: React.FC<Props> = ({ lots, foods, onOpenLot }) => {
  const [requestedPage, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [drawersOpen, setDrawersOpen] = useState(false);
  const [zone, setZone] = useState<'fridge' | 'freezer'>('fridge');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [markers, setMarkers] = useState<{ lotId: string; x: number; y: number }[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<{ setOpen: (value: boolean) => void; setDrawers: (value: boolean) => void }>();
  const openRef = useRef(open);
  const drawersRef = useRef(drawersOpen);
  drawersRef.current = drawersOpen;
  const onOpenRef = useRef(onOpenLot);
  onOpenRef.current = onOpenLot;
  openRef.current = open;
  const page = useMemo(() => fridgePage(lots, foods, requestedPage, zone), [lots, foods, requestedPage, zone]);

  useEffect(() => { controller.current?.setOpen(open); }, [open]);
  useEffect(() => { controller.current?.setDrawers(open && drawersOpen); }, [open, drawersOpen]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let failed = false;
    let frame = 0;
    let door: THREE.Object3D | undefined;
    let freezerDoor: THREE.Object3D | undefined;
    let drawers: THREE.Object3D[] = [];
    let drawerTarget = openRef.current && drawersRef.current ? 0.3 : 0;
    let targetAngle = openRef.current ? -Math.PI * 0.62 : 0;
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
    renderer.toneMappingExposure = 1.1;
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
    scene.environmentIntensity = 0.65;
    environment.dispose();
    pmrem.dispose();
    const camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 30);
    camera.position.set(2.1, 2.65, 6);
    camera.lookAt(-0.12, 1.19, 0);
    scene.add(new THREE.HemisphereLight(F.surfaceRaised, F.borderStrong, 1.2));
    const light = new THREE.DirectionalLight(F.surfaceRaised, 2);
    light.position.set(-3, 5, 4);
    scene.add(light);
    const loaded: THREE.Object3D[] = [];
    const raycaster = new THREE.Raycaster();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const draw = () => {
      frame = 0;
      if (disposed || failed || !inView || document.hidden) return;
      if (door && !(targetAngle === 0 && drawers.some(drawer => drawer.position.z > 0.002))) {
        const difference = targetAngle - door.rotation.y;
        door.rotation.y = reducedMotion.matches || Math.abs(difference) < 0.002
          ? targetAngle : door.rotation.y + difference * 0.16;
        if (freezerDoor) freezerDoor.rotation.y = door.rotation.y;
      }
      for (const drawer of drawers) {
        const delta = drawerTarget - drawer.position.z;
        drawer.position.z = reducedMotion.matches || Math.abs(delta) < 0.002 ? drawerTarget : drawer.position.z + delta * 0.16;
      }
      renderer.render(scene, camera);
      if ((door && door.rotation.y !== targetAngle) || drawers.some(drawer => drawer.position.z !== drawerTarget)) frame = requestAnimationFrame(draw);
    };
    const invalidate = () => {
      if (!disposed && !frame && !failed) frame = requestAnimationFrame(draw);
    };
    controller.current = {
      setOpen: value => { targetAngle = value ? -Math.PI * 0.62 : 0; invalidate(); },
      setDrawers: value => { drawerTarget = value ? 0.3 : 0; invalidate(); },
    };
    const resize = () => {
      if (disposed) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const halfHeight = 1.4 / (width / height);
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      setMarkers(page.entries.map(entry => {
        const point = new THREE.Vector3(...entry.position);
        point.y += 0.29;
        point.project(camera);
        return { lotId: entry.lot.id, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
      }));
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
        if (object.userData.lotId && openRef.current) { onOpenRef.current(object.userData.lotId); return; }
        if (object.name === 'DoorPivot' || object.name === 'FreezerDoorPivot') { setOpen(value => !value); return; }
        if (object.name.startsWith('Crisper') && openRef.current) { setDrawersOpen(value => !value); return; }
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
      const results = await Promise.allSettled([load('fridge'), ...page.entries.map(entry => load(entry.model))]);
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
      freezerDoor.rotation.y = targetAngle;
      scene.add(fridge);
      page.entries.forEach((entry, index) => {
        const result = results[index + 1];
        let object: THREE.Object3D;
        if (result.status === 'fulfilled' && result.value) {
          object = result.value;
          const bounds = new THREE.Box3().setFromObject(object);
          const size = bounds.getSize(new THREE.Vector3());
          const scale = Math.min(0.27 / size.x, 0.31 / size.y, 0.3 / size.z);
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
        slot.position.set(...entry.position);
        slot.add(object);
        scene.add(slot);
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
      environmentMap.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [page]);

  const buttonStyle: React.CSSProperties = {
    minHeight: 44, padding: `${SP[1]}px ${SP[2]}px`, borderRadius: R.button,
    background: F.surfaceRaised, color: HUE.green.ink, boxShadow: S.raisedSoft, fontSize: 13,
  };
  return (
    <section aria-label="冰箱可视化" style={{ marginBottom: SP[3], padding: SP[2], borderRadius: R.bigCard, background: HUE.green.tint }}>
      <div className="flex items-center justify-between" style={{ gap: SP[2] }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{zone === 'fridge' ? '冷藏室' : '冷冻室'} · {page.total} 条库存</span>
        <button type="button" style={buttonStyle} disabled={status !== 'ready'} aria-pressed={open}
          onClick={() => setOpen(value => !value)}>{open ? '关上冰箱' : '打开冰箱'}</button>
      </div>
      <div role="group" aria-label="冰箱分区" className="flex" style={{ gap: SP[0], padding: SP[0], marginTop: SP[2], borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}>
        {(['fridge', 'freezer'] as const).map(value => <button key={value} type="button" aria-pressed={zone === value}
          onClick={() => { setZone(value); setPage(0); }} className="flex-1" style={{ minHeight: 44, fontSize: 13, borderRadius: R.medium,
            background: zone === value ? F.surfaceRaised : 'transparent', color: zone === value ? HUE.green.ink : F.textSecondary,
            boxShadow: zone === value ? S.raisedSoft : undefined }}>{value === 'fridge' ? '下层冷藏' : '上层冷冻'}</button>)}
      </div>
      <div className="relative" style={{ height: 420 }}>
        <div ref={host} className="absolute inset-0" />
        {status !== 'ready' && <div role="status" className="absolute inset-0 flex items-center justify-center text-center"
          style={{ padding: SP[3], color: F.textSecondary, fontSize: 13 }}>
          {status === 'loading' ? '正在整理冰箱…' : '冰箱画面暂时打不开，可以继续使用下面的食材列表。切回列表后重试。'}
        </div>}
        {status === 'ready' && open && page.entries.map((entry, index) => {
          const marker = markers.find(item => item.lotId === entry.lot.id);
          if (!marker) return null;
          return <button key={entry.lot.id} type="button"
            aria-label={`查看${entry.name}详情`}
            onClick={() => onOpenLot(entry.lot.id)}
            className="absolute flex items-center justify-center"
            style={{ left: marker.x - 22, top: marker.y - 22, width: 44, height: 44 }}>
            <span style={{ background: F.surfaceRaised, color: HUE.green.ink, borderRadius: R.pill,
              width: 24, height: 24, lineHeight: '24px', fontSize: 12, boxShadow: S.raisedSoft }}>{index + 1}</span>
          </button>;
        })}
      </div>
      {status === 'ready' && open && <button type="button" aria-pressed={drawersOpen} style={{ ...buttonStyle, marginBottom: SP[2] }}
        onClick={() => setDrawersOpen(value => !value)}>{drawersOpen ? '推回保鲜抽屉' : '拉开保鲜抽屉'}</button>}
      <p style={{ color: F.textSecondary, fontSize: 12, marginBottom: SP[2] }}>
        {page.total === 0 ? `这个分区还没有食材，在添加或详情里把收纳位置设为${zone === 'fridge' ? '冷藏' : '冷冻'}。` : '只展示所选分区；每个模型代表一条库存，点食材查看详情。'}
      </p>
      <div className="grid grid-cols-3" style={{ gap: SP[1] }}>
        {page.entries.map((entry, index) => <button key={entry.lot.id} type="button" style={buttonStyle}
          className="min-w-0 text-left" onClick={() => onOpenLot(entry.lot.id)}>
          <span className="block truncate">{index + 1}. {entry.name}</span>
          <span style={{ color: F.textSecondary, fontSize: 11 }}>查看余量与资料</span>
        </button>)}
      </div>
      {page.pageCount > 1 && <div className="flex items-center justify-between" style={{ marginTop: SP[2] }}>
        <button type="button" disabled={page.page === 0} className="disabled:opacity-40" style={buttonStyle}
          onClick={() => setPage(page.page - 1)}>上一组</button>
        <span style={{ fontSize: 12 }}>{page.page + 1} / {page.pageCount}</span>
        <button type="button" disabled={page.page + 1 === page.pageCount} className="disabled:opacity-40" style={buttonStyle}
          onClick={() => setPage(page.page + 1)}>下一组</button>
      </div>}
    </section>
  );
};

export default KitchenFridgeScene;
