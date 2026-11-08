import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type Rect, resolve } from "./collision";
import type { PanelId, SceneConfig, Target } from "./world-contract";
import { tuning } from "./world-tuning";

export type WorldMode = "loading" | "fixed" | "walk" | "moving" | "seated" | "panel";
export type WorldPrompt = { id: string; label: string; key?: string };
export type WorldEvents = {
  onReady(): void;
  onError(message: string): void;
  onPrompts(prompts: WorldPrompt[], mode: WorldMode): void;
  onPose(x: number, z: number, forwardX: number, forwardZ: number): void;
  onPanel(panel: PanelId): void;
  onPhone(): void;
  onDoor(id: string, open: boolean): void;
  onLock(locked: boolean): void;
};

type Door = { id: string; pivot: THREE.Object3D; closed: number; open: number; t: number; goal: number; rect: Rect };
type Pose = { x: number; y: number; z: number; yaw: number; pitch: number };
type Tween = { from: Pose; to: Pose; start: number; ms: number; done?: () => void };
type Seat = { target: Target; stand: Pose };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number) => t * t * (3 - 2 * t);

export class WorldEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.05, 80);
  rects: Rect[] = [];
  readonly doors = new Map<string, Door>();
  mode: WorldMode = "loading";
  x = 0; z = 0; y: number = tuning.eyeHeight; yaw = 0; pitch = 0;
  frameTimes: number[] = [];
  private lookYaw = 0; private lookPitch = 0; private vx = 0; private vz = 0;
  private raf = 0; private last = 0; private disposed = false;
  private keys = new Set<string>();
  private tween?: Tween; private seat?: Seat;
  private sun?: THREE.DirectionalLight;
  private phoneMat?: THREE.MeshStandardMaterial;
  private ringing = false; private walkAllowed = false; private enabledIds = new Set<string>();
  private picks: { target: Target; object: THREE.Object3D }[] = [];
  private promptKey = ""; private poseAt = 0;
  private drag?: { x: number; y: number; moved: boolean };
  private ray = new THREE.Raycaster();
  private observer: ResizeObserver;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private canvas: HTMLCanvasElement, readonly config: SceneConfig, private events: WorldEvents) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = config.exposure;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    canvas.addEventListener("keydown", this.keyDown);
    canvas.addEventListener("keyup", this.keyUp);
    canvas.addEventListener("blur", this.clearInput);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    document.addEventListener("pointerlockchange", this.lockChange);
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("blur", this.releaseInput);
    this.load();
  }

  private load() {
    new GLTFLoader().load(this.config.url, gltf => {
      if (this.disposed) return;
      this.build(gltf.scene);
      this.events.onReady();
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }, undefined, () => this.events.onError("The 3D scene could not be loaded."));
  }

  private build(root: THREE.Object3D) {
    this.scene.add(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (object.name.startsWith("COLLIDER_")) {
        object.visible = false;
        box.setFromObject(object);
        this.rects.push({ name: object.name, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
        return;
      }
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      for (const map of [material.map, material.emissiveMap]) if (map) map.anisotropy = anisotropy;
      if (material.transparent) {
        material.depthWrite = false;
        mesh.renderOrder = object.name.startsWith("Decal_") ? 1 : 2;
      } else {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      // Screens and signs show UI colours. Tone mapping would grey them.
      if (/Screen|Sign|Placard|Clock_0204|Brand|Totem/.test(material.name) && material.emissiveMap) material.toneMapped = false;
      if (material.name === "Custom_Phone_Screen_Dana_Mat") this.phoneMat = material;
    });

    for (const light of this.config.lights) {
      if (light.type === "point") {
        const point = new THREE.PointLight(light.color, light.intensity, light.distance, 2);
        point.position.set(...light.position);
        this.scene.add(point);
      } else {
        const sun = new THREE.DirectionalLight(light.color, light.intensity);
        sun.position.set(light.from[0] * 22, light.from[1] * 22, light.from[2] * 22 + 4);
        sun.target.position.set(0, 0, 4);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
        sun.shadow.bias = -0.0006;
        sun.shadow.autoUpdate = false;
        sun.shadow.needsUpdate = true;
        this.scene.add(sun, sun.target);
        this.sun = sun;
      }
    }
    const { sky, ground, intensity } = this.config.ambient;
    this.scene.add(new THREE.HemisphereLight(sky, ground, intensity));
    this.scene.background = new THREE.Color(this.config.id === "office" ? "#bcd6ef" : "#05070b");

    for (const door of this.config.doors) {
      const pivot = root.getObjectByName(door.pivot);
      const leaf = root.getObjectByName(door.leaf);
      if (!pivot || !leaf) throw new Error(`Missing door nodes for ${door.id}`);
      const extras = pivot.userData as { closed_rot_z_deg: number; open_rot_z_deg: number };
      const closed = THREE.MathUtils.degToRad(extras.closed_rot_z_deg);
      const open = THREE.MathUtils.degToRad(extras.open_rot_z_deg);
      pivot.rotation.set(0, closed, 0);
      pivot.updateMatrixWorld(true);
      box.setFromObject(leaf);
      this.doors.set(door.id, { id: door.id, pivot, closed, open, t: 0, goal: 0,
        rect: { name: `DOOR_${door.id}`, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z } });
    }

    for (const target of this.config.targets) {
      const names = target.id === "phone" ? ["Custom_Phone_Screen_Dana", "Custom_Phone_Screen_Dana_Bezel"]
        : target.id === "computer" ? ["Custom_Monitor_Display_Surface", "Custom_Monitor_Display_Surface_Bezel"]
        : target.id === "dana" ? ["Avatar_Placeholder_Dana"] : [];
      for (const name of names) {
        const object = root.getObjectByName(name);
        if (object) this.picks.push({ target, object });
      }
    }

    const spawn = this.world(this.config.spawn);
    this.x = spawn.x; this.z = spawn.z; this.y = tuning.eyeHeight;
    const dir = new THREE.Vector3(...this.config.look).sub(new THREE.Vector3(spawn.x, tuning.eyeHeight, spawn.z)).normalize();
    this.lookYaw = this.yaw = Math.atan2(-dir.x, -dir.z);
    this.lookPitch = this.pitch = Math.asin(dir.y);
    this.mode = this.walkAllowed ? "walk" : "fixed";
    this.apply();
    this.refreshPrompts(true);
    this.emitPose(true);
  }

  // ---- App state -------------------------------------------------------------------------------------
  /** Which targets are usable now, and whether the player may walk. Driven by the 2D incident stage. */
  setAvailability(ids: string[], walk: boolean, ringing: boolean) {
    this.enabledIds = new Set(ids);
    this.walkAllowed = walk;
    this.ringing = ringing && !this.reduced.matches;
    if (this.phoneMat && !this.ringing) this.phoneMat.emissiveIntensity = 1;
    if (this.mode === "fixed" && walk) {
      this.mode = "walk";
      this.canvas.focus({ preventScroll: true });
    }
    if (this.mode === "walk" && !walk) this.mode = "fixed";
    this.refreshPrompts(true);
  }

  setPanelOpen(open: boolean) {
    if (open) {
      this.releaseInput();
      if (this.mode === "seated" || this.mode === "walk" || this.mode === "fixed") this.mode = "panel";
    } else if (this.mode === "panel") {
      this.mode = this.seat ? "seated" : this.walkAllowed ? "walk" : "fixed";
      this.canvas.focus({ preventScroll: true });
    }
    this.refreshPrompts(true);
  }

  activate(id: string) {
    const target = this.config.targets.find(item => item.id === id);
    if (!target || !this.enabledIds.has(id) || this.tween) return;
    if (target.kind === "phone") this.events.onPhone();
    else if (target.kind === "door") this.toggleDoors(target.doors ?? []);
    else if (target.kind === "panel" && target.panel) this.events.onPanel(target.panel);
    else if (target.kind === "seat" && (this.mode === "walk")) this.sit(target);
  }

  /** Keyboard, touch and assistive route to a target. Moves without walking and opens doors on the way. */
  goTo(id: string) {
    const target = this.config.targets.find(item => item.id === id);
    if (!target || !this.enabledIds.has(id) || this.tween || (this.mode !== "walk" && this.mode !== "seated")) return;
    if (this.seat) { this.stand(() => this.goTo(id)); return; }
    for (const door of target.via ?? []) this.setDoor(door, true);
    const ground = target.stand ? { x: target.stand[0], z: target.stand[1] } : this.groundPoint(target);
    const look = this.facing(ground.x, ground.z, target);
    this.tweenTo({ x: ground.x, y: tuning.eyeHeight, z: ground.z, yaw: look.yaw, pitch: look.pitch }, 450, () => this.activate(id));
  }

  standUp() { if (this.mode === "seated") this.stand(); }
  reopenPanel() { if (this.mode === "seated" && this.seat?.target.panel) this.events.onPanel(this.seat.target.panel); }

  requestLock() {
    if (this.mode !== "walk" || document.pointerLockElement === this.canvas) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch?.(() => undefined);
    } catch {
      // Drag-to-look stays available when pointer lock is refused.
    }
  }

  // ---- Seats and doors -------------------------------------------------------------------------------
  world(name: string) {
    const node = this.scene.getObjectByName(name);
    if (!node) throw new Error(`Missing scene node ${name}`);
    return node.getWorldPosition(new THREE.Vector3());
  }

  private groundPoint(target: Target) {
    if (target.point) return { x: target.point[0], z: target.point[1] };
    const p = this.world(target.anchor);
    return { x: p.x, z: p.z };
  }

  private facing(x: number, z: number, target: Target, y: number = tuning.eyeHeight) {
    const look = target.seat ? this.world(target.seat.look) : this.world(target.anchor);
    const dir = new THREE.Vector3(look.x - x, (target.seat ? look.y : 1.3) - y, look.z - z).normalize();
    return { yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(dir.y) };
  }

  private sit(target: Target) {
    if (!target.seat) return;
    this.releaseInput();
    const root = target.seat.root;
    const seat = this.world(`${root}_seat_anchor`);
    const stand = this.world(`${root}_stand_anchor`);
    const seated = this.facing(seat.x, seat.z, target, seat.y);
    const standing = this.facing(stand.x, stand.z, target);
    this.seat = { target, stand: { x: stand.x, y: tuning.eyeHeight, z: stand.z, yaw: standing.yaw, pitch: standing.pitch } };
    this.tweenTo({ x: seat.x, y: seat.y, z: seat.z, yaw: seated.yaw, pitch: seated.pitch }, tuning.seatTransitionMs, () => {
      this.mode = "seated";
      this.refreshPrompts(true);
      if (target.panel) this.events.onPanel(target.panel);
    });
  }

  private stand(then?: () => void) {
    const seat = this.seat;
    if (!seat) return;
    this.seat = undefined;
    this.tweenTo(seat.stand, tuning.seatTransitionMs, () => {
      this.mode = this.walkAllowed ? "walk" : "fixed";
      this.refreshPrompts(true);
      this.canvas.focus({ preventScroll: true });
      then?.();
    });
  }

  private tweenTo(to: Pose, ms: number, done?: () => void) {
    this.vx = this.vz = 0;
    this.mode = "moving";
    this.refreshPrompts(true);
    this.tween = { from: { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch }, to, start: performance.now(),
      ms: this.reduced.matches ? 0 : ms, done };
  }

  private toggleDoors(ids: string[]) {
    const open = !ids.some(id => this.doors.get(id)?.goal === 1);
    for (const id of ids) this.setDoor(id, open);
  }

  private setDoor(id: string, open: boolean) {
    const door = this.doors.get(id);
    if (!door || door.goal === (open ? 1 : 0)) return;
    door.goal = open ? 1 : 0;
    if (this.reduced.matches) door.t = door.goal;
    this.events.onDoor(id, open);
    this.refreshPrompts(true);
  }

  /** Walls plus every door that is not open far enough to pass. */
  activeRects() {
    const rects = [...this.rects];
    for (const door of this.doors.values()) if (door.t < 0.6) rects.push(door.rect);
    return rects;
  }

  doorIsOpen(id: string) { return this.doors.get(id)?.goal === 1; }

  // ---- Input ------------------------------------------------------------------------------------------
  private keyDown = (event: KeyboardEvent) => {
    if (event.code === "KeyE" && !event.repeat) {
      event.preventDefault();
      if (this.mode === "seated") this.stand();
      else {
        const first = this.prompts()[0];
        if (first) this.activate(first.id);
      }
      return;
    }
    if (/^(Key[WASD]|Arrow|Shift)/.test(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
    }
  };

  private keyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };

  private clearInput = () => { this.keys.clear(); this.vx = this.vz = 0; };

  private releaseInput = () => {
    this.clearInput();
    this.drag = undefined;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  };

  private visibility = () => { if (document.hidden) this.releaseInput(); else this.last = performance.now(); };

  private lockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (!locked) this.clearInput();
    this.events.onLock(locked);
    this.refreshPrompts(true);
  };

  private pointerDown = (event: PointerEvent) => {
    this.canvas.focus({ preventScroll: true });
    if (document.pointerLockElement === this.canvas) {
      this.pick(0, 0);
      return;
    }
    this.drag = { x: event.clientX, y: event.clientY, moved: false };
  };

  private pointerMove = (event: PointerEvent) => {
    const locked = document.pointerLockElement === this.canvas;
    if (!locked && !this.drag) return;
    if (this.mode === "panel" || this.mode === "moving" || this.mode === "seated") return;
    const dx = locked ? event.movementX : event.clientX - this.drag!.x;
    const dy = locked ? event.movementY : event.clientY - this.drag!.y;
    if (this.drag) {
      this.drag.x = event.clientX; this.drag.y = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
    }
    this.lookYaw -= dx * tuning.lookSensitivity;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * tuning.lookSensitivity, -tuning.pitchLimit, tuning.pitchLimit);
  };

  private pointerUp = (event: PointerEvent) => {
    const drag = this.drag;
    this.drag = undefined;
    if (!drag || drag.moved) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (!this.pick(nx, ny)) this.requestLock();
  };

  private pick(nx: number, ny: number) {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = this.ray.intersectObjects(this.picks.map(pick => pick.object), false);
    const hit = hits[0] && this.picks.find(pick => pick.object === hits[0].object);
    if (!hit || !this.enabledIds.has(hit.target.id)) return false;
    this.activate(hit.target.id);
    return true;
  }

  // ---- Frame ------------------------------------------------------------------------------------------
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const raw = now - this.last;
    this.last = now;
    if (raw > 0 && raw < 1000) {
      this.frameTimes.push(raw);
      if (this.frameTimes.length > 1200) this.frameTimes.shift();
    }
    const dt = Math.min(raw / 1000, tuning.maxDelta);
    this.stepDoors(dt);
    if (this.tween) this.stepTween(now);
    else {
      if (this.mode === "walk" || this.mode === "fixed") this.stepLook(dt);
      if (this.mode === "walk") this.stepMove(dt);
    }
    if (this.ringing && this.phoneMat) this.phoneMat.emissiveIntensity = 1 + 0.35 * Math.max(0, Math.sin(now / 130));
    this.apply();
    this.refreshPrompts();
    this.emitPose();
    this.renderer.render(this.scene, this.camera);
  };

  private stepDoors(dt: number) {
    let changed = false;
    for (const door of this.doors.values()) {
      if (door.t !== door.goal) {
        const step = dt * 1000 / tuning.doorTransitionMs;
        door.t = door.goal > door.t ? Math.min(door.goal, door.t + step) : Math.max(door.goal, door.t - step);
        changed = true;
      }
      door.pivot.rotation.y = door.closed + (door.open - door.closed) * ease(door.t);
    }
    if (changed && this.sun) this.sun.shadow.needsUpdate = true;
  }

  private stepTween(now: number) {
    const tween = this.tween!;
    const k = tween.ms <= 0 ? 1 : Math.min(1, (now - tween.start) / tween.ms);
    const e = ease(k);
    this.x = tween.from.x + (tween.to.x - tween.from.x) * e;
    this.y = tween.from.y + (tween.to.y - tween.from.y) * e;
    this.z = tween.from.z + (tween.to.z - tween.from.z) * e;
    this.yaw = tween.from.yaw + wrap(tween.to.yaw - tween.from.yaw) * e;
    this.pitch = tween.from.pitch + (tween.to.pitch - tween.from.pitch) * e;
    this.lookYaw = this.yaw; this.lookPitch = this.pitch;
    if (k >= 1) {
      this.tween = undefined;
      this.mode = this.seat ? "seated" : this.walkAllowed ? "walk" : "fixed";
      tween.done?.();
    }
  }

  private stepLook(dt: number) {
    const turn = (this.keys.has("ArrowLeft") ? 1 : 0) - (this.keys.has("ArrowRight") ? 1 : 0);
    this.lookYaw += turn * tuning.keyTurnSpeed * dt;
    const k = this.reduced.matches ? 1 : 1 - Math.exp(-tuning.cameraDamping * dt);
    this.yaw += wrap(this.lookYaw - this.yaw) * k;
    this.pitch += (this.lookPitch - this.pitch) * k;
  }

  private stepMove(dt: number) {
    const k = this.keys;
    const forward = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const strafe = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    const length = Math.hypot(forward, strafe) || 1;
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? tuning.sprintSpeed : tuning.walkSpeed;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wantX = ((-sin * forward + cos * strafe) / length) * speed;
    const wantZ = ((-cos * forward - sin * strafe) / length) * speed;
    const rate = (forward || strafe ? tuning.acceleration : tuning.braking) * dt;
    const dx = wantX - this.vx, dz = wantZ - this.vz, gap = Math.hypot(dx, dz);
    const t = gap > rate ? rate / gap : 1;
    this.vx += dx * t; this.vz += dz * t;
    if (!this.vx && !this.vz) return;
    const next = resolve(this.x + this.vx * dt, this.z + this.vz * dt, tuning.capsuleRadius, this.activeRects());
    if (Math.abs(next.x - (this.x + this.vx * dt)) > 1e-5) this.vx *= 0.3;
    if (Math.abs(next.z - (this.z + this.vz * dt)) > 1e-5) this.vz *= 0.3;
    this.x = next.x; this.z = next.z;
  }

  private apply() {
    this.camera.position.set(this.x, this.y, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  private prompts(): WorldPrompt[] {
    if (this.mode === "fixed" || this.mode === "walk") {
      const list = this.config.targets.filter(target => this.enabledIds.has(target.id)).map(target => {
        const point = target.kind === "seat" || target.kind === "door" || target.point ? this.groundPoint(target) : this.groundPoint(target);
        return { target, distance: Math.hypot(point.x - this.x, point.z - this.z) };
      }).filter(({ target, distance }) => distance <= (target.range ?? tuning.interactionDistance)).sort((a, b) => a.distance - b.distance);
      return list.map(({ target }) => {
        const open = target.kind === "door" && target.doors?.some(id => this.doors.get(id)?.goal === 1);
        return { id: target.id, label: target.kind === "door" ? `${open ? "Close" : "Open"} ${target.label.toLowerCase()}` : target.label };
      });
    }
    return [];
  }

  private refreshPrompts(force = false) {
    const prompts = this.prompts();
    const key = `${this.mode}|${prompts.map(prompt => prompt.id + prompt.label).join()}`;
    if (!force && key === this.promptKey) return;
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.events.onPrompts(prompts, this.mode);
  }

  private emitPose(force = false) {
    const now = performance.now();
    if (!force && now - this.poseAt < 90) return;
    this.poseAt = now;
    this.events.onPose(this.x, this.z, -Math.sin(this.yaw), -Math.cos(this.yaw));
  }

  private resize() {
    const width = this.canvas.clientWidth || 1, height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  stats() {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const gl = this.renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      frames: sorted.length, medianMs: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99),
      calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string : "unknown",
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.canvas.removeEventListener("keydown", this.keyDown);
    this.canvas.removeEventListener("keyup", this.keyUp);
    this.canvas.removeEventListener("blur", this.clearInput);
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    document.removeEventListener("pointerlockchange", this.lockChange);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("blur", this.releaseInput);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.map?.dispose(); material.emissiveMap?.dispose(); material.dispose();
    });
    this.renderer.dispose();
  }
}
