import type { AuthError, Session, User } from '@supabase/supabase-js'

export type SignUpResult = {
  error: string | null
  sessionCreated: boolean
  needsEmailConfirmation: boolean
  duplicateEmail: boolean
}

export function authRedirectUrl(origin: string, basePath: string): string {
  const path = basePath.endsWith('/') ? basePath : `${basePath}/`
  return `${origin}${path}`
}

export function mapSignInError(error: Pick<AuthError, 'code' | 'message'>): string {
  if (error.code === 'email_not_confirmed') {
    return 'Please confirm your email before signing in.'
  }
  if (error.code === 'invalid_credentials' || error.message === 'Invalid login credentials') {
    return 'Email or password is incorrect. If you just signed up, check whether this email is already registered.'
  }
  return error.message
}

export function parseSignUpResult(
  data: { session: Session | null; user: User | null },
  error: AuthError | null,
): SignUpResult {
  if (error) {
    return {
      error: error.message,
      sessionCreated: false,
      needsEmailConfirmation: false,
      duplicateEmail: false,
    }
  }

  const sessionCreated = Boolean(data.session)
  const duplicateEmail = Boolean(data.user && data.user.identities?.length === 0)
  const needsEmailConfirmation = Boolean(
    !duplicateEmail && !data.session && data.user && !data.user.email_confirmed_at,
  )

  return { error: null, sessionCreated, needsEmailConfirmation, duplicateEmail }
}
