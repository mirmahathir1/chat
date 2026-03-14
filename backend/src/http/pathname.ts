export function normalizePathname(pathname: string) {
  if (pathname === '/') {
    return pathname
  }

  return pathname.replace(/\/+$/, '')
}

export function resolveRequestPathname(requestUrl: string | undefined) {
  const pathname = new URL(requestUrl ?? '/', 'http://localhost').pathname

  return normalizePathname(pathname)
}
