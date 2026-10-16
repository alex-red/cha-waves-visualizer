import { readdir, readFile, realpath, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Installation metadata is an inventory, not a determination of redistribution obligations.
const packageMetadata = new Map()
const visitedNodeModules = new Set()
const bunStoreDir = join(process.cwd(), 'node_modules', '.bun')
const pendingNodeModules = [join(process.cwd(), 'node_modules'), bunStoreDir]
const formatLicense = license => {
  if (typeof license === 'string') return license
  if (Array.isArray(license)) return license.map(item => typeof item === 'string' ? item : item.type).filter(Boolean).join(' OR ') || 'UNKNOWN'
  return license?.type || 'UNKNOWN'
}

while (pendingNodeModules.length) {
  const modulesDir = pendingNodeModules.pop()
  let modulesPath
  try {
    modulesPath = await realpath(modulesDir)
    if (visitedNodeModules.has(modulesPath)) continue
    visitedNodeModules.add(modulesPath)
  } catch {
    continue
  }

  if (modulesPath === await realpath(bunStoreDir).catch(() => '')) {
    for (const entry of await readdir(modulesDir, { withFileTypes: true })) {
      pendingNodeModules.push(join(modulesDir, entry.name, 'node_modules'))
    }
    continue
  }

  let entries
  try {
    entries = await readdir(modulesDir, { withFileTypes: true })
  } catch {
    continue
  }

  const packageDirs = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      try {
        for (const scopedEntry of await readdir(join(modulesDir, entry.name), { withFileTypes: true })) {
          packageDirs.push(join(modulesDir, entry.name, scopedEntry.name))
        }
      } catch {}
    } else {
      packageDirs.push(join(modulesDir, entry.name))
    }
  }

  for (const packageDir of packageDirs) {
    let metadata
    let packagePath
    try {
      packagePath = await realpath(packageDir)
      metadata = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    if (metadata.name && metadata.version && !packageMetadata.has(packagePath)) {
      packageMetadata.set(packagePath, metadata)
    }
    pendingNodeModules.push(join(packageDir, 'node_modules'))
  }
}

const grouped = new Map()
for (const metadata of packageMetadata.values()) {
  const license = formatLicense(metadata.license)
  const entries = grouped.get(license) ?? []
  entries.push({
    name: metadata.name,
    version: metadata.version,
    license,
    ...(metadata.homepage ? { homepage: metadata.homepage } : {}),
  })
  grouped.set(license, entries)
}
const dependencies = [...packageMetadata.values()].map(metadata => ({
  name: metadata.name,
  versions: [metadata.version],
  declaredLicense: formatLicense(metadata.license),
  ...(metadata.homepage ? { homepage: metadata.homepage } : {}),
})).sort((a, b) => a.name.localeCompare(b.name) || a.versions[0].localeCompare(b.versions[0]))
const counts = Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([license, entries]) => [license, entries.length]))
await mkdir('reports', { recursive: true })
await writeFile('reports/dependency-license-inventory.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  scope: 'All installed workspace dependencies including development tools; not a browser bundle attribution inventory.',
  source: 'package.json metadata from the installed node_modules dependency tree',
  counts,
  dependencies,
}, null, 2) + '\n')
console.log(JSON.stringify({ packages: dependencies.length, licenseGroups: counts, output: 'reports/dependency-license-inventory.json' }, null, 2))
