/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workflow = readFileSync(join(process.cwd(), '.github/workflows/sync-mediprisma-app.yml'), 'utf8')
const variable = 'NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL'

describe('/app institution lab-report release configuration', () => {
  it('passes the public GitHub variable to the /app static-export build', () => {
    const buildStep = workflow.match(
      /^      - name: Build static export for \/app[^\r\n]*\r?\n([\s\S]*?)(?=^      - name:|$(?![\s\S]))/m,
    )?.[1]

    expect(buildStep).toBeDefined()
    expect(buildStep).toMatch(/^        run: npm run build:mediprisma\r?$/m)
    expect(buildStep).toMatch(/^        env:\r?$/m)
    expect(buildStep).toMatch(
      /^          NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL: \$\{\{ vars\.NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL \}\}\r?$/m,
    )
  })

  it('has one direct variable binding, without a default endpoint or secret', () => {
    const bindings = workflow.split(/\r?\n/).filter((line) =>
      new RegExp(`^\\s*${variable}:`).test(line),
    )

    expect(bindings).toEqual([
      '          NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL: ${{ vars.NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL }}',
    ])
    expect(bindings[0]).not.toContain('||')
    expect(bindings[0]).not.toContain('secrets.')
    expect(bindings[0]).not.toMatch(/https?:\/\//)
  })

  it('keeps the institution report URL separate from usage telemetry and AI configuration', () => {
    expect(workflow).toMatch(/^          NEXT_PUBLIC_COLLECTOR_ORIGIN: \$\{\{ vars\.NEXT_PUBLIC_COLLECTOR_ORIGIN \}\}\r?$/m)
    expect(workflow).toMatch(/^          NEXT_PUBLIC_CHAT_URL: \$\{\{ secrets\.NEXT_PUBLIC_CHAT_URL \}\}\r?$/m)
    expect(workflow).toMatch(/^          NEXT_PUBLIC_GEMINI_URL: \$\{\{ secrets\.NEXT_PUBLIC_GEMINI_URL \}\}\r?$/m)
  })
})
