export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}
