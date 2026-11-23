import * as THREE from "three";
import { useEffect, useRef, useState } from "react";
import { useFrame, ReactThreeFiber } from "@react-three/fiber";
import { useGLTF, useTexture, Text } from "@react-three/drei";
import {
  BallCollider,
  CuboidCollider,
  RigidBody,
  useRopeJoint,
  useSphericalJoint,
  RapierRigidBody,
} from "@react-three/rapier";

const segmentProps = {
  type: "dynamic",
  canSleep: true,
  colliders: false,
  angularDamping: 2,
  linearDamping: 2,
} as const;

// The band is a solid 3D strip rebuilt every frame, so it can twist with the card and loop through
// the ring. Samples run from the stitched end of the loop, around the ring, then up the rope.
const LOOP_SAMPLES = 24; // wrapped around the ring, rigid with the card
const FREE_SAMPLES = 64; // hanging from the physics rope
const ATTACH = LOOP_SAMPLES - 1; // sample where the band leaves the loop
const SAMPLES = ATTACH + FREE_SAMPLES;
const HALF_WIDTH = 0.11; // same width the old meshline band had
const HALF_THICKNESS = 0.006;
const TORSION = 7.5; // rad/s² per radian of twist (old "face the screen" pull had this stiffness)
const TOWARD_CAMERA = new THREE.Vector3(0, 0, 1);

// Loop around the ring's top bar, in card.glb model space (clip mesh: bar centre y≈1.224 z=0,
// ±0.024 deep, lowest y≈1.211 under the band edges), leaving room for the band's thickness.
// Starts at the stitched end behind the band, goes down, under the bar and back up the front.
const LOOP = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 1.3, 0.0223),
    new THREE.Vector3(0, 1.25, -0.0226),
    new THREE.Vector3(0, 1.2237, -0.0282),
    new THREE.Vector3(0, 1.2067, 0),
    new THREE.Vector3(0, 1.2237, 0.0282),
    new THREE.Vector3(0, 1.26, 0.0282),
    new THREE.Vector3(0, 1.3, 0.0282),
  ],
  false,
  "centripetal"
).getPoints(ATTACH);
const LOOP_EXIT = new THREE.Vector3(0, 1.36, 0.0282); // makes the band leave the loop straight up

// Vertices per sample: [corner, normal from face (0) or side (1), normal sign, v]. Corners are
// front-left, front-right, back-left, back-right; back face v is flipped so its print reads right.
const LAYOUT = [
  [0, 0, 1, 0], [1, 0, 1, 1], // front face
  [2, 0, -1, 1], [3, 0, -1, 0], // back face
  [0, 1, -1, 0], [2, 1, -1, 0], // left edge
  [1, 1, 1, 1], [3, 1, 1, 1], // right edge
] as const;
const points = Array.from({ length: SAMPLES }, () => new THREE.Vector3());
const tangents = Array.from({ length: SAMPLES }, () => new THREE.Vector3());
const sides = Array.from({ length: SAMPLES }, () => new THREE.Vector3());
const lengths = new Float32Array(SAMPLES);
const corners = Array.from({ length: 4 }, () => new THREE.Vector3());
const cardX = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

function createRibbon() {
  const geometry = new THREE.BufferGeometry();
  const count = SAMPLES * LAYOUT.length;
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  const index: number[] = [];
  for (let a = 0; a < (SAMPLES - 1) * 8; a += 8) {
    const b = a + 8; // same vertex on the next sample
    index.push(
      a, a + 1, b, a + 1, b + 1, b, // front
      a + 2, b + 2, a + 3, a + 3, b + 2, b + 3, // back
      a + 5, a + 4, b + 5, a + 4, b + 4, b + 5, // left edge
      a + 6, a + 7, b + 6, a + 7, b + 7, b + 6 // right edge
    );
  }
  geometry.setIndex(index);
  return geometry;
}

/**
 * Rebuilds the strip. `model` is the card's rendered glb group; `curve` goes from the loop exit up
 * the rope (points 0-1 are set here from the ring, 2+ by the caller from the physics bodies).
 * The free band faces the camera at the top, is parallel-transported down, then twisted gradually
 * so it meets the loop along the card's X axis. Returns that twist, unwrapped against the previous
 * frame so a full spin keeps winding the band instead of snapping back.
 */
