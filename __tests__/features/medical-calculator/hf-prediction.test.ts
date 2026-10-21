/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { buildMedcloudHfInput } from '@/src/core/hf-risk/medcloud-input'
import { parseHfPredictionResult } from '@/src/core/hf-risk/prediction-result'
import { requestHfPrediction } from '@/src/infrastructure/hf-risk/dry-run-client'
import { hfMedcloudFixture } from './hf-medcloud-fixture'
const input = () => buildMedcloudHfInput(hfMedcloudFixture(), { provider: 'SYNTHETIC-HOSPITAL', encounter: 'Encounter/synthetic-visit', claim: 'P1_CD_mortality_1m' }, { today: '2026-10-05', uuid: randomUUID })
function score() { return { schemaVersion: 1, verdict: 'scored', claim: 'P1_CD_mortality_1m', indexDate: input().indexDate, probability: 0.1234, tier: 'intermediate', horizonMonths: 1, computedAt: '2026-10-05T08:00:00Z', notes: ['Synthetic lab coverage warning'], model: { name: 'Synthetic HF test model', versions: [{type:'claim',value:'P1_CD_mortality_1m'}, {type:'model-sha256',value:'a'.repeat(64)}, {type:'locked-package-manifest-sha256',value:'b'.repeat(64)}] } } }
it('uses a separate prediction route, forces dryRun=false and never sends a model token', async () => {
  const fetchFn = jest.fn(async () => new Response(JSON.stringify(score()), {status:200}))
  const result = await requestHfPrediction(input(), { origin:'https://hf.test', authPolicy:'intranet', token:'DO-NOT-SEND', signal:new AbortController().signal, fetch:fetchFn })
  const [url, options] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
  expect(new URL(url).pathname).toBe('/hf/v1/predict')
  expect(new URL(url).searchParams.get('dryRun')).toBe('false')
  expect(options).toMatchObject({redirect:'error', credentials:'omit', cache:'no-store'})
  expect(JSON.stringify(options.headers)).not.toContain('DO-NOT-SEND')
  expect(result).toMatchObject({verdict:'scored', probability:0.1234})
})
it.each([{probability:1.01}, {probability:-1}, {claim:'P1_CD_mortality_3m'}, {indexDate:'2020-01-01'}, {horizonMonths:3}, {tier:'unknown'}, {computedAt:'invalid'}, {notes:['x'.repeat(1001)]}, {identifier:'PRIVATE'}, {model:{name:'Unknown',versions:[]}}])('discards malformed or mismatched results %j', change => {
  expect(() => parseHfPredictionResult(200,{...score(),...change},input())).toThrow('invalid-prediction-response')
})
it('rejects a raw FHIR Bundle instead of interpreting an unchecked probability', () => {
  expect(() => parseHfPredictionResult(200,{resourceType:'Bundle',entry:[{resource:{probabilityDecimal:0.01}}]},input())).toThrow()
})
it('preserves refusal and never returns an invented probability', () => {
  const value={schemaVersion:1,verdict:'refused',claim:input().claim,indexDate:input().indexDate,issues:[{severity:'error',code:'required',text:'Synthetic missing creatinine'}]}
  expect(parseHfPredictionResult(422,value,input())).toEqual(value)
  expect(parseHfPredictionResult(422,value,input())).not.toHaveProperty('probability')
  expect(() => parseHfPredictionResult(200,value,input())).toThrow()
  expect(() => parseHfPredictionResult(422,{...value,issues:[{severity:'information',code:'informational',text:'Accepted'}]},input())).toThrow()
})
it('distinguishes an observed group rate and rejects inconsistent intervals', () => {
  const observedIncidence={rate:0.1,ciLow:0.08,ciHigh:0.12,tierShare:0.3,patients:120,basis:'Synthetic calibration cohort'}
  expect(parseHfPredictionResult(200,{...score(),observedIncidence},input())).toHaveProperty('observedIncidence.rate',0.1)
  expect(() => parseHfPredictionResult(200,{...score(),observedIncidence:{...observedIncidence,ciLow:0.2}},input())).toThrow()
})

it('preserves the observed two-member 3-month model hashes without accepting them for 1 month', () => {
  const prepared={...input(),claim:'P1_CD_mortality_3m' as const}
  const value={...score(),claim:prepared.claim,horizonMonths:3,model:{name:'Synthetic ensemble',versions:[{type:'claim',value:prepared.claim},{type:'locked-package-manifest-sha256',value:'c'.repeat(64)},{type:'model-sha256',value:'m1:'+ 'a'.repeat(64)+';m2:'+'b'.repeat(64)}]}}
  expect(parseHfPredictionResult(200,value,prepared)).toHaveProperty('verdict','scored')
  const wrong={...value,claim:input().claim,horizonMonths:1,model:{...value.model,versions:value.model.versions.map(v=>v.type==='claim'?{...v,value:input().claim}:v)}}
  expect(() => parseHfPredictionResult(200,wrong,input())).toThrow()
})

it.each([['invalid','invalid-prediction-response'],['transient','gateway-unavailable']])('distinguishes service parser failure %s from transport outage', async (code,message) => {
  const fetchFn=jest.fn(async () => new Response(JSON.stringify({resourceType:'OperationOutcome',issue:[{severity:'error',code}]}),{status:502}))
  await expect(requestHfPrediction(input(),{origin:'https://hf.test',authPolicy:'intranet',signal:new AbortController().signal,fetch:fetchFn})).rejects.toThrow(message)
})

it('accepts the maximum service DTO bounds and rejects count/length overflow', () => {
  const observedIncidence = { rate:0.1, ciLow:0.08, ciHigh:0.12, tierShare:0.3, patients:120, basis:'b'.repeat(500) }
  const value = { ...score(), notes:Array.from({length:50}, () => 'n'.repeat(1000)), observedIncidence }
  expect(parseHfPredictionResult(200,value,input())).toEqual(value)
  expect(() => parseHfPredictionResult(200,{...value,notes:[...value.notes,'overflow']},input())).toThrow()
  expect(() => parseHfPredictionResult(200,{...value,observedIncidence:{...observedIncidence,basis:'b'.repeat(501)}},input())).toThrow()
  const refused = {schemaVersion:1,verdict:'refused',claim:input().claim,indexDate:input().indexDate,issues:Array.from({length:50}, () => ({severity:'error',code:'c'.repeat(80),text:'t'.repeat(500)}))}
  expect(parseHfPredictionResult(422,refused,input())).toEqual(refused)
  expect(() => parseHfPredictionResult(422,{...refused,issues:[...refused.issues,refused.issues[0]]},input())).toThrow()
})