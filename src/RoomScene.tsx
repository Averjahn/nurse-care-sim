import { Html, OrbitControls, useGLTF, useTexture } from '@react-three/drei'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { objectInCase, objectLabels, type ObjectId } from './scenario'
import { useSimulationStore } from './store'
import { basePatient, type PatientState } from './simulation'
import { AnimatedPatient } from './RiggedActors'
import { EditableTarget, EditorPulse, SceneEditorControls } from './SceneEditor3D'
import { splitRoomObjects } from './importedRoomObjects'
import { selectEditorSceneObject, useObjectSettings, useSceneEditor } from './sceneEditorStore'
import { useObjectHighlight } from './useObjectHighlight'
import { MedicalModel } from './MedicalModels'
import { CONCENTRATOR_BASE_OFFSET } from './OxygenConcentrator'
import { WALL_STORAGE_POSITIONS } from './wardStorage'
import { BedMotionProvider } from './BedMotion'
import { useBedMotion } from './bedMotionContext'
import RestoredBed from './RestoredBed'
import { BED_ORIGIN, PATIENT_BED_POSITION } from './bedKinematics'
import HospitalWindow from './HospitalWindow'
import PatientBlanket from './PatientBlanket'
import BedRemote from './BedRemote'
import BedRemoteCamera from './BedRemoteCamera'
import { useBedRemote, type BedButtonId } from './bedRemoteStore'
import { subtractOpening, windowLayout } from './windowGeometry'
import { DEFAULT_ANIMATION_CLOCK, patientPose, type AnimationClock } from './patientAnimation'

export type SceneAction = ObjectId

export interface PatientTransform {
  x: number
  y: number
  z: number
  scale: number
}

export interface BlanketTransform {
  x: number
  y: number
  z: number
  scale: number
}

interface RoomSceneProps {
  patientState?: PatientState
  animationClock?: AnimationClock
  covered: boolean
  firstPerson: boolean
  firstPersonCameraHeight: number
  blanketTransform: BlanketTransform
  patientTransform: PatientTransform
  targetAction: SceneAction | null
  onFocusObject?: (object: ObjectId | null) => void
  onAction: (action: SceneAction, point?: [number, number, number], screen?: { x: number; y: number }) => void
  onBedAction: (action: BedButtonId) => void
  actionAnchor?: { object: ObjectId; point: [number, number, number] | null }
  onActionPosition?: (point: { x: number; y: number }) => void
  onPointerLockChange: (locked: boolean) => void
  onPointerLockError: () => void
}

const ROOM_MODEL_URL = `${import.meta.env.BASE_URL}models/ward-room-neutral.glb`
const GENERATED_ROOM_MODEL_URL = `${import.meta.env.BASE_URL}models/hospital-room-generated.glb`
const PATIENT_MODEL_URL = `${import.meta.env.BASE_URL}models/patient.glb?v=2`
const PATIENT_REAL_WORLD_SCALE = 1
const STORAGE_SHELF_X = 2.902
const FIRST_PERSON_EYE_HEIGHT = 3.4
// Stable options prevent Fiber from recreating the camera on every timer tick.
// Saved view changes are applied imperatively by SceneEditorControls.
const INITIAL_CAMERA = { position: [5.4, 6.4, 3.8] as [number, number, number], fov: 36 }

