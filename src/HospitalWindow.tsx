import { useEffect, useMemo } from 'react'
import { Box3, CanvasTexture, SRGBColorSpace, Vector3 } from 'three'
import { EditableTarget } from './SceneEditor3D'
import { useSceneEditor } from './sceneEditorStore'
import { WINDOW_HEIGHT as H, WINDOW_WIDTH as W, windowLayout } from './windowGeometry'

function createNeutralView() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512
  const context = canvas.getContext('2d')!
  const sky = context.createLinearGradient(0, 0, 0, 512)
  sky.addColorStop(0, '#cce4ed'); sky.addColorStop(0.72, '#edf4f3'); sky.addColorStop(1, '#d5e2da')
  context.fillStyle = sky; context.fillRect(0, 0, 512, 512)
  context.filter = 'blur(22px)'; context.fillStyle = '#b9cfc2'
  for (const [x, y, radius] of [[30, 485, 82], [175, 503, 65], [370, 478, 90], [500, 495, 70]]) {
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill()
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
  return texture
}

/** A permanently closed two-pane PVC window, seated within the wall thickness. */
export default function HospitalWindow({ bounds, wallId }: { bounds: Box3; wallId: string }) {
  const wall = useSceneEditor(s => s.settings.objects[wallId])
  const settings = useSceneEditor(s => s.settings.objects.window)
  const layout = windowLayout(bounds.getCenter(new Vector3()).toArray(), bounds.getSize(new Vector3()).toArray(), wall, settings)
  const texture = useMemo(() => createNeutralView(), [])
  useEffect(() => () => texture.dispose(), [texture])
  const depth = layout.depth + 0.012, edge = 0.085, mullion = 0.075
  const paneWidth = (W - 2 * edge - mullion) / 2, paneHeight = H - 2 * edge
  return <EditableTarget id="window" label="Окно (закрыто)" position={layout.position} rotation={[0, Math.PI / 2, 0]} hintScale={1} fixedWorldX={layout.wallX}>
    <group name="closed-hospital-window" userData={{ permanentlyClosed: true }}>
      <mesh position={[0, 0, -depth / 2 + 0.004]}>
        <planeGeometry args={[W - 0.03, H - 0.03]}/><meshBasicMaterial map={texture} toneMapped={false}/>
      </mesh>
      {[-1, 1].map(side => <mesh key={`outer-${side}`} name={`window-frame-jamb-${side}`} position={[side * (W - edge) / 2, 0, 0]}><boxGeometry args={[edge, H, depth]}/><meshStandardMaterial color="#f3f5f2" roughness={0.45}/></mesh>)}
      {[-1, 1].map(side => <mesh key={`rail-${side}`} position={[0, side * (H - edge) / 2, 0]}><boxGeometry args={[W - edge * 2, edge, depth]}/><meshStandardMaterial color="#f3f5f2" roughness={0.45}/></mesh>)}
      <mesh><boxGeometry args={[mullion, H - 2 * edge, depth]}/><meshStandardMaterial color="#f0f3f0" roughness={0.45}/></mesh>
      {[-1, 1].map(side => {
        const x = side * (paneWidth + mullion) / 2
        return <group key={side} position={[x, 0, 0]}>
          <mesh position={[0, 0, depth / 2 - 0.025]}><planeGeometry args={[paneWidth - 0.03, paneHeight - 0.03]}/><meshStandardMaterial color="#d6e9ee" transparent opacity={0.13} roughness={0.12} metalness={0.1} depthWrite={false}/></mesh>
          {[-1, 1].map(v => <mesh key={`seal-x-${v}`} position={[v * (paneWidth - 0.018) / 2, 0, depth / 2 - 0.012]}><boxGeometry args={[0.018, paneHeight, 0.016]}/><meshStandardMaterial color="#7b8d8d" roughness={0.8}/></mesh>)}
          {[-1, 1].map(v => <mesh key={`seal-y-${v}`} position={[0, v * (paneHeight - 0.018) / 2, depth / 2 - 0.012]}><boxGeometry args={[paneWidth, 0.018, 0.016]}/><meshStandardMaterial color="#7b8d8d" roughness={0.8}/></mesh>)}
          {[-1, 1].map(v => <mesh key={`sash-x-${v}`} position={[v * (paneWidth - 0.05) / 2, 0, depth / 2 - 0.007]}><boxGeometry args={[0.045, paneHeight, 0.025]}/><meshStandardMaterial color="#edf1ed" roughness={0.45}/></mesh>)}
          {[-1, 1].map(v => <mesh key={`sash-y-${v}`} position={[0, v * (paneHeight - 0.05) / 2, depth / 2 - 0.007]}><boxGeometry args={[paneWidth, 0.045, 0.025]}/><meshStandardMaterial color="#edf1ed" roughness={0.45}/></mesh>)}
        </group>
      })}
      <mesh position={[0.13, 0, depth / 2 + 0.015]}><boxGeometry args={[0.055, 0.095, 0.03]}/><meshStandardMaterial color="#d7deda" roughness={0.45}/></mesh>
      <mesh position={[0.13, -0.065, depth / 2 + 0.04]}><boxGeometry args={[0.025, 0.12, 0.025]}/><meshStandardMaterial color="#eef1ed" roughness={0.4}/></mesh>
      <mesh position={[0, -H / 2 - 0.032, 0.045]}><boxGeometry args={[W + 0.14, 0.065, depth + 0.17]}/><meshStandardMaterial color="#f0f3ee" roughness={0.6}/></mesh>
    </group>
  </EditableTarget>
}
