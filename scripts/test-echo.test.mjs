import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { makeEchoPlan, parseEchoArgs, runEchoTests, validatePort, DEFAULT_ECHO_SPECS } from './test-echo.mjs'

test('echo runner uses the focused specs and one worker by default', async () => {
  const plan = await makeEchoPlan({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/browser-cache', PLAYWRIGHT_BROWSERS: 'chromium' },
    reservePortImpl: async () => 43127,
  })

  assert.deepEqual(plan.specs, DEFAULT_ECHO_SPECS)
  assert.deepEqual(DEFAULT_ECHO_SPECS, [
    'apps/web/e2e/echo-lab.spec.ts',
    'apps/web/e2e/echo-diagnostics.spec.ts',
    'apps/web/e2e/phone-capture.spec.ts',
    'apps/web/e2e/phone-probe-series.spec.ts',
  ])
  assert.equal(plan.args.at(-1), '--workers=1')
  assert.equal(plan.childEnv.PLAYWRIGHT_PORT, '43127')
  assert.equal(plan.childEnv.PLAYWRIGHT_REUSE_SERVER, '0')
  assert.equal(plan.childEnv.PLAYWRIGHT_BROWSERS_PATH, '/browser-cache')
  assert.equal(plan.childEnv.PLAYWRIGHT_BROWSERS, 'chromium')
  assert.match(plan.cliPath, /node_modules[\/]@playwright[\/]test[\/]cli\.js$/)
})

test('explicit worker settings are forwarded without adding the default', async () => {
  const beforeSeparator = parseEchoArgs(['--workers', '3'])
  assert.equal(beforeSeparator.hasWorkers, true)
  assert.deepEqual(beforeSeparator.forwardedArgs, ['--workers', '3'])

  const leadingBunSeparator = parseEchoArgs(['--', 'apps/web/e2e/echo-diagnostics.spec.ts', '--grep', 'phone', '--workers=2'])
  assert.deepEqual(leadingBunSeparator.specs, ['apps/web/e2e/echo-diagnostics.spec.ts'])
  assert.equal(leadingBunSeparator.hasWorkers, true)
  assert.deepEqual(leadingBunSeparator.forwardedArgs, ['--grep', 'phone', '--workers=2'])
  const helpAndUnknownFlag = parseEchoArgs(['--', '--help', '--unrecognized-flag'])
  assert.deepEqual(helpAndUnknownFlag.specs, DEFAULT_ECHO_SPECS)
  assert.deepEqual(helpAndUnknownFlag.forwardedArgs, ['--help', '--unrecognized-flag'])

  const plan = await makeEchoPlan({
    argv: ['--', 'apps/web/e2e/echo-diagnostics.spec.ts', '--workers=2', '--grep', 'phone'],
    env: { PLAYWRIGHT_PORT: '4444' },
    reservePortImpl: async () => assert.fail('explicit port must be preserved'),
  })
  assert.equal(plan.port, 4444)
  assert.deepEqual(plan.specs, ['apps/web/e2e/echo-diagnostics.spec.ts'])
  assert.equal(plan.args.filter(arg => arg.startsWith('--workers')).length, 1)
  assert.ok(plan.args.includes('--workers=2'))
})

test('port validation rejects malformed or out-of-range ports', () => {
  for (const value of ['', 'abc', '0', '65536', '1.5']) {
    assert.throws(() => validatePort(value), /valid TCP port/)
  }
  assert.equal(validatePort('65535'), 65535)
})

test('an automatically assigned port is validated and recorded in child environment', async () => {
  let reserveCalls = 0
  const plan = await makeEchoPlan({
    env: {},
    reservePortImpl: async () => {
      reserveCalls += 1
      return 43128
    },
  })
  assert.equal(reserveCalls, 1)
  assert.equal(plan.port, 43128)
  assert.equal(plan.childEnv.PLAYWRIGHT_PORT, '43128')
  await assert.rejects(makeEchoPlan({ env: {}, reservePortImpl: async () => 0 }), /valid TCP port/)
})

test('runner inherits environment, reports context, and propagates Playwright exit status', async () => {
  let launch
  let output = ''
  const processLike = new EventEmitter()
  processLike.execPath = '/node'
  const code = await runEchoTests({
    env: {
      PLAYWRIGHT_PORT: '4183',
      PLAYWRIGHT_BROWSERS: 'chromium',
      PLAYWRIGHT_CHROMIUM_CHANNEL: 'chrome',
      PLAYWRIGHT_OUTPUT_DIR: '/private/tmp/echo-test-output',
      PLAYWRIGHT_BROWSERS_PATH: '/browser-cache',
    },
    processLike,
    stdout: { write: value => { output += value } },
    stderr: { write: value => { output += value } },
    spawnImpl: (command, args, options) => {
      launch = { command, args, options }
      const child = new EventEmitter()
      child.killed = false
      child.kill = () => { child.killed = true }
      queueMicrotask(() => child.emit('exit', 7, null))
      return child
    },
  })

  assert.equal(code, 7)
  assert.equal(launch.command, '/node')
  assert.equal(launch.options.env.PLAYWRIGHT_PORT, '4183')
  assert.equal(launch.options.env.PLAYWRIGHT_REUSE_SERVER, '0')
  assert.equal(launch.options.env.PLAYWRIGHT_BROWSERS_PATH, '/browser-cache')
  assert.ok(launch.args.includes('--workers=1'))
  assert.match(output, /port=4183; channel=chrome/)
  assert.match(output, /output=\/private\/tmp\/echo-test-output/)
  assert.equal(processLike.listenerCount('SIGINT'), 0)
})

test('runner forwards an interrupt to its Playwright child and returns a signal exit code', async () => {
  const processLike = new EventEmitter()
  processLike.execPath = '/node'
  let interrupted = false
  const result = runEchoTests({
    env: { PLAYWRIGHT_PORT: '4184' },
    processLike,
    stdout: { write() {} },
    stderr: { write() {} },
    spawnImpl: () => {
      const child = new EventEmitter()
      child.killed = false
      child.kill = signal => {
        assert.equal(signal, 'SIGINT')
        interrupted = true
        child.killed = true
        queueMicrotask(() => child.emit('exit', null, 'SIGINT'))
      }
      queueMicrotask(() => processLike.emit('SIGINT'))
      return child
    },
  })

  assert.equal(await result, 130)
  assert.equal(interrupted, true)
  assert.equal(processLike.listenerCount('SIGINT'), 0)
})
