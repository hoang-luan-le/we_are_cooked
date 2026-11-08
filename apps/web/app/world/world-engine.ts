import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { freeArmLength, isFree, overlaps, type Rect, resolve, segmentHits } from "./collision";
import { coworkers, playerModelUrl, type PanelId, type SceneConfig, type Target } from "./world-contract";
import { type DisplayContent, drawDisplay } from "./world-display";
import { tuning } from "./world-tuning";
import { PhoneAudio } from "./world-audio";
import { type Arm, findRightArm, gripHand, releaseFingers, solveArm } from "./world-ik";

export type WorldMode = "loading" | "fixed" | "walk" | "moving" | "seated" | "panel";
export type WorldPrompt = { id: string; label: string };
export type PhoneState = "none" | "ringing" | "snoozed" | "active";
export type PhoneRect = { left: number; top: number; width: number; height: number };
export type WorldEvents = {
  onReady(): void;
  onError(message: string): void;
  onPrompts(prompts: WorldPrompt[], mode: WorldMode): void;
  onPose(x: number, z: number, forwardX: number, forwardZ: number): void;
  onPanel(panel: PanelId): void;
  onPhoneRect(rect: PhoneRect | null): void;
  onCallBusy(busy: boolean): void;
  onDoor(id: string, open: boolean): void;
  onLock(locked: boolean): void;
  onMessage(text: string): void;
  onView(firstPerson: boolean): void;
  onIntro(phase: "closed" | "open" | "done"): void;
};

type Door = { id: string; pivot: THREE.Object3D; closed: number; open: number; t: number; goal: number; rect: Rect };
type Pose = { x: number; y: number; z: number; yaw: number; pitch: number };
type Tween = { from: Pose; to: Pose; start: number; ms: number; done?: () => void };
type Seat = { target: Target; stand: Pose; anchor?: THREE.Vector3; side?: { x: number; z: number }; chair?: boolean };
type Glow = { material: THREE.MeshStandardMaterial; intensity: number };
type Step = { pose: Pose; ms: number; body?: string | null; walking?: boolean; chairGoal?: number; inChair?: boolean };
type CallPhase = "idle" | "waking" | "reach" | "lift" | "held" | "place" | "release";
type Person = {
  root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>;
  current?: THREE.AnimationAction; clip: string; head?: THREE.Object3D; yaw: number;
};
type Npc = Person & { look: THREE.Vector3; path: THREE.Vector3[]; face: number };
const ONCE = new Set(["Sitting_Enter", "Sitting_Exit", "Interact"]);
const NEXT: Record<string, string | null> = { Sitting_Enter: "Sitting_Idle_Loop", Sitting_Exit: null, Interact: null };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number) => t * t * (3 - 2 * t);
// The handset, in its own axes: +X right, +Y up, +Z out of the screen.
const SCREEN_W = 0.0655, SCREEN_H = 0.1405;
const GRIP_WRIST = new THREE.Vector3(0.036, -0.082, -0.038);
const GRIP_DIR = new THREE.Vector3(-0.42, 0.907, 0).normalize();
const GRIP_ACROSS = new THREE.Vector3(0.907, 0.42, 0).normalize();
const GRIP_PALM = new THREE.Vector3(0, 0, 1);
const BED_EYE = { x: -1.86, y: 0.76, z: 0.2 };
const BED_ROLL = { x: -1.76, y: 0.8, z: 0.34 };
const PHONE_LOOK = new THREE.Vector3(-1.33, 0.86, 0.75);
const BED_SEAT = { x: -0.85, y: 1.27, z: 0.4, yaw: Math.PI, pitch: -0.08 };
const BED_STAND = { x: -0.82, y: 1.6, z: 0.95, yaw: Math.PI, pitch: 0 };
const BED_TARGET: Target = { id: "bed-seat", label: "Bed", kind: "seat" };
const toward = (x: number, y: number, z: number, look: THREE.Vector3): Pose => {
  const d = new THREE.Vector3(look.x - x, look.y - y, look.z - z).normalize();
  return { x, y, z, yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) };
};

const isTall = (rect: Rect) => (rect.maxY ?? 9) >= 1.5 && !/CHAIR|PLANT|AVATAR|BOLLARD/.test(rect.name);

