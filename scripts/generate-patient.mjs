import { access, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { readGlb } from './lib/glb.mjs'
import { getOrStartJob, requestJson, saveJob } from './lib/genapi-job.mjs'
import { parseArgs } from 'node:util'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = process.env.GEN_API_ENV_FILE
  ? resolve(process.env.GEN_API_ENV_FILE)
  : resolve(projectRoot, '.env.local')
let args
try {
  args = parseArgs({ options: { variant: { type: 'string', default: '1' }, 'dry-run': { type: 'boolean' }, resume: { type: 'string' }, help: { type: 'boolean' } } }).values
} catch { console.error('Неизвестный аргумент. Используйте --help; запрос не отправлен.'); process.exit(1) }
const variant = args.variant
const journalPath = resolve(projectRoot, `exports/generation-jobs/patient-a-pose-${variant}.json`)
const outputPath = resolve(projectRoot, `public/models/patient-a-pose-${variant}.glb`)
const supportedModelId = 'tripo-3d'
const requestTimeout = 30_000
const pollInterval = 5_000
const maxPolls = 72
const maxModelBytes = 100 * 1024 * 1024
const prompt = 'A single fictional 68-year-old adult woman, full body, standing in a neutral A-pose with arms about 35 degrees away from the torso, palms inward, feet flat and shoulder-width apart. Eyes open, mouth closed, relaxed neutral face. Plain opaque light-blue short-sleeved hospital gown with trousers, hair tied back in a low ponytail, no accessories. Realistic proportions, clearly separated limbs, visible gaps between arms and torso and between legs, clean topology for humanoid rigging, PBR materials, matte skin, low-to-medium-poly game character. Pivot between feet on the floor, meters, front view, isolated neutral gray background.'
const payload = {
  prompt,
  negative_prompt: 'lying pose, sitting pose, crossed arms, fused limbs, long loose hair, jewelry, blanket, bed, pillow, props, room, text, logos, extreme muscles, cartoon, extra limbs, cropped body',
  texture: true, pbr: true, texture_quality: 'detailed', geometry_quality: 'detailed', face_limit: 50000,
}


function readApiKey(contents, path) {
  const entry = contents.split(/\r?\n/).find((line) => line.trim().startsWith('GEN_API_KEY='))
  if (!entry) throw new Error(`В ${path} не найден GEN_API_KEY.`)
  const value = entry.slice(entry.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
  if (!value) throw new Error(`GEN_API_KEY в ${path} пуст.`)
  return value
}

function readModelId(contents) {
  const entry = contents.split(/\r?\n/).find((line) => line.trim().startsWith('GEN_API_MODEL='))
  const modelId = entry?.slice(entry.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2') || supportedModelId
  if (modelId !== supportedModelId) {
    throw new Error(`Для генерации пациентки укажите GEN_API_MODEL=${supportedModelId}. Meshy Rigging требует готовую GLB-модель.`)
  }
  return modelId
}

function isGlb(bytes) { try { readGlb(bytes); return true } catch { return false } }

async function downloadGlb(url) {
  const resultUrl = new URL(url)
  if (resultUrl.protocol !== 'https:' || resultUrl.username || resultUrl.password) {
    throw new Error('API вернул небезопасную ссылку результата.')
  }

  const response = await fetch(resultUrl, { signal: AbortSignal.timeout(requestTimeout) })
  if (!response.ok) throw new Error(`Не удалось скачать модель (HTTP ${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxModelBytes) throw new Error('Размер модели превышает допустимые 100 МБ.')
  if (!isGlb(bytes)) throw new Error('Результат не является GLB v2. Исходный файл не сохранён.')
  return bytes
}

async function main() {
  if (args.help) { console.log('Usage: npm run generate:patient -- [--variant 1|2|3] [--dry-run] [--resume REQUEST_ID]'); return }
  if (!['1', '2', '3'].includes(variant)) throw new Error('--variant должен быть 1, 2 или 3.')
  if (args['dry-run']) {
    console.log(JSON.stringify({ model: supportedModelId, output: outputPath, payload }, null, 2))
    return
  }
  try {
    await access(outputPath)
    throw new Error('Вариант уже существует. Выберите другой --variant; резервная модель никогда не перезаписывается.')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  let envContents
  try {
    envContents = await readFile(envPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Укажите ключ в nurse-care-sim/.env.local или задайте GEN_API_ENV_FILE с путём к существующему .env.')
    }
    throw error
  }
  const apiKey = readApiKey(envContents, envPath)
  const modelId = readModelId(envContents)
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const job = await getOrStartJob({
    path: journalPath, model: modelId, variant, resumeId: args.resume,
    submit: async () => {
      console.log('Отправляю один запрос в GenAPI / Tripo3D H3.1...')
      return requestJson(`https://api.gen-api.ru/api/v1/networks/${modelId}`,
        { method: 'POST', headers, body: JSON.stringify(payload) }, 'Не удалось создать запрос генерации')
    },
  })
  const requestId = job.requestId
  console.log(`Ожидаю результат задачи ${requestId}. ID сохранён; повторной платной отправки не будет.`)
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await delay(pollInterval)
    const result = await requestJson(
      `https://api.gen-api.ru/api/v1/request/get/${encodeURIComponent(requestId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      'Не удалось получить статус генерации',
    )
    job.status = result.status; job.progress = result.progress; job.checkedAt = new Date().toISOString()
    await saveJob(journalPath, job)
    if (result.status === 'error') {
      throw new Error(typeof result.error === 'string' ? result.error : 'GenAPI сообщил об ошибке генерации.')
    }
    if (result.status !== 'success') {
      const progress = Number.isFinite(result.progress) ? ` ${result.progress}%` : ''
      console.log(`Статус: ${result.status ?? 'в обработке'}${progress}`)
      continue
    }

    const urls = Array.isArray(result.result) ? result.result.filter((item) => typeof item === 'string') : []
    if (urls.length === 0) throw new Error('Генерация завершилась, но API не вернул ссылку на файл.')

    let modelBytes
    let lastDownloadError
    for (const url of urls) {
      try {
        modelBytes = await downloadGlb(url)
        break
      } catch (error) {
        lastDownloadError = error
      }
    }
    if (!modelBytes) throw lastDownloadError ?? new Error('Среди результатов не найден файл GLB.')

    await mkdir(dirname(outputPath), { recursive: true })
    const temporaryPath = `${outputPath}.${process.pid}.tmp`
    try {
      await writeFile(temporaryPath, modelBytes, { flag: 'wx' })
      await link(temporaryPath, outputPath)
      await rm(temporaryPath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
    job.status = 'saved'; job.output = outputPath; job.bytes = modelBytes.length; job.completedAt = new Date().toISOString()
    await saveJob(journalPath, job)
    console.log(`A-pose GLB v2 сохранён в public/models/patient-a-pose-${variant}.glb (${(modelBytes.length / 1024 / 1024).toFixed(1)} МБ).`)
    return
  }

  throw new Error(`Задача ${requestId} ещё не завершена. Повторите с --resume ${requestId}: будет только получение результата, без новой оплаты.`)
}

main().catch((error) => {
  console.error(`Ошибка генерации пациента: ${error.message}`)
  process.exitCode = 1
})
