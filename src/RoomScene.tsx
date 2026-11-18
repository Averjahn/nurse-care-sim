import { Edges, Html, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { scenario, objectLabels, type ObjectId } from './scenario'
import { basePatient, consciousnessLabels, type PatientState } from './simulation'
import { AnimatedBed, AnimatedPatient } from './RiggedActors'
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
  doctorArrived?: boolean
  windowOpen?: boolean
  covered: boolean
  firstPerson: boolean
  firstPersonCameraHeight: number
  blanketTransform: BlanketTransform
  patientTransform: PatientTransform
  targetAction: SceneAction | null
  onFocusObject?: (object: ObjectId | null) => void
  onAction: (action: SceneAction) => void
  onPointerLockChange: (locked: boolean) => void
  onPointerLockError: () => void
}

const ROOM_MODEL_URL = `${import.meta.env.BASE_URL}models/gradd-hospital-room.glb`
const GENERATED_ROOM_MODEL_URL = `${import.meta.env.BASE_URL}models/hospital-room-generated.glb`
const PATIENT_MODEL_URL = `${import.meta.env.BASE_URL}models/patient.glb?v=2`
const PATIENT_REAL_WORLD_SCALE = 1
const PATIENT_PANEL_WIDTH = 2.68
const PATIENT_PANEL_SHIFT_X = PATIENT_PANEL_WIDTH * 0.15
const FIRST_PERSON_EYE_HEIGHT = 3.4
const ACTION_HIGHLIGHT_COLOR = '#ffd54a'

