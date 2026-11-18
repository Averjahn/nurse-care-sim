import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { KTX2Loader, type GLTFLoader } from 'three-stdlib'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { BED_BONES, bedAngles, patientMorphs, patientPose, validatePatientRig, type AnimationClock } from './patientAnimation'
import { applyRigMorphs, applyRigSkin, bindRigClips, cleanRigClothing, cloneRigMaterials, mergeRigClips, rigInventory } from './rigAssets'
import { CompressionPlayback, RigPlayback } from './rigPlayback'
import type { PatientState } from './simulation'

const ROOT = import.meta.env.BASE_URL
const PATIENT_ASSETS = [`${ROOT}models/patient-rigged.glb`, `${ROOT}models/patient-anims.glb`] as const
const BED_ASSETS = [`${ROOT}models/bed-articulated.glb`] as const

function useAssetAvailability(paths: readonly string[]) {
  const [available, setAvailable] = useState<boolean[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all(paths.map(async path => {
      try {
        const response = await fetch(path, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
        const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
        return response.ok && (type === 'model/gltf-binary' || type === 'application/octet-stream')
      } catch { return false }
    })).then(result => { if (!controller.signal.aborted) setAvailable(result) })
    return () => controller.abort()
  }, [paths])
  return available
}
function useRigGLTF(paths: string[]) {
  const { gl } = useThree()
  const [ktx2] = useState(() => new KTX2Loader().setTranscoderPath(`${ROOT}decoders/basis/`).detectSupport(gl))
  const extend = useCallback((loader: GLTFLoader) => { loader.setKTX2Loader(ktx2) }, [ktx2])
  // Decoders are served from the same base path on localhost and GitHub Pages.
  const assets = useGLTF(paths, `${ROOT}decoders/draco/`, true, extend)
  useEffect(() => () => { ktx2.dispose() }, [ktx2])
  return assets
}
export class RigAssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError?: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.warn('Риг не загружен; сохранена резервная сцена.', error.message); this.props.onError?.() }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
export function AnimatedPatient({ patient, clock, fallback }: { patient: PatientState; clock: AnimationClock; fallback: ReactNode }) {
  const available = useAssetAvailability(PATIENT_ASSETS)
  if (!available?.[0]) return fallback
  const paths = available[1] ? [...PATIENT_ASSETS] : [PATIENT_ASSETS[0]]
  return <RigAssetBoundary key={`${clock.attemptId}:${paths.join('|')}`} fallback={fallback}>
    <Suspense fallback={fallback}><RiggedPatient patient={patient} clock={clock} paths={paths}/></Suspense>
  </RigAssetBoundary>
}
function RiggedPatient({ patient, clock, paths }: { patient: PatientState; clock: AnimationClock; paths: string[] }) {
  const loaded = useRigGLTF(paths)
  const prepared = useMemo(() => {
    const object = cloneSkeleton(loaded[0].scene)
    object.userData.patientRenderer = 'rigged'
    const materials = cloneRigMaterials(object)
    try {
      const clips = bindRigClips(object, mergeRigClips(loaded[0].animations, loaded[1]?.animations ?? []))
      const result = validatePatientRig(rigInventory(object, clips))
      if (!result.ok) throw new Error(result.errors.join(' '))
      for (const warning of result.warnings) console.warn(warning)
      const morphMeshes: THREE.Mesh[] = [], skin: { material: THREE.MeshStandardMaterial; base: THREE.Color; roughness: number }[] = []
      object.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return
        if (node.morphTargetDictionary && node.morphTargetInfluences) morphMeshes.push(node)
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof THREE.MeshStandardMaterial && /skin|face|lips/i.test(material.name)) skin.push({ material, base: material.color.clone(), roughness: material.roughness })
          // This material is the clothing primitive split from our supplied GLB.
          if (material instanceof THREE.MeshStandardMaterial && material.name.startsWith('tripo_material_')) cleanRigClothing(material)
        }
      })
      return { object, materials, clips: clips.filter(c => c.name !== 'compression'), compression: clips.filter(c => c.name === 'compression'), morphMeshes, skin }
    } catch (error) { materials.forEach(material => material.dispose()); throw error }
  }, [loaded])
  const { actions, mixer } = useAnimations(prepared.clips, prepared.object)
  const compression = useAnimations(prepared.compression, prepared.object)
  const playback = useRef<RigPlayback | null>(null)
  const pose = patientPose(patient)
  const initialPose = useRef(pose)
  const initialCompression = useRef(clock.compressions)
  const compressionPlayer = useRef<CompressionPlayback | null>(null)
  const visualTime = useRef(patient.secondsSinceOnset)
  useLayoutEffect(() => {
    playback.current = new RigPlayback(mixer, actions, initialPose.current)
    return () => { playback.current?.dispose(); playback.current = null }
  }, [mixer, actions])
  useLayoutEffect(() => { playback.current?.transition(pose) }, [pose])
  useLayoutEffect(() => {
    compressionPlayer.current = new CompressionPlayback(compression.mixer, compression.actions.compression!, initialCompression.current)
    return () => { compressionPlayer.current?.dispose(); compressionPlayer.current = null }
  }, [compression.mixer, compression.actions])
  useLayoutEffect(() => {
    playback.current?.clock(clock.speed, clock.paused)
    compressionPlayer.current?.clock(clock.paused)
  }, [clock.speed, clock.paused])
  useEffect(() => { compressionPlayer.current?.count(clock.compressions) }, [clock.compressions])
  useEffect(() => () => {
    prepared.materials.forEach(material => material.dispose())
    const skeletons = new Set<THREE.Skeleton>()
    prepared.object.traverse(node => { if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton) })
    skeletons.forEach(skeleton => skeleton.dispose())
  }, [prepared])
  useFrame((_, delta) => {
    if (!clock.paused) visualTime.current += delta * clock.speed
    const targets = patientMorphs(patient, visualTime.current)
    const compressing = compression.actions.compression?.isRunning() ?? false
    applyRigMorphs(prepared.morphMeshes, targets, prepared.compression[0], compressing)
    applyRigSkin(prepared.skin, patient.skin)
  })
  return <primitive object={prepared.object} dispose={null}/>
}

