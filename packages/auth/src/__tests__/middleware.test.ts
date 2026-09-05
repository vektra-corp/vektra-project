import { describe, expect, it } from 'vitest'
import {
  extractOrgSlug,
  extractWorkspaceSlug,
  isAllowedOrigin,
  isPortalRoute,
  isMfaExemptRoute,
  isProtectedRoute,
  isPublicRoute,
  needsSecondFactor,
  safeNextPath,
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

describe('needsSecondFactor', () => {
  const verified = [{ status: 'verified' }]
  const unverified = [{ status: 'unverified' }]

  it('challenges a user with a verified factor holding an aal1 token', () => {
    expect(needsSecondFactor('aal1', verified)).toBe(true)
  })

  it('lets an aal2 token through', () => {
    expect(needsSecondFactor('aal2', verified)).toBe(false)
  })

  it('ignores an abandoned enrolment', () => {
    // Otherwise starting enrolment and closing the tab would lock someone out
    // of their own account with no way back in.
    expect(needsSecondFactor('aal1', unverified)).toBe(false)
  })

  it('does not challenge a user with no factors', () => {
    expect(needsSecondFactor('aal1', [])).toBe(false)
    expect(needsSecondFactor('aal1', null)).toBe(false)
    expect(needsSecondFactor(null, undefined)).toBe(false)
  })

  it('challenges when the claim is missing but a factor is verified', () => {
    // Fail closed: an absent aal claim is not evidence of aal2.
    expect(needsSecondFactor(undefined, verified)).toBe(true)
    expect(needsSecondFactor('', verified)).toBe(true)
  })

  it('counts a verified factor among unverified ones', () => {
    expect(needsSecondFactor('aal1', [{ status: 'unverified' }, { status: 'verified' }])).toBe(true)
  })
})

describe('isMfaExemptRoute', () => {
  it('allows the challenge page itself', () => {
    expect(isMfaExemptRoute('/mfa')).toBe(true)
    expect(isMfaExemptRoute('/mfa/verify')).toBe(true)
  })

  it('allows public routes', () => {
    expect(isMfaExemptRoute('/login')).toBe(true)
  })

  it('blocks everything else, including routes that do not exist yet', () => {
    for (const path of ['/acme/dashboard', '/acme/settings/security', '/anything-new']) {
      expect(isMfaExemptRoute(path)).toBe(false)
    }
  })
})

describe('extractOrgSlug — non-tenant top-level routes', () => {
  it('does not read an app route as an organization slug', () => {
    // Anything not excluded here is treated as a tenant, and a signed-in user
    // visiting it is bounced to /403. `/mfa` hit exactly that, which made the
    // second-factor page unreachable.
    for (const path of [
      '/mfa',
      '/mfa?next=/acme/dashboard',
      '/login',
      '/signup',
      '/verify',
      '/forgot-password',
      '/reset-password',
      '/403',
      '/404',
      '/api/export',
      '/auth/callback',
      '/onboarding',
      '/select-org',
      '/logout',
    ]) {
      expect(extractOrgSlug(path), path).toBeNull()
    }
  })

  it('still reads a real org slug', () => {
    expect(extractOrgSlug('/acme/dashboard')).toBe('acme')
    expect(extractOrgSlug('/acme')).toBe('acme')
  })
})


describe('safeNextPath', () => {
  it('allows an ordinary in-app path', () => {
    expect(safeNextPath('/acme/dashboard')).toBe('/acme/dashboard')
    expect(safeNextPath('/acme/reports?status=todo')).toBe('/acme/reports?status=todo')
    expect(safeNextPath('/acme/tasks#comments')).toBe('/acme/tasks#comments')
  })

  it('refuses a protocol-relative URL', () => {
    // The whole point: this starts with "/" and is an absolute URL to another
    // site, so the naive startsWith('/') check waves it through.
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath('//evil.example/path')).toBe('/')
  })

  it('refuses a backslash authority, which browsers normalise', () => {
    expect(safeNextPath('/\\evil.example')).toBe('/')
    expect(safeNextPath('/\\/evil.example')).toBe('/')
  })

  it('refuses an absolute URL', () => {
    for (const value of ['https://evil.example', 'http://evil.example']) {
      expect(safeNextPath(value)).toBe('/')
    }
  })

  it('refuses other schemes', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/')
    expect(safeNextPath('data:text/html,<script>')).toBe('/')
  })

  it('refuses values carrying characters a browser strips before parsing', () => {
    // "/<tab>https://evil.example" becomes an absolute URL once the tab is gone.
    expect(safeNextPath('/\thttps://evil.example')).toBe('/')
    expect(safeNextPath('/\nhttps://evil.example')).toBe('/')
    expect(safeNextPath('/ https://evil.example')).toBe('/')
  })

  it('refuses anything that is not a path', () => {
    expect(safeNextPath('acme/dashboard')).toBe('/')
    expect(safeNextPath('')).toBe('/')
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
    expect(safeNextPath(42)).toBe('/')
  })

  it('normalises traversal rather than passing it through', () => {
    expect(safeNextPath('/acme/../other')).toBe('/other')
  })

  it('honours a caller-supplied fallback', () => {
    expect(safeNextPath('//evil.example', '/acme/dashboard')).toBe('/acme/dashboard')
  })
})

describe('isAllowedOrigin — configured URLs that carry a path', () => {
  // The admin console is served at admin.vektracorp.in/project, because that
  // subdomain is shared across products. An Origin header never has a path, so
  // a string comparison against the configured URL would never match and every
  // admin mutation would be refused as CSRF.
  const configured = ['https://project.vektracorp.in', 'https://admin.vektracorp.in/project']

  it('matches an origin against a configured URL that has a path', () => {
    expect(isAllowedOrigin('https://admin.vektracorp.in', configured)).toBe(true)
  })

  it('still matches a plain configured origin', () => {
    expect(isAllowedOrigin('https://project.vektracorp.in', configured)).toBe(true)
  })

  it('refuses a different host', () => {
    expect(isAllowedOrigin('https://evil.example', configured)).toBe(false)
  })

  it('refuses a lookalike host', () => {
    expect(isAllowedOrigin('https://admin.vektracorp.in.evil.example', configured)).toBe(false)
  })

  it('treats scheme and port as part of the origin', () => {
    expect(isAllowedOrigin('http://project.vektracorp.in', configured)).toBe(false)
    expect(isAllowedOrigin('https://project.vektracorp.in:8443', configured)).toBe(false)
  })

  it('refuses a missing or unparseable origin', () => {
    expect(isAllowedOrigin(null, configured)).toBe(false)
    expect(isAllowedOrigin('null', configured)).toBe(false)
    expect(isAllowedOrigin('not-a-url', configured)).toBe(false)
  })

  it('refuses everything when nothing is configured', () => {
    expect(isAllowedOrigin('https://project.vektracorp.in', [])).toBe(false)
    expect(isAllowedOrigin('https://project.vektracorp.in', [undefined])).toBe(false)
  })
})
