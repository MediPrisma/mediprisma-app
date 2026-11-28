/** This SDK omits thinking.type=disabled. Haiku 5.5 defaults to thinking ON,
 * so serialize an explicit opt-out rather than relying on an omitted field.
 * An explicit adaptive/enabled setting serialized by the SDK still wins. */
export function withClaudeThinkingDefault(fetchImpl: typeof fetch, mode?: 'disabled'): typeof fetch {
  if (!mode) return fetchImpl
  return async (input, init) => {
    if (typeof init?.body !== 'string') return fetchImpl(input, init)
    const body = JSON.parse(init.body)
    if (body.thinking === undefined) body.thinking = { type: mode }
    return fetchImpl(input, { ...init, body: JSON.stringify(body) })
  }
}
