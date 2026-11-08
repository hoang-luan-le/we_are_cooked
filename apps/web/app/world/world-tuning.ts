// The one place to tune how the 3D scenes feel. Values are SI units (metres, seconds, radians).
export const tuning = {
  walkSpeed: 1.7,
  sprintSpeed: 3.0,
  /** Ground speed each clip was authored for, measured from its foot travel. Keeps feet planted. */
  walkClipSpeed: 1.0,
  jogClipSpeed: 2.545,
  jogThreshold: 2.1,
  acceleration: 10,
  braking: 14,
  lookSensitivity: 0.0021,
  keyTurnSpeed: 2.1,
  cameraDamping: 24,
  pitchLimit: 1.25,
  capsuleRadius: 0.32,
  eyeHeight: 1.6,
  interactionDistance: 1.35,
  approachSpeed: 1.6,
  turnToSeatMs: 240,
  seatTransitionMs: 820,
  /** The sit clip leaves the hips this far behind the feet. Moving the body forward puts the hips on the chair. */
  seatBodyForward: 0.318,
  seatSideStep: 0.62,
  /** The chair rolls back this far so the player can stand in front of it, then in again with them. */
  chairPull: 0.32,
  chairRollMs: 430,
  sitBlendDamping: 7,
  standTransitionMs: 780,
  monitorFocusMs: 460,
  doorTransitionMs: 380,
  maxDelta: 0.05,

  // Scroll camera. Requested zoom is the player's choice. Collision only shortens the arm.
  zoomMax: 3.4,
  zoomStep: 0.35,
  /** Scrolling in to this distance or less selects first person. */
  firstPersonEnter: 0.55,
  /** Scrolling out to this distance or more selects third person. The gap stops flicker. */
  firstPersonExit: 0.85,
  /** Distance used by the view toggle and the first scroll out. */
  thirdPersonDefault: 2.2,
  /** Third-person camera sits above and beside the head, so the character never blocks the view. */
  shoulderOffset: 0.38,
  shoulderRise: 0.22,
  zoomDamping: 12,
  armRecoverDamping: 6,
  /** How fast the camera comes in for a wall. Fast, but a move rather than a cut. */
  armPullDamping: 26,
  armPullSpeed: 3.2,
  armRecoverSpeed: 2,
  cameraRadius: 0.16,
  /** The character is hidden when the camera is closer than this, so it can't cover the view. */
  bodyHideDistance: 0.45,
  characterScale: 1,
  bodyTurnDamping: 12,
} as const;
