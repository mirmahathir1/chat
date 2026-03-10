const words = [
  'amber',
  'blaze',
  'cedar',
  'dawn',
  'echo',
  'frost',
  'glow',
  'haze',
  'iris',
  'jade',
  'kite',
  'luna',
  'mist',
  'nova',
  'opal',
  'pine',
  'quill',
  'rain',
  'sage',
  'tide',
  'vale',
  'wave',
  'zeal',
  'apex',
  'bolt',
  'core',
  'dusk',
  'edge',
  'flux',
  'grid',
]

const humanReadableIdPattern = /^[a-z]+-[a-z]+-\d{2}$/i

function pickWord() {
  return words[Math.floor(Math.random() * words.length)]
}

export function createHumanReadableId() {
  const suffix = Math.floor(Math.random() * 90 + 10)

  return `${pickWord()}-${pickWord()}-${suffix}`
}

export function isHumanReadableId(value: string) {
  return humanReadableIdPattern.test(value.trim())
}

export function normalizeHumanReadableId(value: string) {
  const trimmed = value.trim().toLowerCase()

  return isHumanReadableId(trimmed) ? trimmed : null
}

export function formatHumanReadableId(value: string) {
  const normalized = normalizeHumanReadableId(value)

  if (!normalized) {
    return value.slice(-4).toUpperCase()
  }

  return normalized
    .split('-')
    .map((segment, index, parts) =>
      index === parts.length - 1
        ? segment
        : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`
    )
    .join(' ')
}
