import * as THREE from "three";

// Two-bone arm solve and a phone grip for the Rocketbox skeleton. Runs after the mixer each frame.
const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();

type Joint = { bone: THREE.Object3D; base: THREE.Quaternion; axis: THREE.Vector3; curl: number };
export type Arm = {
  upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D;
  l1: number; l2: number; joints: Joint[];
  /** Bind-pose hand orientation against its finger, knuckle and palm directions. */
  handBasis: THREE.Quaternion; handBind: THREE.Quaternion;
};

const pos = (o: THREE.Object3D, out: THREE.Vector3) => out.setFromMatrixPosition(o.matrixWorld);

/** Call while the character is still in its bind pose. */
export function findRightArm(root: THREE.Object3D): Arm | undefined {
  const get = (n: string) => root.getObjectByName(`Bip01_R_${n}`);
  const upper = get("UpperArm"), fore = get("Forearm"), hand = get("Hand");
  const f1 = get("Finger1"), f2 = get("Finger2"), f4 = get("Finger4");
  if (!upper || !fore || !hand || !f1 || !f2 || !f4) return undefined;
  root.updateMatrixWorld(true);
  const dir = pos(f2, new THREE.Vector3()).sub(pos(hand, v0)).normalize();
  const across = pos(f1, new THREE.Vector3()).sub(pos(f4, v1));
  across.addScaledVector(dir, -across.dot(dir)).normalize();
  const palm = new THREE.Vector3().crossVectors(across, dir).normalize();
  const handBind = hand.getWorldQuaternion(new THREE.Quaternion());
  const handBasis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, across, palm));
  const joints: Joint[] = [];
  const add = (name: string, curl: number) => {
    const bone = get(name);
    if (!bone) return;
    const inverse = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    joints.push({ bone, base: bone.quaternion.clone(), axis: across.clone().applyQuaternion(inverse).normalize(), curl });
  };
  for (const n of [1, 2, 3, 4]) { add(`Finger${n}`, 0.95); add(`Finger${n}1`, 1.0); add(`Finger${n}2`, 0.6); }
  add("Finger0", 0.15); add("Finger01", 0.3); add("Finger02", 0.3);
  return { upper, fore, hand, joints, handBasis, handBind,
    l1: pos(upper, v0).distanceTo(pos(fore, v1)), l2: pos(fore, v0).distanceTo(pos(hand, v1)) };
}

function aim(bone: THREE.Object3D, tip: THREE.Vector3, goal: THREE.Vector3) {
  pos(bone, v0);
  v1.copy(tip).sub(v0).normalize();
  v2.copy(goal).sub(v0).normalize();
  q0.setFromUnitVectors(v1, v2);
  bone.getWorldQuaternion(q1);
  q1.premultiply(q0);
  bone.parent!.getWorldQuaternion(q2).invert();
  bone.quaternion.copy(q2.multiply(q1));
  bone.updateWorldMatrix(false, true);
}

/** Moves the wrist toward `wrist` by `weight`, bending the elbow toward `pole`. */
export function solveArm(arm: Arm, wrist: THREE.Vector3, pole: THREE.Vector3, weight: number) {
  if (weight <= 0) return;
  const shoulder = pos(arm.upper, new THREE.Vector3());
  const current = pos(arm.hand, new THREE.Vector3());
  const goal = current.clone().lerp(wrist, weight);
  const toGoal = goal.clone().sub(shoulder);
  const distance = Math.min(toGoal.length(), (arm.l1 + arm.l2) * 0.995);
  const dir = toGoal.normalize();
  const along = (arm.l1 * arm.l1 - arm.l2 * arm.l2 + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, arm.l1 * arm.l1 - along * along));
  const side = pole.clone().sub(shoulder);
  side.addScaledVector(dir, -side.dot(dir)).normalize();
  const elbow = shoulder.clone().addScaledVector(dir, along).addScaledVector(side, height);
  aim(arm.upper, pos(arm.fore, v3), elbow);
  const end = shoulder.clone().addScaledVector(dir, distance);
  aim(arm.fore, pos(arm.hand, v3), end);
}

/** Orients the hand to a grip given as world directions, and curls the fingers. */
export function gripHand(arm: Arm, dir: THREE.Vector3, across: THREE.Vector3, palm: THREE.Vector3, weight: number) {
  m0.makeBasis(dir, across, palm);
  q0.setFromRotationMatrix(m0);
  m1.identity();
  const target = q0.clone().multiply(arm.handBasis.clone().invert()).multiply(arm.handBind);
  arm.hand.getWorldQuaternion(q1);
  q1.slerp(target, weight);
  arm.hand.parent!.getWorldQuaternion(q2).invert();
  arm.hand.quaternion.copy(q2.multiply(q1));
  for (const joint of arm.joints) {
    joint.bone.quaternion.copy(joint.base);
    joint.bone.rotateOnAxis(joint.axis, joint.curl * weight);
  }
  arm.hand.updateWorldMatrix(false, true);
}

export function releaseFingers(arm: Arm) {
  for (const joint of arm.joints) joint.bone.quaternion.copy(joint.base);
}