async function isGlbAvailable(url: string) {
  const response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Не удалось проверить 3D-модель ${url} (HTTP ${response.status}).`)

  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  return contentType === 'model/gltf-binary' || contentType === 'application/octet-stream'
}

function drawWindowView(canvas: HTMLCanvasElement, now: Date) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось создать графический контекст вида из окна.')

  const width = canvas.width
  const height = canvas.height
  const hour = now.getHours() + now.getMinutes() / 60
  const isNight = hour < 5.5 || hour >= 20.5
  const isTwilight = !isNight && (hour < 7 || hour >= 18.5)
  const sky = isNight
    ? ['#101d35', '#435976']
    : isTwilight
      ? ['#d58f79', '#f0c7a2']
      : ['#75b9d1', '#d2e8e7']
  const gradient = context.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, sky[0])
  gradient.addColorStop(0.7, sky[1])
  gradient.addColorStop(1, isNight ? '#788497' : '#e5d7bd')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)

  const horizon = height * 0.64
  if (isNight) {
    context.fillStyle = '#f2e8c9'
    context.beginPath()
    context.arc(width * 0.74, height * 0.2, 39, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#718199'
    context.beginPath()
    context.arc(width * 0.76, height * 0.18, 35, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = 'rgba(255,255,255,0.72)'
    for (let index = 0; index < 34; index += 1) {
      const x = (index * 167 + 41) % width
      const y = (index * 83 + 29) % Math.floor(horizon * 0.78)
      context.fillRect(x, y, 3, 3)
    }
  } else {
    const daylight = Math.max(0, Math.min(1, (hour - 6) / 12))
    const sunX = width * (0.12 + daylight * 0.76)
    const sunY = height * (0.43 - Math.sin(daylight * Math.PI) * 0.26)
    context.fillStyle = isTwilight ? '#ffd39a' : '#fff4c2'
    context.beginPath()
    context.arc(sunX, sunY, 42, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = 'rgba(255,255,255,0.28)'
    for (const [x, y, radius] of [[0.2, 0.25, 30], [0.48, 0.16, 24], [0.88, 0.33, 28]]) {
      context.beginPath()
      context.arc(width * x, height * y, radius, 0, Math.PI * 2)
      context.arc(width * x + 34, height * y - 10, radius * 0.8, 0, Math.PI * 2)
      context.arc(width * x + 63, height * y, radius * 0.65, 0, Math.PI * 2)
      context.fill()
    }
  }

  context.fillStyle = isNight ? '#39495b' : '#829b8f'
  context.fillRect(0, horizon, width, height - horizon)
  const buildings = [
    [0.02, 0.2, 0.23], [0.14, 0.16, 0.35], [0.27, 0.2, 0.27],
    [0.42, 0.18, 0.42], [0.57, 0.16, 0.29], [0.69, 0.2, 0.38],
    [0.85, 0.18, 0.3],
  ]
  buildings.forEach(([left, buildingWidth, buildingHeight], buildingIndex) => {
    const x = width * left
    const top = horizon - height * buildingHeight
    const buildingPixelWidth = width * buildingWidth
    context.fillStyle = isNight
      ? ['#26364b', '#304158', '#233147'][buildingIndex % 3]
      : ['#aebcb7', '#c4c9c1', '#97aaa5'][buildingIndex % 3]
    context.fillRect(x, top, buildingPixelWidth, height - top)
    context.fillStyle = isNight ? '#f0c879' : '#d9e7df'
    const columns = Math.max(2, Math.floor(buildingPixelWidth / 38))
    const rows = Math.max(2, Math.floor((height - top) / 32))
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        if (isNight && (column + row + buildingIndex) % 3 === 0) continue
        context.fillRect(x + 13 + column * 31, top + 14 + row * 28, 10, 12)
      }
    }
  })

  context.fillStyle = 'rgba(34, 55, 53, 0.76)'
  for (const x of [width * 0.08, width * 0.38, width * 0.91]) {
    context.fillRect(x - 5, horizon - 72, 10, 100)
    context.beginPath()
    context.arc(x, horizon - 76, 35, 0, Math.PI * 2)
    context.fill()
  }

  context.fillStyle = 'rgba(28, 49, 48, 0.84)'
  context.beginPath()
  context.roundRect(width - 218, 20, 198, 76, 14)
  context.fill()
  context.fillStyle = '#d7e9e3'
  context.font = '600 19px "DM Sans", sans-serif'
  context.fillText('МЕСТНОЕ ВРЕМЯ', width - 199, 48)
  context.fillStyle = '#ffffff'
  context.font = '700 31px "DM Sans", sans-serif'
  context.fillText(
    now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    width - 199,
    83,
  )
}

function createWindowTexture(now: Date) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 640
  drawWindowView(canvas, now)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function HospitalWindow({ open = false }: { open?: boolean }) {
  const [texture, setTexture] = useState(() => createWindowTexture(new Date()))
  const currentTexture = useRef(texture)

  useEffect(() => {
    const updateView = () => {
      const nextTexture = createWindowTexture(new Date())
      currentTexture.current.dispose()
      currentTexture.current = nextTexture
      setTexture(nextTexture)
    }
    updateView()
    const intervalId = window.setInterval(updateView, 60_000)
    return () => {
      window.clearInterval(intervalId)
      currentTexture.current.dispose()
    }
  }, [])

  return (
    <group position={[-3.9, 3.15, -0.35]} rotation={[0, Math.PI / 2 + (open ? 0.35 : 0), 0]}>
      <mesh position={[0, 0, -0.025]}>
        <boxGeometry args={[2.2, 1.56, 0.12]} />
        <meshStandardMaterial color="#e5ebe8" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <boxGeometry args={[2.02, 1.36, 0.035]} />
        <meshStandardMaterial color="#526762" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.067]}>
        <planeGeometry args={[1.92, 1.26]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.09]} raycast={() => {}}>
        <boxGeometry args={[0.035, 1.25, 0.025]} />
        <meshStandardMaterial color="#f4f7f5" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.09]} raycast={() => {}}>
        <boxGeometry args={[1.92, 0.035, 0.025]} />
        <meshStandardMaterial color="#f4f7f5" roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.83, 0.035]} castShadow>
        <boxGeometry args={[2.3, 0.12, 0.3]} />
        <meshStandardMaterial color="#f4f7f5" roughness={0.55} />
      </mesh>
    </group>
  )
}

function PatientWallPanel({ onAction, targetAction, patientState }: Pick<RoomSceneProps, 'onAction' | 'targetAction' | 'patientState'>) {
  const consciousness = patientState?.consciousness
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 480
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось создать графический контекст для стенового экрана пациента.')

    context.fillStyle = '#f8fbfa'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#397e76'
    context.fillRect(0, 0, canvas.width, 82)
    context.fillStyle = '#c9e6de'
    context.font = '600 28px "DM Sans", sans-serif'
    context.fillText('ПАЦИЕНТ · ПАЛАТА 204', 36, 51)
    context.fillStyle = '#294f49'
    context.font = '700 42px "DM Sans", sans-serif'
    context.fillText(`${scenario.patient.name} · ${scenario.patient.age} лет`, 36, 145)
    context.fillStyle = '#718681'
    context.font = '500 27px "DM Sans", sans-serif'
    context.fillText(consciousness ? 'Экстренный эпизод · требуется оценка' : 'Готовность к учебному эпизоду', 36, 187)
    context.fillText(consciousness ? `Сознание: ${consciousnessLabels[consciousness]}` : 'Мария Андреевна · учебные данные', 36, 222)
    context.fillStyle = '#e9f2ef'
    context.beginPath()
    context.roundRect(32, 258, 836, 124, 16)
    context.fill()

    scenario.patient.vitals.forEach((vital, index) => {
      const left = 52 + index * 164
      context.fillStyle = '#81938e'
      context.font = '600 23px "DM Sans", sans-serif'
      context.fillText(vital.label, left, 294)
      context.fillStyle = '#294f49'
      context.font = '700 36px "DM Sans", sans-serif'
      context.fillText(vital.value, left, 337)
      context.fillStyle = '#718681'
      context.font = '500 19px "DM Sans", sans-serif'
      context.fillText(vital.unit, left, 364)
    })
    context.fillStyle = '#63877f'
    context.font = '600 20px "DM Sans", sans-serif'
    context.fillText('ИСХОДНЫЕ ПОКАЗАТЕЛИ · ТЕКУЩИЕ НУЖНО ИЗМЕРИТЬ', 36, 432)

    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [consciousness])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <group position={[2.5 + PATIENT_PANEL_SHIFT_X, 3, -3.95]}>
      <mesh position={[0, 0, -0.035]}>
        <boxGeometry args={[PATIENT_PANEL_WIDTH, 1.52, 0.07]} />
        <meshStandardMaterial
          color={targetAction === 'chart' ? ACTION_HIGHLIGHT_COLOR : '#45615c'}
          emissive={targetAction === 'chart' ? ACTION_HIGHLIGHT_COLOR : '#000000'}
          emissiveIntensity={targetAction === 'chart' ? 0.7 : 0}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, 0, 0.015]}
        onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (document.pointerLockElement) return; event.nativeEvent.preventDefault(); onAction('chart') }}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <planeGeometry args={[2.58, 1.43]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  )
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
      camera.position.set(7.2, 6.8, 8.5)
      camera.rotation.order = 'XYZ'
      camera.lookAt(0, 1.2, 0)
      onPointerLockChange(false)
    }
  }, [gl, onPointerLockChange, onPointerLockError])

  useEffect(() => {
    cameraRef.current.position.y = firstPersonCameraHeight
  }, [firstPersonCameraHeight])

  useFrame((_, delta) => {
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

function BlanketVisual({ highlighted = false }: { highlighted?: boolean }) {
  const { surface, hem } = useMemo(() => {
    const columns = 36
    const rows = 72
    const width = 1.8
    const length = 2.05
    const startZ = -0.58
    const surface = new THREE.BufferGeometry()
    const positions: number[] = []
    const indices: number[] = []
    const heightAt = (x: number, along: number) => {
      const distanceFromCenter = Math.abs(x)
      const torsoDome = Math.max(0, 1 - (distanceFromCenter / 0.62) ** 2) * 0.16
      const sideDrape = Math.max(0, (distanceFromCenter - 0.57) / 0.33) * 0.3
      const folds = (
        Math.sin(along * 29 + distanceFromCenter * 8) * 0.016
        + Math.sin(along * 53 - distanceFromCenter * 13) * 0.007
      ) * (0.3 + Math.min(sideDrape, 1))
      const endFold = Math.exp(-(((along - 0.94) / 0.035) ** 2)) * 0.045
      return 0.36 + Math.sin(Math.PI * along) * 0.08 + torsoDome - sideDrape + folds + endFold
    }

    for (let row = 0; row <= rows; row += 1) {
      const along = row / rows
      const z = startZ + along * length

      for (let column = 0; column <= columns; column += 1) {
        const x = (column / columns * 2 - 1) * width / 2
        positions.push(x, heightAt(x, along), z)
      }
    }

    const stride = columns + 1
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const a = row * stride + column
        const b = a + 1
        const c = a + stride
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }

    surface.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    surface.setIndex(indices)
    surface.computeVertexNormals()

    const edgeX = width / 2 - 0.015
    const hemPoints = Array.from({ length: 49 }, (_, index) => {
      const along = index / 48
      return new THREE.Vector3(-edgeX, heightAt(-edgeX, along), startZ + along * length)
    })
    hemPoints.push(
      new THREE.Vector3(0, heightAt(0, 1), startZ + length),
      ...Array.from({ length: 49 }, (_, index) => {
        const along = 1 - index / 48
        return new THREE.Vector3(edgeX, heightAt(edgeX, along), startZ + along * length)
      }),
    )
    const hem = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemPoints), 144, 0.012, 6, false)

    return { surface, hem }
  }, [])

  useEffect(() => () => {
    surface.dispose()
    hem.dispose()
  }, [hem, surface])

  return (
    <group>
      <mesh geometry={surface} castShadow receiveShadow>
        <meshStandardMaterial
          color={highlighted ? ACTION_HIGHLIGHT_COLOR : '#b9d1d5'}
          emissive={highlighted ? ACTION_HIGHLIGHT_COLOR : '#000000'}
          emissiveIntensity={highlighted ? 0.3 : 0}
          roughness={0.82}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={hem} castShadow>
        <meshStandardMaterial
          color={highlighted ? ACTION_HIGHLIGHT_COLOR : '#e2ece9'}
          emissive={highlighted ? ACTION_HIGHLIGHT_COLOR : '#000000'}
          emissiveIntensity={highlighted ? 0.3 : 0}
          roughness={0.88}
        />
      </mesh>
      <mesh position={[0, 0.49, -0.48]} rotation={[0.035, 0, 0]} castShadow>
        <boxGeometry args={[1.62, 0.035, 0.12]} />
        <meshStandardMaterial
          color={highlighted ? ACTION_HIGHLIGHT_COLOR : '#d5e2e1'}
          emissive={highlighted ? ACTION_HIGHLIGHT_COLOR : '#000000'}
          emissiveIntensity={highlighted ? 0.3 : 0}
          roughness={0.96}
        />
      </mesh>
    </group>
  )
}

type HospitalRoomModelProps = Omit<
  RoomSceneProps,
  'firstPersonCameraHeight' | 'onPointerLockChange' | 'onPointerLockError'
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
  doctorArrived,
  windowOpen,
  modelUrl,
}: HospitalRoomModelProps & { modelUrl: string }) {
  const { scene } = useGLTF(modelUrl)
  const patientScale = patientTransform.scale * PATIENT_REAL_WORLD_SCALE
  const [bedReady, setBedReady] = useState(false)
  const onBedReady = useCallback((ready: boolean) => setBedReady(ready), [])
  const blanketOff = patientState && ['sitting_edge', 'collapsed', 'arrest'].includes(patientPose(patientState))
  const { model, scale, offset } = useMemo(() => {
    const model = scene.clone(true)
    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = 8.5 / Math.max(size.x, size.z)
    if (bedReady) model.traverse(object => { if (object.name.includes('Hospital_Bed')) object.visible = false })
    return {
    model,
    scale,
    offset: new THREE.Vector3(-center.x * scale, -bounds.min.y * scale, -center.z * scale),
    }
  }, [scene, bedReady])

  return (
    <>
    <group position={offset} scale={scale}>
      <primitive object={model} />
    </group>

    <HospitalWindow open={windowOpen} />

    <group
      position={[
        -0.274 + patientTransform.x,
        1.3954 + patientTransform.y,
        -2.0613 + patientTransform.z,
      ]}
      scale={patientScale}
    >
      <AnimatedPatient patient={patientState ?? basePatient} clock={animationClock} fallback={patientState ? <ArticulatedPatient patient={patientState} clock={animationClock} showSupports={!bedReady}/> : <PatientVisual/>}/>
    </group>
    <group
      position={[
        -0.274 + patientTransform.x,
        1.3954 + patientTransform.y,
        -2.0613 + patientTransform.z,
      ]}
    >
      {(covered || targetAction === 'blanket') && (
        <group
          position={[blanketTransform.x, blanketTransform.y, blanketTransform.z + (blanketOff ? 0.9 : 0)]}
          scale={patientScale * blanketTransform.scale}
        >
          <group scale={blanketOff ? [1, 0.8, 0.28] : [1, 1, 1]}><BlanketVisual highlighted={targetAction === 'blanket' && !covered} /></group>
        </group>
      )}
    </group>

    <AnimatedBed patient={patientState} clock={animationClock} onReady={onBedReady}/>
    <WallStorageShelf />
    <PatientWallPanel onAction={onAction} targetAction={targetAction} patientState={patientState} />
    <EmergencyObjects onFocusObject={onFocusObject} firstPerson={firstPerson} targetAction={targetAction} onAction={onAction} patientState={patientState} />
    {doctorArrived && <group position={[2.9, 0, 1.5]}>
      <mesh position={[0, 1.1, 0]}><capsuleGeometry args={[0.24, 0.65, 6, 12]}/><meshStandardMaterial color="#f6fcfa"/></mesh>
      <mesh position={[0, 1.75, 0]}><sphereGeometry args={[0.18, 16, 12]}/><meshStandardMaterial color="#dcb297"/></mesh>
      {[-0.13, 0.13].map(x => <mesh key={x} position={[x, 0.43, 0]}><capsuleGeometry args={[0.08, 0.65, 4, 8]}/><meshStandardMaterial color="#537c7a"/></mesh>)}
      <Html position={[0, 2.1, 0]} center style={{ pointerEvents: 'none' }}><span className="scene-label">Врач в палате</span></Html>
    </group>}
    </>
  )
}

function Room({
  covered,
  firstPerson,
  firstPersonCameraHeight,
  blanketTransform,
  patientTransform,
  targetAction,
  onAction,
  onPointerLockChange,
  onPointerLockError,
  onFocusObject,
  patientState,
  animationClock = DEFAULT_ANIMATION_CLOCK,
  doctorArrived,
  windowOpen,
}: RoomSceneProps) {
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
        doctorArrived={doctorArrived}
        windowOpen={windowOpen}
        covered={covered}
        firstPerson={firstPerson}
        blanketTransform={blanketTransform}
        patientTransform={patientTransform}
        targetAction={targetAction}
        onAction={onAction}
        onFocusObject={onFocusObject}
      />
    </Suspense>
    {firstPerson ? (
      <FirstPersonNavigation
        firstPersonCameraHeight={firstPersonCameraHeight}
        onPointerLockChange={onPointerLockChange}
        onPointerLockError={onPointerLockError}
      />
    ) : (
      <OrbitControls
        makeDefault
        target={[0, 1.2, 0]}
        minDistance={6.5}
        maxDistance={13}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI / 2.05}
        enablePan={false}
        minAzimuthAngle={-Math.PI / 2.5}
        maxAzimuthAngle={Math.PI / 2.5}
      />
    )}
    </>
  )
}

useGLTF.preload(ROOM_MODEL_URL)

export default function RoomScene(props: RoomSceneProps) {
  return (
    <Canvas
      camera={{ position: [7.2, 6.8, 8.5], fov: 36 }}
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
  const breath = useRef<THREE.Mesh>(null)
  const body = useRef<THREE.Group>(null)
  const visualTime = useRef(patient.secondsSinceOnset)
  const compressionAge = useRef(Infinity)
  const lastCompression = useRef(clock.compressions)
  const pose = patientPose(patient)
  const skin = ({ normal: '#dcb296', pale: '#d1c6b6', flushed: '#db927f', coldSweat: '#c4c8bc', rash: '#dfa18e' })[patient.skin]
  useFrame((_, realDelta) => {
    if (clock.paused) return
    const delta = realDelta * clock.speed
    visualTime.current += delta
    if (clock.compressions > lastCompression.current) compressionAge.current = 0
    lastCompression.current = clock.compressions
    compressionAge.current += realDelta
    const angle = pose === 'semifowler' ? 0.65 : pose === 'sitting_edge' ? 1.2 : 0
    if (torso.current) torso.current.rotation.x = THREE.MathUtils.damp(torso.current.rotation.x, angle, 5, delta)
    const legAngle = pose === 'legs_elevated' ? -0.3 : pose === 'sitting_edge' ? 0.8 : 0
    if (legs.current) legs.current.rotation.x = THREE.MathUtils.damp(legs.current.rotation.x, legAngle, 5, delta)
    if (body.current) body.current.rotation.y = THREE.MathUtils.damp(body.current.rotation.y, pose === 'sitting_edge' ? Math.PI / 2 : 0, 5, delta)
    if (breath.current) {
      const compressionPulse = compressionAge.current < 0.3 ? Math.sin(compressionAge.current / 0.3 * Math.PI) * 0.08 : 0
      breath.current.scale.y = 1 + (patient.breathing ? Math.sin(visualTime.current * 2.8) * 0.035 : 0) - compressionPulse
    }
  })
  return <group ref={body} userData={{ patientRenderer: 'fallback' }}>
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
      {[-0.13, 0.13].map(x => <mesh key={x} position={[x, 0.02, 0.43]} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.09, 0.68, 6, 12]}/><meshStandardMaterial color="#a4c6cb"/></mesh>)}
      {showSupports && <mesh position={[0, -0.07, 0.4]}><boxGeometry args={[0.53, 0.1, 0.83]}/><meshStandardMaterial color="#e3eeeb"/></mesh>}
    </group>
  </group>
}

// Shelf heights are the upper surfaces; item origins include their geometry's
// bottom offset so that moving a shelf never leaves its contents suspended.
const SHELF_X = 2.5 + PATIENT_PANEL_SHIFT_X
const SHELF_Z = -3.62
const SHELF_TOP = 1.8
const SHELF_LOWER = 1.0
function WallStorageShelf() {
  return <group name="wall-storage-shelf" position={[SHELF_X, 0, SHELF_Z]}>
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
  </group>
}
interface SceneObjectPlacement {
  id: ObjectId
  position: [number, number, number]
  rotation?: [number, number, number]
  hitbox?: [number, number, number]
  color: string
}
const sceneObjects: SceneObjectPlacement[] = [
  { id: 'patient', position: [-0.35, 2, -2.25], hitbox: [0.48, 0.18, 0.6], color: '#6e9f95' },
  // The original GLB's right rails are at x=0.783–0.832, y=0.905–1.694.
  { id: 'bed-controls', position: [0.88, 1.23, -1.12], rotation: [0, Math.PI / 2, 0], hitbox: [0.29, 0.2, 0.14], color: '#71939b' },
  { id: 'call-bell', position: [0.88, 1.54, -2.5], rotation: [0, Math.PI / 2, 0], hitbox: [0.22, 0.32, 0.14], color: '#c66058' },
  { id: 'monitor', position: [2.5, SHELF_TOP + 0.09, SHELF_Z], color: '#4b918d' },
  { id: 'chart', position: [SHELF_X, 3, -3.86], hitbox: [2.58, 1.43, 0.12], color: '#809c83' },
  { id: 'medications', position: [1.98, SHELF_TOP + 0.075, SHELF_Z], color: '#b57e60' },
  { id: 'oxygen', position: [1.9, SHELF_LOWER + 0.475, SHELF_Z], hitbox: [0.28, 0.7, 0.28], color: '#5d9bb0' },
  { id: 'window', position: [-3.77, 3.15, -0.35], rotation: [0, Math.PI / 2, 0], hitbox: [1.92, 1.26, 0.15], color: '#82abb8' },
  { id: 'blanket', position: [2.48, SHELF_LOWER + 0.0225, SHELF_Z], hitbox: [0.4, 0.15, 0.32], color: '#789e98' },
  { id: 'heater', position: [3.48, SHELF_TOP + 0.024, SHELF_Z], rotation: [Math.PI / 2, 0, 0], hitbox: [0.24, 0.44, 0.09], color: '#c98c74' },
  { id: 'sink', position: [-2.8, 1.8, 1.7], color: '#a3beb9' },
  { id: 'injection', position: [3.89, SHELF_TOP + 0.06, SHELF_Z], rotation: [0, 0, Math.PI / 2], hitbox: [0.15, 0.5, 0.15], color: '#719dac' },
  { id: 'linen', position: [3.08, SHELF_LOWER + 0.0225, SHELF_Z], hitbox: [0.4, 0.15, 0.32], color: '#96b1ac' },
  { id: 'equipment', position: [3.03, SHELF_TOP + 0.0175, SHELF_Z], hitbox: [0.39, 0.12, 0.26], color: '#8c9eaf' },
  { id: 'cpr', position: [-0.3, 1.9, -2.3], hitbox: [0.48, 0.18, 0.6], color: '#c75b56' },
]
function EmergencyObject({ object, highlighted, onAction }: { object: typeof sceneObjects[number]; highlighted: boolean; onAction: RoomSceneProps['onAction'] }) {
  const [hovered, setHovered] = useState(false)
  const color = hovered || highlighted ? ACTION_HIGHLIGHT_COLOR : object.color
  const hitbox = object.hitbox ?? [0.36, 0.4, 0.25]
  return <group position={object.position} rotation={object.rotation} userData={{ emergencyObject: object.id }}>
    <mesh onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (document.pointerLockElement) return; event.nativeEvent.preventDefault(); onAction(object.id) }} onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }} onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}>
      <boxGeometry args={hitbox}/>
      <meshBasicMaterial color={color} transparent opacity={hovered || highlighted ? 0.1 : 0} depthWrite={false}/>
      {(hovered || highlighted) && <Edges color={ACTION_HIGHLIGHT_COLOR} raycast={() => {}}/>}
    </mesh>
    <mesh visible={false} userData={{ centerOutline: true }} raycast={() => {}}>
      <boxGeometry args={[hitbox[0] + 0.02, hitbox[1] + 0.02, hitbox[2] + 0.02]}/><meshBasicMaterial visible={false}/><Edges color={ACTION_HIGHLIGHT_COLOR} raycast={() => {}}/>
    </mesh>
    <ObjectVisual id={object.id} color={object.color}/>
    {(hovered || highlighted) && <Html position={[0, 0.25, 0]} center zIndexRange={[2, 1]} style={{ pointerEvents: 'none' }}><span className="scene-label">{objectLabels[object.id]}</span></Html>}
  </group>
}
function EmergencyObjects({ firstPerson, targetAction, onAction, onFocusObject, patientState }: Pick<RoomSceneProps, 'firstPerson' | 'targetAction' | 'onAction' | 'onFocusObject' | 'patientState'>) {
  return <>
    {sceneObjects.filter(o => o.id === 'cpr' ? patientState?.breathing === false : o.id !== 'patient' || patientState?.breathing !== false).map(object => <EmergencyObject key={object.id} object={object} highlighted={targetAction === object.id} onAction={onAction}/>)}
    {firstPerson && <CenterInteraction onAction={onAction} onFocusObject={onFocusObject}/>}
  </>
}
function CenterInteraction({ onAction, onFocusObject }: Pick<RoomSceneProps, 'onAction' | 'onFocusObject'>) {
  const { camera, scene, gl } = useThree()
  const target = useRef<ObjectId | null>(null)
  const outlined = useRef<THREE.Mesh | null>(null)
  const rayRef = useRef(new THREE.Raycaster())
  useFrame(() => {
    const ray = rayRef.current
    ray.setFromCamera(new THREE.Vector2(0, 0), camera)
    ray.far = Infinity
    const hit = ray.intersectObjects(scene.children, true).find(hit => hit.object.visible && hit.object instanceof THREE.Mesh)
    let object: THREE.Object3D | null = hit?.object ?? null
    const previousTarget = target.current
    target.current = null
    while (object) {
      if (object.userData.emergencyObject) { target.current = object.userData.emergencyObject as ObjectId; break }
      object = object.parent
    }
    if (outlined.current) outlined.current.visible = false
    outlined.current = null
    if (object && target.current) {
      const outline = object.children.find(child => child.userData.centerOutline) as THREE.Mesh | undefined
      if (outline) { outline.visible = true; outlined.current = outline }
    }
    if (previousTarget !== target.current) onFocusObject?.(target.current)
  })
  useEffect(() => {
    const interact = () => { if (target.current) onAction(target.current) }
    const key = (e: KeyboardEvent) => { if (e.code === 'KeyE' && !e.repeat && document.pointerLockElement === gl.domElement) { e.preventDefault(); interact() } }
    const click = (e: MouseEvent) => { if (document.pointerLockElement === gl.domElement && target.current) { e.preventDefault(); interact() } }
    window.addEventListener('keydown', key); gl.domElement.addEventListener('click', click)
    return () => { window.removeEventListener('keydown', key); gl.domElement.removeEventListener('click', click) }
  }, [gl, onAction])
  return null
}

function ObjectVisual({ id, color }: { id: ObjectId; color: string }) {
  if (['patient', 'cpr', 'window', 'chart', 'sink'].includes(id)) return null
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