function updateRibbon(
  geometry: THREE.BufferGeometry,
  curve: THREE.CatmullRomCurve3,
  model: THREE.Object3D,
  prevTwist: number
) {
  const last = SAMPLES - 1;
  cardX.set(1, 0, 0).applyQuaternion(model.getWorldQuaternion(_q)); // also updates matrixWorld
  curve.points[0].copy(LOOP[ATTACH]).applyMatrix4(model.matrixWorld);
  curve.points[1].copy(LOOP_EXIT).applyMatrix4(model.matrixWorld);
  for (let i = 0; i < ATTACH; i++) points[i].copy(LOOP[i]).applyMatrix4(model.matrixWorld);
  for (let i = ATTACH; i <= last; i++) curve.getPoint((i - ATTACH) / (last - ATTACH), points[i]);
  for (let i = 0; i <= last; i++) {
    tangents[i].subVectors(points[Math.min(i + 1, last)], points[Math.max(i - 1, 0)]).normalize();
    lengths[i] = i === 0 ? 0 : lengths[i - 1] + points[i].distanceTo(points[i - 1]);
  }

  sides[last].crossVectors(tangents[last], TOWARD_CAMERA).normalize();
  for (let i = last - 1; i >= ATTACH; i--)
    sides[i].copy(sides[i + 1]).applyQuaternion(_q.setFromUnitVectors(tangents[i + 1], tangents[i]));

  let twist = prevTwist;
  _v.copy(cardX).projectOnPlane(tangents[ATTACH]);
  if (_v.lengthSq() > 1e-6) {
    // (skipped for the instant the band runs exactly along the card's X axis)
    const s = sides[ATTACH], t = tangents[ATTACH];
    const raw = Math.atan2(_n.crossVectors(s, _v).dot(t), s.dot(_v));
    twist = raw + 2 * Math.PI * Math.round((prevTwist - raw) / (2 * Math.PI));
  }
  for (let i = ATTACH; i <= last; i++)
    sides[i].applyAxisAngle(tangents[i], twist * (1 - (i - ATTACH) / (last - ATTACH)));
  for (let i = 0; i < ATTACH; i++) sides[i].copy(cardX); // the loop is rigid with the card

  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i <= last; i++) {
    const p = points[i], side = sides[i];
    _n.crossVectors(side, tangents[i]).normalize();
    for (let c = 0; c < 4; c++)
      corners[c]
        .copy(p)
        .addScaledVector(side, c % 2 ? HALF_WIDTH : -HALF_WIDTH)
        .addScaledVector(_n, c < 2 ? HALF_THICKNESS : -HALF_THICKNESS);
    const u = (-3 * lengths[i]) / (lengths[last] || 1); // texture repeats 3x along the band, as before
    for (let k = 0; k < LAYOUT.length; k++) {
      const [c, fromSide, sign, v] = LAYOUT[k];
      const nrm = fromSide ? side : _n;
      position.setXYZ(i * 8 + k, corners[c].x, corners[c].y, corners[c].z);
      normal.setXYZ(i * 8 + k, nrm.x * sign, nrm.y * sign, nrm.z * sign);
      uv.setXY(i * 8 + k, u, v);
    }
  }
  position.needsUpdate = normal.needsUpdate = uv.needsUpdate = true;
  return twist;
}

