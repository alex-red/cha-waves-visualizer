import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSpatialStereo } from './spatial-stereo.ts'

export const runSpatialStereoSgm = (args: readonly string[]): Promise<string> => runSpatialStereo(args, 'rectified-census-sgm-v1')

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereoSgm(process.argv.slice(2)).then(output => process.stdout.write(output), error => {
    process.stderr.write(`spatial:stereo:sgm: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
