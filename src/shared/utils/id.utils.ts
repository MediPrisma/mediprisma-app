// ID Generation Utilities
export function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function generateShortId(): string {
  return Math.random().toString(36).slice(2, 10)
}
