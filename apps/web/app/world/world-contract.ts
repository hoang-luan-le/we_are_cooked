// Names in this file are node names in the exported GLBs. Coordinates are glTF: +Y up, office inbound is +Z.
export type SceneId = "bedroom" | "office";
export type PanelId = "incident-board" | "briefing" | "workstation-1" | "workstation-2";

export type Target = {
  id: string;
  label: string;
  /** Node whose ground position is measured for reach. */
  anchor: string;
  range?: number;
  point?: [number, number];
  kind: "phone" | "seat" | "door" | "panel";
  panel?: PanelId;
  seat?: { root: string; look: string };
  doors?: string[];
  /** Doors that "Go to" opens on the way. */
  via?: string[];
  /** Ground point used by "Go to" when the target has no seat. */
  stand?: [number, number];
};

type RigLight =
  | { type: "point"; position: [number, number, number]; color: string; intensity: number; distance: number }
  | { type: "sun"; from: [number, number, number]; color: string; intensity: number };

export type SceneConfig = {
  id: SceneId;
  url: string;
  still: string;
  title: string;
  spawn: string;
  look: [number, number, number];
  exposure: number;
  ambient: { sky: string; ground: string; intensity: number };
  lights: RigLight[];
  targets: Target[];
  doors: { id: string; pivot: string; leaf: string }[];
};

export const bedroom: SceneConfig = {
  id: "bedroom",
  url: "/world/bedroom.glb",
  still: "/world/bedroom-still.png",
  title: "ShopNorth on-call, 2:04 a.m.",
  spawn: "bedroom_spawn",
  look: [-1.3, 0.82, 0.95],
  exposure: 0.95,
  ambient: { sky: "#4a5f96", ground: "#1c1a28", intensity: 0.55 },
  lights: [
    { type: "point", position: [-1.69, 1.1, 0.98], color: "#ffa95e", intensity: 2.0, distance: 3.6 },
    { type: "point", position: [-1.25, 1.25, 0.25], color: "#ffb26f", intensity: 0.5, distance: 3 },
    { type: "point", position: [0.46, 1.1, 1.44], color: "#ffc98a", intensity: 1.0, distance: 2.4 },
    { type: "point", position: [-0.55, 1.7, 1.6], color: "#7f9fff", intensity: 2.4, distance: 5 },
  ],
  doors: [],
  targets: [
    { id: "phone", label: "Check the phone", anchor: "bedroom_phone_anchor", kind: "phone", range: 2.4 },
    {
      id: "computer", label: "Sit at the computer", anchor: "chair_bedroom_desk_approach", kind: "seat", panel: "incident-board",
      seat: { root: "chair_bedroom_desk", look: "bedroom_screen_plane" },
    },
  ],
};

export const office: SceneConfig = {
  id: "office",
  url: "/world/office.glb",
  still: "/world/office-still.png",
  title: "ShopNorth office, morning",
  spawn: "office_exterior_spawn",
  look: [0, 1.4, 6],
  exposure: 1.05,
  ambient: { sky: "#cfe0f5", ground: "#d8d0c2", intensity: 1.9 },
  lights: [
    { type: "sun", from: [0.42, 0.46, -0.78], color: "#fff0d6", intensity: 3.2 },
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
    { id: "entrance", label: "Entrance doors", anchor: "office_entrance_anchor", kind: "door", range: 1.7, doors: ["office_entrance_left", "office_entrance_right"] },
    { id: "meeting-door", label: "Meeting room door", anchor: "office_meeting_room_anchor", point: [-2, 7.43], kind: "door", range: 1.7, doors: ["meeting_room"] },
    { id: "work-door", label: "Workstation bay door", anchor: "office_workstation_door_anchor", point: [2, 7.43], kind: "door", range: 1.7, doors: ["workstation_bay"] },
    {
      id: "dana", label: "Join Dana's briefing", anchor: "office_dana_briefing_anchor", kind: "panel", panel: "briefing", range: 1.9, stand: [-5.2, 10.75],
      via: ["office_entrance_left", "office_entrance_right", "meeting_room"],
    },
    {
      id: "meeting-seat", label: "Sit for the briefing", anchor: "chair_meeting_seat_1_approach", kind: "seat", panel: "briefing",
      seat: { root: "chair_meeting_seat_1", look: "office_project_screen_plane" }, via: ["office_entrance_left", "office_entrance_right", "meeting_room"],
    },
    {
      id: "desk-1", label: "Sit at workstation 1", anchor: "chair_office_ws1_approach", kind: "seat", panel: "workstation-1",
      seat: { root: "chair_office_ws1", look: "office_workstation_1_screen_plane" }, via: ["office_entrance_left", "office_entrance_right", "workstation_bay"],
    },
    {
      id: "desk-2", label: "Sit at workstation 2", anchor: "chair_office_ws2_approach", kind: "seat", panel: "workstation-2",
      seat: { root: "chair_office_ws2", look: "WS2_Laptop_Screen" }, via: ["office_entrance_left", "office_entrance_right", "workstation_bay"],
    },
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
