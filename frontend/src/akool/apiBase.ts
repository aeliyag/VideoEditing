export function resolveAkoolApiBase(env: {
  VITE_AKOOL_API_BASE?: string
  VITE_SUPABASE_URL?: string
  DEV?: boolean
}): string {
  const explicit = env.VITE_AKOOL_API_BASE?.trim().replace(/\/$/, '')
  if (explicit) {
    return explicit
  }
  if (env.DEV) {
    return '/api/akool'
  }
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  if (supabaseUrl) {
    return `${supabaseUrl}/functions/v1/akool-proxy`
  }
  return '/api/akool'
}
