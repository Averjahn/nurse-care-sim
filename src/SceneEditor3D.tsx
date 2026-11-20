import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import { Group, PerspectiveCamera, Vector3, type Object3D } from 'three'
import { editorObjectAllowed, selectEditorSceneObject, useObjectSettings, useSceneEditor } from './sceneEditorStore'
import type { Vec3 } from './sceneSettings'
import { useObjectHighlight } from './useObjectHighlight'

export function EditableTarget({ id, label, position, rotation, scale, hintScale = 1.3, visible = true, fixedWorldX, children }: {
  id: string; label: string; position?: Vec3 | Vector3; rotation?: Vec3; scale?: number | Vec3; hintScale?: number; visible?: boolean; fixedWorldX?: number; children: ReactNode
}) {
  const ref = useRef<Group>(null)
  const open = useSceneEditor(s => s.open)
  const override = useObjectSettings(id)
  const target = useSceneEditor(s => s.targets[id])
  useLayoutEffect(() => {
    const object = ref.current!
    object.updateWorldMatrix(true, false)
    const world = object.getWorldPosition(new Vector3())
    if (editorObjectAllowed(id)) useSceneEditor.getState().register({ id, label, object, position: world.toArray(), localPosition: object.position.toArray(), localScale: object.scale.toArray(), hintScale })
    return () => useSceneEditor.getState().unregister(id, object)
  }, [id, label, hintScale])
  useLayoutEffect(() => {
    if (!target || target.object !== ref.current) return
    const object = target.object
    if (override?.position) {
      const point = new Vector3(...override.position)
      object.parent?.updateWorldMatrix(true, false)
      object.position.copy(object.parent ? object.parent.worldToLocal(point) : point)
    } else object.position.fromArray(target.localPosition)
    if (fixedWorldX !== undefined) object.position.setX(fixedWorldX)
    object.scale.fromArray(target.localScale).multiplyScalar(override?.scale ?? 1)
    object.updateWorldMatrix(false, true)
  }, [override, target, fixedWorldX])
  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    selectEditorSceneObject(id)
  }
  return <group ref={ref} name={`editable-${id}`} position={position} rotation={rotation} scale={scale} visible={visible} onClick={open && visible ? select : undefined} userData={{ editorId: id }}>
    {children}
  </group>
}

export function EditorPulse({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<Group>(null)
  const active = useSceneEditor(s => s.open && s.preview && s.selected === id)
  const settings = useObjectSettings(id)
  const defaultColor = useSceneEditor(s => s.settings.hintColor)
  const defaultScale = useSceneEditor(s => s.targets[id]?.hintScale ?? 1.3)
  const color = settings?.hintColor ?? defaultColor
  const maxScale = settings?.hintScale ?? defaultScale
  useObjectHighlight(ref, active, false, id === 'patient' ? 0 : maxScale - 1, color)
  return <group ref={ref}><group>{children}</group></group>
}

type OrbitControl = { target: Vector3; update: () => void }
export function SceneEditorControls({ firstPerson, simulationActive = false }: { firstPerson: boolean; simulationActive?: boolean }) {
  const { camera, controls, size } = useThree()
  const saved = useSceneEditor(s => s.settings.camera)
  const open = useSceneEditor(s => s.open)
  const selected = useSceneEditor(s => s.selected)
  const target = useSceneEditor(s => s.targets[selected])
  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return
    if (simulationActive && !open && !firstPerson && size.width > 900) {
      // Keep the working area centered in the space left of the patient panel.
      camera.setViewOffset(size.width, size.height, Math.min(340, size.width * .25) / 2, 0, size.width, size.height)
    } else camera.clearViewOffset()
    return () => camera.clearViewOffset()
  }, [camera, size.width, size.height, simulationActive, open, firstPerson])
  useLayoutEffect(() => {
    if (firstPerson) return
    camera.position.fromArray(saved.position)
    if (camera instanceof PerspectiveCamera) camera.setFocalLength(camera.getFilmHeight() / (2 * Math.tan(saved.fov * Math.PI / 360)))
    const orbit = controls as unknown as OrbitControl | null
    orbit?.target?.fromArray(saved.target)
    orbit?.update()
  }, [saved, camera, controls, firstPerson])
  useLayoutEffect(() => {
    if (firstPerson || !(camera instanceof PerspectiveCamera)) return
    const aspect = size.width / size.height
    const fov = Math.min(75, 2 * Math.atan(Math.tan(saved.fov * Math.PI / 360) * Math.max(1, 1 / aspect)) * 180 / Math.PI)
    camera.setFocalLength(camera.getFilmHeight() / (2 * Math.tan(fov * Math.PI / 360)))
  }, [camera, saved.fov, size.width, size.height, firstPerson])
  useEffect(() => {
    const captureView = () => ({ ...useSceneEditor.getState().settings.camera, position: camera.position.toArray() as Vec3, target: (controls as unknown as OrbitControl | null)?.target?.toArray() as Vec3 ?? [0, 1.2, 0] })
    useSceneEditor.setState({ captureView })
    return () => { if (useSceneEditor.getState().captureView === captureView) useSceneEditor.setState({ captureView: null }) }
  }, [camera, controls])
  useEffect(() => {
    if (!open) {
      useSceneEditor.setState({ dragging: false, selectionBlockedUntil: 0 })
      if (controls) Reflect.set(controls, 'enabled', true)
    }
  }, [open, controls])
  if (!open || !target) return null
  return <TransformControls object={target.object as Object3D} mode="translate" space="world" size={0.85} showX={selected !== 'window'}
    onMouseDown={() => useSceneEditor.setState({ dragging: true })}
    onMouseUp={() => useSceneEditor.setState({ dragging: false, selectionBlockedUntil: Date.now() + 250 })}
    onObjectChange={() => {
    const point = target.object.getWorldPosition(new Vector3()).clampScalar(-100, 100)
    useSceneEditor.getState().updateObject(selected, { position: point.toArray() }, 'position')
  }} />
}
