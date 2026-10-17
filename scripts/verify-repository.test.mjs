import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { inspectRepositoryFiles } from './verify-repository.mjs'

async function fixture(t, documents) {
  const root = await mkdtemp(join(tmpdir(), 'cha-repository-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [file, contents] of Object.entries(documents)) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), contents)
  }
  return { root, files: Object.keys(documents) }
}

test('allows public relative/image targets, external links and fenced command examples', async t => {
  const { root, files } = await fixture(t, {
    'README.md': '[Guide](docs/guide.md#scope) ![Plan](docs/plan.png) [Web](https://example.com)\n```sh\n[example](missing.json)\n```\n`[inline](missing.json)`',
    'docs/guide.md': '[Back](../README.md)\n[Encoded space](a%20b.md)',
    'docs/a b.md': 'An authored example.', 'docs/plan.png': Buffer.from([137, 80, 78, 71]),
    '.env.example': 'PORT=4173',
  })
  assert.deepEqual(await inspectRepositoryFiles(root, files), [])
})

test('rejects missing, escaped and ignored private link targets without exposing their values', async t => {
  const { root, files } = await fixture(t, { 'docs/guide.md': '[Missing](absent.md)\n[Escape](../../elsewhere.md)\n[Private](../local-captures/held.json)' })
  const findings = await inspectRepositoryFiles(root, files)
  assert.deepEqual(findings.map(finding => finding.rule), ['missing-local-link', 'outside-repository-link', 'missing-local-link'])
  assert.deepEqual(findings.map(finding => finding.line), [1, 2, 3])
})

test('rejects accidentally included credentials and recorded scans with redacted diagnostics', async t => {
  const secret = ['ghp', 'x'.repeat(36)].join('_')
  const { root, files } = await fixture(t, {
    '.env': `TOKEN=${secret}`,
    'local-captures/held.json': JSON.stringify({ format: 'cha-echo-scan-v3', mode: 'recorded', recordings: [] }),
    'certs/server.pem': ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
  })
  const findings = await inspectRepositoryFiles(root, files)
  assert(findings.some(finding => finding.rule === 'github-token'))
  assert(findings.some(finding => finding.rule === 'private-key'))
  assert(findings.some(finding => finding.rule === 'recorded-scan'))
  assert.equal(findings.filter(finding => finding.rule === 'private-artifact').length, 3)
  assert.equal(JSON.stringify(findings).includes(secret), false)
})

test('detects machine-specific paths and private endpoints while allowing documented placeholders', async t => {
  const homePath = ['', 'Users', 'someone', 'capture.json'].join('/')
  const privateHost = ['scanner', 'private-network', 'ts', 'net'].join('.')
  const { root, files } = await fixture(t, { 'report.md': `${homePath}\nhttps://${privateHost}\nhttps://your-device.your-tailnet.ts.net\nhttps://scanner.example.ts.net` })
  assert.deepEqual((await inspectRepositoryFiles(root, files)).map(finding => finding.rule), ['local-home-path', 'private-tailnet-host'])
})
