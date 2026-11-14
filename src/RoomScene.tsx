import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { scenario } from './scenario'

export type SceneAction =
  | 'sink'
  | 'patient'
  | 'blanket'
  | 'call-bell'
  | 'bed-controls'
  | 'mobility'
  | 'thermostat-up'
  | 'thermostat-down'

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
  covered: boolean
  firstPerson: boolean
  firstPersonCameraHeight: number
  blanketTransform: BlanketTransform
  patientTransform: PatientTransform
  roomTemperature: number
  targetAction: SceneAction | null
  onAction: (action: SceneAction) => void
  onPointerLockChange: (locked: boolean) => void
  onPointerLockError: () => void
}

function Hotspot({
  position,
  firstPerson,
  onClick,
}: {
  position: [number, number, number]
  firstPerson: boolean
  onClick: () => void
}) {
  return (
    <mesh
      position={position}
      scale={firstPerson ? 0.8 : 1.4}
      onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onClick() }}
      onPointerOver={() => { document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = 'auto' }}
    >
      <ringGeometry args={[0.075, 0.15, 32]} />
      <meshBasicMaterial
        color={ACTION_HIGHLIGHT_COLOR}
        side={THREE.DoubleSide}
        transparent
        opacity={0.98}
        toneMapped={false}
      />
    </mesh>
  )
}

const ROOM_MODEL_URL = `${import.meta.env.BASE_URL}models/gradd-hospital-room.glb`
const GENERATED_ROOM_MODEL_URL = `${import.meta.env.BASE_URL}models/hospital-room-generated.glb`
const PATIENT_MODEL_URL = `${import.meta.env.BASE_URL}models/patient.glb`
const PATIENT_REAL_WORLD_SCALE = 1
const PATIENT_PANEL_WIDTH = 2.68
const PATIENT_PANEL_SHIFT_X = PATIENT_PANEL_WIDTH * 0.15
const FIRST_PERSON_EYE_HEIGHT = 3.4
const ACTION_HIGHLIGHT_COLOR = '#ffd54a'

