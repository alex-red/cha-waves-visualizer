import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

export type StereoResourceChildOptions = {
  command: readonly string[]
  cwd?: string
  timeoutMs: number
  maxRssBytes: number
  maxOutputBytes?: number
}

export type StereoResourceChildResult = {
  status: 'completed' | 'timeout' | 'rss-limit' | 'output-limit' | 'failed' | 'measurement-unavailable'
  exitCode: number | null
  wallTimeMs: number
  /** Highest RSS sample for the direct child; this is not the OS high-water mark. */
  sampledPeakRssBytes: number | null
  stdout: string
  stderr: string
}

export type StereoRssMonitor = (pid: number, signal?: AbortSignal) => Promise<number | null>

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024
const RSS_SAMPLE_INTERVAL_MS = 25
const MONITOR_OUTPUT_LIMIT_BYTES = 128
const RSS_MONITOR_TIMEOUT_MS = 250

function validateOptions(options: StereoResourceChildOptions): void {
  if (!Array.isArray(options.command) || options.command.length === 0 || options.command.some(part => typeof part !== 'string')) {
    throw new TypeError('command must be a non-empty string array')
  }
  for (const [name, value] of Object.entries({ timeoutMs: options.timeoutMs, maxRssBytes: options.maxRssBytes })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  }
  if (options.maxOutputBytes !== undefined && (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 0)) {
    throw new RangeError('maxOutputBytes must be a non-negative safe integer')
  }
}

function sampleProcessRss(pid: number, signal?: AbortSignal): Promise<number | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  return new Promise(resolve => {
    let output = ''
    let finished = false
    const monitor = spawn('ps', ['-o', 'rss=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] })
    let timeout: ReturnType<typeof setTimeout> | null = null
    const settle = (value: number | null) => {
      if (finished) return
      finished = true
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener('abort', stop)
      resolve(value)
    }
    const stop = () => {
      if (finished) return
      settle(null)
      try { monitor.kill('SIGKILL') } catch { /* The monitor may already be gone. */ }
    }
    if (signal?.aborted) {
      stop()
      return
    }
    signal?.addEventListener('abort', stop, { once: true })
    timeout = setTimeout(stop, RSS_MONITOR_TIMEOUT_MS)
    monitor.stdout.on('data', (chunk: Buffer) => {
      if (output.length < MONITOR_OUTPUT_LIMIT_BYTES) output += chunk.toString('ascii').slice(0, MONITOR_OUTPUT_LIMIT_BYTES - output.length)
    })
    monitor.once('error', () => settle(null))
    monitor.once('close', code => {
      if (code !== 0) return settle(null)
      const rssKiB = Number.parseInt(output.trim(), 10)
      settle(Number.isSafeInteger(rssKiB) && rssKiB >= 0 ? rssKiB * 1024 : null)
    })
  })
}

function killProcessGroup(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill('SIGKILL')
    else process.kill(-child.pid, 'SIGKILL')
  } catch {
    try { child.kill('SIGKILL') } catch { /* The child may already be gone. */ }
  }
}

/**
 * Run one isolated command without a shell, bounding execution time, sampled RSS,
 * and retained output. RSS is sampled from `ps` every 25 ms and is not a process
 * high-water measurement. The optional monitor argument supports deterministic
 * tests and alternate platform adapters; normal callers should omit it.
 */
export async function runStereoResourceChild(
  options: StereoResourceChildOptions,
  monitorRss: StereoRssMonitor = sampleProcessRss,
): Promise<StereoResourceChildResult> {
  validateOptions(options)
  const outputLimit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const startedAt = performance.now()
  const child = spawn(options.command[0]!, options.command.slice(1), {
    cwd: options.cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let retainedBytes = 0
  let forcedStatus: StereoResourceChildResult['status'] | null = null
  let spawnFailed = false
  let sampledPeakRssBytes: number | null = null
  let childClosed = false
  let sampling = false
  let activeMonitorController: AbortController | null = null

  const retain = (target: Buffer[], chunk: Buffer) => {
    const remaining = outputLimit - retainedBytes
    const kept = remaining <= 0 ? Buffer.alloc(0) : chunk.length <= remaining ? chunk : chunk.subarray(0, remaining)
    if (kept.length > 0) {
      target.push(Buffer.from(kept))
      retainedBytes += kept.length
    }
    if (kept.length < chunk.length && forcedStatus === null) {
      forcedStatus = 'output-limit'
      killProcessGroup(child)
    }
  }
  child.stdout.on('data', (chunk: Buffer) => retain(stdoutChunks, chunk))
  child.stderr.on('data', (chunk: Buffer) => retain(stderrChunks, chunk))
  child.once('error', () => { spawnFailed = true })
  child.once('exit', () => killProcessGroup(child))

  const sample = async () => {
    if (childClosed || !child.pid || sampling) return
    sampling = true
    const controller = new AbortController()
    activeMonitorController = controller
    let rss: number | null = null
    try { rss = await monitorRss(child.pid, controller.signal) } catch { rss = null } finally {
      if (activeMonitorController === controller) activeMonitorController = null
      sampling = false
    }
    if (childClosed || typeof rss !== 'number' || !Number.isFinite(rss) || rss < 0) return
    const normalized = Math.floor(rss)
    sampledPeakRssBytes = sampledPeakRssBytes === null ? normalized : Math.max(sampledPeakRssBytes, normalized)
    if (normalized > options.maxRssBytes && forcedStatus === null) {
      forcedStatus = 'rss-limit'
      killProcessGroup(child)
    }
  }
  void sample()
  const sampleTimer = setInterval(() => { void sample() }, RSS_SAMPLE_INTERVAL_MS)
  const timeoutTimer = setTimeout(() => {
    if (childClosed || forcedStatus !== null) return
    forcedStatus = 'timeout'
    killProcessGroup(child)
  }, options.timeoutMs)

  const exitCode = await new Promise<number | null>(resolve => {
    child.once('close', code => {
      childClosed = true
      activeMonitorController?.abort()
      resolve(code)
    })
  })
  clearInterval(sampleTimer)
  clearTimeout(timeoutTimer)

  let status: StereoResourceChildResult['status']
  if (forcedStatus) status = forcedStatus
  else if (spawnFailed || exitCode !== 0) status = 'failed'
  else if (sampledPeakRssBytes === null) status = 'measurement-unavailable'
  else status = 'completed'

  return {
    status,
    exitCode,
    wallTimeMs: Math.max(0, Math.round(performance.now() - startedAt)),
    sampledPeakRssBytes,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  }
}
