import { access, link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = process.env.GEN_API_ENV_FILE
  ? resolve(process.env.GEN_API_ENV_FILE)
  : resolve(projectRoot, '.env.local')
const outputPath = resolve(projectRoot, 'public/models/hospital-room-generated.glb')
const modelId = 'tripo-3d'
const requestTimeout = 30_000
const pollInterval = 5_000
const maxPolls = 72
const maxModelBytes = 100 * 1024 * 1024
const prompt = 'Create a high-quality, realistic PBR 3D model of a modern single-patient hospital room for a nursing-care training simulator. Build a clean architectural cutaway interior: floor, back wall and two side walls, with the entire front open and no ceiling so the room is clearly visible from a three-quarter view. Include one correctly proportioned adult hospital bed centered in the room, with mattress, white linens, adjustable side rails and a headboard; a bedside cabinet; an IV pole; a detailed wall-mounted medical headwall with gas outlets, sockets and examination light; a visitor chair; handwashing sink with dispenser; and a red clinical waste bin. Add a large realistic framed window on the left wall. The window opening must remain genuinely open and transparent with no opaque mesh or exterior scenery blocking it, so the simulator can render a live time-of-day view through it. Keep the bed and floor area unobstructed for a separate patient model and interactive overlays. Realistic hospital materials, clean subtle colors, accurate furniture scale, detailed but uncluttered clinical interior, coherent geometry, stable floor contact, game-ready GLB. No patient, no people, no text, no logos, no watermark, no duplicate beds, no floating objects, no ceiling, no closed front wall.'

function readApiKey(contents) {
  const entry = contents.split(/\r?\n/).find((line) => line.trim().startsWith('GEN_API_KEY='))
  if (!entry) throw new Error(`В ${envPath} не найден GEN_API_KEY.`)
  const value = entry.slice(entry.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
  if (!value) throw new Error(`GEN_API_KEY в ${envPath} пуст.`)
  return value
}

async function requestJson(url, options, description) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeout) })
  const body = await response.text()
  let data
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error(`${description}: API вернул не JSON (HTTP ${response.status}).`)
  }
  if (!response.ok) {
    const detail = {
      status: response.status,
      error: data.error,
      detail: data.detail,
      message: data.message,
      errors: data.errors,
    }
    const renderedDetail = JSON.stringify(detail, (_, value) => value === undefined ? undefined : value)
    throw new Error(`${description}: ${renderedDetail ?? `HTTP ${response.status}`}`)
  }
  return data
}

function isGlb(bytes) {
  return bytes.length >= 20
    && bytes.toString('ascii', 0, 4) === 'glTF'
    && bytes.readUInt32LE(4) === 2
    && bytes.readUInt32LE(8) <= bytes.length
}

async function downloadGlb(url) {
  const resultUrl = new URL(url)
  if (resultUrl.protocol !== 'https:' || resultUrl.username || resultUrl.password) {
    throw new Error('API вернул небезопасную ссылку результата.')
  }

  const response = await fetch(resultUrl, { signal: AbortSignal.timeout(requestTimeout) })
  if (!response.ok) throw new Error(`Не удалось скачать модель (HTTP ${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxModelBytes) throw new Error('Размер модели превышает допустимые 100 МБ.')
  if (!isGlb(bytes)) throw new Error('Результат не является GLB v2. Исходная палата не изменена.')
  return bytes
}

async function main() {
  try {
    await access(outputPath)
    throw new Error('Файл новой палаты уже существует; откажусь перезаписывать результат.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  let envContents
  try {
    envContents = await readFile(envPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Укажите ключ в nurse-care-sim/.env.local или задайте GEN_API_ENV_FILE.')
    }
    throw error
  }
  const apiKey = readApiKey(envContents)
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  console.log('Отправляю один запрос в GenAPI / Tripo3D H3.1...')
  const submitted = await requestJson(
    `https://api.gen-api.ru/api/v1/networks/${modelId}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        callback_url: null,
        prompt,
        texture: true,
        pbr: true,
        texture_quality: 'detailed',
        geometry_quality: 'detailed',
      }),
    },
    'Не удалось создать запрос генерации палаты',
  )
  const requestId = submitted.request_id ?? submitted.id
  if (requestId === undefined || requestId === null) {
    throw new Error('GenAPI не вернул идентификатор запроса.')
  }

  console.log('Запрос принят. Ожидаю завершения генерации...')
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await delay(pollInterval)
    const result = await requestJson(
      `https://api.gen-api.ru/api/v1/request/get/${encodeURIComponent(requestId)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } },
      'Не удалось получить статус генерации',
    )
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
    } finally {
      await unlink(temporaryPath).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    console.log(`GLB v2 сохранён в public/models/hospital-room-generated.glb (${(modelBytes.length / 1024 / 1024).toFixed(1)} МБ).`)
    return
  }

  throw new Error('Генерация не завершилась за 6 минут. Проверьте статус запроса в GenAPI.')
}

main().catch((error) => {
  console.error(`Ошибка генерации палаты: ${error.message}`)
  process.exitCode = 1
})
