import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BED_BONES, validatePatientRig } from '../src/patientAnimation.ts'
import { glbInventory, readGlb } from './lib/glb.mjs'

const args = process.argv.slice(2)
const option = (flag, fallback) => { const i=args.indexOf(flag); return i===-1 ? fallback : args[i+1] }
const patientPath = option('--patient', 'public/models/patient-rigged.glb')
const animationsPath = option('--animations', 'public/models/patient-anims.glb')
const bedPath = option('--bed', 'public/models/bed-articulated.glb')
const report = { ok: false, files: [], errors: [], warnings: [], bytes: 0 }
async function read(path, optional = false) {
  try {
    const bytes = await readFile(resolve(path)); report.bytes += bytes.length; report.files.push(path)
    return readGlb(bytes)
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null
    report.errors.push(`${path}: ${error.message}`); return null
  }
}
const patient = await read(patientPath), animations = await read(animationsPath,true), bed = await read(bedPath)
if (patient) {
  const inventory = glbInventory(patient)
  inventory.clips = [...new Set([...inventory.clips, ...(animations ? glbInventory(animations).clips : [])])]
  const validated = validatePatientRig(inventory)
  report.errors.push(...validated.errors); report.warnings.push(...validated.warnings)
  const triangles = (patient.meshes ?? []).flatMap(m => m.primitives).reduce((sum,p) => sum + ((p.mode ?? 4) === 4 ? patient.accessors[p.indices ?? p.attributes.POSITION].count / 3 : 0),0)
  if (triangles > 50000) report.errors.push(`Пациентка: ${triangles} треугольников; лимит 50000.`)
  for (const image of patient.images ?? []) if (image.uri && !image.uri.startsWith('data:')) report.errors.push('Текстуры пациентки должны быть встроены в GLB.')
}
if (bed) for (const name of BED_BONES) if (!glbInventory(bed).bones.includes(name)) report.errors.push(`Кушетка: отсутствует кость ${name}.`)
if (report.bytes > 30 * 1024 * 1024) report.errors.push('Суммарный размер превышает 30 МБ.')
report.warnings.push('Контакт таза/стоп, деформации, разрешение текстур и права на ассеты требуют визуальной и авторской проверки.')
report.ok = report.errors.length === 0
console.log(JSON.stringify(report,null,2)); if (!report.ok) process.exitCode=1
