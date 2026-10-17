import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAdbDevices,
  parseAndroidArgs,
  parseReverseMappings,
  runAndroidSatellite,
  selectAdbDevice,
} from './satellite-android.mjs'

const deviceList = `List of devices attached
R58M123456A device product:cheetah model:Pixel_7 device:cheetah transport_id:1
emulator-5554 offline transport_id:2
`

function fakeExecFile(responses) {
  const calls = []
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, options })
    const next = responses.shift()
    if (next instanceof Error) callback(next, '', next.stderr || '')
    else callback(null, next?.stdout ?? '', next?.stderr ?? '')
  }
  return { calls, execFile }
}

test('parses options and rejects unsafe or conflicting command combinations', () => {
  assert.deepEqual(parseAndroidArgs([]), { port: 4175, serial: undefined, check: false, remove: false, help: false })
  assert.deepEqual(parseAndroidArgs(['--', '--port', '8443', '--serial', 'R58', '--check']), {
    port: 8443, serial: 'R58', check: true, remove: false, help: false,
  })
  assert.throws(() => parseAndroidArgs(['--port', '0']), /1 through 65535/)
  assert.throws(() => parseAndroidArgs(['--check', '--remove']), /cannot be used together/)
  assert.throws(() => parseAndroidArgs(['--serial', 'x\n']), /invalid characters/)
})

test('lists all adb device states and automatically selects only one authorized device', () => {
  const devices = parseAdbDevices(deviceList)
  assert.deepEqual(devices.map(({ serial, state }) => ({ serial, state })), [
    { serial: 'R58M123456A', state: 'device' },
    { serial: 'emulator-5554', state: 'offline' },
  ])
  assert.equal(selectAdbDevice(devices), 'R58M123456A')
  assert.equal(selectAdbDevice(devices, 'R58M123456A'), 'R58M123456A')
  assert.throws(() => selectAdbDevice(devices, 'emulator-5554'), /is offline/)
  assert.throws(() => selectAdbDevice(devices, 'missing'), /was not listed/)
  assert.throws(() => selectAdbDevice(parseAdbDevices('List of devices attached\n')), /No ADB devices found/)
  assert.throws(() => selectAdbDevice(parseAdbDevices('List of devices attached\nphone unauthorized\n')), /No authorized ADB device/)
  assert.throws(() => selectAdbDevice(parseAdbDevices('List of devices attached\na device\nb device\n')), /Choose one with --serial/)
})

test('sets only the requested reverse mapping and prints the phone localhost origin', async () => {
  const fake = fakeExecFile([{ stdout: deviceList }, { stdout: '' }, { stdout: '' }])
  const result = await runAndroidSatellite({ port: 4175 }, { execFile: fake.execFile })
  assert.equal(result.action, 'setup')
  assert.match(result.message, /http:\/\/localhost:4175/)
  assert.deepEqual(fake.calls.map(({ command, args }) => [command, args]), [
    ['adb', ['devices', '-l']],
    ['adb', ['-s', 'R58M123456A', 'reverse', '--list']],
    ['adb', ['-s', 'R58M123456A', 'reverse', '--no-rebind', 'tcp:4175', 'tcp:4175']],
  ])
  assert.equal(fake.calls[2].options.timeout, 10_000)
  assert.equal(fake.calls[2].options.maxBuffer, 256 * 1024)
})

test('--check is read-only and reports whether the exact port mapping exists', async () => {
  const fake = fakeExecFile([
    { stdout: deviceList },
    { stdout: 'R58M123456A\ttcp:4175\ttcp:4175\nR58M123456A\ttcp:4174\ttcp:4174\n' },
  ])
  const result = await runAndroidSatellite({ check: true }, { execFile: fake.execFile })
  assert.equal(result.active, true)
  assert.deepEqual(fake.calls.map(({ args }) => args), [
    ['devices', '-l'], ['-s', 'R58M123456A', 'reverse', '--list'],
  ])

  const absent = fakeExecFile([{ stdout: deviceList }, { stdout: 'tcp:4174 tcp:4174\n' }])
  const absentResult = await runAndroidSatellite({ check: true }, { execFile: absent.execFile })
  assert.equal(absentResult.active, false)
  assert.match(absentResult.message, /not active/)
})

