import type { PatientState } from './simulation.ts'

export const PATIENT_POSES = ['lying', 'semifowler', 'sitting_edge', 'legs_elevated', 'collapsed', 'arrest'] as const
export type PatientPose = typeof PATIENT_POSES[number]
export const CROSSFADE_SECONDS = 0.4
export const POSE_CLIPS: Record<PatientPose, string> = {
  lying: 'lying_idle', semifowler: 'semifowler_idle', sitting_edge: 'sit_edge_idle',
  legs_elevated: 'legs_elevated_idle', collapsed: 'collapsed_idle', arrest: 'arrest_idle',
}
export const CORE_TRANSITION_CLIPS = ['lying_to_sit_edge', 'sit_edge_to_lying', 'faint_from_sit'] as const
export const PATIENT_MORPHS = ['eyes_closed', 'pain_grimace', 'mouth_open_gasp', 'face_swelling', 'chest_rise', 'lips_swelling'] as const
export const BED_BONES = ['Bed_Head', 'Bed_Knee', 'Bed_FootEnd'] as const
export type PatientMorph = typeof PATIENT_MORPHS[number]
export function patientPose(patient: PatientState): PatientPose {
  if (!patient.breathing) return 'arrest'
  if (patient.consciousness === 'lost' || (patient.consciousness === 'dim' && patient.position === 'sitting')) return 'collapsed'
  return ({ supine: 'lying', semiSitting: 'semifowler', sitting: 'sitting_edge', legsUp: 'legs_elevated' } as const)[patient.position]
}
const transitions: Partial<Record<PatientPose, Partial<Record<PatientPose, string>>>> = {
  lying: { semifowler: 'lying_to_semifowler', sitting_edge: 'lying_to_sit_edge', legs_elevated: 'lying_to_legs_elevated', collapsed: 'collapse_from_lying' },
  semifowler: { lying: 'semifowler_to_lying' },
  sitting_edge: { lying: 'sit_edge_to_lying', collapsed: 'faint_from_sit' },
  legs_elevated: { lying: 'legs_elevated_to_lying' },
  collapsed: { lying: 'collapsed_to_lying' },
  arrest: { lying: 'arrest_to_lying' },
}
export interface PoseTransition { from: PatientPose; to: PatientPose; clip: string | null }
/** Non-adjacent postures travel via lying; emergencies interrupt the route. */
export function poseTransitionRoute(from: PatientPose, to: PatientPose): PoseTransition[] {
  if (from === to) return []
  if (to === 'arrest') return [{ from, to, clip: null }]
  const direct = transitions[from]?.[to]
  if (direct) return [{ from, to, clip: direct }]
  if (from === 'lying' || to === 'lying') return [{ from, to, clip: null }]
  return [...poseTransitionRoute(from, 'lying'), ...poseTransitionRoute('lying', to)]
}
export interface PlaybackStep { clip: string; once: boolean }
export function animationPlan(from: PatientPose, to: PatientPose, available: readonly string[]): PlaybackStep[] {
  const steps = poseTransitionRoute(from, to).flatMap(edge => edge.clip && available.includes(edge.clip) ? [{ clip: edge.clip, once: true }] : [])
  return [...steps, { clip: POSE_CLIPS[to], once: false }]
}
export function animationTimeScale(speed: number, paused: boolean, compression = false): number {
  return paused ? 0 : compression ? 1 : [1, 2, 4].includes(speed) ? speed : 1
}
export function bedAngles(pose: PatientPose): Record<typeof BED_BONES[number], number> {
  return { Bed_Head: pose === 'semifowler' ? Math.PI / 4 : 0, Bed_Knee: pose === 'legs_elevated' ? 0.12 : 0, Bed_FootEnd: pose === 'legs_elevated' ? -0.28 : 0 }
}
export function patientMorphs(patient: PatientState, breathingTime: number): Record<PatientMorph, number> {
  const distressed = patient.complaint !== 'none' && !patient.chestPainRelieved
  const allergic = patient.complaint === 'itchBreath'
  return {
    eyes_closed: patient.consciousness === 'lost' ? 1 : patient.consciousness === 'dim' ? 0.65 : 0,
    pain_grimace: distressed ? 0.65 : 0,
    mouth_open_gasp: patient.breathing && allergic ? 0.6 : 0,
    face_swelling: allergic ? 0.65 : 0,
    lips_swelling: allergic ? 0.55 : 0,
    chest_rise: patient.breathing ? (Math.sin(breathingTime * 2.8) + 1) * 0.2 : 0,
  }
}
export interface RigInventory { skinnedMeshes: number; bones: readonly string[]; clips: readonly string[]; morphs?: readonly string[] }
export interface RigValidation { ok: boolean; errors: string[]; warnings: string[] }
export const normalizedBoneName = (name: string) => name.replace(/^mixamorig[:_]?/i, '').toLowerCase()
export function validatePatientRig(inventory: RigInventory): RigValidation {
  const errors: string[] = [], warnings: string[] = []
  if (!inventory.skinnedMeshes) errors.push('Нет SkinnedMesh: статичная сетка не является ригом.')
  const bones = new Set(inventory.bones.map(normalizedBoneName))
  for (const bone of ['hips', 'spine', 'head']) if (!bones.has(bone)) errors.push(`Не найдена кость ${bone}.`)
  if (new Set(inventory.bones).size > 65) errors.push('Число костей превышает 65.')
  for (const clip of [...Object.values(POSE_CLIPS), ...CORE_TRANSITION_CLIPS, 'compression']) if (!inventory.clips.includes(clip)) errors.push(`Отсутствует клип ${clip}.`)
  for (const morph of PATIENT_MORPHS) if (!inventory.morphs?.includes(morph)) warnings.push(`Нет морфа ${morph}: соответствующий эффект будет пропущен.`)
  return { ok: errors.length === 0, errors, warnings }
}
export function patientRenderer(assetAvailable: boolean, validation: RigValidation | null, loadError = false): 'rigged' | 'fallback' {
  return assetAvailable && !loadError && validation?.ok ? 'rigged' : 'fallback'
}

export interface AnimationClock { speed: number; paused: boolean; compressions: number; attemptId: string }
export const DEFAULT_ANIMATION_CLOCK: AnimationClock = { speed: 1, paused: false, compressions: 0, attemptId: 'preview' }
