import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function readJob(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
export async function saveJob(path, job, exclusive = false) {
  await mkdir(dirname(path), { recursive: true })
  const text = JSON.stringify(job, null, 2) + '\n'
  if (exclusive) return writeFile(path, text, { flag: 'wx', mode: 0o600 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, text, { mode: 0o600 })
  await rename(temporary, path)
}
/** Never repeat a paid submission when its outcome is unknown. */
export async function getOrStartJob({ path, model, variant, resumeId, submit }) {
  const existing = await readJob(path)
  if (existing && (existing.model !== model || existing.variant !== variant)) throw new Error('Журнал относится к другой модели или варианту.')
  if (existing?.requestId && resumeId && String(existing.requestId) !== String(resumeId)) throw new Error('ID отличается от сохранённого. Новый запрос не отправлен.')
  if (existing?.requestId) return existing
  if (resumeId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(resumeId))) throw new Error('Некорректный ID запроса.')
    const job = { ...existing, model, variant, requestId: String(resumeId), status: 'accepted', resumedAt: new Date().toISOString() }
    await saveJob(path, job, !existing)
    return job
  }
  if (existing) throw new Error('Запрос уже отправлялся, но ID неизвестен. Укажите --resume ID из GenAPI. Повторная платная генерация заблокирована.')
  const job = { model, variant, status: 'submitting', createdAt: new Date().toISOString() }
  // Reserve the variant before POST: a concurrent process cannot charge twice.
  await saveJob(path, job, true)
  const result = await submit()
  const id = result.request_id ?? result.id
  if (id === undefined || id === null) throw new Error('GenAPI не вернул ID. Проверьте историю; не повторяйте платный запрос.')
  job.requestId = String(id); job.status = 'accepted'
  await saveJob(path, job)
  return job
}
/** Only idempotent GET requests are retried; POST is always sent at most once. */
export async function requestJson(url, options, description, { fetchFn = fetch, sleep = delay, timeout = 30_000 } = {}) {
  const attempts = (options.method ?? 'GET').toUpperCase() === 'GET' ? 4 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchFn(url, { ...options, signal: AbortSignal.timeout(timeout) })
      if (!response.ok) {
        const error = new Error(`${description}: HTTP ${response.status}.`)
        error.retryable = response.status === 429 || response.status >= 500
        throw error
      }
      return await response.json()
    } catch (error) {
      if (attempt + 1 === attempts || error.retryable === false) throw error
      await sleep(1000 * 2 ** attempt)
    }
  }
}
