const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

export function formatTimeLabel(value: string) {
  return timeFormatter.format(new Date(value))
}