export default function Band({ maxSpeed = 50, minSpeed = 10 }) {
  const fixed = useRef<RapierRigidBody>(null!);
  const j1 = useRef<RapierRigidBody>(null!);
  const j2 = useRef<RapierRigidBody>(null!);
  const j3 = useRef<RapierRigidBody>(null!);

  const card = useRef<RapierRigidBody>(null!);
  const model = useRef<THREE.Group>(null!);
  const twist = useRef(0);
  const [ribbon] = useState(createRibbon);
  const vec = new THREE.Vector3();
  const ang = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const [dragged, drag] = useState<THREE.Vector3 | false>(false);
  const [hovered, hover] = useState(false);

  const { nodes, materials } = useGLTF("/assets/3d/card.glb");
  const texture = useTexture("/assets/images/tag_texture.png", (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  });

  const [curve] = useState(
    () =>
      new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(),
          new THREE.Vector3(),
          new THREE.Vector3(),
          new THREE.Vector3(),
          new THREE.Vector3(),
        ],
        false,
        "chordal"
      )
  );

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);

  useSphericalJoint(j3, card, [
    [0, 0, 0],
    [0, 1.45, 0],
  ]);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? "grabbing" : "grab";
      return () => void (document.body.style.cursor = "auto");
    }
    return () => void (document.body.style.cursor = "auto");
  }, [hovered, dragged]);

  useFrame((state, delta) => {
    if (
      !fixed.current ||
      !j1.current ||
      !j2.current ||
      !model.current ||
      !card.current
    )
      return;

    if (dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      vec.add(dir.multiplyScalar(state.camera.position.length()));
      [card, j1, j2, j3, fixed].forEach((ref) => ref.current?.wakeUp());
      card.current?.setNextKinematicTranslation({
        x: vec.x - dragged.x,
        y: vec.y - dragged.y,
        z: vec.z - dragged.z,
      });
    }

    if (fixed.current) {
      const [j1Lerped, j2Lerped] = [j1, j2].map((ref) => {
        if (ref.current) {
          const lerped = new THREE.Vector3().copy(ref.current.translation());

          const clampedDistance = Math.max(
            0.1,
            Math.min(1, lerped.distanceTo(ref.current.translation()))
          );

          return lerped.lerp(
            ref.current.translation(),
            delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed))
          );
        }
      });

      // The band end follows the card's rendered (interpolated) model, not raw j3: with
      // `interpolate` the card is drawn up to one physics step behind j3.
      curve.points[2].copy(j2Lerped ?? j2.current.translation());
      curve.points[3].copy(j1Lerped ?? j1.current.translation());
      curve.points[4].copy(fixed.current.translation());
      twist.current = updateRibbon(ribbon, curve, model.current, twist.current);

      // Torsion: a twisted band turns the card back; at rest it keeps the card facing the screen.
      ang
        .copy(card.current.angvel())
        .addScaledVector(tangents[ATTACH], -TORSION * twist.current * delta);
      card.current.setAngvel(ang, Math.abs(twist.current) > 0.05);
    }
  });

  return (
    <>
      <group position={[0, 4.6, 0]}>
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />
        <RigidBody position={[0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>

        <RigidBody
          position={[2, 0, 0]}
          ref={card}
          {...segmentProps}
          type={dragged ? "kinematicPosition" : "dynamic"}
        >
          <CuboidCollider args={[0.8, 1.125, 0.01]} />
          <group
            ref={model}
            scale={2.25}
            position={[0, -1.25, -0.05]}
            onPointerOver={() => hover(true)}
            onPointerOut={() => hover(false)}
            onPointerUp={(e) => (
              (e.target as Element)?.releasePointerCapture(e.pointerId),
              drag(false)
            )}
            onPointerDown={(e) => (
              (e.target as Element)?.setPointerCapture(e.pointerId),
              card.current &&
                drag(
                  new THREE.Vector3()
                    .copy(e.point)
                    .sub(vec.copy(card.current.translation()))
                )
            )}
          >
            {/* @ts-expect-error geometry/map are not declared? */}
            <mesh geometry={nodes.card.geometry}>
              <meshPhysicalMaterial
                // @ts-expect-error geometry/map are not declared?
                map={materials.base.map}
                map-anisotropy={16}
                clearcoat={1}
                clearcoatRoughness={0.15}
                roughness={0.3}
                metalness={0.5}
              />
            </mesh>
            <Text
              position={[-0.30, 0.10, 0.01]}
              fontSize={0.06}
              color="white"
              anchorX="left"
              anchorY="bottom"
              font="https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf"
            >
              Daffa Haidar
            </Text>
            <mesh
              // @ts-expect-error geometry/map are not declared?
              geometry={nodes.clip.geometry}
              material={materials.metal}
              material-roughness={0.3}
            />
            {/* @ts-expect-error geometry/map are not declared? */}
            <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
          </group>
        </RigidBody>
      </group>
      <mesh geometry={ribbon} frustumCulled={false}>
        <meshStandardMaterial map={texture} />
      </mesh>
    </>
  );
}
