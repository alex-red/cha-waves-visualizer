import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_ECHO_SPECS = [
  'apps/web/e2e/echo-lab.spec.ts',
  'apps/web/e2e/echo-diagnostics.spec.ts',
  'apps/web/e2e/phone-capture.spec.ts',
  'apps/web/e2e/phone-probe-series.spec.ts',
]

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function parseEchoArgs(argv) {
  // Bun preserves its run-script separator in argv on some versions. Strip
  // that leading marker only; subsequent positional arguments are test-file
  // filters and options continue to be parsed normally.
  const args = argv[0] === '--' ? argv.slice(1) : argv
  const specs = []
  const forwardedArgs = []
  const valueOptions = new Set([
    '--config', '--project', '--grep', '-g', '--grep-invert', '--workers', '-w',
    '--output', '--reporter', '--timeout', '--global-timeout', '--retries',
    '--repeat-each', '--max-failures', '--shard', '--test-match', '--test-ignore',
    '--snapshot-path-template',
  ])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith('-')) {
      forwardedArgs.push(arg)
      if (valueOptions.has(arg) && args[index + 1] !== undefined) {
        forwardedArgs.push(args[index + 1])
        index += 1
      }
    } else {
      specs.push(arg)
    }
  }

  return {
    specs: specs.length ? specs : [...DEFAULT_ECHO_SPECS],
    forwardedArgs,
    hasWorkers: forwardedArgs.some(arg => arg === '--workers' || arg === '-w' || arg.startsWith('--workers=')),
  }
}

export function validatePort(value) {
  const port = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PLAYWRIGHT_PORT must be a valid TCP port from 1 to 65535.')
  }
  return port
}

export async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise(resolveClose => server.close(resolveClose))
    throw new Error('Could not reserve a local Playwright preview port.')
  }
  const port = address.port
  await new Promise((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
  })
  return port
}

export function getPlaywrightCliPath() {
  // @playwright/test does not export ./cli.js. Its resolved package entry and
  // CLI live beside one another in the installed, project-local package.
  const entry = fileURLToPath(import.meta.resolve('@playwright/test'))
  return resolve(dirname(entry), 'cli.js')
}

export async function makeEchoPlan({ argv = [], env = process.env, root = repoRoot, reservePortImpl = reservePort } = {}) {
  const parsed = parseEchoArgs(argv)
  const port = env.PLAYWRIGHT_PORT === undefined || env.PLAYWRIGHT_PORT === ''
    ? validatePort(await reservePortImpl())
    : validatePort(env.PLAYWRIGHT_PORT)
  const cliPath = getPlaywrightCliPath()
  await access(cliPath, constants.R_OK)

  const childEnv = {
    ...env,
    PLAYWRIGHT_PORT: String(port),
    PLAYWRIGHT_REUSE_SERVER: '0',
  }
  const outputDir = env.PLAYWRIGHT_OUTPUT_DIR || 'test-results'
  const args = [cliPath, 'test', '--config=playwright.config.ts', ...parsed.specs]
  if (!parsed.hasWorkers) args.push('--workers=1')
  args.push(...parsed.forwardedArgs)

  return {
    args,
    childEnv,
    port,
    specs: parsed.specs,
    outputDir,
    browsers: env.PLAYWRIGHT_BROWSERS || 'chromium',
    channel: env.PLAYWRIGHT_CHROMIUM_CHANNEL || 'Playwright default',
    cliPath,
  }
}

export async function runEchoTests({
  argv = process.argv.slice(2),
  env = process.env,
  spawnImpl = spawn,
  reservePortImpl = reservePort,
  processLike = process,
  stdout = process.stdout,
  stderr = process.stderr,
  root = repoRoot,
} = {}) {
  let plan
  try {
    plan = await makeEchoPlan({ argv, env, root, reservePortImpl })
  } catch (error) {
    stderr.write(`Echo Playwright setup failed: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  const workerArg = plan.args.find(arg => arg === '--workers' || arg.startsWith('--workers='))
  const workers = workerArg?.includes('=') ? workerArg.split('=', 2)[1] : 'explicit'
  stdout.write(`Echo Playwright: browsers=${plan.browsers}; port=${plan.port}; channel=${plan.channel}; workers=${workers}; output=${plan.outputDir}\n`)

  return new Promise(resolveExit => {
    let settled = false
    const child = spawnImpl(processLike.execPath || process.execPath, plan.args, {
      cwd: root,
      env: plan.childEnv,
      stdio: 'inherit',
    })
    const signalHandlers = new Map()
    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) processLike.removeListener(signal, handler)
    }
    const finish = code => {
      if (settled) return
      settled = true
      cleanup()
      resolveExit(code)
    }

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => {
        if (child && !child.killed) child.kill(signal)
      }
      signalHandlers.set(signal, handler)
      processLike.once(signal, handler)
    }

    child.once('error', error => {
      stderr.write(`Could not start project Playwright: ${error.message}\n`)
      finish(1)
    })
    child.once('exit', (code, signal) => {
      if (signal) {
        const signalNumber = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal]
        finish(typeof signalNumber === 'number' ? 128 + signalNumber : 1)
      } else {
        finish(code ?? 1)
      }
    })
  })
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  runEchoTests().then(code => {
    process.exitCode = code
  }).catch(error => {
    process.stderr.write(`Echo Playwright failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
