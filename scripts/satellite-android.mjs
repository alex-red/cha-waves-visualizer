#!/usr/bin/env node
import { execFile as childExecFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const DEFAULT_PORT = 4175
const ADB_TIMEOUT_MS = 10_000
const ADB_MAX_BUFFER = 256 * 1024

export function parseAndroidArgs(args) {
  const options = { port: DEFAULT_PORT, serial: undefined, check: false, remove: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--check') options.check = true
    else if (arg === '--remove') options.remove = true
    else if (arg === '--port' || arg === '--serial') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`)
      if (arg === '--port') options.port = Number(value)
      else options.serial = value
    } else throw new Error(`Unsupported argument: ${arg}`)
  }
  if (!options.help && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    throw new Error('--port must be an integer from 1 through 65535.')
  }
  if (options.serial && /[\u0000-\u001f\u007f]/.test(options.serial)) throw new Error('--serial contains invalid characters.')
  if (options.check && options.remove) throw new Error('--check and --remove cannot be used together.')
  return options
}

export function parseAdbDevices(output) {
  return String(output).split(/\r?\n/).flatMap(line => {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 2 || !fields[0] || fields[0] === '*' || fields[0] === 'List') return []
    return [{ serial: fields[0], state: fields[1], details: fields.slice(2).join(' ') }]
  })
}

export function selectAdbDevice(devices, requestedSerial) {
  const authorized = devices.filter(device => device.state === 'device')
  if (requestedSerial) {
    const device = devices.find(candidate => candidate.serial === requestedSerial)
    if (!device) throw new Error(`ADB device "${requestedSerial}" was not listed. Run "adb devices -l" and check the USB connection.`)
    if (device.state !== 'device') throw new Error(`ADB device "${requestedSerial}" is ${device.state}; authorize USB debugging on the phone and try again.`)
    return device.serial
  }
  if (authorized.length === 0) {
    const blocked = devices.filter(device => device.state !== 'device')
    if (blocked.length) throw new Error(`No authorized ADB device. Current device state: ${blocked.map(device => `${device.serial} (${device.state})`).join(', ')}. Unlock the phone and authorize USB debugging.`)
    throw new Error('No ADB devices found. Connect and unlock the phone, enable USB debugging, then run "adb devices -l".')
  }
  if (authorized.length > 1) throw new Error(`Found ${authorized.length} authorized ADB devices. Choose one with --serial SERIAL.`)
  return authorized[0].serial
}

function runAdb(execFile, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('adb', args, {
      encoding: 'utf8',
      timeout: ADB_TIMEOUT_MS,
      maxBuffer: ADB_MAX_BUFFER,
      windowsHide: true,
    }, (error, stdout = '', stderr = '') => {
      if (!error) return resolvePromise({ stdout: String(stdout), stderr: String(stderr) })
      if (error.code === 'ENOENT') return rejectPromise(new Error('Could not find adb. Install Android Platform Tools and ensure adb is on PATH.'))
      if (error.killed || error.code === 'ETIMEDOUT') return rejectPromise(new Error(`adb ${args.join(' ')} timed out after ${ADB_TIMEOUT_MS / 1000} seconds.`))
      const diagnostic = String(stderr || error.stderr || error.message || '').trim().slice(0, 600)
      rejectPromise(new Error(`adb ${args.join(' ')} failed${diagnostic ? `: ${diagnostic}` : '.'}`))
    })
  })
}

export function parseReverseMappings(output) {
  return String(output).split(/\r?\n/).flatMap(line => {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 2) return []
    // `adb -s SERIAL reverse --list` is already scoped to one device. Its first
    // column can be a transport label (for example UsbFfs or host), not SERIAL.
    // Parse the final pair so non-TCP host sockets still participate in conflicts.
    const [deviceEndpoint, hostEndpoint] = columns.slice(-2)
    if (!isSocketEndpoint(deviceEndpoint) || !isSocketEndpoint(hostEndpoint)) return []
    const devicePort = /^tcp:(\d+)$/.exec(deviceEndpoint)?.[1]
    const hostPort = /^tcp:(\d+)$/.exec(hostEndpoint)?.[1]
    return [{
      deviceEndpoint,
      hostEndpoint,
      ...(devicePort ? { devicePort: Number(devicePort) } : {}),
      ...(hostPort ? { hostPort: Number(hostPort) } : {}),
    }]
  })
}

function isSocketEndpoint(value) {
  return /^(?:tcp:\d+|localabstract:.+|localreserved:.+|localfilesystem:.+|dev:.+|jdwp:\d+)$/.test(value)
}

function mappingForPort(output, port) {
  return parseReverseMappings(output).find(mapping => mapping.deviceEndpoint === `tcp:${port}`)
}

function assertNoPortConflict(output, port, serial) {
  const mapping = mappingForPort(output, port)
  if (mapping && mapping.hostEndpoint !== `tcp:${port}`) {
    throw new Error(`Phone localhost:${port} is already reversed to ${mapping.hostEndpoint} on ${serial}; refusing to change or remove that mapping.`)
  }
  return Boolean(mapping)
}

/** Run the safe ADB reverse-port workflow. execFile is injectable for tests. */
export async function runAndroidSatellite(options, { execFile = childExecFile } = {}) {
  const deviceResult = await runAdb(execFile, ['devices', '-l'])
  const serial = selectAdbDevice(parseAdbDevices(deviceResult.stdout), options.serial)
  const port = options.port ?? DEFAULT_PORT
  const endpoint = `tcp:${port}`
  const reverseResult = await runAdb(execFile, ['-s', serial, 'reverse', '--list'])
  const alreadyMapped = assertNoPortConflict(reverseResult.stdout, port, serial)
  if (options.check) {
    const active = alreadyMapped
    return {
      serial,
      port,
      action: 'check',
      active,
      message: active
        ? `ADB reverse is active for ${endpoint}. Open http://localhost:${port} on the phone.`
        : `ADB reverse is not active for ${endpoint}. Run this command without --check to set it up.`,
    }
  }
  if (options.remove) {
    if (!alreadyMapped) return { serial, port, action: 'remove', message: `No ADB reverse mapping exists for ${endpoint} on ${serial}.` }
    await runAdb(execFile, ['-s', serial, 'reverse', '--remove', endpoint])
    return { serial, port, action: 'remove', message: `Removed ADB reverse mapping ${endpoint} for ${serial}.` }
  }
  if (alreadyMapped) {
    return {
      serial,
      port,
      action: 'setup',
      message: `ADB reverse is already ready for ${serial}. Open http://localhost:${port} in Chrome on the phone.`,
    }
  }
  await runAdb(execFile, ['-s', serial, 'reverse', '--no-rebind', endpoint, endpoint])
  return {
    serial,
    port,
    action: 'setup',
    message: [
      `ADB reverse is ready for ${serial}: host tcp:${port} → phone localhost:${port}.`,
      `Open http://localhost:${port} in Chrome on the phone.`,
      'Keep the satellite server running on the computer at this port. This USB localhost tunnel provides Chrome a secure localhost context; it does not install software or change phone trust settings.',
    ].join('\n'),
  }
}

export const ANDROID_HELP = `Usage: node scripts/satellite-android.mjs [--port PORT] [--serial SERIAL] [--check | --remove]

Set up an ADB USB reverse tunnel from phone localhost:PORT to computer tcp:PORT.
The default port is ${DEFAULT_PORT}. Without --serial, exactly one authorized device must be connected.

  --check       List devices and inspect the reverse mapping without changing it
  --remove      Remove only this port's reverse mapping on the selected device
  --serial ID   Select a device when more than one authorized device is connected
  --port PORT   Use a different relay port (default ${DEFAULT_PORT})
  --help        Show this help

Start the satellite server on the computer at the same port before opening the phone URL.`

const ownPath = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  try {
    const options = parseAndroidArgs(process.argv.slice(2))
    if (options.help) console.log(ANDROID_HELP)
    else {
      const result = await runAndroidSatellite(options)
      console.log(result.message)
      if (options.check && !result.active) process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
