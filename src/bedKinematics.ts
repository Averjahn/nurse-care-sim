import type { PatientState } from './simulation.ts'
export interface BedAngles { head: number; thigh: number; shin: number }
export const BED_ORIGIN: [number, number, number] = [-.27423787, 1.395375857, -2.123998153]
export const BED_GEOMETRY = { width: 1.980065716, headEnd: -1.75, footEnd: 1.875, hip: .195, knee: .81, thickness: .347506475 }
export const PATIENT_BED_POSITION: [number, number, number] = [0, -.32, .18]
export function targetBedAngles(position: PatientState['position']): BedAngles {
  return { head: position === 'semiSitting' ? Math.PI / 4 : 0, thigh: position === 'legsUp' ? Math.PI / 9 : position === 'kneesUp' ? .65 : 0, shin: position === 'kneesUp' ? -.65 : position === 'legsUp' ? Math.PI / 9 : 0 }
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t
export function interpolateBed(from: BedAngles, to: BedAngles, progress: number): BedAngles {
  const t = Math.max(0, Math.min(1, progress)), s = t * t * (3 - 2 * t)
  return { head: mix(from.head, to.head, s), thigh: mix(from.thigh, to.thigh, s), shin: mix(from.shin, to.shin, s) }
}
/** Surface path is parameterized by the unbent longitudinal coordinate. */
export function bedPoint(y: number, z: number, a: BedAngles): [number, number] {
  const { hip, knee } = BED_GEOMETRY
  let height = 0, longitudinal = z, angle = 0
  if (z < 0) { angle = a.head; height = -z * Math.sin(angle); longitudinal = z * Math.cos(angle) }
  else if (z > hip && z <= knee) { angle = -a.thigh; height = (z - hip) * Math.sin(a.thigh); longitudinal = hip + (z - hip) * Math.cos(a.thigh) }
  else if (z > knee) { angle = -a.shin; height = (knee - hip) * Math.sin(a.thigh) + (z - knee) * Math.sin(a.shin); longitudinal = hip + (knee - hip) * Math.cos(a.thigh) + (z - knee) * Math.cos(a.shin) }
  // Smooth the foam's normal across each hinge, avoiding cracks on the underside.
  for (const [hinge, before, after] of [[0, a.head, 0], [hip, 0, -a.thigh], [knee, -a.thigh, -a.shin]]) {
    if (Math.abs(z - hinge) < .035) angle = mix(before, after, (z - hinge + .035) / .07)
  }
  return [height + y * Math.cos(angle), longitudinal + y * Math.sin(angle)]
}
/** Height of the mattress top at a projected coordinate; no triangle raycast. */
export function mattressHeight(z: number, a: BedAngles): number | null {
  const { headEnd, footEnd, hip, knee } = BED_GEOMETRY
  const kneeZ = hip + (knee - hip) * Math.cos(a.thigh)
  const kneeY = (knee - hip) * Math.sin(a.thigh)
  if (z < headEnd * Math.cos(a.head) || z > kneeZ + (footEnd - knee) * Math.cos(a.shin)) return null
  if (z < 0) return -z * Math.tan(a.head)
  if (z <= hip) return 0
  if (z <= kneeZ) return (z - hip) * Math.tan(a.thigh)
  return kneeY + (z - kneeZ) * Math.tan(a.shin)
}

// Small hip extension accommodates the model's tapered calf/heel radius. Knee flexion is unchanged.
export const patientLegTilt = (headAngle: number) => .035 + .045 * Math.sin(headAngle)

export function positionForBed(patient?: PatientState): PatientState['position'] {
  return patient && patient.breathing && patient.location !== 'sink' ? patient.position : 'supine'
}
