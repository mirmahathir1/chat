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

export default defineConfig(({ mode }) => ({
  base: resolveBasePath(mode),
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
}))
