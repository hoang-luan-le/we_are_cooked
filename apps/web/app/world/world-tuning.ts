// The one place to tune how the 3D scenes feel. Values are SI units (metres, seconds, radians).
export const tuning = {
  walkSpeed: 2.3,
  sprintSpeed: 3.4,
  acceleration: 13,
  braking: 19,
  lookSensitivity: 0.0021,
  keyTurnSpeed: 2.1,
  cameraDamping: 24,
  pitchLimit: 1.25,
  capsuleRadius: 0.32,
  eyeHeight: 1.6,
  interactionDistance: 1.35,
  seatTransitionMs: 520,
  doorTransitionMs: 380,
  maxDelta: 0.05,
} as const;
