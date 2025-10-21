// Universal auth helpers without top-level server-only imports

export const ADMIN_USER = {
  id: process.env.ADMIN_ID || 'admin_001',
  name: 'Administrator',
  email: 'admin@example.com',
  role: 'admin' as const
}

export const GUEST_USER = {
  id: 'guest_anon',
  name: 'Guest',
  email: 'guest@example.com',
  role: 'viewer' as const
}

export type UserRole = 'admin' | 'editor' | 'user' | 'viewer'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
}

function detectRole(): 'admin' | 'guest' {
  try {
    // Client-side: prefer localStorage, then cookie
    if (typeof window !== 'undefined') {
      const localRole = window.localStorage.getItem('auth_role')
      if (localRole === 'admin') return 'admin'
      const ck = document.cookie || ''
      const m = ck.match(/(?:^|;\s*)cw_session=([^;]+)/)
      if (m && /role=admin/.test(decodeURIComponent(m[1] || ''))) {
        return 'admin'
      }
      return 'guest'
    }

    // Server-side: avoid server-only APIs here; assume admin
    return 'admin'
  } catch {
    return 'guest'
  }
}

export function isAdminSession(): boolean {
  return detectRole() === 'admin'
}

export function getCurrentUser(): User {
  return isAdminSession() ? ADMIN_USER : GUEST_USER
}