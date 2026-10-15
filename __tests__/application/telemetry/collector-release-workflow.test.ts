/** @jest-environment node */
import { readFileSync } from 'node:fs'
const read = (file: string) => readFileSync('.github/workflows/' + file, 'utf8').replace(/\r\n/g, '\n')
test('formal APP CI and manual/automatic mirror publishing share the compatibility gate', () => {
  const ci = read('ci.yml'), sync = read('sync-mediprisma-app.yml'), gate = read('collector-compatibility.yml')
  expect(ci).toContain('uses: ./.github/workflows/collector-compatibility.yml')
  expect(ci).toContain("github.ref == 'refs/heads/master' || github.base_ref == 'master'")
  expect(sync).toMatch(/\n  sync:\n    needs: collector-compatibility\n/)
  expect(sync).toContain('uses: ./.github/workflows/collector-compatibility.yml')
  expect(gate).toContain('repository: MediPrisma/tvgh-mediprisma-gateway')
  expect(gate).toContain("--testMatch '**/e2e/collector-contract.integration.test.ts'")
  expect(gate).toContain('COLLECTOR_GATEWAY_CHECKOUT:')
  expect(gate).toContain('token: ${{ secrets.COLLECTOR_GATEWAY_READ_TOKEN }}')
  expect(gate).not.toContain('secrets: inherit')
  expect(gate).not.toContain('MEDIPRISMA_SITE_DEPLOY_KEY')
  expect(gate).not.toContain('contents: write')
  expect(gate).not.toContain('pull_request_target')
})
