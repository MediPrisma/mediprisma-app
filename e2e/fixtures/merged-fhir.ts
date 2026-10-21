/** Fictional cloud + in-house export; never contains patient or hospital data. */
export type RawResource = { resourceType: string; id: string; [key: string]: unknown }
export type RawBundle = {
  resourceType: 'Bundle'
  type: 'collection'
  entry: Array<{ fullUrl: string; resource: RawResource }>
  extension: Array<{ url: string; valueString: string }>
}
export type SourceImage = {
  source: 'cloud' | 'hospital'
  reportTitle: string
  title: string
  contentType: string
  data: string
  width: number
  height: number
}

export function createMergedFhirFixture(date = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(date))) throw new Error('Merged FHIR fixture requires a valid ISO timestamp')
  const bundle: RawBundle = {
    resourceType: 'Bundle', type: 'collection', entry: [],
    extension: [{ url: 'urn:example:merged-export', valueString: '雲端＋院內原始資料，保留所有來源' }],
  }
  const add = (resource: RawResource) => bundle.entry.push({
    fullUrl: `urn:uuid:${resource.id}`, resource,
  })
  add({ resourceType: 'Patient', id: 'merged-patient',
    name: [{ text: '整併測試病人' }], gender: 'female', birthDate: '1970-01-01' })
  const subject = { reference: 'urn:uuid:merged-patient' }
  const images: SourceImage[] = []
  for (const source of ['cloud', 'hospital'] as const) {
    const meta = {
      source: source === 'cloud' ? 'https://medcloud2.nhi.gov.tw/example' : 'https://hospital.example.test/ehr',
      tag: [{ system: 'urn:wildcatch:source', code: source === 'cloud' ? 'medcloud' : 'vghtpe-outpatient-supplement' }],
    }
    const local = (resource: RawResource) => add({ ...resource, meta,
      extension: [{ url: `urn:example:${source}:unrecognized`, valueString: `${source} 原始欄位不能遺漏` }],
    })
    local({ resourceType: 'Organization', id: `${source}-organization`, name: '臺北榮總' })
    local({ resourceType: 'Encounter', id: `${source}-encounter`, status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' }, subject,
      period: { start: date }, serviceProvider: { reference: `urn:uuid:${source}-organization` } })
    const encounter = { reference: `urn:uuid:${source}-encounter` }
    local({ resourceType: 'Condition', id: `${source}-condition`, subject, encounter,
      code: { text: `${source} 原始診斷` },
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] } })
    // Matching clinical values remain separate source records in the raw file.
    local({ resourceType: 'Observation', id: `${source}-observation`, status: 'final', subject, encounter,
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { text: 'Merged source glucose', coding: [{ system: 'http://loinc.org', code: '2345-7' }] },
      effectiveDateTime: date, valueQuantity: { value: 123.45, unit: 'mg/dL' },
      identifier: [{ system: `urn:example:${source}`, value: `${source}-original-lab` }] })
    local({ resourceType: 'MedicationRequest', id: `${source}-medication`, status: 'active', intent: 'order',
      subject, encounter, authoredOn: date, medicationCodeableConcept: { text: `${source} 原始處方` },
      dosageInstruction: [{ text: `${source} 劑量與備註原文` }] })
    local({ resourceType: 'DocumentReference', id: `${source}-document`, status: 'current', subject,
      description: `${source} 原始文件`, content: [{ attachment: {
        contentType: 'text/plain', title: 'same-filename.txt',
        data: Buffer.from(`${source} 文件原文\r\n不可省略`).toString('base64'),
      } }] })
    // Together the two unknown Binary resources cross the encrypted chunk boundary.
    local({ resourceType: 'Binary', id: `${source}-binary`, contentType: 'application/octet-stream',
      data: Buffer.alloc(2 * 1024 * 1024 + (source === 'cloud' ? 129 : 257), source === 'cloud' ? 0x41 : 0x42).toString('base64') })
    const reportTitle = source === 'cloud' ? 'Cloud source imaging' : 'Hospital source imaging'
    const sourceImages: SourceImage[] = source === 'cloud' ? [{
      source, reportTitle, title: 'same-filename.png', contentType: 'image/png', width: 1, height: 1,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    }] : []
    for (let index = 0; index < (source === 'cloud' ? 1 : 2); index++) {
      const width = source === 'cloud' ? 3 : 5 + index
      const height = source === 'cloud' ? 2 : 4 + index
      const color = source === 'cloud' ? '#ff0000' : index === 0 ? '#0000ff' : '#008000'
      sourceImages.push({ source, reportTitle, title: index === 0 ? 'same-filename.svg' : 'second-image.svg',
        contentType: 'image/svg+xml', width, height,
        data: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`).toString('base64') })
    }
    if (source === 'hospital') {
      // A real 5x4 blue JPEG, generated once; no image library is needed at test time.
      sourceImages[0] = { source, reportTitle, title: 'same-filename.png',
        contentType: 'image/jpeg', width: 5, height: 4,
        data: '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAUDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCewFIh3//Z' }
    }
    images.push(...sourceImages)
    local({ resourceType: 'DiagnosticReport', id: `${source}-report`, status: 'final', subject, encounter,
      code: { text: reportTitle }, effectiveDateTime: date,
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }],
      result: [{ reference: `urn:uuid:${source}-observation` }],
      conclusion: `${source} 原始影像報告文字`,
      presentedForm: sourceImages.map(({ contentType, title, data }) => ({ contentType, title, data })),
    })
  }
  add({ resourceType: 'Provenance', id: 'merge-provenance', recorded: date,
    target: ['cloud-report', 'hospital-report'].map(id => ({ reference: `urn:uuid:${id}` })),
    agent: [{ who: { display: 'Synthetic merge fixture' } }],
    entity: ['cloud', 'hospital'].map(source => ({ role: 'source', what: { identifier: { system: 'urn:example:source', value: source } } })),
  })
  // The merged resource's metadata must also survive unchanged.
  add({ resourceType: 'Observation', id: 'merged-observation', status: 'final', subject,
    meta: { source: 'https://medcloud2.nhi.gov.tw/example', tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] },
    extension: [{ url: 'urn:wildcatch:dedup-method', valueString: 'synthetic-cloud-and-hospital' }],
    code: { text: 'Merged provenance observation' }, valueString: '兩個來源整併後保留的內容',
  })
  // Include BOM, CRLF, indentation and a number lexeme a parse/stringify would alter.
  const original = Buffer.from('\uFEFF' + JSON.stringify(bundle, null, 2)
    .replaceAll('123.45', '123.4500').replaceAll('\n', '\r\n') + '\r\n')
  return { bundle, original, images }
}
