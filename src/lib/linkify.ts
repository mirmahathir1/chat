export interface LinkSegment {
  type: 'text' | 'link'
  value: string
}

const urlPattern = /(https?:\/\/[^\s]+)/gi

export function splitTextWithLinks(text: string) {
  const segments: LinkSegment[] = []
  let startIndex = 0

  for (const match of text.matchAll(urlPattern)) {
    const value = match[0]
    const index = match.index ?? 0

    if (index > startIndex) {
      segments.push({
        type: 'text',
        value: text.slice(startIndex, index),
      })
    }

    try {
      const normalized = new URL(value).toString()

      segments.push({
        type: 'link',
        value: normalized,
      })
    } catch {
      segments.push({
        type: 'text',
        value,
      })
    }

    startIndex = index + value.length
  }

  if (startIndex < text.length) {
    segments.push({
      type: 'text',
      value: text.slice(startIndex),
    })
  }

  return segments.length > 0
    ? segments
    : [
        {
          type: 'text',
          value: text,
        },
      ]
}
