/** Temporary import-flow logging — filter console with `[import]`. */
export function importDebug(step: string, data?: unknown): void {
  if (import.meta.env.DEV) {
    if (data !== undefined) {
      console.log(`[import] ${step}`, data)
    } else {
      console.log(`[import] ${step}`)
    }
  }
}