async function isGlbAvailable(url: string) {
  const response = await fetch(url, { headers: { Range: 'bytes=0-11' } })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Не удалось проверить 3D-модель ${url} (HTTP ${response.status}).`)

  const reader = response.body?.getReader()
  if (!reader) throw new Error(`Сервер не вернул тело файла 3D-модели ${url}.`)

  const header = new Uint8Array(12)
  let bytesRead = 0
  try {
    while (bytesRead < header.length) {
      const { done, value } = await reader.read()
      if (done) break
      const bytesToCopy = Math.min(value.length, header.length - bytesRead)
      header.set(value.subarray(0, bytesToCopy), bytesRead)
      bytesRead += bytesToCopy
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }

  return bytesRead >= header.length
    && header[0] === 0x67
    && header[1] === 0x6c
    && header[2] === 0x54
    && header[3] === 0x46
    && new DataView(header.buffer).getUint32(4, true) === 2
    && new DataView(header.buffer).getUint32(8, true) >= 20
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

function HospitalWindow() {
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
    <group position={[-3.9, 3.15, -0.35]} rotation={[0, Math.PI / 2, 0]}>
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

function PatientWallPanel({ onAction, targetAction }: Pick<RoomSceneProps, 'onAction' | 'targetAction'>) {
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
    context.fillText('Восстановление после пневмонии', 36, 187)
    context.fillText('Слабость · передвижение с поддержкой', 36, 222)
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
    context.fillText('ПОСЛЕДНИЕ ПОКАЗАТЕЛИ · 08:00 · УЧЕБНЫЕ ДАННЫЕ', 36, 432)

    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <group position={[2.5 + PATIENT_PANEL_SHIFT_X, 3, -3.95]}>
      <mesh position={[0, 0, -0.035]}>
        <boxGeometry args={[PATIENT_PANEL_WIDTH, 1.52, 0.07]} />
        <meshStandardMaterial
          color={targetAction === 'patient' ? ACTION_HIGHLIGHT_COLOR : '#45615c'}
          emissive={targetAction === 'patient' ? ACTION_HIGHLIGHT_COLOR : '#000000'}
          emissiveIntensity={targetAction === 'patient' ? 0.7 : 0}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, 0, 0.015]}
        onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onAction('patient') }}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <planeGeometry args={[2.58, 1.43]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  )
}

function HandwashingSink({
  targetAction,
  onAction,
}: Pick<RoomSceneProps, 'targetAction' | 'onAction'>) {
  const highlighted = targetAction === 'sink'
  const porcelain = highlighted ? ACTION_HIGHLIGHT_COLOR : '#f5f8f6'
  const basinMaterial = (
    <meshStandardMaterial
      color={porcelain}
      emissive={highlighted ? ACTION_HIGHLIGHT_COLOR : '#000000'}
      emissiveIntensity={highlighted ? 0.48 : 0}
      roughness={0.28}
      metalness={0.04}
    />
  )

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onAction('sink')
  }

  return (
    <group
      position={[-3.72, 0.45, -1.72]}
      rotation={[0, Math.PI / 2, 0]}
      onClick={handleClick}
      onPointerOver={() => { document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = 'auto' }}
    >
      <mesh position={[0, 0.43, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.84, 0.86, 0.4]} />
        <meshStandardMaterial
          color={highlighted ? '#ffe27a' : '#dce8e4'}
          emissive={highlighted ? ACTION_HIGHLIGHT_COLOR : '#000000'}
          emissiveIntensity={highlighted ? 0.32 : 0}
          roughness={0.68}
        />
      </mesh>
      <mesh position={[0, 0.9, 0.015]} castShadow receiveShadow>
        <boxGeometry args={[1.02, 0.12, 0.5]} />
        {basinMaterial}
      </mesh>
      <mesh position={[0, 0.974, 0.055]} castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.035, 0.31]} />
        <meshStandardMaterial
          color={highlighted ? '#fff0a8' : '#d9e8e7'}
          emissive={highlighted ? ACTION_HIGHLIGHT_COLOR : '#000000'}
          emissiveIntensity={highlighted ? 0.38 : 0}
          roughness={0.24}
        />
      </mesh>
      <mesh position={[0, 0.994, 0.055]}>
        <boxGeometry args={[0.38, 0.012, 0.16]} />
        <meshStandardMaterial color="#a9c5c6" roughness={0.2} metalness={0.14} />
      </mesh>
      <mesh position={[0, 1.035, -0.15]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 0.1, 16]} />
        <meshStandardMaterial color="#b4c3c0" metalness={0.72} roughness={0.24} />
      </mesh>
      <mesh position={[0, 1.085, -0.105]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.05, 0.018, 8, 18, Math.PI]} />
        <meshStandardMaterial color="#b4c3c0" metalness={0.72} roughness={0.24} />
      </mesh>
      <mesh position={[0.3, 1.035, -0.15]}>
        <cylinderGeometry args={[0.035, 0.035, 0.07, 16]} />
        <meshStandardMaterial color="#9abbb5" roughness={0.35} />
      </mesh>
      <mesh position={[-0.3, 1.035, -0.15]}>
        <cylinderGeometry args={[0.035, 0.035, 0.07, 16]} />
        <meshStandardMaterial color="#9abbb5" roughness={0.35} />
      </mesh>
      <mesh position={[0.37, 1.36, -0.2]} castShadow>
        <boxGeometry args={[0.2, 0.28, 0.12]} />
        <meshStandardMaterial
          color={highlighted ? ACTION_HIGHLIGHT_COLOR : '#edf4f1'}
          emissive={highlighted ? ACTION_HIGHLIGHT_COLOR : '#000000'}
          emissiveIntensity={highlighted ? 0.38 : 0}
          roughness={0.52}
        />
      </mesh>
      <mesh position={[0.37, 1.37, -0.13]}>
        <boxGeometry args={[0.08, 0.11, 0.018]} />
        <meshStandardMaterial color="#9bc9bb" roughness={0.5} />
      </mesh>
    </group>
  )
}

function Thermostat({
  roomTemperature,
  targetAction,
  onAction,
}: Pick<RoomSceneProps, 'roomTemperature' | 'targetAction' | 'onAction'>) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 360
    canvas.height = 200
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось создать графический контекст термостата.')
    context.fillStyle = '#edf5f2'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#628078'
    context.font = '600 25px "DM Sans", sans-serif'
    context.textAlign = 'center'
    context.fillText('ТЕМПЕРАТУРА', canvas.width / 2, 48)
    context.fillStyle = '#244c45'
    context.font = '700 76px "DM Sans", sans-serif'
    context.fillText(`${roomTemperature}°`, canvas.width / 2, 132)
    context.fillStyle = '#82948e'
    context.font = '500 22px "DM Sans", sans-serif'
    context.fillText('уставка палаты', canvas.width / 2, 172)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [roomTemperature])

  useEffect(() => () => texture.dispose(), [texture])

  const handleAction = (event: ThreeEvent<MouseEvent>, action: SceneAction) => {
    event.stopPropagation()
    onAction(action)
  }
  const buttonMaterial = (action: SceneAction) => (
    <meshStandardMaterial
      color={targetAction === action ? ACTION_HIGHLIGHT_COLOR : '#dcebe5'}
      emissive={targetAction === action ? ACTION_HIGHLIGHT_COLOR : '#000000'}
      emissiveIntensity={targetAction === action ? 0.85 : 0}
      roughness={0.65}
    />
  )

  return (
    <group position={[-3.2, 1.85, -3.72]}>
      <mesh position={[0, 0, -0.035]}>
        <boxGeometry args={[0.78, 0.76, 0.08]} />
        <meshStandardMaterial color="#f8fbf9" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.11, 0.018]}>
        <planeGeometry args={[0.62, 0.34]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh
        position={[-0.19, -0.22, 0.035]}
        onClick={(event: ThreeEvent<MouseEvent>) => handleAction(event, 'thermostat-down')}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <boxGeometry args={[0.2, 0.16, 0.04]} />
        {buttonMaterial('thermostat-down')}
      </mesh>
      <mesh position={[-0.19, -0.22, 0.06]} raycast={() => {}}>
        <boxGeometry args={[0.08, 0.018, 0.012]} />
        <meshBasicMaterial color="#52786e" />
      </mesh>
      <mesh
        position={[0.19, -0.22, 0.035]}
        onClick={(event: ThreeEvent<MouseEvent>) => handleAction(event, 'thermostat-up')}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <boxGeometry args={[0.2, 0.16, 0.04]} />
        {buttonMaterial('thermostat-up')}
      </mesh>
      <mesh position={[0.19, -0.22, 0.06]} raycast={() => {}}>
        <boxGeometry args={[0.08, 0.018, 0.012]} />
        <meshBasicMaterial color="#52786e" />
      </mesh>
      <mesh position={[0.19, -0.22, 0.075]} raycast={() => {}}>
        <boxGeometry args={[0.018, 0.08, 0.012]} />
        <meshBasicMaterial color="#52786e" />
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
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) {
        event.preventDefault()
        keys.add(key)
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase())
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
      if (!locked) keys.clear()
      onPointerLockChange(locked)
    }
    const handleLockError = () => onPointerLockError()
    const handleCanvasClick = () => {
      canvas.focus({ preventScroll: true })
      if (document.pointerLockElement === canvas) return
      const result = canvas.requestPointerLock()
      if (result instanceof Promise) void result.catch(handleLockError)
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
    const handleBlur = () => keys.clear()

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
    const distance = Math.min(delta, 0.05) * 2.2
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

  if (hasGeneratedModel) return <GeneratedPatientModel />

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
  roomTemperature,
  targetAction,
  onAction,
  modelUrl,
}: HospitalRoomModelProps & { modelUrl: string }) {
  const { scene } = useGLTF(modelUrl)
  const patientScale = patientTransform.scale * PATIENT_REAL_WORLD_SCALE
  const { model, scale, offset } = useMemo(() => {
    const model = scene.clone(true)
    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = 8.5 / Math.max(size.x, size.z)
    return {
    model,
    scale,
    offset: new THREE.Vector3(-center.x * scale, -bounds.min.y * scale, -center.z * scale),
    }
  }, [scene])

  return (
    <>
    <group position={offset} scale={scale}>
      <primitive object={model} />
    </group>

    <HospitalWindow />

    <group
      position={[
        -0.274 + patientTransform.x,
        1.3954 + patientTransform.y,
        -2.0613 + patientTransform.z,
      ]}
      scale={patientScale}
    >
      <PatientVisual />
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
          position={[blanketTransform.x, blanketTransform.y, blanketTransform.z]}
          scale={patientScale * blanketTransform.scale}
        >
          <BlanketVisual highlighted={targetAction === 'blanket' && !covered} />
        </group>
      )}
    </group>

    <PatientWallPanel onAction={onAction} targetAction={targetAction} />
    <HandwashingSink onAction={onAction} targetAction={targetAction} />
    <Thermostat roomTemperature={roomTemperature} targetAction={targetAction} onAction={onAction} />

    {targetAction === 'blanket' && <Hotspot position={[-1.25, 1.85, -0.15]} firstPerson={firstPerson} onClick={() => onAction('blanket')} />}
    {targetAction === 'call-bell' && <Hotspot position={[1.4, 1.55, -1.1]} firstPerson={firstPerson} onClick={() => onAction('call-bell')} />}
    {targetAction === 'bed-controls' && <Hotspot position={[0.9, 1.45, -1.2]} firstPerson={firstPerson} onClick={() => onAction('bed-controls')} />}
    {targetAction === 'mobility' && <Hotspot position={[-0.1, 1.8, 0.25]} firstPerson={firstPerson} onClick={() => onAction('mobility')} />}
    </>
  )
}

function Room({
  covered,
  firstPerson,
  firstPersonCameraHeight,
  blanketTransform,
  patientTransform,
  roomTemperature,
  targetAction,
  onAction,
  onPointerLockChange,
  onPointerLockError,
}: RoomSceneProps) {
  return (
    <>
    <color attach="background" args={['#e9f1ef']} />
    <ambientLight intensity={1.25} />
    <hemisphereLight args={['#ffffff', '#b5c6c1', 0.8]} />
    <directionalLight position={[4, 8, 3]} intensity={1.4} />
    <Suspense fallback={null}>
      <HospitalRoomModel
        covered={covered}
        firstPerson={firstPerson}
        blanketTransform={blanketTransform}
        patientTransform={patientTransform}
        roomTemperature={roomTemperature}
        targetAction={targetAction}
        onAction={onAction}
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
