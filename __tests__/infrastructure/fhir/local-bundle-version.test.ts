import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { readLocalBundleVersion, rememberLocalBundleVersion } from '@/src/infrastructure/fhir/services/local-bundle-version'
const system='https://cloud-wildcatch.invalid/fhir/CodeSystem/extension-version'
const bundle=(code?:string)=>({resourceType:'Bundle',type:'collection',entry:[],...(code?{meta:{tag:[{system,code}]}}:{})})
afterEach(async()=>{await LocalBundleService.clear()})
test('accepted imports replace version and clear removes it',async()=>{
 await LocalBundleService.save(bundle('0.15.17'))
 expect(readLocalBundleVersion()).toBe('0.15.17')
 await LocalBundleService.save(bundle())
 expect(readLocalBundleVersion()).toBeUndefined()
 await LocalBundleService.save(bundle('0.15.18.1'))
 expect(readLocalBundleVersion()).toBe('0.15.18.1')
 await LocalBundleService.clear()
 expect(readLocalBundleVersion()).toBeUndefined()
})
test.each(['patient text','1.2','<script>','1'.repeat(100)])('invalid source value %s is omitted',code=>{
 rememberLocalBundleVersion(bundle(code));expect(readLocalBundleVersion()).toBeUndefined()
})
test('ambiguous version tags are omitted',()=>{
 rememberLocalBundleVersion({meta:{tag:[{system,code:'1.2.3'},{system,code:'1.2.4'}]}})
 expect(readLocalBundleVersion()).toBeUndefined()
})
