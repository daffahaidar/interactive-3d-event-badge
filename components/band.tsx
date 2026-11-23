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

// The band is a flat 3D ribbon rebuilt every frame, so it can twist with the card.
const SEGMENTS = 64;
const HALF_WIDTH = 0.11; // same width the old meshline band had
const TOWARD_CAMERA = new THREE.Vector3(0, 0, 1);
const points = Array.from({ length: SEGMENTS }, () => new THREE.Vector3());
const tangents = Array.from({ length: SEGMENTS }, () => new THREE.Vector3());
const sides = Array.from({ length: SEGMENTS }, () => new THREE.Vector3());
const lengths = new Float32Array(SEGMENTS);
const cardRotation = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

function createRibbon() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SEGMENTS * 6), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(SEGMENTS * 6), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(SEGMENTS * 4), 2));
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2; // vertices a / a+1 = left / right edge of sample i
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  return geometry;
}

/**
 * Lays the ribbon along `curve` (t=0 at the card clip, t=1 at the fixed top). The width axis faces
 * the camera at the top, is parallel-transported down the band, then twisted gradually so at the
 * clip it matches the card's X axis. Returns the twist, unwrapped against the previous frame so a
 * full spin keeps winding the band (like a real lanyard) instead of snapping back.
 */
function updateRibbon(
  geometry: THREE.BufferGeometry,
  curve: THREE.Curve<THREE.Vector3>,
  cardQuaternion: THREE.Quaternion,
  prevTwist: number
) {
  const last = SEGMENTS - 1;
  for (let i = 0; i <= last; i++) curve.getPoint(i / last, points[i]);
  for (let i = 0; i <= last; i++) {
    tangents[i].subVectors(points[Math.min(i + 1, last)], points[Math.max(i - 1, 0)]).normalize();
    lengths[i] = i === 0 ? 0 : lengths[i - 1] + points[i].distanceTo(points[i - 1]);
  }

  sides[last].crossVectors(tangents[last], TOWARD_CAMERA).normalize();
  for (let i = last - 1; i >= 0; i--)
    sides[i].copy(sides[i + 1]).applyQuaternion(_q.setFromUnitVectors(tangents[i + 1], tangents[i]));

  let twist = prevTwist;
  _v.set(1, 0, 0).applyQuaternion(cardQuaternion).projectOnPlane(tangents[0]);
  if (_v.lengthSq() > 1e-6) {
    // (skipped for the instant the band runs exactly along the card's X axis)
    const raw = Math.atan2(_n.crossVectors(sides[0], _v).dot(tangents[0]), sides[0].dot(_v));
    twist = raw + 2 * Math.PI * Math.round((prevTwist - raw) / (2 * Math.PI));
  }

  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i <= last; i++) {
    const p = points[i];
    const s = sides[i].applyAxisAngle(tangents[i], twist * (1 - i / last)).multiplyScalar(HALF_WIDTH);
    _n.crossVectors(s, tangents[i]).normalize();
    const u = (-3 * lengths[i]) / (lengths[last] || 1); // texture repeats 3x along the band, as before
    position.setXYZ(2 * i, p.x - s.x, p.y - s.y, p.z - s.z);
    position.setXYZ(2 * i + 1, p.x + s.x, p.y + s.y, p.z + s.z);
    normal.setXYZ(2 * i, _n.x, _n.y, _n.z);
    normal.setXYZ(2 * i + 1, _n.x, _n.y, _n.z);
    uv.setXY(2 * i, u, 0);
    uv.setXY(2 * i + 1, u, 1);
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
  const anchor = useRef<THREE.Object3D>(null!);
  const twist = useRef(0);
  const [ribbon] = useState(createRibbon);
  const vec = new THREE.Vector3();
  const ang = new THREE.Vector3();
  const rot = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const [dragged, drag] = useState<THREE.Vector3 | false>(false);
  const [hovered, hover] = useState(false);

  const { nodes, materials } = useGLTF("/assets/3d/card.glb");
  const texture = useTexture("/assets/images/tag_texture.png", (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  });
  const [backTexture] = useState(() => {
    const t = texture.clone();
    t.repeat.y = -1; // flip across the width so the print isn't mirrored when seen from behind
    return t;
  });

  const [curve] = useState(
    () =>
      new THREE.CatmullRomCurve3(
        [
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
      !anchor.current ||
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

      // Rendered (interpolated) clip position, not raw j3: with `interpolate` the card is drawn
      // up to one physics step behind j3, which pulled the band off the clip while swinging.
      anchor.current.getWorldPosition(curve.points[0]);
      curve.points[1].copy(j2Lerped ?? j2.current.translation());
      curve.points[2].copy(j1Lerped ?? j1.current.translation());
      curve.points[3].copy(fixed.current.translation());
      twist.current = updateRibbon(
        ribbon,
        curve,
        anchor.current.getWorldQuaternion(cardRotation),
        twist.current
      );

      ang.copy(card.current.angvel());
      rot.copy(card.current.rotation());
      card.current.setAngvel(
        { x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z },
        false
      );
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
          {/* Band end, same point as the spherical joint anchor above */}
          <object3D ref={anchor} position={[0, 1.45, 0]} />
          <group
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
      {/* Same ribbon geometry twice: front and back face, each with its own texture */}
      <mesh geometry={ribbon} frustumCulled={false}>
        <meshStandardMaterial map={texture} />
      </mesh>
      <mesh geometry={ribbon} frustumCulled={false}>
        <meshStandardMaterial map={backTexture} side={THREE.BackSide} />
      </mesh>
    </>
  );
}
