import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getOrStartJob, readJob, saveJob, requestJson } from '../scripts/lib/genapi-job.mjs'

async function temporaryJob(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'careflow-generation-test-'))
  try { await run(path.join(directory, 'job.json')) } finally { await fs.rm(directory, {recursive: true, force: true}) }
}
test('accepted generation ID is saved and subsequent runs do not submit again', () => temporaryJob(async file => {
  let submissions = 0
  const options = { path:file, model:'tripo-3d', variant:'1', submit:async()=>{submissions++;return {request_id:12345}} }
  await getOrStartJob(options)
  assert.equal((await readJob(file)).requestId,'12345')
  const resumed=await getOrStartJob(options)
  assert.equal(resumed.requestId,'12345');assert.equal(submissions,1)
}))
test('uncertain submission blocks another paid request until an ID is recovered', () => temporaryJob(async file => {
  let submissions=0
  const options={path:file,model:'tripo-3d',variant:'1',submit:async()=>{submissions++;throw new Error('connection lost')}}
  await assert.rejects(getOrStartJob(options),/connection lost/)
  await assert.rejects(getOrStartJob(options),/Повторная платная генерация заблокирована/)
  const resumed=await getOrStartJob({...options,resumeId:'recovered-id'})
  assert.equal(resumed.requestId,'recovered-id');assert.equal(submissions,1)
}))
test('resume of a known ID is read-only even without a journal', () => temporaryJob(async file => {
  const job=await getOrStartJob({path:file,model:'tripo-3d',variant:'1',resumeId:'known-id',submit:async()=>assert.fail('paid submission must not run')})
  assert.equal(job.requestId,'known-id')
}))
test('journal reservation prevents concurrent duplicate submissions', () => temporaryJob(async file => {
  let count=0
  const options={path:file,model:'tripo-3d',variant:'1',submit:async()=>{count++;return {id:77}}}
  await Promise.allSettled([getOrStartJob(options),getOrStartJob(options)])
  assert.equal(count,1);assert.equal((await readJob(file)).requestId,'77')
}))
test('a journal cannot be silently replaced with another task', () => temporaryJob(async file => {
  await saveJob(file,{model:'tripo-3d',variant:'1',requestId:'first'})
  await assert.rejects(getOrStartJob({path:file,model:'tripo-3d',variant:'1',resumeId:'second'}),/ID отличается/)
  assert.equal((await readJob(file)).requestId,'first')
}))
test('transient GET failures retry without creating a new generation', async () => {
  let requests=0
  const result=await requestJson('https://example.test/status',{method:'GET'},'status',{
    fetchFn:async()=>{requests++;if(requests<3)throw new Error('network');return {ok:true,json:async()=>({status:'success'})}},sleep:async()=>{},
  })
  assert.equal(result.status,'success');assert.equal(requests,3)
})
test('a paid POST is never retried on an uncertain network error', async () => {
  let requests=0
  await assert.rejects(requestJson('https://example.test/generate',{method:'POST'},'generate',{
    fetchFn:async()=>{requests++;throw new Error('network')},sleep:async()=>{},
  }),/network/)
  assert.equal(requests,1)
})
test('non-retryable authorization failure does not loop', async () => {
  let requests=0
  await assert.rejects(requestJson('https://example.test/status',{},'status',{
    fetchFn:async()=>{requests++;return {ok:false,status:401}},sleep:async()=>{},
  }),/HTTP 401/)
  assert.equal(requests,1)
})
