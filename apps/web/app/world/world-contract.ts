// Names in this file are node names in the exported GLBs. Coordinates are glTF: +Y up, office inbound is +Z.
export type SceneId = "bedroom" | "office";
export type Palette = { top: string; legs: string; hair: string; skin: string; shoes: string };
export type PanelId = "setup" | "incident-board" | "briefing" | "workstation-1" | "workstation-2";

export type PropAction =
  | { type: "light"; light: string; glow: string; on: string; off: string }
  | { type: "blinds"; open: string; closed: string }
  | { type: "message"; text: string };

export type Target = {
  id: string;
  label: string;
  /** Node whose ground position is measured for reach. */
  anchor?: string;
  range?: number;
  point?: [number, number];
  kind: "phone" | "seat" | "door" | "panel" | "prop";
  panel?: PanelId;
  /** How far from the screen the camera settles before the panel opens. */
  seat?: { root: string; look: string; focus: number; chair?: string };
  doors?: string[];
  /** Doors that "Go to" opens on the way. */
  via?: string[];
  /** Ground point used by "Go to" when the target has no seat. */
  stand?: [number, number];
  action?: PropAction;
  /** Higher wins when targets compete for focus. Essential objects outrank environmental ones. */
  priority?: number;
};

type RigLight =
  | { type: "point"; id?: string; position: [number, number, number]; color: string; intensity: number; distance: number }
  | { type: "sun"; from: [number, number, number]; color: string; intensity: number };

export type SceneConfig = {
  id: SceneId;
  url: string;
  still: string;
  title: string;
  spawn: string;
  look: [number, number, number];
  exposure: number;
  ceilingY: number;
  player: Palette;
  ambient: { sky: string; ground: string; intensity: number };
  lights: RigLight[];
  targets: Target[];
  doors: { id: string; pivot: string; leaf: string }[];
};

export const playerModelUrl = "/world/player.glb";
export const coworkers = {
  dana: { avatar: "Avatar_Placeholder_Dana", model: "/world/dana.glb", palette: { top: "#2a3b57", legs: "#2c2f38", hair: "#3a241a", skin: "#b98565", shoes: "#16171b" } as Palette },
  teammate: { avatar: "Avatar_Placeholder_Teammate", model: "/world/teammate.glb", palette: { top: "#b58a3d", legs: "#3b4250", hair: "#14100d", skin: "#8a5a3e", shoes: "#2b2c31" } as Palette },
};

export const bedroom: SceneConfig = {
  id: "bedroom",
  url: "/world/bedroom.glb",
  still: "/world/bedroom-still.png",
  title: "ShopNorth on-call, 2:04 a.m.",
  spawn: "bedroom_spawn",
  look: [-1.3, 0.82, 0.95],
  exposure: 0.95,
  ceilingY: 2.78,
  player: { top: "#59626f", legs: "#2d3644", hair: "#1f1712", skin: "#c79274", shoes: "#3a3d44" },
  ambient: { sky: "#5a6da3", ground: "#2a2436", intensity: 0.95 },
  lights: [
    { type: "point", id: "bedside", position: [-1.69, 1.1, 0.98], color: "#ffa95e", intensity: 2.0, distance: 3.6 },
    { type: "point", position: [-1.25, 1.25, 0.25], color: "#ffb26f", intensity: 0.5, distance: 3 },
    { type: "point", id: "desk", position: [0.46, 1.1, 1.44], color: "#ffc98a", intensity: 1.0, distance: 2.4 },
    { type: "point", position: [-0.55, 1.7, 1.6], color: "#7f9fff", intensity: 2.4, distance: 5 },
    { type: "point", position: [1.2, 2.3, -0.6], color: "#8a93c4", intensity: 2.2, distance: 6.5 },
  ],
  doors: [],
  targets: [
    { id: "phone", label: "Check the phone", anchor: "bedroom_phone_anchor", kind: "phone", range: 2.4, priority: 3 },
    {
      id: "computer", label: "Sit at the computer", anchor: "chair_bedroom_desk_approach", kind: "seat", panel: "incident-board", priority: 3,
      seat: { root: "chair_bedroom_desk", look: "bedroom_screen_plane", focus: 0.62, chair: "Chair_Bedroom_Desk" },
    },
    { id: "lamp", label: "Bedside lamp", anchor: "Prop_BedsideLamp_Kenney", kind: "prop", range: 1.5, priority: 1,
      action: { type: "light", light: "bedside", glow: "lampRoundTable(Clone)", on: "Lamp on.", off: "Lamp off." } },
    { id: "desk-lamp", label: "Desk lamp", point: [0.34, 1.52], kind: "prop", range: 1.3, priority: 1,
      action: { type: "light", light: "desk", glow: "Bedroom_DeskLamp_Bulb", on: "Desk lamp on.", off: "Desk lamp off." } },
    { id: "blinds", label: "Adjust the blinds", point: [-0.55, 2.0], kind: "prop", range: 1.6, priority: 1,
      action: { type: "blinds", open: "Blinds open. Moonlight on the floor.", closed: "Blinds closed." } },
    { id: "clock", label: "Read the clock", anchor: "bedroom_clock_anchor", kind: "prop", range: 1.5, priority: 2,
      action: { type: "message", text: "2:04 a.m. The alert fired just now." } },
    { id: "bed", label: "Look at the bed", point: [-1.2, -0.08], kind: "prop", range: 1.6, priority: 0,
      action: { type: "message", text: "Not tonight. Checkout is still down." } },
  ],
};

