import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

function normalizeBasePath(value: string | undefined) {
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

function resolveBasePath(mode: string) {
  const env = loadEnv(mode, process.cwd(), '')
  const configuredBasePath = normalizeBasePath(env.VITE_APP_BASE_PATH)

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

function readBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true'
}

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const usePolling = readBoolean(
    process.env.CHOKIDAR_USEPOLLING ?? env.CHOKIDAR_USEPOLLING
  )
  const pollingInterval = readNumber(
    process.env.CHOKIDAR_INTERVAL ?? env.CHOKIDAR_INTERVAL,
    300
  )
  const hmrHost = process.env.VITE_HMR_HOST ?? env.VITE_HMR_HOST
  const hmrClientPort = readNumber(
    process.env.VITE_HMR_CLIENT_PORT ?? env.VITE_HMR_CLIENT_PORT,
    5173
  )

  return {
    base: resolveBasePath(mode),
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      watch: usePolling
        ? {
            interval: pollingInterval,
            usePolling: true,
          }
        : undefined,
      hmr: hmrHost
        ? {
            clientPort: hmrClientPort,
            host: hmrHost,
            port: hmrClientPort,
            protocol: 'ws',
          }
        : undefined,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
