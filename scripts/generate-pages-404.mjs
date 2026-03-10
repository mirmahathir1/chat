import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function normalizeBasePath(value) {
  if (!value) {
    return '/'
  }

  const trimmed = value.trim()

  if (!trimmed || trimmed === '/') {
    return '/'
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`

  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash
    : `${withLeadingSlash}/`
}

function resolveBasePath() {
  const configuredBasePath = normalizeBasePath(process.env.VITE_APP_BASE_PATH)

  if (configuredBasePath !== '/') {
    return configuredBasePath
  }

  if (process.env.GITHUB_ACTIONS !== 'true') {
    return configuredBasePath
  }

  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]

  if (!repository || repository.endsWith('.github.io')) {
    return '/'
  }

  return `/${repository}/`
}

const basePath = resolveBasePath()
const distDir = path.resolve('dist')
const redirectHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Redirecting...</title>
    <script>
      ;(() => {
        const target = new URL(${JSON.stringify(basePath)}, window.location.origin)
        const redirectedRoute =
          window.location.pathname +
          window.location.search +
          window.location.hash

        target.searchParams.set('p2p_route', redirectedRoute)
        window.location.replace(target.toString())
      })()
    </script>
  </head>
  <body></body>
</html>
`

await mkdir(distDir, { recursive: true })
await writeFile(path.join(distDir, '404.html'), redirectHtml)
await writeFile(path.join(distDir, '.nojekyll'), '')
