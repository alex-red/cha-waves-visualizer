import { execFileSync } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const textExtensions = new Set(['.md', '.mjs', '.js', '.ts', '.vue', '.json', '.yml', '.yaml', '.toml', '.txt', '.html', '.css', '.lock', '.pem', '.key'])
const privatePath = /(^|\/)(?:local-captures|certs|\.aws|\.ssh|\.codex)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i
const sensitivePatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['local-home-path', /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//g],
]

export function listRepositoryFiles(root = repositoryRoot) {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort()
}

function isWithinRoot(root, target) {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function proseOnly(markdown) {
  let fence = null
  return markdown.split('\n').map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker
      return ''
    }
    return fence ? '' : line.replace(/`[^`]*`/g, '')
  })
}

// This is a bounded publication guard, not a complete credential/privacy scan.
// Diagnostics contain category, path and line only, never the matched secret.
export async function inspectRepositoryFiles(root, files) {
  const knownFiles = new Set(files)
  const findings = []
  const add = (file, rule, line = null) => findings.push({ file, rule, ...(line === null ? {} : { line }) })
  for (const file of files) {
    const absolute = resolve(root, file)
    if (!isWithinRoot(root, absolute)) { add(file, 'outside-repository'); continue }
    if (privatePath.test(file) && !/(^|\/)\.env\.example$/.test(file)) add(file, 'private-artifact')
    let metadata
    try { metadata = await lstat(absolute) } catch (error) {
      if (error.code === 'ENOENT') continue // Tracked deletion in a working tree.
      throw error
    }
    if (metadata.isSymbolicLink()) { add(file, 'repository-symlink'); continue }
    if (!metadata.isFile() || (!textExtensions.has(extname(file)) && !file.startsWith('.env'))) continue
    const source = await readFile(absolute, 'utf8')
    for (const [rule, pattern] of sensitivePatterns) {
      for (const match of source.matchAll(pattern)) add(file, rule, source.slice(0, match.index).split('\n').length)
    }
    for (const match of source.matchAll(/https?:\/\/([a-z0-9.-]+\.ts\.net)\b/gi)) {
      if (!/(?:^|\.)(?:example|your-tailnet)\./i.test(match[1])) add(file, 'private-tailnet-host', source.slice(0, match.index).split('\n').length)
    }
    if (extname(file) === '.json') {
      let document
      try { document = JSON.parse(source) } catch { /* Other checks own malformed JSON. */ }
      if (/^cha-echo-scan-v\d+$/.test(document?.format) && document.mode === 'recorded') add(file, 'recorded-scan')
    }
    if (extname(file) !== '.md') continue
    for (const [index, line] of proseOnly(source).entries()) {
      for (const match of line.matchAll(/!?\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
        const href = match[1] ?? match[2]
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue
        let target
        try { target = decodeURIComponent(href.split(/[?#]/, 1)[0]) } catch { add(file, 'malformed-local-link', index + 1); continue }
        if (!target) continue
        const resolvedTarget = resolve(dirname(absolute), target)
        if (!isWithinRoot(root, resolvedTarget)) { add(file, 'outside-repository-link', index + 1); continue }
        const repositoryTarget = relative(root, resolvedTarget).split(sep).join('/')
        if (!knownFiles.has(repositoryTarget) && !files.some(candidate => candidate.startsWith(`${repositoryTarget}/`))) add(file, 'missing-local-link', index + 1)
      }
    }
  }
  return findings
}

export async function verifyRepository(root = repositoryRoot) {
  const files = listRepositoryFiles(root)
  const findings = await inspectRepositoryFiles(root, files)
  if (findings.length) {
    for (const finding of findings) process.stderr.write(`${finding.file}${finding.line ? `:${finding.line}` : ''}: ${finding.rule}\n`)
    process.stderr.write(`Repository verification failed: ${findings.length} finding(s). Matched values are intentionally omitted.\n`)
    return 1
  }
  process.stdout.write(`Repository verification passed: ${files.length} public candidate files; local Markdown targets and selected private-artifact/credential patterns checked.\n`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRepository().then(code => { process.exitCode = code }).catch(error => {
    process.stderr.write(`Repository verification could not complete: ${error.message}\n`)
    process.exitCode = 1
  })
}
