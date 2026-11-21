import { Html, RoundedBox } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Group } from 'three'
import { useSimulationStore } from './store'
import { useSceneEditor } from './sceneEditorStore'
import { actionById } from './scenario'
import { actionMenu } from './actionMenu'
import { BED_BUTTONS, REMOTE_TIMING, suggestedBedButton, useBedRemote, type BedButtonId } from './bedRemoteStore'
import { bedButtonTexture } from './bedButtonIcons'
import { useObjectHighlight } from './useObjectHighlight'

function RemoteButton({ id, label, x, y, hinted, enabled, onOpen }: { id: BedButtonId; label: string; x: number; y: number; hinted: boolean; enabled: boolean; onOpen: () => void }) {
  const root = useRef<Group>(null), face = useRef<Group>(null), age = useRef(0), wasPressed = useRef(false), maxDepth = useRef(0)
  const [hoverKey, setHoverKey] = useState('')
  const phaseKey = useBedRemote(s => `${s.session}:${s.phase}`)
  const hovered = hoverKey === phaseKey && (phaseKey.endsWith(':idle') || phaseKey.endsWith(':ready'))
  const hover = () => { const state = useBedRemote.getState(); setHoverKey(`${state.session}:${state.phase}`) }
  const color = useSceneEditor(s => s.settings.hintColor)
  const texture = useMemo(() => bedButtonTexture(id, label), [id, label])
  useEffect(() => () => texture.dispose(), [texture])
  useObjectHighlight(face, hinted, hovered && enabled, 0, color)
  useFrame((_, dt) => {
    const attempt = useSimulationStore.getState().attempt
    if (attempt && !['active', 'arrest'].includes(attempt.phase)) return
    const remote = useBedRemote.getState(), pressing = remote.phase === 'pressing' && remote.action === id
    if (pressing !== wasPressed.current) { age.current = 0; wasPressed.current = pressing; if (pressing) maxDepth.current = 0 }
    age.current += Math.min(dt, .1)
    const depth = pressing ? Math.sin(Math.min(1, age.current / REMOTE_TIMING.press) * Math.PI) * .012 : 0
    maxDepth.current = Math.max(maxDepth.current, depth)
    if (root.current) {
      root.current.position.z = .066 - depth
      Object.assign(root.current.userData, { bedAction: id, hinted, enabled, pressDepth: depth, maxPressDepth: maxDepth.current })
    }
  })
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    setHoverKey('')
    if (document.pointerLockElement) return
    const phase = useBedRemote.getState().phase
    if (phase === 'idle') onOpen()
    else if (phase === 'ready' && enabled) useBedRemote.getState().press(id)
  }
  return <group ref={root} name={`bed-button-${id}`} position={[x, y, .066]}
    onClick={click} onPointerOver={event => { event.stopPropagation(); hover(); document.body.style.cursor = 'pointer' }} onPointerMove={event => { event.stopPropagation(); if (!hovered) hover() }} onPointerOut={() => { setHoverKey(''); document.body.style.cursor = 'auto' }}>
    <group ref={face}><RoundedBox args={[.16, .14, .028]} radius={.008} smoothness={3}><meshStandardMaterial color={enabled ? '#e8f3ee' : '#c8d3ce'} roughness={.58}/></RoundedBox></group>
    <mesh position={[0, 0, .0155]}><planeGeometry args={[.147, .125]}/><meshBasicMaterial map={texture} transparent alphaTest={.01} opacity={enabled ? 1 : .42} depthWrite={false}/></mesh>
    {hovered && !document.pointerLockElement && <Html position={[0, .11, .05]} center zIndexRange={[10, 9]} style={{ pointerEvents: 'none' }}><span className="bed-button-tooltip">{actionById(id).title}{!enabled && <small>Доступно на соответствующем этапе помощи</small>}</span></Html>}
  </group>
}
export default function BedRemote({ highlighted, onOpen }: { highlighted: boolean; onOpen: () => void }) {
  const attempt = useSimulationStore(s => s.attempt), phase = useBedRemote(s => s.phase)
  const editor = useSceneEditor(s => s.open), preview = useSceneEditor(s => s.open && s.preview && s.selected === 'bed-controls')
  const availability = attempt?.phase === 'failed' && attempt.arrestAt !== null ? { ...attempt, phase: 'arrest' as const } : attempt
  const expected = suggestedBedButton(attempt), available = actionMenu(availability, 'bed-controls').map(item => item.id)
  return <group name="interaction-bed-controls" userData={{ emergencyObject: 'bed-controls', hinted: highlighted }} onClick={event => { event.stopPropagation(); if (!document.pointerLockElement) onOpen() }}>
    <mesh position={[0, 0, -.06]}><boxGeometry args={[.15, .38, .08]}/><meshStandardMaterial color="#8ba39b" roughness={.65} metalness={.25}/></mesh>
    <RoundedBox args={[.42, .57, .10]} radius={.035} smoothness={4}><meshStandardMaterial color="#f2f5ef" roughness={.65}/></RoundedBox>
    <mesh position={[0, -.008, .052]}><boxGeometry args={[.385, .52, .012]}/><meshStandardMaterial color="#738e84" roughness={.7}/></mesh>
    {BED_BUTTONS.map((button, i) => <RemoteButton key={button.id} {...button} x={i % 2 ? .098 : -.098} y={.17 - Math.floor(i / 2) * .17}
      hinted={editor ? preview : attempt?.mode === 'training' && expected === button.id && (phase === 'ready' || phase === 'approaching' || (phase === 'idle' && highlighted))}
      enabled={available.includes(button.id)} onOpen={onOpen}/>)}
  </group>
}