async function isGlbAvailable(url: string) {
  const response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Не удалось проверить 3D-модель ${url} (HTTP ${response.status}).`)

  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  return contentType === 'model/gltf-binary' || contentType === 'application/octet-stream'
}

function FirstPersonNavigation({
  firstPersonCameraHeight,
  onPointerLockChange,
  onPointerLockError,
}: Pick<RoomSceneProps, 'firstPersonCameraHeight' | 'onPointerLockChange' | 'onPointerLockError'>) {
  const { camera: sceneCamera, gl } = useThree()
  const cameraRef = useRef(sceneCamera)
  const pressedKeys = useRef(new Set<string>())
  const dragging = useRef(false)
  const sprinting = useRef(false)

  useEffect(() => {
    const canvas = gl.domElement
    const camera = cameraRef.current
    const keys = pressedKeys.current
    camera.position.set(-2.8, FIRST_PERSON_EYE_HEIGHT, 1.6)
    camera.rotation.order = 'YXZ'
    camera.rotation.set(0.04, -0.72, 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!['active', 'arrest'].includes(useSimulationStore.getState().attempt?.phase ?? '')) return
      if (useBedRemote.getState().phase !== 'idle') return
      const key = event.key.toLowerCase()
      const activeElement = document.activeElement
      const isEditing = activeElement instanceof HTMLElement
        && (activeElement.isContentEditable || activeElement.matches('input, textarea, select, button'))
      if (document.pointerLockElement !== canvas && isEditing) return
      sprinting.current = event.shiftKey
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) {
        event.preventDefault()
        keys.add(key)
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.key.toLowerCase())
      sprinting.current = event.shiftKey
    }
    const handlePointerMove = (event: MouseEvent) => {
      if (!['active', 'arrest'].includes(useSimulationStore.getState().attempt?.phase ?? '')) return
      if (useBedRemote.getState().phase !== 'idle') return
      if (document.pointerLockElement !== canvas && !dragging.current) return
      camera.rotation.y -= event.movementX * 0.002
      camera.rotation.x = THREE.MathUtils.clamp(
        camera.rotation.x - event.movementY * 0.002,
        -Math.PI / 2 + 0.08,
        Math.PI / 2 - 0.08,
      )
    }
    const handleLockChange = () => {
      const locked = document.pointerLockElement === canvas
      if (!locked) { keys.clear(); sprinting.current = false }
      onPointerLockChange(locked)
    }
    const handleLockError = () => onPointerLockError()
    const handleCanvasClick = (event: MouseEvent) => {
      if (!['active', 'arrest'].includes(useSimulationStore.getState().attempt?.phase ?? '')) return
      if (useBedRemote.getState().phase !== 'idle') return
      if (event.defaultPrevented) return
      canvas.focus({ preventScroll: true })
      if (document.pointerLockElement === canvas) return
      try {
        const result = canvas.requestPointerLock?.()
        if (result instanceof Promise) void result.catch(handleLockError)
        if (!canvas.requestPointerLock) handleLockError()
      } catch { handleLockError() }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!['active', 'arrest'].includes(useSimulationStore.getState().attempt?.phase ?? '')) return
      if (useBedRemote.getState().phase !== 'idle') return
      if (event.button !== 0 || document.pointerLockElement === canvas) return
      dragging.current = true
      canvas.setPointerCapture(event.pointerId)
    }
    const handlePointerUp = (event: PointerEvent) => {
      dragging.current = false
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    const handleBlur = () => { keys.clear(); sprinting.current = false }

    canvas.addEventListener('click', handleCanvasClick)
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointerlockerror', handleLockError)
    document.addEventListener('pointerlockchange', handleLockChange)
    document.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      canvas.removeEventListener('click', handleCanvasClick)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointerlockerror', handleLockError)
      document.removeEventListener('pointerlockchange', handleLockChange)
      document.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      keys.clear()
      dragging.current = false
      sprinting.current = false
      const view = useSceneEditor.getState().settings.camera
      camera.position.fromArray(view.position)
      camera.rotation.order = 'XYZ'
      camera.lookAt(...view.target)
      onPointerLockChange(false)
    }
  }, [gl, onPointerLockChange, onPointerLockError])

  useEffect(() => {
    cameraRef.current.position.y = firstPersonCameraHeight
  }, [firstPersonCameraHeight])

  useFrame((_, delta) => {
    if (!['active', 'arrest'].includes(useSimulationStore.getState().attempt?.phase ?? '')) return
    if (useBedRemote.getState().phase !== 'idle') return
    const camera = cameraRef.current
    const keys = pressedKeys.current
    const forwardInput = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'))
    const rightInput = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'))
    if (!forwardInput && !rightInput) return

    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
    const movement = forward.multiplyScalar(forwardInput).addScaledVector(right, rightInput).normalize()
    const distance = Math.min(delta, 0.05) * 2.2 * (sprinting.current ? 2 : 1)
    const nextX = THREE.MathUtils.clamp(camera.position.x + movement.x * distance, -3.7, 3.7)
    const nextZ = THREE.MathUtils.clamp(camera.position.z + movement.z * distance, -3.65, 3.7)

    const hitsBed = (x: number, z: number) => x > -1.35 && x < 1.4 && z > -2.5 && z < 0.35
    if (!hitsBed(nextX, camera.position.z)) camera.position.x = nextX
    if (!hitsBed(camera.position.x, nextZ)) camera.position.z = nextZ
  })

  return null
}

function GeneratedPatientModel() {
  const { scene } = useGLTF(PATIENT_MODEL_URL)
  const model = useMemo(() => {
    const patient = scene.clone(true)
    // The generated patient and transfer pad share a baked-in 33.59° slope.
    // Level the pad's underside, with the head toward the bed's negative-Z end.
    patient.rotation.set(-Math.PI / 2 + THREE.MathUtils.degToRad(33.59), -Math.PI / 2, 0)

    patient.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(patient, true)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const originalLength = 1.8
    const scale = originalLength / size.z
    patient.scale.setScalar(scale)
    patient.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      // Keep the head at the pillow as the body extends toward the footboard.
      -bounds.min.z * scale - originalLength / 2,
    )
    patient.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    return patient
  }, [scene])

  return <primitive object={model} />
}

class PatientModelBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error('Не удалось загрузить модель пациента. Используется упрощённая модель.', error)
  }

  render() {
    return this.state.hasError ? <FallbackPatientModel /> : this.props.children
  }
}

function FallbackPatientModel() {
  return (
    <>
      <mesh position={[0, 0.18, -0.05]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <capsuleGeometry args={[0.25, 1.1, 6, 14]} />
        <meshStandardMaterial color="#d9a98e" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.34, -0.78]} castShadow>
        <sphereGeometry args={[0.22, 20, 16]} />
        <meshStandardMaterial color="#dfb69e" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.39, -0.94]} castShadow>
        <sphereGeometry args={[0.2, 20, 16]} />
        <meshStandardMaterial color="#6a5148" roughness={0.95} />
      </mesh>
      {[-0.37, 0.37].map((x) => (
        <mesh key={x} position={[x, 0.14, 0.6]} rotation={[Math.PI / 2, 0, x < 0 ? -0.04 : 0.04]} castShadow>
          <capsuleGeometry args={[0.12, 0.64, 5, 12]} />
          <meshStandardMaterial color="#d9a98e" roughness={0.9} />
        </mesh>
      ))}
    </>
  )
}

function PatientVisual() {
  const [hasGeneratedModel, setHasGeneratedModel] = useState(false)

  useEffect(() => {
    let active = true
    isGlbAvailable(PATIENT_MODEL_URL)
      .then((available) => {
        if (active) setHasGeneratedModel(available)
      })
      .catch((error: unknown) => {
        console.error('Ошибка проверки модели пациента:', error)
      })
    return () => { active = false }
  }, [])

  return hasGeneratedModel
    ? <PatientModelBoundary><GeneratedPatientModel /></PatientModelBoundary>
    : <FallbackPatientModel />
}


type HospitalRoomModelProps = Omit<
  RoomSceneProps,
  'firstPersonCameraHeight' | 'onPointerLockChange' | 'onPointerLockError' | 'onBedAction'
>

function HospitalRoomModel(props: HospitalRoomModelProps) {
  const [hasGeneratedModel, setHasGeneratedModel] = useState(false)

  useEffect(() => {
    let active = true
    isGlbAvailable(GENERATED_ROOM_MODEL_URL)
      .then((available) => {
        if (active) setHasGeneratedModel(available)
      })
      .catch((error: unknown) => {
        console.error('Ошибка проверки сгенерированной модели палаты:', error)
      })
    return () => { active = false }
  }, [])

  return (
    <HospitalRoomAsset
      {...props}
      modelUrl={hasGeneratedModel ? GENERATED_ROOM_MODEL_URL : ROOM_MODEL_URL}
    />
  )
}

function TiledFloor({ bounds }: { bounds: THREE.Box3 }) {
  const source = useTexture(`${import.meta.env.BASE_URL}textures/floor.webp`)
  const gl = useThree(state => state.gl)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const texture = useMemo(() => {
    const map = source.clone()
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    // The image contains 3 × 2 tiles, each approximately 60 cm square.
    map.repeat.set(size.x / 1.8, size.z / 1.2)
    map.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    map.needsUpdate = true
    return map
  }, [source, size.x, size.z, gl])
  useEffect(() => () => texture.dispose(), [texture])

  return <EditableTarget id="floor" label="Пол" position={center.toArray()} hintScale={1}>
    <EditorPulse id="floor"><group>
      <mesh><boxGeometry args={[size.x, size.y, size.z]}/><meshStandardMaterial color="#c8ceca" roughness={0.9}/></mesh>
      <mesh name="TiledFloor" position={[0, size.y / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size.x, size.z]} />
        <meshStandardMaterial map={texture} roughness={0.8} />
      </mesh>
    </group></EditorPulse>
  </EditableTarget>
}

function TwoToneWall({ bounds, floorY, id }: { bounds: THREE.Box3; floorY: number; id: string }) {
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const dividerY = THREE.MathUtils.clamp(floorY + 1.2, bounds.min.y, bounds.max.y)
  const wallSettings = useSceneEditor(s => s.settings.objects[id])
  const windowSettings = useSceneEditor(s => s.settings.objects.window)
  const leftWall = size.x < size.z
  const opening = leftWall ? windowLayout(center.toArray(), size.toArray(), wallSettings, windowSettings).opening : null
  const trimHeight = 0.035
  const bands = [
    { bottom: bounds.min.y, top: dividerY - trimHeight / 2, color: '#a7c6cf' },
    { bottom: dividerY - trimHeight / 2, top: dividerY + trimHeight / 2, color: '#d4deda' },
    { bottom: dividerY + trimHeight / 2, top: bounds.max.y, color: '#f3f0e9' },
  ]

  return <EditableTarget id={id} label={size.x < size.z ? 'Левая стена' : 'Задняя стена'} position={center.toArray()} hintScale={1}><EditorPulse id={id}><group name="TwoToneWall">
    {bands.flatMap(({ bottom, top, color }) => {
      const band = { left: -size.z / 2, right: size.z / 2, bottom: bottom - center.y, top: top - center.y }
      const pieces = opening ? subtractOpening(band, opening) : [band]
      return pieces.map((piece, index) => <mesh key={`${color}-${index}`} name={opening ? 'window-wall-reveal' : undefined} position={[0, (piece.bottom + piece.top) / 2, (piece.left + piece.right) / 2]}>
        <boxGeometry args={[size.x, piece.top - piece.bottom, piece.right - piece.left]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>)
    })}
  </group></EditorPulse></EditableTarget>
}

function HospitalRoomAsset({
  covered,
  firstPerson,
  blanketTransform,
  patientTransform,
  targetAction,
  onAction,
  onFocusObject,
  patientState,
  animationClock = DEFAULT_ANIMATION_CLOCK,
  modelUrl,
}: HospitalRoomModelProps & { modelUrl: string }) {
  const { scene } = useGLTF(modelUrl)
  const editorOpen = useSceneEditor(s => s.open)
  const editingBlanket = useSceneEditor(s => s.selected === 'blanket-on-patient')
  const cprSupport = useSimulationStore(s => !!s.attempt?.completed.includes('firm-surface'))
  const patientScale = patientTransform.scale * PATIENT_REAL_WORLD_SCALE
  const blanketOff = patientState && patientPose(patientState) === 'sitting_edge'
  const { model, scale, offset, floorBounds, wallBounds, importedObjects } = useMemo(() => {
    const model = scene.clone(true)
    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = 8.5 / Math.max(size.x, size.z)
    const offset = new THREE.Vector3(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    let floorBounds: THREE.Box3 | null = null
    const wallBounds: THREE.Box3[] = []
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const slab = new THREE.Box3().setFromObject(object)
      const slabSize = slab.getSize(new THREE.Vector3())
      if (slabSize.x > size.x * 0.8 && slabSize.z > size.z * 0.8 && slabSize.y < Math.max(size.x, size.z) * 0.05) {
        if (!floorBounds || slab.max.y < floorBounds.max.y) floorBounds = slab
        object.visible = false
      }
      // Replace only the room's solid wall slabs; equipment keeps its materials.
      const thinWall = Math.min(slabSize.x, slabSize.z) < Math.max(size.x, size.z) * 0.05
      const longWall = slabSize.x > size.x * 0.8 || slabSize.z > size.z * 0.8
      if (thinWall && longWall && slabSize.y > size.y * 0.8) {
        wallBounds.push(slab)
        object.visible = false
      }
    })
    const normalizedFloor = floorBounds as THREE.Box3 | null
    if (normalizedFloor) {
      normalizedFloor.min.multiplyScalar(scale).add(offset)
      normalizedFloor.max.multiplyScalar(scale).add(offset)
    }
    wallBounds.forEach(wall => {
      wall.min.multiplyScalar(scale).add(offset)
      wall.max.multiplyScalar(scale).add(offset)
    })
    const importedObjects = splitRoomObjects(model)
    return {
    importedObjects,
    model,
    scale,
    offset,
    floorBounds: normalizedFloor,
    wallBounds,
    }
  }, [scene])

  const defibrillatorSource = importedObjects.find(entry => entry.id === 'imported-defibrillator')
  const bedSource = importedObjects.find(entry => entry.id === 'bed')
  const bedSourceMatrix = useMemo(() => new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z).multiply(new THREE.Matrix4().makeScale(scale, scale, scale)).multiply(new THREE.Matrix4().makeTranslation(...(bedSource?.position ?? [0, 0, 0]))), [offset, scale, bedSource])

  useEffect(() => () => importedObjects.forEach(entry => entry.materials.forEach(material => material.dispose())), [importedObjects])

  return (
    <>
    <group position={offset} scale={scale}>
      <primitive object={model} />
      {importedObjects.filter(entry => !['bed', 'imported-cabinet', 'imported-defibrillator'].includes(entry.id)).map(entry => <EditableTarget key={entry.id} id={entry.id} label={entry.label} position={entry.position} hintScale={1} visible={false}>
        <EditorPulse id={entry.id}><primitive object={entry.object}/></EditorPulse>
      </EditableTarget>)}
    </group>

    {floorBounds && <TiledFloor bounds={floorBounds} />}
    {wallBounds.map((bounds, index) => <TwoToneWall key={index} id={`wall-${index}`} bounds={bounds} floorY={floorBounds?.max.y ?? 0} />)}

    {wallBounds.map((bounds, index) => bounds.getSize(new THREE.Vector3()).x < bounds.getSize(new THREE.Vector3()).z ? <HospitalWindow key={index} bounds={bounds} wallId={`wall-${index}`} /> : null)}

    <BedMotionProvider>
    <EditableTarget id="bed" label="Кровать" position={BED_ORIGIN} hintScale={1}>
      {cprSupport && <mesh name="cpr-bed-support" position={[0, -.37, .04]}><boxGeometry args={[1.9, .03, 3.5]}/><meshStandardMaterial color="#829a9c"/></mesh>}
      {bedSource && <EditorPulse id="bed"><RestoredBed source={bedSource.object} sourceMatrix={bedSourceMatrix}/></EditorPulse>}
    <EditableTarget id="patient" label="Пациентка" hintScale={1}
      position={[
        (patientState?.location === 'sink' ? -3.05 - BED_ORIGIN[0] : PATIENT_BED_POSITION[0]) + patientTransform.x,
        (patientState?.location === 'sink' ? .15 - BED_ORIGIN[1] : PATIENT_BED_POSITION[1] + .28) + patientTransform.y,
        (patientState?.location === 'sink' ? 1.7 - BED_ORIGIN[2] : PATIENT_BED_POSITION[2] + .21) + patientTransform.z,
      ]}
      scale={patientScale}
    >
      <SceneInteraction id={patientState?.breathing === false ? 'cpr' : 'patient'} highlighted={targetAction === 'patient' || targetAction === 'cpr'} onAction={onAction}>
      <AnimatedPatient patient={patientState ?? basePatient} clock={animationClock} fallback={patientState ? <ArticulatedPatient patient={patientState} clock={animationClock} showSupports={false}/> : <PatientVisual/>}/>
      </SceneInteraction>
    </EditableTarget>
    <group
      position={[
        (patientState?.location === 'sink' ? -3.05 - BED_ORIGIN[0] : PATIENT_BED_POSITION[0]) + patientTransform.x,
        (patientState?.location === 'sink' ? .15 - BED_ORIGIN[1] : PATIENT_BED_POSITION[1] + .28) + patientTransform.y,
        (patientState?.location === 'sink' ? 1.7 - BED_ORIGIN[2] : PATIENT_BED_POSITION[2] + .21) + patientTransform.z,
      ]}
    >
        <EditableTarget id="blanket-on-patient" label="Одеяло на пациентке" visible={covered || (editorOpen && editingBlanket)}
          position={[blanketTransform.x, blanketTransform.y, blanketTransform.z + (blanketOff ? 0.9 : 0)]}
          scale={patientScale * blanketTransform.scale}
        >
          <SceneInteraction id={patientState?.breathing === false ? 'cpr' : 'patient'} alias="interaction-covered-patient" highlighted={targetAction === 'patient' || targetAction === 'cpr'} onAction={onAction}><group scale={blanketOff ? [1, 0.8, 0.28] : [1, 1, 1]}><PatientBlanket folded={Boolean(blanketOff)} lowerOnly={patientState?.breathing === false}/></group></SceneInteraction>
        </EditableTarget>
    </group>

      <BedsideInteractions targetAction={targetAction} onAction={onAction} patientState={patientState}/>
    </EditableTarget>
    </BedMotionProvider>
    {defibrillatorSource && <EmergencyObject object={sceneObjects.find(o => o.id === 'aed-device')!} highlighted={targetAction === 'aed-device'} onAction={onAction}
      visual={<group scale={scale} name="restored-wall-defibrillator"><primitive object={defibrillatorSource.object}/></group>}/>}
    <WallStorageShelf />
    <WallStorageShelf left />
    <EmergencyObjects onFocusObject={onFocusObject} firstPerson={firstPerson} targetAction={targetAction} onAction={onAction} patientState={patientState} />
    </>
  )
}

function ActionAnchor({ anchor, onPosition }: { anchor: NonNullable<RoomSceneProps['actionAnchor']>; onPosition: NonNullable<RoomSceneProps['onActionPosition']> }) {
  const { scene, camera, size } = useThree()
  const local = useRef<{ object: THREE.Object3D; point: THREE.Vector3 } | null>(null)
  const screen = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => { local.current = null }, [anchor])
  useFrame(() => {
    if (!local.current) {
      const object = scene.getObjectByName(`interaction-${anchor.object}`)
      if (!object) return
      const point = anchor.point ? object.worldToLocal(new THREE.Vector3(...anchor.point)) : new THREE.Vector3()
      local.current = { object, point }
    }
    screen.copy(local.current.point)
    local.current.object.localToWorld(screen).project(camera)
    onPosition({ x: (screen.x + 1) * size.width / 2, y: (1 - screen.y) * size.height / 2 })
  })
  return null
}

function Room({
  covered,
  firstPerson,
  firstPersonCameraHeight,
  blanketTransform,
  patientTransform,
  targetAction,
  onAction,
  onBedAction,
  onPointerLockChange,
  onPointerLockError,
  onFocusObject,
  patientState,
  animationClock = DEFAULT_ANIMATION_CLOCK,
  actionAnchor,
  onActionPosition,
}: RoomSceneProps) {
  const editorOpen = useSceneEditor(s => s.open)
  const cameraTarget = useSceneEditor(s => s.settings.camera.target)
  const ended = useSimulationStore(s => s.attempt?.phase === 'failed' || s.attempt?.phase === 'finished')
  return (
    <>
    <color attach="background" args={['#e9f1ef']} />
    <ambientLight intensity={1.25} />
    <hemisphereLight args={['#ffffff', '#b5c6c1', 0.8]} />
    <directionalLight position={[4, 8, 3]} intensity={1.4} />
    <Suspense fallback={null}>
      <HospitalRoomModel
        patientState={patientState}
        animationClock={animationClock}
        covered={covered}
        firstPerson={firstPerson}
        blanketTransform={blanketTransform}
        patientTransform={patientTransform}
        targetAction={targetAction}
        onAction={onAction}
        onFocusObject={onFocusObject}
      />
    </Suspense>
    {actionAnchor && onActionPosition && <ActionAnchor anchor={actionAnchor} onPosition={onActionPosition} />}
    {firstPerson ? (
      <FirstPersonNavigation
        firstPersonCameraHeight={firstPersonCameraHeight}
        onPointerLockChange={onPointerLockChange}
        onPointerLockError={onPointerLockError}
      />
    ) : (
      <OrbitControls
        makeDefault
        enabled={editorOpen || !ended}
        target={cameraTarget}
        minDistance={0.5}
        maxDistance={40}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI / 2.05}
        enablePan={editorOpen}
        minAzimuthAngle={-Math.PI / 2.5}
        maxAzimuthAngle={Math.PI / 2.5}
      />
    )}
    <SceneEditorControls firstPerson={firstPerson} simulationActive={!!patientState} />
    <BedRemoteCamera onCommit={onBedAction}/>
    </>
  )
}

useGLTF.preload(ROOM_MODEL_URL)

export default function RoomScene(props: RoomSceneProps) {
  return (
    <Canvas
      camera={INITIAL_CAMERA}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false }}
      tabIndex={0}
      aria-label="Интерактивная трёхмерная палата пациента"
    >
      <Room {...props} />
    </Canvas>
  )
}

// The supplied patient GLB is a single unrigged mesh. A segmented teaching model
// supplies the four articulated positions without pretending the GLB has clips.
function ArticulatedPatient({ patient, clock, showSupports = true }: { patient: PatientState; clock: AnimationClock; showSupports?: boolean }) {
  const torso = useRef<THREE.Group>(null)
  const legs = useRef<THREE.Group>(null)
  const shins = useRef<THREE.Group>(null)
  const breath = useRef<THREE.Mesh>(null)
  const body = useRef<THREE.Group>(null)
  const visualTime = useRef(patient.secondsSinceOnset)
  const compressionAge = useRef(Infinity)
  const lastCompression = useRef(clock.compressions)
  const pose = patientPose(patient)
  const bedMotion = useBedMotion()
  const skin = ({ normal: '#dcb296', pale: '#d1c6b6', flushed: '#db927f', coldSweat: '#c4c8bc', rash: '#dfa18e' })[patient.skin]
  useFrame((_, realDelta) => {
    if (clock.paused) return
    const delta = realDelta * clock.speed
    visualTime.current += delta
    if (clock.compressions > lastCompression.current) compressionAge.current = 0
    lastCompression.current = clock.compressions
    compressionAge.current += realDelta
    const angle = bedMotion?.current.angles.head ?? (pose === 'semifowler' ? 0.65 : pose === 'sitting_edge' ? 1.2 : 0)
    if (torso.current) torso.current.rotation.x = THREE.MathUtils.damp(torso.current.rotation.x, angle, 5, delta)
    const legAngle = bedMotion ? -bedMotion.current.angles.thigh : pose === 'knees_flexed' ? -.65 : pose === 'legs_elevated' ? -0.3 : pose === 'sitting_edge' ? 0.8 : 0
    if (legs.current) legs.current.rotation.x = THREE.MathUtils.damp(legs.current.rotation.x, legAngle, 5, delta)
    if (shins.current) shins.current.rotation.x = THREE.MathUtils.damp(shins.current.rotation.x, pose === 'knees_flexed' ? 1.3 : 0, 5, delta)
    if (body.current) body.current.rotation.y = THREE.MathUtils.damp(body.current.rotation.y, pose === 'sitting_edge' ? Math.PI / 2 : 0, 5, delta)
    if (breath.current) {
      const compressionPulse = compressionAge.current < 0.3 ? Math.sin(compressionAge.current / 0.3 * Math.PI) * 0.08 : 0
      breath.current.scale.y = 1 + (patient.breathing ? Math.sin(visualTime.current * 2.8) * 0.035 : 0) - compressionPulse
    }
  })
  return <group ref={body} position={[0, .15, 0]} userData={{ patientRenderer: 'fallback' }}>
    <group ref={torso} position={[0, 0.15, 0]}>
      <mesh ref={breath} position={[0, 0.09, -0.3]}><boxGeometry args={[0.45, 0.22, 0.65]}/><meshStandardMaterial color="#b7d9dc" roughness={0.85}/></mesh>
      <mesh position={[0, 0.13, -0.86]} scale={[0.8, 0.85, 1]}><sphereGeometry args={[0.2, 24, 16]}/><meshStandardMaterial color={skin}/></mesh>
      <mesh position={[0, 0.13, -0.96]} scale={[0.85, 0.8, 0.65]}><sphereGeometry args={[0.2, 18, 12]}/><meshStandardMaterial color="#62534f"/></mesh>
      {[-0.075, 0.075].map(x => <mesh key={x} position={[x, 0.297, -0.81]} rotation={[-Math.PI / 2, 0, 0]}><boxGeometry args={[0.046, patient.consciousness === 'lost' ? 0.008 : 0.024, 0.008]}/><meshStandardMaterial color="#4b514e"/></mesh>)}
      {[-0.3, 0.3].map(x => <mesh key={x} position={[x, 0.06, -0.28]} rotation={[Math.PI / 2, 0, x < 0 ? -0.08 : 0.08]}><capsuleGeometry args={[0.065, 0.55, 6, 12]}/><meshStandardMaterial color={skin}/></mesh>)}
      {patient.skin === 'rash' && [-0.12, 0, 0.1].map((x, i) => <mesh key={x} position={[x, 0.213, -0.58 + i * 0.04]}><sphereGeometry args={[0.025, 8, 6]}/><meshStandardMaterial color="#bc5b59"/></mesh>)}
      {showSupports && <mesh position={[0, -0.07, -0.3]}><boxGeometry args={[0.53, 0.1, 0.8]}/><meshStandardMaterial color="#e3eeeb"/></mesh>}
    </group>
    <group ref={legs} position={[0, 0.15, 0]}>
      {[-0.13, 0.13].map(x => <mesh key={x} position={[x, 0.02, .2]} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.09, .24, 6, 12]}/><meshStandardMaterial color="#a4c6cb"/></mesh>)}
      <group ref={shins} position={[0, 0, .42]}>{[-.13, .13].map(x => <mesh key={x} position={[x, .02, .2]} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[.08, .24, 6, 12]}/><meshStandardMaterial color="#a4c6cb"/></mesh>)}</group>
      {showSupports && <mesh position={[0, -0.07, 0.4]}><boxGeometry args={[0.53, 0.1, 0.83]}/><meshStandardMaterial color="#e3eeeb"/></mesh>}
    </group>
  </group>
}

// Shelf heights are the upper surfaces; item origins include their geometry's
// bottom offset so that moving a shelf never leaves its contents suspended.
const SHELF_X = STORAGE_SHELF_X
const SHELF_Z = -3.62
const SHELF_TOP = 1.8
const SHELF_LOWER = 1.0
function WallStorageShelf({ left = false }: { left?: boolean }) {
  return <EditableTarget id={left ? 'shelf-left' : 'shelf'} label={left ? 'Полки слева' : 'Полки справа'} position={[left ? -SHELF_X : SHELF_X, 0, SHELF_Z]} hintScale={1.05}><EditorPulse id={left ? 'shelf-left' : 'shelf'}>
    {[SHELF_TOP, SHELF_LOWER].map(height => <group key={height}>
      <mesh position={[0, height - 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.64, 0.08, 0.66]}/>
        <meshStandardMaterial color="#e4eeea" roughness={0.7}/>
      </mesh>
      <mesh position={[0, height + 0.025, -0.315]}>
        <boxGeometry args={[2.64, 0.05, 0.03]}/>
        <meshStandardMaterial color="#bdcfca" roughness={0.6}/>
      </mesh>
      {[-1.03, 1.03].map(x => <group key={x}>
        <mesh position={[x, height - 0.23, -0.3]}>
          <boxGeometry args={[0.055, 0.38, 0.045]}/>
          <meshStandardMaterial color="#809f98" metalness={0.3} roughness={0.5}/>
        </mesh>
        <mesh position={[x, height - 0.08, -0.06]}>
          <boxGeometry args={[0.055, 0.045, 0.48]}/>
          <meshStandardMaterial color="#809f98" metalness={0.3} roughness={0.5}/>
        </mesh>
      </group>)}
    </group>)}
  </EditorPulse></EditableTarget>
}
interface SceneObjectPlacement {
  id: ObjectId
  position: [number, number, number]
  rotation?: [number, number, number]
  hitbox?: [number, number, number]
  color: string
}
const sceneObjects: SceneObjectPlacement[] = [
  { id: 'glucometer', position: [3.5, 1.84, -3.75], color: '#7099ad' },
  { id: 'aed-device', position: WALL_STORAGE_POSITIONS['aed-device'], color: '#548f91' },
  { id: 'bag-mask', position: [-3.3, 1.894, -3.62], color: '#83bec2' },
  { id: 'tonometer', position: WALL_STORAGE_POSITIONS.tonometer, color: '#e4eee9' },
  { id: 'thermometer', position: WALL_STORAGE_POSITIONS.thermometer, color: '#e4eee9' },
  { id: 'pulseox', position: WALL_STORAGE_POSITIONS.pulseox, color: '#6e9db0' },
  { id: 'ecg-device', position: [2.05, 1.875, -3.68], color: '#6c9ca3' },
  { id: 'shock-kit', position: [3.05, 1.87, -3.62], color: '#bb5d55' },
  { id: 'iv-stand', position: [-1.95, .124, -3.1], color: '#86a5a8' },
  { id: 'ice-pack', position: [-2.65, 1.872, -3.62], color: '#79a9c5' },
  { id: 'analgesics', position: [2.95, 1.0325, -3.62], color: '#e8ece4' },
  { id: 'enema-kit', position: [-3.65, 1.117, -3.62], color: '#a582a2' },
  { id: 'food-water', position: WALL_STORAGE_POSITIONS['food-water'], color: '#bddbe1' },
  // Controls and emergency bell mount to the authored bed's right rail.
  { id: 'bed-controls', position: [.88, 1.23, -1.12], rotation: [0, Math.PI / 2, 0], hitbox: [0.29, 0.2, 0.14], color: '#71939b' },
  { id: 'call-bell', position: [.88, 1.54, -2.5], rotation: [0, Math.PI / 2, 0], hitbox: [0.22, 0.32, 0.14], color: '#c66058' },
  { id: 'monitor', position: [.65, 2.55, -3.86], color: '#4b918d' },
  { id: 'chart', position: [3.35, SHELF_LOWER + 0.0175, SHELF_Z], rotation: [-Math.PI / 2, 0, 0], hitbox: [0.32, 0.44, 0.06], color: '#809c83' },
  { id: 'medications', position: [3.85, SHELF_TOP + 0.0675, SHELF_Z], color: '#b57e60' },
  { id: 'oxygen', position: [1.35, .654, -1.2], hitbox: [0.28, 0.7, 0.28], color: '#5d9bb0' },
  { id: 'blanket', position: [-2.25, SHELF_LOWER + 0.0225, SHELF_Z], hitbox: [0.4, 0.15, 0.32], color: '#789e98' },
  { id: 'heater', position: [-1.95, SHELF_TOP + 0.024, SHELF_Z], rotation: [Math.PI / 2, 0, 0], hitbox: [0.24, 0.44, 0.09], color: '#c98c74' },
  { id: 'sink', position: [-3.75, 1.15, 1.7], rotation: [0, Math.PI / 2, 0], color: '#a3beb9' },
  { id: 'injection', position: [2.35, SHELF_LOWER + 0.06, SHELF_Z], rotation: [0, 0, Math.PI / 2], hitbox: [0.15, 0.5, 0.15], color: '#719dac' },
  { id: 'linen', position: [-3.08, SHELF_LOWER + 0.0225, SHELF_Z], hitbox: [0.4, 0.15, 0.32], color: '#96b1ac' },
  { id: 'equipment', position: [1.85, SHELF_LOWER + 0.0175, SHELF_Z], hitbox: [0.39, 0.12, 0.26], color: '#8c9eaf' },
]
function BedsideInteractions({ targetAction, onAction }: Pick<RoomSceneProps, 'targetAction' | 'onAction' | 'patientState'>) {
  const motion = useBedMotion()!
  const bell = useRef<THREE.Group>(null)
  const placements = useMemo(() => sceneObjects.filter(o => ['call-bell', 'bed-controls'].includes(o.id)).map(o => ({ ...o, position: o.position.map((v, i) => v - BED_ORIGIN[i]) as [number, number, number] })), [])
  useFrame(() => { bell.current?.rotation.set(motion.current.angles.head, 0, 0) })
  return <>{placements.map(object => object.id === 'call-bell' ? <group ref={bell} key={object.id}><EmergencyObject object={object} highlighted={targetAction === object.id} onAction={onAction}/></group> : <EditableTarget key={object.id} id="bed-controls" label="Пульт кровати" position={object.position} rotation={object.rotation} hintScale={1}><BedRemote highlighted={targetAction === object.id} onOpen={() => onAction('bed-controls')}/></EditableTarget>)}</>
}
/** Pulse the actual mesh materials, never a proxy box. All materials here
 * belong to the mounted scene instance (patient materials are cloned on load). */
function SceneInteraction({ id, alias, highlighted, growth = 0, onAction, children }: {
  id: ObjectId; alias?: string; highlighted: boolean; growth?: number; onAction: RoomSceneProps['onAction']; children: ReactNode
}) {
  const ref = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const editor = useSceneEditor(s => s.open)
  const editorId = id === 'cpr' ? 'patient' : id
  const preview = useSceneEditor(s => s.open && s.preview && s.selected === editorId)
  const settings = useObjectSettings(editorId)
  const defaultColor = useSceneEditor(s => s.settings.hintColor)
  const color = settings?.hintColor ?? defaultColor
  const maxScale = settings?.hintScale ?? 1 + growth
  useObjectHighlight(ref, editor ? preview : highlighted, hovered, id === 'patient' || id === 'cpr' ? 0 : maxScale - 1, color)
  const content = <group ref={ref} name={alias ?? `interaction-${id}`} userData={{ emergencyObject: id, hinted: highlighted }}
    onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (useSceneEditor.getState().open) { selectEditorSceneObject(editorId); return }; if (document.pointerLockElement) return; event.nativeEvent.preventDefault(); onAction(id, event.point.toArray(), { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }) }}
    onPointerOver={event => { event.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}>
    {id === 'oxygen' ? <group position={[0, CONCENTRATOR_BASE_OFFSET, 0]}>{children}</group> : children}
    {hovered && !document.pointerLockElement && <Html position={[0, id === 'oxygen' ? 1.05 : .28, 0]} center zIndexRange={[2, 1]} style={{ pointerEvents: 'none' }}><span className="scene-label">{objectLabels[id]}</span></Html>}
  </group>
  return id === 'oxygen' ? <group position={[0, -CONCENTRATOR_BASE_OFFSET, 0]}>{content}</group> : content
}
function EmergencyObject({ object, highlighted, onAction, visual }: { object: SceneObjectPlacement; highlighted: boolean; onAction: RoomSceneProps['onAction']; visual?: ReactNode }) {
  const hitbox = object.hitbox ?? [0.36, 0.4, 0.25]
  const growth = object.id === 'call-bell' ? 0.5 : Math.min(0.5, 0.12 / Math.max(...hitbox))
  return <EditableTarget id={object.id} label={objectLabels[object.id]} position={object.position} rotation={object.rotation} hintScale={1 + growth}>
    <SceneInteraction id={object.id} highlighted={highlighted} growth={growth} onAction={onAction}>
      {visual ?? <ObjectVisual id={object.id} color={object.color}/>}
    </SceneInteraction>
  </EditableTarget>
}
function EmergencyObjects({ firstPerson, targetAction, onAction, onFocusObject }: Pick<RoomSceneProps, 'firstPerson' | 'targetAction' | 'onAction' | 'onFocusObject' | 'patientState'>) {
  const editorOpen = useSceneEditor(s => s.open)
  const episode = useSimulationStore(s => s.attempt?.episode)
  const ended = useSimulationStore(s => s.attempt?.phase === 'failed' || s.attempt?.phase === 'finished')
  const [lastVisibleEpisode, setLastVisibleEpisode] = useState(episode)
  if (!ended && lastVisibleEpisode !== episode) setLastVisibleEpisode(episode)
  const visibleEpisode = ended ? lastVisibleEpisode : episode
  const layout = useSceneEditor(s => s.layout)
  const catalog = useSceneEditor(s => s.catalog)
  return <>
    {sceneObjects.filter(o => !['call-bell', 'bed-controls', 'aed-device'].includes(o.id) && (editorOpen ? catalog || objectInCase(o.id, layout ? layout as Parameters<typeof objectInCase>[1] : undefined) : objectInCase(o.id, visibleEpisode))).map(object => <EmergencyObject key={object.id} object={object} highlighted={targetAction === object.id} onAction={onAction}/>)}
    {firstPerson && <CenterInteraction onAction={onAction} onFocusObject={onFocusObject}/>}
  </>
}
function CenterInteraction({ onAction, onFocusObject }: Pick<RoomSceneProps, 'onAction' | 'onFocusObject'>) {
  const { camera, scene, gl } = useThree()
  const target = useRef<ObjectId | null>(null)
  const hitPoint = useRef<[number, number, number] | undefined>(undefined)
  const rayRef = useRef(new THREE.Raycaster())
  useFrame(() => {
    const ray = rayRef.current
    ray.setFromCamera(new THREE.Vector2(0, 0), camera)
    ray.far = Infinity
    const hit = ray.intersectObjects(scene.children, true).find(hit => {
      if (!(hit.object instanceof THREE.Mesh)) return false
      let node: THREE.Object3D | null = hit.object
      while (node) { if (!node.visible) return false; node = node.parent }
      return true
    })
    let object: THREE.Object3D | null = hit?.object ?? null
    hitPoint.current = hit?.point.toArray()
    const previousTarget = target.current
    target.current = null
    while (object) {
      if (object.userData.emergencyObject) { target.current = object.userData.emergencyObject as ObjectId; break }
      object = object.parent
    }
    if (previousTarget !== target.current) onFocusObject?.(target.current)
  })
  useEffect(() => {
    const interact = () => {
      if (!target.current) return
      const rect = gl.domElement.getBoundingClientRect()
      onAction(target.current, hitPoint.current, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    }
    const key = (e: KeyboardEvent) => { if (e.code === 'KeyE' && !e.repeat && document.pointerLockElement === gl.domElement) { e.preventDefault(); interact() } }
    const click = (e: MouseEvent) => { if (document.pointerLockElement === gl.domElement && target.current) { e.preventDefault(); interact() } }
    window.addEventListener('keydown', key); gl.domElement.addEventListener('click', click)
    return () => { window.removeEventListener('keydown', key); gl.domElement.removeEventListener('click', click) }
  }, [gl, onAction])
  return null
}

function ObjectVisual({ id, color }: { id: ObjectId; color: string }) {
  if (['glucometer', 'aed-device', 'bag-mask', 'tonometer', 'monitor', 'thermometer', 'pulseox', 'ecg-device', 'shock-kit', 'iv-stand', 'ice-pack', 'analgesics', 'enema-kit', 'food-water', 'medications', 'oxygen'].includes(id)) return <MedicalModel id={id}/>
  if (id === 'chart') return <group>
    <mesh><boxGeometry args={[0.3, 0.42, 0.035]}/><meshStandardMaterial color="#6e8b89"/></mesh>
    <mesh position={[0, -0.01, 0.02]}><boxGeometry args={[0.26, 0.35, 0.008]}/><meshStandardMaterial color="#faf9ee"/></mesh>
    <mesh position={[0, 0.18, 0.028]}><boxGeometry args={[0.11, 0.045, 0.018]}/><meshStandardMaterial color="#81938b" metalness={0.4}/></mesh>
    {[-0.1, -0.04, 0.02, 0.08].map(y => <mesh key={y} position={[0, y, 0.026]}><boxGeometry args={[0.2, 0.006, 0.002]}/><meshStandardMaterial color="#a8bab3"/></mesh>)}
  </group>
  if (id === 'sink') return <group>
    <mesh position={[.25, .1, .07]}><cylinderGeometry args={[.028, .035, .13, 10]}/><meshStandardMaterial color="#a68f6a"/></mesh>
    <mesh position={[.25, .18, .07]}><cylinderGeometry args={[.031, .031, .025, 10]}/><meshStandardMaterial color="#e3e6dc"/></mesh>
    <mesh position={[.31, .03, .12]}><sphereGeometry args={[.03, 8, 6]}/><meshStandardMaterial color="#f7f6ed"/></mesh>
    <mesh position={[0, -0.35, 0]}><boxGeometry args={[0.55, 0.6, 0.4]}/><meshStandardMaterial color="#d6e1dc"/></mesh>
    <mesh scale={[1, 0.26, 0.8]}><sphereGeometry args={[0.36, 24, 16]}/><meshStandardMaterial color="#f3f6f1" roughness={0.35}/></mesh>
    <mesh position={[0, 0.13, -0.22]}><cylinderGeometry args={[0.025, 0.025, 0.24, 12]}/><meshStandardMaterial color="#8da6a2" metalness={0.65}/></mesh>
    <mesh position={[0, 0.25, -0.15]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.025, 0.025, 0.17, 12]}/><meshStandardMaterial color="#8da6a2" metalness={0.65}/></mesh>
  </group>
  if (['patient', 'cpr'].includes(id)) return null
  if (id === 'call-bell' || id === 'bed-controls') return <group>
    <mesh position={[0, 0, -0.065]}><boxGeometry args={[0.17, 0.19, 0.08]}/><meshStandardMaterial color="#8da7a0" metalness={0.25}/></mesh>
    <mesh><boxGeometry args={id === 'bed-controls' ? [0.24, 0.15, 0.06] : [0.16, 0.26, 0.06]}/><meshStandardMaterial color="#f0f5ef"/></mesh>
    {id === 'call-bell' ? <>
      <mesh position={[0, 0.035, 0.04]}><sphereGeometry args={[0.048, 16, 12]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25}/></mesh>
      <mesh position={[0, -0.065, 0.035]}><boxGeometry args={[0.055, 0.015, 0.012]}/><meshStandardMaterial color="#9e5b52"/></mesh>
    </> : <>
      {[-0.062, 0.062].map(x => <mesh key={x} position={[x, 0, 0.038]}><boxGeometry args={[0.06, 0.065, 0.016]}/><meshStandardMaterial color={color}/></mesh>)}
      {[-0.062, 0.062].map(x => <mesh key={x} position={[x, 0, 0.048]} rotation={[0, 0, x < 0 ? 0 : Math.PI]}><coneGeometry args={[0.018, 0.025, 3]}/><meshStandardMaterial color="#f4f8f4"/></mesh>)}
    </>}
  </group>
  if (id === 'medications') return <group>
    <mesh><boxGeometry args={[0.34, 0.15, 0.24]}/><meshStandardMaterial color="#fafbf7"/></mesh>
    <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.15, 0.008, 0.045]}/><meshStandardMaterial color="#b86c5f"/></mesh>
    <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.045, 0.008, 0.15]}/><meshStandardMaterial color="#b86c5f"/></mesh>
  </group>
  if (id === 'oxygen') return <group>
    <mesh position={[0, -0.2, 0]}><cylinderGeometry args={[0.1, 0.1, 0.55, 16]}/><meshStandardMaterial color="#d6e9e5" metalness={0.2}/></mesh>
    <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.035, 0.035, 0.1, 10]}/><meshStandardMaterial color="#648d85"/></mesh>
    <mesh position={[0.075, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.04, 0.04, 0.025, 12]}/><meshStandardMaterial color="#edf3ea"/></mesh>
  </group>
  if (id === 'monitor') return <group>
    <mesh><boxGeometry args={[0.3, 0.18, 0.2]}/><meshStandardMaterial color="#eff5ee"/></mesh>
    <mesh position={[0, 0.04, 0.105]}><planeGeometry args={[0.21, 0.07]}/><meshBasicMaterial color="#6faaa0"/></mesh>
  </group>
  if (id === 'heater') return <group><mesh scale={[1, 1.3, 0.4]}><boxGeometry args={[0.2, 0.24, 0.12]}/><meshStandardMaterial color="#b87862" roughness={0.9}/></mesh><mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.025, 0.025, 0.08, 10]}/><meshStandardMaterial color="#e3d9c0"/></mesh></group>
  if (id === 'blanket' || id === 'linen') return <group>{[0, 0.05, 0.1].map(y => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[0.35, 0.045, 0.28]}/><meshStandardMaterial color={id === 'blanket' ? '#a9c8c0' : '#edf0e6'} roughness={1}/></mesh>)}</group>
  if (id === 'injection') return <group>
    <mesh><cylinderGeometry args={[0.06, 0.06, 0.25, 12]}/><meshStandardMaterial color="#dcecea" transparent opacity={0.7}/></mesh>
    <mesh position={[0, -0.22, 0]}><cylinderGeometry args={[0.01, 0.01, 0.2, 8]}/><meshStandardMaterial color="#8bb5ad"/></mesh>
  </group>
  return <group><mesh><boxGeometry args={[0.35, 0.035, 0.22]}/><meshStandardMaterial color="#c9d5ce" metalness={0.5}/></mesh>{[-0.1, 0, 0.1].map(x => <mesh key={x} position={[x, 0.035, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.01, 0.01, 0.15, 8]}/><meshStandardMaterial color="#849f94" metalness={0.5}/></mesh>)}</group>
}
