export const ADMIN_USER = {
  id: process.env.ADMIN_ID || 'admin_001',
  name: 'Administrator',
  email: 'admin@example.com',
  role: 'admin' as const
}

export type UserRole = 'admin' | 'editor' | 'user' | 'viewer'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
}

export function getCurrentUser(): User {
  return ADMIN_USER
}