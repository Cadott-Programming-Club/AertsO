// Strip query params the Prisma engines may reject (e.g. supa= routing/telemetry
// params some hosting integrations append) while preserving the URL byte-for-byte
// otherwise. Pure string surgery — do NOT use `new URL(...)` here: for non-special
// schemes like postgresql:// WHATWG URLs serialize `origin` as the string "null",
// which silently corrupts the connection string.

const KNOWN_PARAMS = [
  'pgbouncer',
  'connection_limit',
  'connect_timeout',
  'pool_timeout',
  'sslmode',
  'ssl',
]

export function sanitizePrismaUrl(raw: string): string {
  const q = raw.indexOf('?')
  if (q === -1) return raw
  const base = raw.slice(0, q)
  const params = new URLSearchParams(raw.slice(q + 1))
  let changed = false
  for (const key of [...params.keys()]) {
    if (!KNOWN_PARAMS.includes(key)) {
      params.delete(key)
      changed = true
    }
  }
  if (!changed) return raw
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}
