import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight, Box3, DirectionalLight, Group, LoadingManager, Material, Mesh,
  PerspectiveCamera, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CharacterModelBridge } from '../types/character-models';
import './character-model.css';

export interface CharacterModelProps {
  modelId: string;
  size: number;
  label: string;
  onError?: (message: string) => void;
}

function disposeModels(models: Group[]) {
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const images = new Set<ImageBitmap>();
  for (const model of models) model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) images.add(texture.source.data);
    texture.dispose();
  }
  for (const image of images) image.close();
}

function verifyLoadedModel(model: Group) {
  let triangles = 0;
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof Texture && value.source.data) {
        const image = value.source.data as { width?: number; height?: number };
        if ((image.width || 0) > 2048 || (image.height || 0) > 2048) throw new Error('GLB 텍스처는 2048px 이하여야 합니다.');
      }
    }
  });
  if (!triangles || triangles > 20_000) throw new Error('GLB 삼각형은 20,000개 이하여야 합니다.');
  const bounds = new Box3().setFromObject(model);
  const dimensions = bounds.getSize(new Vector3());
  const extent = Math.max(dimensions.x, dimensions.y, dimensions.z);
  if (!Number.isFinite(extent) || extent <= 0) throw new Error('3D 모델의 크기 정보가 올바르지 않습니다.');
  model.position.sub(bounds.getCenter(new Vector3()));
  const normalized = new Group();
  normalized.add(model);
  normalized.scale.setScalar(1.7 / extent);
  return normalized;
}

export default function CharacterModel({ modelId, size, label, onError }: CharacterModelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const errorRef = useRef(onError);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => { errorRef.current = onError; }, [onError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let disposed = false;
    let failed = false;
    let inView = true;
    let windowVisible = true;
    let frame = 0;
    let renderCount = 0;
    let renderer: WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let scene: Scene | undefined;
    let camera: PerspectiveCamera | undefined;
    let normalized: Group | undefined;
    let models: Group[] = [];
    setStatus('loading');
    canvas.dataset.renderCount = '0';
    canvas.dataset.windowVisible = 'true';

    const fail = (message: string) => {
      if (disposed || failed) return;
      failed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      releaseResources();
      setStatus('error');
      errorRef.current?.(message);
    };
    const requestRender = () => {
      if (disposed || failed || frame || !normalized || !inView || !windowVisible || document.hidden) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposed || failed || document.hidden || !windowVisible || !inView || !renderer || !scene || !camera) return;
        try {
          renderer.render(scene, camera);
          canvas.dataset.renderCount = String(++renderCount);
        } catch { fail('3D 표시를 시작하지 못했습니다. 2D 캐릭터로 표시합니다.'); }
      });
    };
    function releaseResources() {
      controls?.removeEventListener('change', requestRender);
      controls?.dispose();
      controls = undefined;
      disposeModels(models);
      models = [];
      normalized = undefined;
      scene?.clear();
      scene = undefined;
      camera = undefined;
      renderer?.renderLists.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = undefined;
    }
    const onVisibility = () => {
      canvas.dataset.windowVisible = String(windowVisible);
      if ((document.hidden || !windowVisible) && frame) { cancelAnimationFrame(frame); frame = 0; }
      if (controls) controls.enabled = !document.hidden && windowVisible && inView;
      requestRender();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      fail('그래픽 장치에서 3D 표시를 중단했습니다. 2D 캐릭터로 표시합니다.');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!normalized || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      normalized.rotation.y += event.key === 'ArrowLeft' ? -0.15 : event.key === 'ArrowRight' ? 0.15 : 0;
      normalized.rotation.x += event.key === 'ArrowUp' ? -0.15 : event.key === 'ArrowDown' ? 0.15 : 0;
      requestRender();
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (controls) controls.enabled = inView && windowVisible && !document.hidden;
      if (!inView && frame) { cancelAnimationFrame(frame); frame = 0; }
      requestRender();
    });
    observer.observe(host);
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = window.dotdock?.onCommand((command) => {
      if (command.type !== 'window-visibility') return;
      windowVisible = command.payload === true;
      onVisibility();
    });
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('keydown', onKeyDown);

    void (async () => {
      try {
        const bridge = window.dotdock as (typeof window.dotdock & Partial<CharacterModelBridge>);
        if (!bridge?.getCharacterModel) throw new Error('데스크톱 앱에서 3D 모델을 표시할 수 있습니다.');
        const result = await bridge.getCharacterModel(modelId);
        if (disposed) return;
        if (!result.ok || !result.base64) throw new Error(result.message || '저장된 3D 모델이 없습니다.');
        if (result.base64.length > 14_000_000) throw new Error('3D 모델은 10MB 이하여야 합니다.');
        const raw = atob(result.base64);
        if (raw.length > 10 * 1024 * 1024) throw new Error('3D 모델은 10MB 이하여야 합니다.');
        const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
        const manager = new LoadingManager();
        manager.setURLModifier((url) => {
          if (!url.startsWith('blob:')) throw new Error('내장 텍스처가 포함된 GLB만 지원합니다.');
          return url;
        });
        const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, '');
        models = gltf.scenes;
        if (disposed) { disposeModels(models); return; }
        normalized = verifyLoadedModel(gltf.scene);
        // The bundled Tripo models face +X; glTF viewers look from +Z.
        if (modelId.startsWith('zodiac:')) normalized.rotation.y = -Math.PI / 2;
        renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(size, size, false);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = SRGBColorSpace;
        scene = new Scene();
        scene.add(normalized, new AmbientLight(0xffffff, 2));
        const keyLight = new DirectionalLight(0xffffff, 3);
        keyLight.position.set(3, 4, 5);
        scene.add(keyLight);
        camera = new PerspectiveCamera(35, 1, 0.05, 100);
        camera.position.set(0, 0.15, 3.5);
        controls = new OrbitControls(camera, canvas);
        controls.enablePan = false;
        controls.enableZoom = false;
        controls.enableDamping = false;
        controls.autoRotate = false;
        controls.minPolarAngle = 0.15;
        controls.maxPolarAngle = Math.PI - 0.15;
        controls.enabled = inView && windowVisible && !document.hidden;
        controls.addEventListener('change', requestRender);
        controls.update();
        setStatus('ready');
        requestRender();
      } catch (error) {
        fail(error instanceof Error && /GLB|3D|텍스처|모델|내장|데스크톱/.test(error.message)
          ? error.message : '3D 모델을 표시하지 못했습니다. 다른 GLB 파일을 선택해 주세요.');
      }
    })();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe?.();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('keydown', onKeyDown);
      releaseResources();
    };
  }, [modelId, size]);

  return (
    <div ref={hostRef} className="character-model" style={{ width: size, height: size }}
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
      title="드래그 또는 방향키로 캐릭터 회전">
      <canvas ref={canvasRef} className="character-model-canvas" role="img" tabIndex={0}
        aria-label={`${label} 3D 캐릭터 — 드래그 또는 방향키로 회전`}
        aria-busy={status === 'loading'} onContextMenu={(event) => event.preventDefault()} />
      {status !== 'ready' && <span className="character-model-status" role="status">
        {status === 'loading' ? '불러오는 중…' : '3D 표시 불가'}
      </span>}
    </div>
  );
}