export class WorldEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.05, 80);
  rects: Rect[] = [];
  readonly doors = new Map<string, Door>();
  readonly displays = new Map<string, DisplayContent>();
  mode: WorldMode = "loading";
  x = 0; z = 0; y: number = tuning.eyeHeight; yaw = 0; pitch = 0;
  /** The player's chosen distance. Collision never changes it. */
  requestedZoom = 0;
  firstPerson = true;
  /** Smoothed arm before collision, then the collision-limited arm actually used. */
  arm = 0; armLimit = 0; cameraDistance = 0;
  private sideLimit = 0;
  frameTimes: number[] = [];
  lightsOn = new Map<string, boolean>();
  blindsOpen = true;
  get characterClip() { return this.body?.clip ?? ""; }
  introActive = false;
  private lookYaw = 0; private lookPitch = 0; private vx = 0; private vz = 0;
  private raf = 0; private last = 0; private disposed = false;
  private keys = new Set<string>();
  private tween?: Tween; private seat?: Seat; private sequence = 0; private tweenWalking = false; private sitBlend = 0;
  private focus?: { pose: Pose; t: number; goal: number; done?: () => void };
  private bodyClip: string | null = null;
  private sun?: THREE.DirectionalLight;
  private phoneMat?: THREE.MeshStandardMaterial;
  private ringing = false; private walkAllowed = false; private enabledIds = new Set<string>();
  private picks: { target: Target; object: THREE.Object3D }[] = [];
  private promptKey = ""; private poseAt = 0;
  private drag?: { x: number; y: number; moved: boolean };
  private ray = new THREE.Raycaster();
  private observer: ResizeObserver;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private lights = new Map<string, { light: THREE.PointLight; intensity: number }>();
  private glows = new Map<string, Glow>();
  private slats: THREE.Object3D[] = [];
  private moonDecal?: THREE.MeshStandardMaterial;
  private screens = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture }>();
  private pendingDisplays = new Map<string, DisplayContent>();
  private body?: Person;
  get character() { return this.body?.root; }
  readonly npcs = new Map<string, Npc>();
  private meeting = { open: false, display: false };
  private bodyYaw = 0;
  private chair?: { node: THREE.Object3D; home: THREE.Vector3; back: THREE.Vector3 };
  private chairOffset = 0; private chairGoal = 0; private inChair = false;
  phoneState: PhoneState = "none";
  callPhase: CallPhase = "idle";
  private phaseAt = 0;
  private handset?: { node: THREE.Object3D; rest: THREE.Vector3; restQ: THREE.Quaternion; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture; painted: string };
  private phoneT = 0; private armWeight = 0; private lying = 0; private onBed = false;
  private arm3?: Arm;
  private headRest?: THREE.Vector3;
  private audio?: PhoneAudio;
  private held = false;
  private readonly lyingQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
  get canReopenPanel() { return Boolean(this.seat?.target.panel); }
  get audioState() { return { state: this.audio?.state ?? "none", active: this.audio?.active ?? false, source: this.audio?.source }; }

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
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    document.addEventListener("pointerlockchange", this.lockChange);
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("blur", this.releaseInput);
    this.load();
  }

  private load() {
    const loader = new GLTFLoader();
    loader.load(this.config.url, gltf => {
      if (this.disposed) return;
      this.build(gltf.scene);
      loader.load(playerModelUrl, model => { if (!this.disposed) this.addPeople(model.scene, model.animations); },
        undefined, () => undefined); // The scene stays playable in first person without the character.
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
        this.rects.push({ name: object.name, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, maxY: box.max.y });
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
      if (object.name.startsWith("Phone_")) mesh.castShadow = false;
      if (object.name.startsWith("Window_Blind_Slat_")) this.slats.push(object);
      if (object.name === "Decal_Moon_Blinds") this.moonDecal = material;
    });

    for (const light of this.config.lights) {
      if (light.type === "point") {
        const point = new THREE.PointLight(light.color, light.intensity, light.distance, 2);
        point.position.set(...light.position);
        this.scene.add(point);
        if (light.id) {
          this.lights.set(light.id, { light: point, intensity: light.intensity });
          this.lightsOn.set(light.id, true);
        }
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
        rect: { name: `DOOR_${door.id}`, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, maxY: box.max.y } });
    }

    const pickNames: Record<string, string[]> = {
      phone: ["Custom_Phone_Screen_Dana", "Custom_Phone_Screen_Dana_Bezel"],
      computer: ["Custom_Monitor_Display_Surface", "Custom_Monitor_Display_Surface_Bezel"],
      dana: ["Avatar_Placeholder_Dana"],
      projector: ["Custom_Meeting_Shared_Screen"],
      "desk-1": ["Custom_WS1_PR_Review_Screen"],
      "desk-2": ["WS2_Laptop_Screen"],
      lamp: ["lampRoundTable(Clone)"],
      clock: ["Custom_Clock_0204_Display"],
      directory: ["Lobby_Directory_Display_Screen"],
    };
    for (const target of this.config.targets) {
      for (const name of pickNames[target.id] ?? []) {
        const object = root.getObjectByName(name);
        if (object) this.picks.push({ target, object });
      }
    }

    this.setupHandset(root);
    const spawn = this.world(this.config.spawn);
    this.x = spawn.x; this.z = spawn.z; this.y = tuning.eyeHeight;
    const dir = new THREE.Vector3(...this.config.look).sub(new THREE.Vector3(spawn.x, tuning.eyeHeight, spawn.z)).normalize();
    this.lookYaw = this.yaw = this.bodyYaw = Math.atan2(-dir.x, -dir.z);
    this.lookPitch = this.pitch = Math.asin(dir.y);
    this.mode = this.walkAllowed ? "walk" : "fixed";
    for (const [mesh, content] of this.pendingDisplays) this.setDisplay(mesh, content);
    this.pendingDisplays.clear();
    this.apply(0);
    this.refreshPrompts();
    this.emitPose(true);
  }

  private makePerson(source: THREE.Object3D, animations: THREE.AnimationClip[]): Person {
    const root = cloneRig(source);
    root.scale.setScalar(tuning.characterScale);
    let head: THREE.Object3D | undefined;
    root.traverse(object => {
      if (object.name === "Bip01_Head") head = object;
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // Skinned bounds follow the bind pose, so culling would pop the figure.
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (material.name.endsWith("_opacity")) { material.alphaTest = 0.45; material.transparent = false; material.side = THREE.DoubleSide; }
      mesh.material = material;
    });
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of animations) {
      const action = mixer.clipAction(clip);
      if (ONCE.has(clip.name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      actions.set(clip.name, action);
    }
    const person: Person = { root, mixer, actions, clip: "", head, yaw: 0 };
    this.playOn(person, "Idle_Loop");
    mixer.update(0); // Never one frame of the bind pose.
    return person;
  }

  private playOn(person: Person, name: string) {
    const next = person.actions.get(name);
    if (!next || next === person.current) return;
    next.reset().play();
    next.timeScale = 1;
    if (person.current) next.crossFadeFrom(person.current, this.reduced.matches ? 0 : 0.2, false);
    person.current = next;
    person.clip = name;
  }

  private addPeople(model: THREE.Object3D, animations: THREE.AnimationClip[]) {
    const bind = cloneRig(model);
    this.arm3 = undefined;
    this.body = this.makePerson(model, animations);
    this.body.root.visible = false;
    this.arm3 = this.config.id === "bedroom" ? this.findArmFromBind(bind) : undefined;
    if (this.config.id !== "office") return;
    const loader = new GLTFLoader();
    for (const [id, info] of Object.entries(coworkers)) {
      const placeholder = this.scene.getObjectByName(info.avatar);
      if (!placeholder) continue;
      const spot = placeholder.getWorldPosition(new THREE.Vector3());
      loader.load(info.model, gltf => {
        if (this.disposed) return;
        placeholder.visible = false; // Stays pickable so talking to the person still works.
        const person = this.makePerson(gltf.scene, gltf.animations);
        const npc: Npc = { ...person, look: new THREE.Vector3(-4.8, 1.3, 8.9), path: [], face: 0 };
        npc.root.position.set(spot.x, 0, spot.z);
        npc.yaw = npc.face = Math.atan2(npc.look.x - spot.x, npc.look.z - spot.z);
        npc.root.rotation.y = npc.yaw;
        this.npcs.set(id, npc);
        this.applyMeeting();
      }, undefined, () => undefined);
    }
  }

  /** The grip is measured on an unposed copy, then bound to the live skeleton by name. */
  private findArmFromBind(bind: THREE.Object3D) {
    const measured = findRightArm(bind);
    const body = this.body;
    if (!measured || !body) return undefined;
    const live = (o: THREE.Object3D) => body.root.getObjectByName(o.name)!;
    return { ...measured, upper: live(measured.upper), fore: live(measured.fore), hand: live(measured.hand),
      joints: measured.joints.map(joint => ({ ...joint, bone: live(joint.bone) })) };
  }

  // ---- Night call -------------------------------------------------------------------------------------
  private setupHandset(root: THREE.Object3D) {
    const node = root.getObjectByName("Phone_Handset");
    const screen = root.getObjectByName("Custom_Phone_Screen_Dana") as THREE.Mesh | undefined;
    if (!node || !screen) return;
    node.traverse(object => { object.frustumCulled = false; });
    const canvas = document.createElement("canvas");
    canvas.width = 390; canvas.height = 844;
    const ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    const material = (screen.material as THREE.MeshStandardMaterial).clone();
    Object.assign(material, { map: null, emissiveMap: texture, emissiveIntensity: 1, toneMapped: false });
    material.color.set("#000000"); material.emissive.set("#ffffff"); material.needsUpdate = true;
    screen.material = material;
    this.phoneMat = material;
    this.handset = { node, rest: node.position.clone(), restQ: node.quaternion.clone(), ctx, texture, painted: "" };
    this.audio = new PhoneAudio();
    this.paintHandset("dark");
  }

  private paintHandset(state: "incoming" | "active" | "dark") {
    const h = this.handset;
    if (!h || h.painted === state) return;
    h.painted = state;
    const c = h.ctx, W = 390, H = 844;
    const round = (x: number, y: number, r: number, fill: string) => { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
    c.fillStyle = state === "incoming" ? "#0d1512" : state === "active" ? "#1a5a7c" : "#04060a";
    c.fillRect(0, 0, W, H);
    if (state === "incoming") {
      const g = c.createRadialGradient(100, 460, 10, 100, 460, 330);
      g.addColorStop(0, "#2a4a2c"); g.addColorStop(1, "rgba(13,21,18,0)");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    c.fillStyle = "#000"; c.fillRect(120, 0, 150, 30);
    c.fillStyle = "#fff"; c.textAlign = "center";
    if (state === "dark") {
      c.font = "300 82px Segoe UI, sans-serif"; c.fillText("2:04", W / 2, 210);
    } else {
      c.font = "300 46px Segoe UI, sans-serif"; c.fillText("Dana", W / 2, 150);
      c.font = "20px Segoe UI, sans-serif"; c.fillText("ShopNorth On-Call", W / 2, 186);
      if (state === "incoming") { round(90, 730, 38, "#f0443a"); round(300, 730, 38, "#4cd964"); }
      else round(W / 2, 730, 38, "#f0443a");
    }
    h.texture.needsUpdate = true;
  }

  /** Follows the call. A fresh ring plays the wake-up unless it is skipped. */
  setPhone(state: PhoneState, skip: boolean) {
    if (this.config.id !== "bedroom" || this.mode === "loading" || !this.handset) return;
    const previous = this.phoneState;
    if (state === previous) return;
    this.phoneState = state;
    if (state === "ringing") this.audio?.start(); else this.audio?.stop();
    if (state === "ringing" || state === "snoozed") {
      this.paintHandset("incoming");
      if (this.callPhase === "idle") this.beginCall(skip || this.reduced.matches);
    } else if (state === "active") {
      this.paintHandset("active");
      if (this.callPhase === "idle") this.resumeCall();
      else { this.skipToHeld(); this.sitUp(); }
    } else if (this.callPhase !== "idle") {
      this.paintHandset("dark");
      this.setHeld(false);
      this.setPhase("place");
    } else this.paintHandset("dark");
  }

  private setPhase(phase: CallPhase) { this.callPhase = phase; this.phaseAt = performance.now(); }

  private beginCall(skip: boolean) {
    this.introActive = true;
    this.events.onCallBusy(true);
    this.releaseInput();
    this.firstPerson = true; this.requestedZoom = 0;
    this.lying = 1; this.onBed = true;
    const start = toward(BED_EYE.x, BED_EYE.y, BED_EYE.z, new THREE.Vector3(-1.7, 2.8, 0.45));
    Object.assign(this, start, { lookYaw: start.yaw, lookPitch: start.pitch });
    this.mode = "moving";
    if (skip) { this.skipToHeld(); return; }
    this.events.onIntro("closed");
    this.setPhase("waking");
    window.setTimeout(() => { if (this.callPhase === "waking" && !this.disposed) this.events.onIntro("open"); }, 1100);
    this.runSteps([
      { pose: start, ms: 2600 },
      { pose: toward(BED_EYE.x, BED_EYE.y, BED_EYE.z, PHONE_LOOK), ms: 2300 },
      { pose: toward(BED_ROLL.x, BED_ROLL.y, BED_ROLL.z, PHONE_LOOK), ms: 900 },
    ], () => { if (this.callPhase === "waking") { this.mode = "moving"; this.setPhase("reach"); } });
  }

  /** Reaches the same in-hand state as watching the whole sequence. */
  skipIntro() { if (this.callPhase === "waking" || this.callPhase === "reach" || this.callPhase === "lift") this.skipToHeld(); }

  private skipToHeld() {
    if (this.callPhase === "held") return;
    this.sequence++;
    this.tween = undefined;
    if (this.callPhase === "idle" || this.callPhase === "waking") {
      const pose = toward(BED_ROLL.x, BED_ROLL.y, BED_ROLL.z, PHONE_LOOK);
      Object.assign(this, pose, { lookYaw: pose.yaw, lookPitch: pose.pitch });
    }
    this.mode = "moving";
    this.phoneT = 1; this.armWeight = 1;
    this.setPhase("held");
    this.events.onIntro("done");
    this.setHeld(true);
  }

  private setHeld(held: boolean) {
    this.held = held;
    this.events.onPhoneRect(held ? this.phoneRect() : null);
  }

  private phoneDistance() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const screen = Math.min(h * 0.87, (w - 40) * SCREEN_H / SCREEN_W);
    return SCREEN_H / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * (h / screen);
  }

  private phoneRect(): PhoneRect {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const height = Math.min(h * 0.87, (w - 40) * SCREEN_H / SCREEN_W), width = height * SCREEN_W / SCREEN_H;
    return { left: (w - width) / 2, top: (h - height) / 2, width, height };
  }

  private seatOnBed() {
    this.seat = { target: BED_TARGET, stand: BED_STAND };
    this.bodyClip = "Sitting_Idle_Loop";
    this.sitBlend = this.reduced.matches ? 1 : this.sitBlend;
  }

  private sitUp() {
    this.seatOnBed();
    this.runSteps([{ pose: BED_SEAT, ms: 1800, body: "Sitting_Idle_Loop" }], () => { this.mode = "moving"; });
    this.mode = "moving";
  }

  private resumeCall() {
    this.introActive = true;
    this.events.onCallBusy(true);
    this.firstPerson = true; this.requestedZoom = 0;
    this.onBed = true; this.lying = 0;
    Object.assign(this, BED_SEAT, { lookYaw: BED_SEAT.yaw, lookPitch: BED_SEAT.pitch });
    this.seatOnBed();
    this.sitBlend = 1;
    this.phoneT = 1; this.armWeight = 1;
    this.mode = "moving";
    this.setPhase("held");
    this.setHeld(true);
  }

  private finishCall() {
    this.setPhase("idle");
    this.introActive = false;
    this.armWeight = 0;
    if (this.arm3) releaseFingers(this.arm3);
    if (!this.seat) this.seatOnBed();
    Object.assign(this, BED_SEAT, { lookYaw: BED_SEAT.yaw, lookPitch: BED_SEAT.pitch });
    this.lying = 0;
    this.mode = "seated";
    this.events.onCallBusy(false);
    this.refreshPrompts();
    this.canvas.focus({ preventScroll: true });
  }

  private stepCall(now: number, dt: number) {
    const h = this.handset;
    if (!h) return;
    const elapsed = now - this.phaseAt;
    const reduced = this.reduced.matches;
    if (this.callPhase === "reach") {
      this.armWeight = reduced ? 1 : ease(Math.min(1, elapsed / 1150));
      if (elapsed >= 1150 || reduced) this.setPhase("lift");
    } else if (this.callPhase === "lift") {
      this.armWeight = 1;
      this.phoneT = reduced ? 1 : Math.min(1, elapsed / 1300);
      if (this.phoneT >= 1) { this.setPhase("held"); this.events.onIntro("done"); this.setHeld(true); }
    } else if (this.callPhase === "place") {
      this.phoneT = reduced ? 0 : Math.max(0, 1 - elapsed / 1150);
      if (this.phoneT <= 0) this.setPhase("release");
    } else if (this.callPhase === "release") {
      this.armWeight = reduced ? 0 : 1 - ease(Math.min(1, elapsed / 520));
      if (this.armWeight <= 0) this.finishCall();
    }
    if (this.seat && this.seat.target === BED_TARGET) {
      this.lying = Math.max(0, this.lying - dt / 1.8);
      if (reduced) this.lying = 0;
    }
    if (this.callPhase === "idle") return;
    this.camera.updateMatrixWorld();
    const e = ease(this.phoneT);
    const held = this.camera.position.clone().add(new THREE.Vector3(0, 0, -this.phoneDistance()).applyQuaternion(this.camera.quaternion));
    h.node.position.lerpVectors(h.rest, held, e);
    h.node.position.y += Math.sin(Math.PI * this.phoneT) * 0.06;
    h.node.quaternion.copy(h.restQ).slerp(this.camera.quaternion, e);
    const buzz = this.phoneT === 0 && !reduced ? this.audio?.vibration(now) ?? 0 : 0;
    if (buzz) {
      h.node.position.x += Math.sin(now * 0.31) * 0.0014;
      h.node.position.z += Math.cos(now * 0.37) * 0.0014;
      h.node.rotateZ(Math.sin(now * 0.43) * 0.012);
    }
    h.node.updateMatrixWorld(true);
  }

  private stepArm() {
    const person = this.body, arm = this.arm3, h = this.handset;
    if (!person || !arm || !h || this.armWeight <= 0) return;
    person.root.updateMatrixWorld(true);
    const q = h.node.getWorldQuaternion(new THREE.Quaternion());
    const wrist = GRIP_WRIST.clone().applyMatrix4(h.node.matrixWorld);
    const down = new THREE.Vector3(0.55, -0.85, 0.15).applyQuaternion(this.camera.quaternion);
    const pole = wrist.clone().addScaledVector(down, 0.8);
    solveArm(arm, wrist, pole, this.armWeight);
    gripHand(arm, GRIP_DIR.clone().applyQuaternion(q), GRIP_ACROSS.clone().applyQuaternion(q), GRIP_PALM.clone().applyQuaternion(q), this.armWeight);
  }

  /** Dana's stance follows the current beat. Called with the same state that drives the projector. */
  setMeeting(open: boolean, display: boolean, complete: boolean) {
    this.meeting = { open, display };
    this.applyMeeting();
    if (complete) this.teammateLeaves();
  }

  private applyMeeting() {
    const dana = this.npcs.get("dana"), mate = this.npcs.get("teammate");
    if (!dana || !mate) return;
    const screen = this.scene.getObjectByName("office_project_screen_plane")?.getWorldPosition(new THREE.Vector3());
    if (dana.path.length === 0) {
      this.playOn(dana, this.meeting.open ? "Idle_Talking_Loop" : "Idle_Loop");
      dana.look.set(-4.8, 1.3, 8.9);
      if (this.meeting.display && screen) dana.look.copy(screen);
      dana.face = Math.atan2(dana.look.x - dana.root.position.x, dana.look.z - dana.root.position.z);
    }
    if (mate.path.length === 0 && mate.clip !== "Walk_Loop") {
      if (this.meeting.display && screen) mate.look.copy(screen);
      else mate.look.copy(dana.root.position).setY(1.5);
      mate.face = Math.atan2(mate.look.x - mate.root.position.x, mate.look.z - mate.root.position.z);
    }
  }

  private teammateLeaves() {
    const mate = this.npcs.get("teammate");
    if (!mate || mate.path.length || mate.clip === "Walk_Loop" || mate.root.position.x > 0) return;
    this.setDoor("meeting_room", true);
    this.setDoor("workstation_bay", true);
    this.rects = this.rects.filter(rect => rect.name !== "COLLIDER_AVATAR_TEAMMATE");
    mate.path = [[-3.05, 10.6], [-2.9, 7.45], [-1, 7.45], [1, 7.45], [3.1, 7.45], [3.4, 6.7]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  }

  private stepNpcs(dt: number) {
    const k = this.reduced.matches ? 1 : 1 - Math.exp(-tuning.bodyTurnDamping * dt);
    for (const npc of this.npcs.values()) {
      const goal = npc.path[0];
      if (goal) {
        const to = goal.clone().sub(npc.root.position).setY(0);
        const step = 1.4 * dt;
        if (to.length() <= step) npc.path.shift();
        else npc.root.position.addScaledVector(to.normalize(), step);
        npc.face = Math.atan2(to.x, to.z);
        this.playOn(npc, "Walk_Loop");
        if (npc.current) npc.current.timeScale = 1.4 / tuning.walkClipSpeed;
        if (!npc.path.length) { this.playOn(npc, "Idle_Loop"); npc.look.set(5, 1.2, 9); }
      }
      npc.yaw += wrap(npc.face - npc.yaw) * k * 0.5;
      npc.root.rotation.y = npc.yaw;
      npc.mixer.update(dt);
      if (npc.head) {
        // A small head turn after the pose is sampled, so people look at the speaker or the screen.
        const delta = wrap(Math.atan2(npc.look.x - npc.root.position.x, npc.look.z - npc.root.position.z) - npc.yaw);
        npc.head.rotateY(THREE.MathUtils.clamp(delta, -0.7, 0.7) * 0.8);
      }
    }
  }

  // ---- App state -------------------------------------------------------------------------------------
  /** Which targets are usable now, and whether the player may walk. Driven by the incident stage. */
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
    this.refreshPrompts();
  }

  setPanelOpen(open: boolean) {
    if (open) {
      this.releaseInput();
      if (this.mode === "seated" || this.mode === "walk" || this.mode === "fixed") this.mode = "panel";
    } else if (this.mode === "panel") {
      const settle = () => {
        this.focus = undefined;
        this.mode = this.seat ? "seated" : this.walkAllowed ? "walk" : "fixed";
        this.canvas.focus({ preventScroll: true });
        this.refreshPrompts();
      };
      if (this.focus) {
        // The room comes back through the same camera move that led into the panel.
        this.focus.goal = 0;
        this.focus.done = settle;
        this.mode = "moving";
      } else settle();
    }
    this.refreshPrompts();
  }

  /** Paints a screen from the same content object the HTML panel uses. */
  setDisplay(meshName: string, content: DisplayContent) {
    if (this.mode === "loading") {
      this.pendingDisplays.set(meshName, content);
      return;
    }
    const mesh = this.scene.getObjectByName(meshName) as THREE.Mesh | undefined;
    if (!mesh) return;
    let screen = this.screens.get(meshName);
    if (!screen) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 576;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false; // glTF UV convention, matching the baked screen art.
      texture.wrapS = THREE.RepeatWrapping;
      texture.repeat.x = -1;
      texture.offset.x = 1; // The screen meshes map U right to left.
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      material.map = null;
      material.color.set("#000000");
      material.emissive.set("#ffffff");
      material.emissiveMap = texture;
      material.emissiveIntensity = 1;
      material.toneMapped = false;
      material.needsUpdate = true;
      mesh.material = material;
      screen = { canvas, ctx, texture };
      this.screens.set(meshName, screen);
    }
    drawDisplay(screen.ctx, content);
    screen.texture.needsUpdate = true;
    this.displays.set(meshName, content);
  }

  activate(id: string) {
    const target = this.config.targets.find(item => item.id === id);
    if (!target || !this.enabledIds.has(id) || this.tween || this.focus || this.introActive) return;
    if (target.kind === "door") this.toggleDoors(target.doors ?? []);
    else if (target.kind === "panel" && target.panel) this.events.onPanel(target.panel);
    else if (target.kind === "seat" && this.mode === "walk") this.sit(target);
    else if (target.kind === "prop" && target.action) this.useProp(target);
  }

  private useProp(target: Target) {
    const action = target.action!;
    if (action.type === "message") this.events.onMessage(action.text);
    else if (action.type === "light") {
      const on = !this.lightsOn.get(action.light);
      this.lightsOn.set(action.light, on);
      const entry = this.lights.get(action.light);
      if (entry) entry.light.intensity = on ? entry.intensity : 0;
      this.setGlow(action.glow, on);
      this.events.onMessage(on ? action.on : action.off);
    } else {
      this.blindsOpen = !this.blindsOpen;
      for (const slat of this.slats) slat.rotation.x = this.blindsOpen ? 0 : Math.PI / 2.4;
      if (this.moonDecal) { this.moonDecal.opacity = this.blindsOpen ? 1 : 0.15; }
      this.events.onMessage(this.blindsOpen ? action.open : action.closed);
    }
  }

  private setGlow(name: string, on: boolean) {
    let glow = this.glows.get(name);
    if (!glow) {
      const mesh = this.scene.getObjectByName(name) as THREE.Mesh | undefined;
      if (!mesh) return;
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = material;
      glow = { material, intensity: material.emissiveIntensity };
      this.glows.set(name, glow);
    }
    glow.material.emissiveIntensity = on ? glow.intensity : 0.04;
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
  reopenPanel() { if (this.mode === "seated" && this.seat) this.openMonitor(this.seat.target); }

  requestLock() {
    if (this.mode !== "walk" || document.pointerLockElement === this.canvas) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch?.(() => undefined);
    } catch {
      // Drag-to-look stays available when pointer lock is refused.
    }
  }

  // ---- Camera zoom ------------------------------------------------------------------------------------
  zoomBy(delta: number) {
    if (this.mode === "panel" || this.mode === "loading" || this.introActive) return;
    this.setRequestedZoom(this.requestedZoom + delta);
  }

  /** One-press alternative for input without a wheel. */
  toggleView() {
    if (this.mode === "panel" || this.mode === "loading" || this.introActive) return;
    this.setRequestedZoom(this.firstPerson ? tuning.thirdPersonDefault : 0);
  }

  private setRequestedZoom(value: number) {
    this.requestedZoom = THREE.MathUtils.clamp(value, 0, tuning.zoomMax);
    const wasFirst = this.firstPerson;
    if (wasFirst && this.requestedZoom >= tuning.firstPersonExit) {
      this.firstPerson = false;
      // Leaving first person goes straight to a follow distance that shows the whole character.
      this.requestedZoom = Math.max(this.requestedZoom, tuning.thirdPersonDefault);
    }
    else if (!wasFirst && this.requestedZoom <= tuning.firstPersonEnter) this.firstPerson = true;
    if (wasFirst !== this.firstPerson) this.events.onView(this.firstPerson);
  }

  private wheel = (event: WheelEvent) => {
    if (this.mode === "panel" || this.mode === "loading") return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    // Proportional, so a trackpad moves the zoom smoothly and a wheel notch is one step.
    this.zoomBy(THREE.MathUtils.clamp(pixels * tuning.zoomStep / 100, -tuning.zoomStep, tuning.zoomStep));
  };

  // ---- Seats and doors -------------------------------------------------------------------------------
  world(name: string) {
    const node = this.scene.getObjectByName(name);
    if (!node) throw new Error(`Missing scene node ${name}`);
    return node.getWorldPosition(new THREE.Vector3());
  }

  private groundPoint(target: Target) {
    if (target.point) return { x: target.point[0], z: target.point[1] };
    const p = this.world(target.anchor!);
    return { x: p.x, z: p.z };
  }

  private facing(x: number, z: number, target: Target, y: number = tuning.eyeHeight) {
    const ground = this.groundPoint(target);
    const look = target.seat ? this.world(target.seat.look) : new THREE.Vector3(ground.x, 1.3, ground.z);
    const dir = new THREE.Vector3(look.x - x, look.y - y, look.z - z).normalize();
    return { yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(dir.y) };
  }

  private runSteps(steps: Step[], done?: () => void) {
    const id = ++this.sequence;
    const next = (index: number) => {
      if (id !== this.sequence) return; // A skipped or replaced sequence must not continue.
      if (index >= steps.length) { this.tweenWalking = false; done?.(); return; }
      const step = steps[index];
      if (step.body !== undefined) this.bodyClip = step.body;
      if (step.chairGoal !== undefined) this.chairGoal = step.chairGoal;
      if (step.inChair !== undefined) this.inChair = step.inChair;
      this.tweenWalking = Boolean(step.walking);
      this.tweenTo(step.pose, step.ms, () => next(index + 1));
    };
    next(0);
  }

  private sit(target: Target) {
    if (!target.seat) return;
    const root = target.seat.root;
    const approach = this.world(`${root}_approach`), seat = this.world(`${root}_seat_anchor`), stand = this.world(`${root}_stand_anchor`);
    if (!isFree(approach.x, approach.z, tuning.capsuleRadius * 0.8, this.activeRects())) {
      this.events.onMessage("Something is in the way of that chair.");
      return;
    }
    this.releaseInput();
    const seated = this.facing(seat.x, seat.z, target, seat.y);
    const standing = this.facing(stand.x, stand.z, target);
    const atApproach = this.facing(approach.x, approach.z, target);
    const distance = Math.hypot(approach.x - this.x, approach.z - this.z);
    const steps: Step[] = [];
    if (distance > 0.12) {
      const heading = Math.atan2(-(approach.x - this.x), -(approach.z - this.z));
      steps.push({ pose: { x: approach.x, y: tuning.eyeHeight, z: approach.z, yaw: heading, pitch: 0 }, ms: distance / tuning.approachSpeed * 1000, body: null, walking: true });
    }
    // Around the chair back, which rolls out of the way. A short step into the gap, a turn, then straight down.
    const side = this.seatSide(seat, seated.yaw, approach);
    const chairNode = target.seat.chair ? this.scene.getObjectByName(target.seat.chair) : undefined;
    const pulled = Boolean(side && chairNode);
    if (side) {
      if (chairNode) {
        this.chair = { node: chairNode, home: chairNode.position.clone(), back: new THREE.Vector3(Math.sin(seated.yaw), 0, Math.cos(seated.yaw)) };
        this.chairOffset = 0;
      }
      const heading = Math.atan2(-(side.x - approach.x), -(side.z - approach.z));
      steps.push({ pose: { x: side.x, y: tuning.eyeHeight, z: side.z, yaw: heading, pitch: 0 }, ms: Math.hypot(side.x - approach.x, side.z - approach.z) / tuning.approachSpeed * 1000, body: null, walking: true, chairGoal: tuning.chairPull });
      const inward = Math.atan2(-(seat.x - side.x), -(seat.z - side.z));
      steps.push({ pose: { x: side.x, y: tuning.eyeHeight, z: side.z, yaw: inward, pitch: 0 }, ms: tuning.turnToSeatMs * 0.7, body: null });
      steps.push({ pose: { x: seat.x, y: tuning.eyeHeight, z: seat.z, yaw: inward, pitch: 0 }, ms: tuning.seatSideStep / tuning.approachSpeed * 1000, body: null, walking: true });
      steps.push({ pose: { x: seat.x, y: tuning.eyeHeight, z: seat.z, yaw: seated.yaw, pitch: 0 }, ms: tuning.turnToSeatMs, body: null });
    } else {
      steps.push({ pose: { x: approach.x, y: tuning.eyeHeight, z: approach.z, yaw: atApproach.yaw, pitch: atApproach.pitch }, ms: tuning.turnToSeatMs, body: null });
    }
    steps.push({ pose: { x: seat.x, y: seat.y, z: seat.z, yaw: seated.yaw, pitch: seated.pitch }, ms: tuning.seatTransitionMs, body: "Sitting_Enter" });
    if (pulled) steps.push({ pose: { x: seat.x, y: seat.y, z: seat.z, yaw: seated.yaw, pitch: seated.pitch }, ms: tuning.chairRollMs, chairGoal: 0, inChair: true });
    this.seat = { target, side, anchor: seat.clone(), chair: pulled, stand: { x: stand.x, y: tuning.eyeHeight, z: stand.z, yaw: standing.yaw, pitch: standing.pitch } };
    this.runSteps(steps, () => {
      this.mode = "seated";
      this.refreshPrompts();
      this.openMonitor(target);
    });
  }

  /** The camera settles on the screen in front of the seated player, then the shared panel opens. */
  private openMonitor(target: Target, panel = target.panel) {
    if (!panel || !target.seat) return;
    const screen = this.world(target.seat.look);
    const away = new THREE.Vector3(this.x - screen.x, this.y - screen.y, this.z - screen.z).normalize();
    const eye = screen.clone().addScaledVector(away, target.seat.focus);
    const dir = screen.clone().sub(eye).normalize();
    this.focus = { pose: { x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(dir.y) }, t: 0, goal: 1,
      done: () => { this.mode = "seated"; this.events.onPanel(panel); } };
    this.mode = "moving";
    this.refreshPrompts();
  }

  /** Starts at the desk and moves into the monitor, so setup appears on the computer. */
  openOnComputer(panel: PanelId) {
    const target = this.config.targets.find(item => item.kind === "seat" && item.panel === "incident-board");
    if (!target?.seat || this.mode === "loading") return;
    const seat = this.world(`${target.seat.root}_seat_anchor`);
    const pose = this.facing(seat.x, seat.z, target, seat.y);
    Object.assign(this, { x: seat.x, y: seat.y, z: seat.z, yaw: pose.yaw, pitch: pose.pitch, lookYaw: pose.yaw, lookPitch: pose.pitch });
    this.openMonitor(target, panel);
  }

  /** The clear point beside a chair that is nearest the way the player came in. */
  private seatSide(seat: THREE.Vector3, yaw: number, from: THREE.Vector3) {
    const blockers = this.activeRects().filter(rect => !rect.name.includes("CHAIR"));
    const options = [1, -1]
      .map(sign => ({ x: seat.x + Math.cos(yaw) * sign * tuning.seatSideStep, z: seat.z - Math.sin(yaw) * sign * tuning.seatSideStep }))
      .filter(point => isFree(point.x, point.z, tuning.capsuleRadius * 0.6, blockers))
      .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
    return options[0];
  }

  private stand(then?: () => void) {
    const seat = this.seat;
    if (!seat || this.introActive) return;
    const blockers = this.activeRects().filter(rect => !rect.name.includes("CHAIR"));
    if (!isFree(seat.stand.x, seat.stand.z, tuning.capsuleRadius * 0.8, blockers)) {
      this.events.onMessage("There's no room to stand here.");
      return;
    }
    this.seat = undefined;
    this.releaseInput();
    this.onBed = false;
    const here = { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch };
    const walkMs = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) / tuning.approachSpeed * 1000;
    const upright = seat.anchor ? { x: seat.anchor.x, y: tuning.eyeHeight, z: seat.anchor.z, yaw: this.yaw, pitch: 0 } : undefined;
    const leave: Step[] = seat.chair && seat.side && upright
      ? [
        { pose: here, ms: tuning.chairRollMs, chairGoal: tuning.chairPull },
        { pose: upright, ms: tuning.standTransitionMs, body: "Sitting_Exit" },
        { pose: { x: seat.side.x, y: tuning.eyeHeight, z: seat.side.z, yaw: Math.atan2(-(seat.side.x - upright.x), -(seat.side.z - upright.z)), pitch: 0 }, ms: walkMs(seat.side, upright), body: null, walking: true, inChair: false },
        { pose: seat.stand, ms: walkMs(seat.stand, seat.side), body: null, walking: true, chairGoal: 0 },
      ]
      : [{ pose: seat.stand, ms: tuning.standTransitionMs, body: "Sitting_Exit" }];
    this.runSteps(leave, () => {
      this.bodyClip = null;
      this.inChair = false;
      this.mode = this.walkAllowed ? "walk" : "fixed";
      this.refreshPrompts();
      this.canvas.focus({ preventScroll: true });
      then?.();
    });
  }

  private tweenTo(to: Pose, ms: number, done?: () => void) {
    this.vx = this.vz = 0;
    this.mode = "moving";
    this.refreshPrompts();
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
    if (!open && overlaps(this.x, this.z, tuning.capsuleRadius, door.rect)) {
      this.events.onMessage("You're standing in the doorway.");
      return;
    }
    door.goal = open ? 1 : 0;
    if (this.reduced.matches) door.t = door.goal;
    this.events.onDoor(id, open);
    this.refreshPrompts();
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
    if (event.code === "KeyE") {
      event.preventDefault();
      if (event.repeat) return; // A held key must not activate twice.
      if (this.mode === "seated") this.stand();
      else {
        const first = this.prompts()[0];
        if (first) this.activate(first.id);
      }
      return;
    }
    if (event.code === "KeyV" && !event.repeat) { event.preventDefault(); this.toggleView(); return; }
    if (event.code === "KeyZ" && !event.repeat) { event.preventDefault(); this.zoomBy(-tuning.zoomStep); return; }
    if (event.code === "KeyX" && !event.repeat) { event.preventDefault(); this.zoomBy(tuning.zoomStep); return; }
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
    this.refreshPrompts();
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
    if (!hit || !this.enabledIds.has(hit.target.id) || !this.canReach(hit.target)) return false;
    this.activate(hit.target.id);
    return true;
  }

  /** In range and not behind a wall or the wrong side of a door. */
  private canReach(target: Target) {
    if (this.mode === "seated") return false;
    const point = this.groundPoint(target);
    if (Math.hypot(point.x - this.x, point.z - this.z) > (target.range ?? tuning.interactionDistance)) return false;
    return this.lineOfSight(target, point);
  }

  private lineOfSight(target: Target, point: { x: number; z: number }) {
    const own = new Set((target.doors ?? []).map(id => `DOOR_${id}`));
    return !this.activeRects().some(rect => isTall(rect) && !own.has(rect.name) &&
      // Screens and props stand against walls, so the far end stops just short of them.
      segmentHits(this.x, this.z, this.x + (point.x - this.x) * 0.9, this.z + (point.z - this.z) * 0.9, rect));
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
    this.stepChair(dt);
    this.stepFocus(dt);
    if (this.tween) this.stepTween(now);
    else if (!this.focus) {
      if (this.mode === "walk" || this.mode === "fixed") this.stepLook(dt);
      if (this.mode === "walk") this.stepMove(dt);
    }
    if (this.ringing && this.phoneMat) this.phoneMat.emissiveIntensity = 1 + 0.25 * Math.max(0, Math.sin(now / 130));
    this.apply(dt);
    if (this.callPhase !== "idle") this.stepCall(now, dt);
    this.stepCharacter(dt);
    this.stepNpcs(dt);
    this.refreshPrompts();
    this.emitPose();
    this.renderer.render(this.scene, this.camera);
  };

  private stepFocus(dt: number) {
    const focus = this.focus;
    if (!focus || focus.t === focus.goal) return;
    const step = this.reduced.matches ? 1 : dt * 1000 / tuning.monitorFocusMs;
    focus.t = focus.goal > focus.t ? Math.min(focus.goal, focus.t + step) : Math.max(focus.goal, focus.t - step);
    if (focus.t === focus.goal) {
      const done = focus.done;
      focus.done = undefined;
      done?.();
    }
  }

  private stepChair(dt: number) {
    if (!this.chair) return;
    const step = this.reduced.matches ? 1 : dt * 1000 / tuning.chairRollMs * tuning.chairPull;
    this.chairOffset = this.chairGoal > this.chairOffset ? Math.min(this.chairGoal, this.chairOffset + step) : Math.max(this.chairGoal, this.chairOffset - step);
    this.chair.node.position.copy(this.chair.home).addScaledVector(this.chair.back, this.chairOffset);
  }

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
    if (dt > 0 && (Math.abs(next.x - (this.x + this.vx * dt)) > 1e-5 || Math.abs(next.z - (this.z + this.vz * dt)) > 1e-5)) {
      // Slide: keep the motion that actually happened, so corners don't cut the speed.
      const speedNow = Math.hypot(this.vx, this.vz);
      let sx = (next.x - this.x) / dt, sz = (next.z - this.z) / dt;
      const slid = Math.hypot(sx, sz);
      if (slid > speedNow && slid > 0) { sx *= speedNow / slid; sz *= speedNow / slid; }
      this.vx = sx; this.vz = sz;
      this.x += sx * dt; this.z += sz * dt;
      const settled = resolve(this.x, this.z, tuning.capsuleRadius, this.activeRects());
      this.x = settled.x; this.z = settled.z;
      return;
    }
    this.x = next.x; this.z = next.z;
  }

  private apply(dt: number) {
    const instant = this.reduced.matches || dt === 0;
    const want = this.firstPerson || this.introActive || this.focus ? 0 : this.requestedZoom;
    this.arm = instant ? want : this.arm + (want - this.arm) * (1 - Math.exp(-tuning.zoomDamping * dt));
    if (this.arm < 0.005 && want === 0) this.arm = 0;
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
    const blend = Math.min(1, this.arm / tuning.firstPersonExit);
    let pivot: [number, number, number] = [this.x, this.y, this.z];
    let distance = 0;
    if (this.arm > 0) {
      // Move above and beside the head first, stopping short of any wall on that side.
      const right: [number, number, number] = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
      const rects = this.activeRects().filter(rect => !/CHAIR|AVATAR|BOLLARD/.test(rect.name));
      const settle = (current: number, free: number) => {
        if (instant) return free;
        const pulling = free < current;
        const change = (free - current) * (1 - Math.exp(-(pulling ? tuning.armPullDamping : tuning.armRecoverDamping) * dt));
        const cap = (pulling ? tuning.armPullSpeed : tuning.armRecoverSpeed) * dt;
        return current + THREE.MathUtils.clamp(change, -cap, cap);
      };
      const lift = Math.min(tuning.shoulderRise * blend, Math.max(0, this.config.ceilingY - tuning.cameraRadius - this.y));
      const raised: [number, number, number] = [this.x, this.y + lift, this.z];
      this.sideLimit = settle(this.sideLimit, freeArmLength(raised, right, tuning.shoulderOffset * blend, rects, this.config.ceilingY, tuning.cameraRadius));
      const side = Math.min(this.sideLimit, tuning.shoulderOffset * blend);
      pivot = [raised[0] + right[0] * side, raised[1], raised[2] + right[2] * side];
      const free = freeArmLength(pivot, [back.x, back.y, back.z], this.arm, rects, this.config.ceilingY, tuning.cameraRadius);
      // Collision pulls in at once and eases back out, and never touches requestedZoom.
      this.armLimit = settle(this.armLimit, free);
      distance = Math.min(this.arm, this.armLimit);
    } else { this.armLimit = 0; this.sideLimit = 0; }
    this.cameraDistance = distance;
    this.camera.position.set(pivot[0] + back.x * distance, pivot[1] + back.y * distance, pivot[2] + back.z * distance);
    if (this.focus) {
      const e = ease(this.focus.t), pose = this.focus.pose;
      this.camera.position.lerp(new THREE.Vector3(pose.x, pose.y, pose.z), e);
      this.camera.rotation.set(this.pitch + (pose.pitch - this.pitch) * e, this.yaw + wrap(pose.yaw - this.yaw) * e, 0, "YXZ");
    }
  }

  private stepCharacter(dt: number) {
    const person = this.body;
    if (!person) return;
    const armOn = this.armWeight > 0 || this.lying > 0;
    person.root.visible = armOn || (this.cameraDistance > tuning.bodyHideDistance && !this.focus);
    const speed = this.tween && this.tweenWalking ? tuning.approachSpeed : Math.hypot(this.vx, this.vz);
    const posed = Boolean(this.seat) || this.mode === "moving";
    let targetYaw = this.bodyYaw;
    if (posed) targetYaw = this.yaw + Math.PI;
    else if (speed > 0.15) targetYaw = Math.atan2(this.vx, this.vz);
    else if (this.firstPerson) targetYaw = this.yaw + Math.PI;
    const k = this.reduced.matches ? 1 : 1 - Math.exp(-tuning.bodyTurnDamping * dt);
    this.bodyYaw += wrap(targetYaw - this.bodyYaw) * k;
    if (this.onBed) {
      // On the mattress the body is already over the edge. Elsewhere it rolls in with the chair.
      this.sitBlend = this.bodyClip === "Sitting_Idle_Loop" || this.bodyClip === "Sitting_Exit" ? 1 : 0;
    } else if (this.chair && this.seat?.chair) {
      this.sitBlend = this.inChair ? 1 - this.chairOffset / tuning.chairPull : 0;
    } else {
      const seatedClip = this.bodyClip === "Sitting_Enter" || this.bodyClip === "Sitting_Idle_Loop";
      const sitK = this.reduced.matches ? 1 : 1 - Math.exp(-tuning.sitBlendDamping * dt);
      this.sitBlend += ((seatedClip ? 1 : 0) - this.sitBlend) * sitK;
    }
    const forward = tuning.seatBodyForward * this.sitBlend;
    const lift = this.onBed && this.bodyClip === "Sitting_Idle_Loop" ? 0.05 : 0;
    person.root.position.set(this.x + Math.sin(this.bodyYaw) * forward, lift, this.z + Math.cos(this.bodyYaw) * forward);
    person.root.rotation.set(0, this.bodyYaw, 0);
    if (this.lying > 0) {
      // On the back along the bed, head at the wall. Blends into the seated pose as the player sits up.
      const k = ease(this.lying);
      const flat = new THREE.Vector3(BED_EYE.x + 1.62, 0.6, this.z);
      person.root.position.lerp(flat, k);
      person.root.quaternion.slerp(this.lyingQ, k);
    }
    const eyesInBody = armOn && this.cameraDistance < tuning.bodyHideDistance;
    // The controller moves the character. Clips are in place and only their playback rate follows speed.
    if (this.bodyClip) {
      this.playOn(person, this.bodyClip);
      const once = ONCE.has(this.bodyClip) && person.current;
      if (once && person.current!.time >= person.current!.getClip().duration - 0.02) this.bodyClip = NEXT[this.bodyClip] ?? null;
    } else if (speed > tuning.jogThreshold) {
      this.playOn(person, "Jog_Fwd_Loop");
      if (person.current) person.current.timeScale = speed / tuning.jogClipSpeed;
    } else if (speed > 0.15) {
      this.playOn(person, "Walk_Loop");
      if (person.current) person.current.timeScale = Math.max(0.6, speed / tuning.walkClipSpeed);
    } else this.playOn(person, "Idle_Loop");
    person.mixer.update(dt);
    if (eyesInBody && person.head) {
      // The camera is the player's eyes, so the head is brought to it and the body never crosses the view.
      person.root.updateMatrixWorld(true);
      const head = new THREE.Vector3().setFromMatrixPosition(person.head.matrixWorld);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0);
      person.root.position.x += this.camera.position.x - head.x - side.x * 0;
      person.root.position.z += this.camera.position.z - head.z;
      if (this.lying > 0) person.root.position.y += (this.camera.position.y - 0.1 - head.y) * ease(this.lying);
      // Slightly behind the eyes, so the chest stays out of the bottom of the frame.
      const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion).setY(0).normalize();
      person.root.position.addScaledVector(backward, 0.08);
    }
    if (person.head) {
      const hide = this.firstPerson && this.cameraDistance < tuning.bodyHideDistance && armOn;
      person.head.scale.setScalar(hide ? 0.001 : 1); // Never in front of the camera.
      this.headRest ??= person.head.position.clone();
      person.head.position.copy(this.headRest);
      if (hide) {
        // The collapsed head lands behind the viewer, so the collar can't fan across the frame.
        const behind = this.camera.position.clone().add(new THREE.Vector3(0, 0.12, 0.34).applyQuaternion(this.camera.quaternion));
        person.head.parent!.updateWorldMatrix(true, false);
        person.head.position.copy(person.head.parent!.worldToLocal(behind));
      }
    }
    this.stepArm();
  }

  private prompts(): WorldPrompt[] {
    if (this.mode !== "fixed" && this.mode !== "walk") return [];
    const forward = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const list = this.config.targets.filter(target => this.enabledIds.has(target.id) && this.canReach(target)).map(target => {
      const point = this.groundPoint(target);
      const to = new THREE.Vector2(point.x - this.x, point.z - this.z);
      const distance = to.length();
      const facing = distance > 0.01 ? to.normalize().dot(forward) : 1;
      // Lower is better. Essential objects win ties. Position and aim are the same in both camera modes.
      return { target, score: distance * (1.6 - facing) - (target.priority ?? 0) * 0.45 };
    }).sort((a, b) => a.score - b.score);
    return list.map(({ target }) => {
      const open = target.kind === "door" && target.doors?.some(id => this.doors.get(id)?.goal === 1);
      return { id: target.id, label: target.kind === "door" ? `${open ? "Close" : "Open"} ${target.label.toLowerCase()}` : target.label };
    });
  }

  private refreshPrompts() {
    const prompts = this.prompts();
    const key = `${this.mode}|${prompts.map(prompt => prompt.id + prompt.label).join()}`;
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
    this.canvas.removeEventListener("wheel", this.wheel);
    document.removeEventListener("pointerlockchange", this.lockChange);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("blur", this.releaseInput);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.audio?.dispose();
    this.body?.mixer.stopAllAction();
    for (const npc of this.npcs.values()) npc.mixer.stopAllAction();
    for (const screen of this.screens.values()) screen.texture.dispose();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of ([] as THREE.Material[]).concat(mesh.material)) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.map?.dispose(); standard.emissiveMap?.dispose(); standard.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // Otherwise each reopen keeps a WebGL context until the browser evicts one.
  }
}