test('--remove targets only the selected port and device', async () => {
  const fake = fakeExecFile([{ stdout: deviceList }, { stdout: 'tcp:4999 tcp:4999\n' }, {}])
  const result = await runAndroidSatellite({ remove: true, port: 4999, serial: 'R58M123456A' }, { execFile: fake.execFile })
  assert.equal(result.action, 'remove')
  assert.deepEqual(fake.calls[2].args, ['-s', 'R58M123456A', 'reverse', '--remove', 'tcp:4999'])
})

test('accepts an exact existing mapping without rebinding and rejects port conflicts', async () => {
  const active = fakeExecFile([{ stdout: deviceList }, { stdout: 'R58M123456A device tcp:4175 tcp:4175\n' }])
  const result = await runAndroidSatellite({}, { execFile: active.execFile })
  assert.equal(result.action, 'setup')
  assert.match(result.message, /already ready/)
  assert.equal(active.calls.length, 2)

  const conflict = fakeExecFile([{ stdout: deviceList }, { stdout: 'tcp:4175 tcp:9000\n' }])
  await assert.rejects(runAndroidSatellite({}, { execFile: conflict.execFile }), /already reversed to tcp:9000/)
  assert.equal(conflict.calls.length, 2)
  await assert.rejects(runAndroidSatellite({ remove: true }, {
    execFile: fakeExecFile([{ stdout: deviceList }, { stdout: 'tcp:4175 tcp:9000\n' }]).execFile,
  }), /refusing to change or remove/)
})

test('removing an absent mapping succeeds without issuing a mutation', async () => {
  const fake = fakeExecFile([{ stdout: deviceList }, { stdout: 'tcp:4174 tcp:4174\n' }])
  const result = await runAndroidSatellite({ remove: true }, { execFile: fake.execFile })
  assert.match(result.message, /No ADB reverse mapping exists/)
  assert.equal(fake.calls.length, 2)
})

test('parses ADB transport labels and socket endpoints from scoped reverse-list output', () => {
  const output = 'UsbFfs tcp:4175 tcp:9000\nhost tcp:4176 tcp:4176\ntcp:4000 tcp:4001\n'
  assert.deepEqual(parseReverseMappings(output), [
    { deviceEndpoint: 'tcp:4175', hostEndpoint: 'tcp:9000', devicePort: 4175, hostPort: 9000 },
    { deviceEndpoint: 'tcp:4176', hostEndpoint: 'tcp:4176', devicePort: 4176, hostPort: 4176 },
    { deviceEndpoint: 'tcp:4000', hostEndpoint: 'tcp:4001', devicePort: 4000, hostPort: 4001 },
  ])
  assert.deepEqual(parseReverseMappings('host tcp:4175 localabstract:android_usb'), [
    { deviceEndpoint: 'tcp:4175', hostEndpoint: 'localabstract:android_usb', devicePort: 4175 },
  ])
})

test('treats a non-TCP mapping on the phone port as a conflict', async () => {
  const fake = fakeExecFile([{ stdout: deviceList }, { stdout: 'UsbFfs tcp:4175 localabstract:some-socket\n' }])
  await assert.rejects(runAndroidSatellite({}, { execFile: fake.execFile }), /already reversed to localabstract:some-socket/)
  assert.equal(fake.calls.length, 2)
})

test('surfaces missing adb, bounded execution timeout, and command diagnostics', async () => {
  const missing = new Error('spawn adb ENOENT')
  missing.code = 'ENOENT'
  await assert.rejects(runAndroidSatellite({}, { execFile: fakeExecFile([missing]).execFile }), /Install Android Platform Tools/)

  const timeout = new Error('killed')
  timeout.killed = true
  await assert.rejects(runAndroidSatellite({}, { execFile: fakeExecFile([{ stdout: deviceList }, timeout]).execFile }), /timed out after 10 seconds/)

  const failure = new Error('exit 1')
  failure.stderr = 'device unauthorized'
  await assert.rejects(runAndroidSatellite({}, { execFile: fakeExecFile([failure]).execFile }), /device unauthorized/)
})
