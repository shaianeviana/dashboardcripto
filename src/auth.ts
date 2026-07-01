const SESSION_KEY = 'dash_auth'

// ── Edite as credenciais aqui ──────────────────────────────────────────────────
const USERS: Record<string, string> = {
  admin: 'crypto2025',
}

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === '1'
}

export function tryLogin(user: string, pass: string): boolean {
  if (USERS[user] !== undefined && USERS[user] === pass) {
    sessionStorage.setItem(SESSION_KEY, '1')
    return true
  }
  return false
}

export function logout(): void {
  sessionStorage.removeItem(SESSION_KEY)
}
