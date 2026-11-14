import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = process.env.GEN_API_ENV_FILE
  ? resolve(process.env.GEN_API_ENV_FILE)
  : resolve(projectRoot, '.env.local')
const outputPath = resolve(projectRoot, 'public/models/patient.glb')
const supportedModelId = 'tripo-3d'
const requestTimeout = 30_000
const pollInterval = 5_000
const maxPolls = 72
const maxModelBytes = 100 * 1024 * 1024
const prompt = 'A single fictional 72-year-old adult woman for a respectful medical-care training simulation. Full-body realistic 3D character lying supine on her back in a neutral relaxed pose, head facing upward on a small pillow, arms resting naturally at her sides with hands visible, legs straight and slightly apart. Wearing a fully closed, opaque pale-blue hospital gown covering the entire body. Calm neutral expression, age-appropriate face, anatomically plausible proportions, clear separation between limbs, clean game-ready topology, PBR materials, one isolated character only. No bed, no pillow, no blanket, no room, no props, no text, no logos, no extra limbs, no cropped body. Horizontal lying pose, suitable for placement on a hospital bed in a 3D simulation.'

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
    const detail = typeof data.error === 'string' ? data.error : `HTTP ${response.status}`
    throw new Error(`${description}: ${detail}`)
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
  if (!isGlb(bytes)) throw new Error('Результат не является GLB v2. Исходный файл не сохранён.')
  return bytes
}

async function main() {
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

  console.log('Отправляю один запрос в GenAPI / Tripo3D H3.1...')
  const submitted = await requestJson(
    `https://api.gen-api.ru/api/v1/networks/${modelId}`,
    { method: 'POST', headers, body: JSON.stringify({ prompt }) },
    'Не удалось создать запрос генерации',
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
      { headers: { Authorization: `Bearer ${apiKey}` } },
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
    const temporaryPath = `${outputPath}.tmp`
    try {
      await writeFile(temporaryPath, modelBytes, { flag: 'wx' })
      await rename(temporaryPath, outputPath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
    console.log(`GLB v2 сохранён в public/models/patient.glb (${(modelBytes.length / 1024 / 1024).toFixed(1)} МБ).`)
    return
  }

  throw new Error('Генерация не завершилась за 6 минут. Проверьте статус запроса в GenAPI.')
}

main().catch((error) => {
  console.error(`Ошибка генерации пациента: ${error.message}`)
  process.exitCode = 1
})
