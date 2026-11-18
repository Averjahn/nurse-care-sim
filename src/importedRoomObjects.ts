import { Box3, Group, Mesh, Vector3, type Material, type Object3D } from 'three'
import type { Vec3 } from './sceneSettings'

const categories: Array<[RegExp, string, string]> = [
  [/Hospital_Bed|Matress_Twin/, 'bed', 'Кровать'],
  [/Drawers_on_Wheels/, 'imported-cabinet', 'Тумба на колёсах'],
  [/IV_Bag_Holder|IV_Monitor/, 'imported-iv-stand', 'Инфузионная стойка'],
  [/X_Ray_Viewing/, 'imported-xray', 'Негатоскоп'],
  [/ECG_|Monitor_Wall_Mount/, 'imported-wall-monitor', 'Настенный монитор'],
  [/Overhead_Light/, 'imported-light', 'Медицинский светильник'],
  [/Back_Panel/, 'imported-medical-panel', 'Медицинская панель'],
  [/Wall_Socket|Wall_Outlet/, 'imported-outlets', 'Розетки и выключатели'],
  [/Defib/, 'imported-defibrillator', 'Дефибриллятор'],
  [/Ophthal|Otoscope|Scope_Holder/, 'imported-diagnostic', 'Диагностические инструменты'],
  [/Blood_Pressure_Monitor/, 'imported-pressure', 'Прикроватный прибор'],
  [/Bedside_Chart/, 'imported-chart-holder', 'Держатель документов'],
  [/Biohazard_Bin/, 'imported-bin', 'Контейнер для отходов'],
  [/Stethoscope|Connecting/, 'imported-stethoscope', 'Стетоскоп'],
  [/Clear_Tube|Wire_/, 'imported-wires', 'Трубки и провода'],
]
export interface ImportedRoomObject { id: string; label: string; object: Group; position: Vec3; materials: Material[] }
/** Flat imported GLB meshes become selectable logical furniture groups. */
export function splitRoomObjects(model: Object3D): ImportedRoomObject[] {
  const grouped = new Map<string, ImportedRoomObject>()
  for (const child of [...model.children]) {
    if (/^Mesh[123](?:_| )/.test(child.name)) continue // Existing floor/wall shell.
    const [, id, label] = categories.find(([pattern]) => pattern.test(child.name)) ?? [null, 'imported-other', 'Прочее оборудование']
    if (!grouped.has(id)) grouped.set(id, { id, label, object: new Group(), position: [0, 0, 0], materials: [] })
    grouped.get(id)!.object.add(child)
  }
  for (const entry of grouped.values()) {
    entry.object.updateMatrixWorld(true)
    const center = new Box3().setFromObject(entry.object).getCenter(new Vector3())
    entry.position = center.toArray()
    entry.object.children.forEach(child => child.position.sub(center))
    const copies = new Map<Material, Material>()
    entry.object.traverse(node => {
      if (!(node instanceof Mesh)) return
      const clone = (source: Material) => { if (!copies.has(source)) copies.set(source, source.clone()); return copies.get(source)! }
      node.material = Array.isArray(node.material) ? node.material.map(clone) : clone(node.material)
    })
    entry.materials = [...copies.values()]
  }
  return [...grouped.values()]
}
