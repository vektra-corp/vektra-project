import { describe, expect, it } from 'vitest'
import {
  extractOrgSlug,
  extractWorkspaceSlug,
  isAllowedOrigin,
  isPortalRoute,
  isProtectedRoute,
  isPublicRoute,
} from '../middleware'

describe('extractOrgSlug', () => {
  it('reads the first segment of a dashboard URL', () => {
    expect(extractOrgSlug('/acme/engineering/projects')).toBe('acme')
    expect(extractOrgSlug('/acme')).toBe('acme')
  })

  it('reads one segment deeper on a portal URL', () => {
    // Without this the guard checks membership of an org named "portal",
    // finds none, and 403s every external user.
    expect(extractOrgSlug('/portal/acme')).toBe('acme')
    expect(extractOrgSlug('/portal/acme/projects/abc')).toBe('acme')
  })

  it('returns null for routes that are not tenant-scoped', () => {
    expect(extractOrgSlug('/')).toBeNull()
    expect(extractOrgSlug('/login')).toBeNull()
    expect(extractOrgSlug('/onboarding')).toBeNull()
    expect(extractOrgSlug('/api/webhooks/stripe')).toBeNull()
    expect(extractOrgSlug('/403')).toBeNull()
  })

  it('rejects a segment that cannot be a slug', () => {
    expect(extractOrgSlug('/Acme')).toBeNull()
    expect(extractOrgSlug('/-acme')).toBeNull()
    expect(extractOrgSlug('/portal/Acme')).toBeNull()
  })

  it('returns null for a bare /portal with no org', () => {
    expect(extractOrgSlug('/portal')).toBeNull()
  })

  it('does not treat a public prefix as reserved inside the portal', () => {
    // An org may legitimately be slugged "login"; only the root-level route is
    // reserved, and the portal's org segment is never at the root.
    expect(extractOrgSlug('/portal/login')).toBe('login')
  })
})

describe('isPortalRoute', () => {
  it('distinguishes portal paths from app paths', () => {
    expect(isPortalRoute('/portal/acme')).toBe(true)
    expect(isPortalRoute('/acme/portal')).toBe(false)
    expect(isPortalRoute('/')).toBe(false)
  })
})

describe('extractWorkspaceSlug', () => {
  it('reads the second segment in the app', () => {
    expect(extractWorkspaceSlug('/acme/engineering/projects')).toBe('engineering')
  })

  it('returns null in the portal, which has no workspace level', () => {
    expect(extractWorkspaceSlug('/portal/acme/projects')).toBeNull()
  })
})

describe('isPublicRoute / isProtectedRoute', () => {
  it('treats auth screens and signature-verified endpoints as public', () => {
    expect(isPublicRoute('/login')).toBe(true)
    expect(isPublicRoute('/api/webhooks/stripe')).toBe(true)
    expect(isPublicRoute('/api/inngest')).toBe(true)
  })

  it('does not let a prefix match a longer sibling segment', () => {
    expect(isPublicRoute('/logins')).toBe(false)
    expect(isPublicRoute('/login-help')).toBe(false)
  })

  it('protects everything that is not public', () => {
    expect(isProtectedRoute('/acme/dashboard')).toBe(true)
    expect(isProtectedRoute('/portal/acme')).toBe(true)
    expect(isProtectedRoute('/login')).toBe(false)
  })
})

describe('isAllowedOrigin', () => {
  it('requires an exact match and ignores undefined entries', () => {
    const allowed = ['https://app.example.com', undefined]
    expect(isAllowedOrigin('https://app.example.com', allowed)).toBe(true)
    expect(isAllowedOrigin('https://evil.example.com', allowed)).toBe(false)
    expect(isAllowedOrigin(null, allowed)).toBe(false)
    // A null origin must never match an absent allowlist entry.
    expect(isAllowedOrigin(undefined as never, allowed)).toBe(false)
  })
})