export function AnimatedBed({ patient, clock, onReady }: { patient?: PatientState; clock: AnimationClock; onReady: (ready: boolean) => void }) {
  const available = useAssetAvailability(BED_ASSETS)
  const failed = useCallback(() => onReady(false), [onReady])
  if (!available?.[0]) return null
  return <RigAssetBoundary fallback={null} onError={failed}><Suspense fallback={null}><BedRig patient={patient} clock={clock} onReady={onReady}/></Suspense></RigAssetBoundary>
}
function BedRig({ patient, clock, onReady }: { patient?: PatientState; clock: AnimationClock; onReady: (ready: boolean) => void }) {
  const [asset] = useRigGLTF([...BED_ASSETS])
  const prepared = useMemo(() => {
    const object = cloneSkeleton(asset.scene)
    const bones = BED_BONES.map(name => {
      const bone = object.getObjectByName(name)
      if (!(bone instanceof THREE.Bone)) throw new Error(`У кушетки отсутствует кость ${name}.`)
      return { bone, name, rest: bone.quaternion.clone() }
    })
    const materials = cloneRigMaterials(object)
    return { object, bones, materials, pillow: object.getObjectByName('Bed_Pillow') }
  }, [asset.scene])
  useEffect(() => { onReady(true); return () => onReady(false) }, [onReady])
  useEffect(() => () => prepared.materials.forEach(material => material.dispose()), [prepared])
  useFrame((_, delta) => {
    if (clock.paused) return
    const pose = patient ? patientPose(patient) : 'lying'
    const angles = bedAngles(pose)
    for (const { bone, name, rest } of prepared.bones) {
      const target = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angles[name]))
      bone.quaternion.slerp(target, 1 - Math.exp(-6 * delta * clock.speed))
    }
    setPillowVisibility(prepared.pillow, pose !== 'legs_elevated' && pose !== 'arrest')
  })
  return <group position={[-0.274, 1.3954, -2.0613]}><primitive object={prepared.object} dispose={null}/></group>
}

function setPillowVisibility(pillow: THREE.Object3D | undefined, visible: boolean) { if (pillow) pillow.visible = visible }