const toEntrance = ["office_entrance_left", "office_entrance_right"];

export const office: SceneConfig = {
  id: "office",
  url: "/world/office.glb",
  still: "/world/office-still.png",
  title: "ShopNorth office, morning",
  spawn: "office_exterior_spawn",
  look: [0, 1.4, 6],
  exposure: 0.98,
  ceilingY: 3.15,
  player: { top: "#3f6187", legs: "#242a36", hair: "#1f1712", skin: "#c79274", shoes: "#191a1e" },
  ambient: { sky: "#c9dcf5", ground: "#cfc5b4", intensity: 1.55 },
  lights: [
    { type: "sun", from: [0.42, 0.46, -0.78], color: "#fff0d6", intensity: 3.8 },
    { type: "point", position: [0, 2.9, 3], color: "#ffeed2", intensity: 5, distance: 11 },
    { type: "point", position: [0, 2.9, 8.5], color: "#ffeed2", intensity: 5, distance: 11 },
    { type: "point", position: [-4.5, 2.6, 9], color: "#ffeed2", intensity: 6, distance: 9 },
    { type: "point", position: [4.5, 2.6, 9], color: "#ffffff", intensity: 6, distance: 9 },
  ],
  doors: [
    { id: "office_entrance_left", pivot: "door_office_entrance_left_pivot", leaf: "Door_office_entrance_left_Leaf" },
    { id: "office_entrance_right", pivot: "door_office_entrance_right_pivot", leaf: "Door_office_entrance_right_Leaf" },
    { id: "meeting_room", pivot: "door_meeting_room_pivot", leaf: "Door_meeting_room_Leaf" },
    { id: "workstation_bay", pivot: "door_workstation_bay_pivot", leaf: "Door_workstation_bay_Leaf" },
  ],
  targets: [
    { id: "entrance", label: "Entrance doors", anchor: "office_entrance_anchor", kind: "door", range: 1.7, doors: toEntrance, priority: 3 },
    { id: "meeting-door", label: "Meeting room door", point: [-2, 7.43], kind: "door", range: 1.7, doors: ["meeting_room"], priority: 3 },
    { id: "work-door", label: "Workstation bay door", point: [2, 7.43], kind: "door", range: 1.7, doors: ["workstation_bay"], priority: 3 },
    {
      id: "meeting-seat", label: "Sit for the briefing", anchor: "chair_meeting_seat_1_approach", kind: "seat", panel: "briefing", priority: 3,
      seat: { root: "chair_meeting_seat_1", look: "office_project_screen_plane", focus: 2.3, chair: "Chair_Meeting_1" }, via: [...toEntrance, "meeting_room"],
    },
    { id: "dana", label: "Join Dana's briefing", anchor: "office_dana_briefing_anchor", kind: "panel", panel: "briefing", range: 1.9, stand: [-5.2, 10.75],
      via: [...toEntrance, "meeting_room"], priority: 3 },
    { id: "projector", label: "Read the meeting display", point: [-4.5, 11.1], kind: "panel", panel: "briefing", range: 2.2, priority: 2 },
    {
      id: "desk-1", label: "Sit at workstation 1", anchor: "chair_office_ws1_approach", kind: "seat", panel: "workstation-1", priority: 3,
      seat: { root: "chair_office_ws1", look: "office_workstation_1_screen_plane", focus: 0.66, chair: "Chair_WS1" }, via: [...toEntrance, "workstation_bay"],
    },
    {
      id: "desk-2", label: "Sit at workstation 2", anchor: "chair_office_ws2_approach", kind: "seat", panel: "workstation-2", priority: 3,
      seat: { root: "chair_office_ws2", look: "WS2_Laptop_Screen", focus: 0.42, chair: "Chair_WS2" }, via: [...toEntrance, "workstation_bay"],
    },
    { id: "directory", label: "Read the directory", point: [1.35, 2.75], kind: "prop", range: 1.5, priority: 1,
      action: { type: "message", text: "Directory: Dana's Meeting Room is down the hall on the right. Workstations are on the left." } },
    { id: "reception", label: "Ask at reception", point: [-2.6, 2.75], kind: "prop", range: 1.6, priority: 1,
      action: { type: "message", text: "Reception is unstaffed this morning. A note says: Incident review in MR-204." } },
    { id: "hall-sign", label: "Check the hallway sign", point: [0, 7.1], kind: "prop", range: 2.2, priority: 0,
      action: { type: "message", text: "Dana Briefing Room to the right. Eng Workstations to the left." } },
    { id: "teammate", label: "Greet your teammate", anchor: "Avatar_Placeholder_Teammate", kind: "prop", range: 1.6, priority: 1,
      action: { type: "message", text: "\"Morning. Dana's walking us through last night.\"" } },
  ],
};

/** Argon's single world-to-map transform (REV3 report section 4), inside the 180 px minimap frame. */
export function toMinimap(x: number, z: number) {
  return { u: 20 + ((7 - x) / 14) * 140, v: 46 + ((12 - z) / 16.5) * 132 };
}

/** Clockwise degrees on the map. Map up is +Z and map left is +X. */
export function mapHeading(forwardX: number, forwardZ: number) {
  return (Math.atan2(-forwardX, forwardZ) * 180) / Math.PI;
}
