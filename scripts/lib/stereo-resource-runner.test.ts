import { describe, expect, it } from 'vitest'
import { runStereoResourceChild } from './stereo-resource-runner.ts'

const bun = process.execPath
const worker = (source: string) => [bun, '-e', source] as const
const bounded = { timeoutMs: 2_000, maxRssBytes: 512 * 1024 * 1024 }

describe('stereo child resource runner', () => {
  it('runs an argument vector without a shell and samples child RSS', async () => {
    const result = await runStereoResourceChild({ ...bounded, command: worker('process.stdout.write("ready")') }, async () => 2048)
    expect(result.status).toBe('completed')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('ready')
    expect(result.sampledPeakRssBytes).toBe(2048)
    expect(result.wallTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('reports whether the platform sampler could measure a short-lived child', async () => {
    const result = await runStereoResourceChild({ ...bounded, command: worker('await new Promise(resolve => setTimeout(resolve, 80))') })
    expect(['completed', 'measurement-unavailable']).toContain(result.status)
    if (result.status === 'completed') expect(result.sampledPeakRssBytes).toBeGreaterThan(0)
    else expect(result.sampledPeakRssBytes).toBeNull()
  })

  it('kills a child when the timeout expires', async () => {
    const result = await runStereoResourceChild({
      command: worker('setInterval(() => {}, 1000)'),
      timeoutMs: 75,
      maxRssBytes: bounded.maxRssBytes,
    })
    expect(result.status).toBe('timeout')
    expect(result.exitCode).toBeNull()
    expect(result.wallTimeMs).toBeLessThan(2_000)
  })

  it('kills a child when an injected RSS sample exceeds the cap', async () => {
    const result = await runStereoResourceChild({
      command: worker('setInterval(() => {}, 1000)'),
      timeoutMs: 2_000,
      maxRssBytes: 64,
    }, async () => 65)
    expect(result.status).toBe('rss-limit')
    expect(result.sampledPeakRssBytes).toBe(65)
  })

  it('reports unavailable measurement when a successful child has no RSS sample', async () => {
    const result = await runStereoResourceChild({ ...bounded, command: worker('process.stdout.write("ok")') }, async () => null)
    expect(result.status).toBe('measurement-unavailable')
    expect(result.exitCode).toBe(0)
    expect(result.sampledPeakRssBytes).toBeNull()
  })

  it('aborts an in-flight RSS monitor when the child closes', async () => {
    let aborted = false
    const result = await runStereoResourceChild({ ...bounded, command: worker('await new Promise(resolve => setTimeout(resolve, 50))') }, async (_pid, signal) => new Promise(resolve => {
      signal?.addEventListener('abort', () => { aborted = true; resolve(null) }, { once: true })
    }))
    expect(result.status).toBe('measurement-unavailable')
    expect(aborted).toBe(true)
  })

  it('bounds retained output and reports output-limit separately', async () => {
    const result = await runStereoResourceChild({
      command: worker('process.stdout.write("x".repeat(4096)); setInterval(() => {}, 1000)'),
      timeoutMs: 2_000,
      maxRssBytes: bounded.maxRssBytes,
      maxOutputBytes: 32,
    })
    expect(result.status).toBe('output-limit')
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(32)
  })

  it('reports unsuccessful child exit as failed', async () => {
    const result = await runStereoResourceChild({ ...bounded, command: worker('process.stderr.write("broken"); process.exitCode = 3') })
    expect(result.status).toBe('failed')
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toBe('broken')
  })
})
