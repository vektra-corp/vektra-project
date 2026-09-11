import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appUrl, appUrlProblem, isLocalAppUrl } from '../app-url'

const ORIGINAL_URL = process.env.NEXT_PUBLIC_APP_URL
const ORIGINAL_ENV = process.env.NODE_ENV

function setEnv(url: string | undefined, nodeEnv: string) {
  if (url === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = url
  // NODE_ENV is readonly in the Next types but writable at runtime; the cast
  // keeps the test honest rather than mocking the module under test.
  ;(process.env as Record<string, string>).NODE_ENV = nodeEnv
}

beforeEach(() => setEnv(ORIGINAL_URL, ORIGINAL_ENV ?? 'test'))
afterEach(() => setEnv(ORIGINAL_URL, ORIGINAL_ENV ?? 'test'))

describe('appUrl', () => {
  it('strips trailing slashes so links do not double up', () => {
    setEnv('https://projects.vektracorp.in/', 'production')
    expect(appUrl()).toBe('https://projects.vektracorp.in')
  })

  it('strips several trailing slashes', () => {
    setEnv('https://projects.vektracorp.in///', 'production')
    expect(appUrl()).toBe('https://projects.vektracorp.in')
  })

  it('is empty when unset, rather than guessing', () => {
    setEnv(undefined, 'production')
    expect(appUrl()).toBe('')
  })
})

describe('isLocalAppUrl', () => {
  it('treats localhost as unreachable by anyone else', () => {
    expect(isLocalAppUrl('http://localhost:3000')).toBe(true)
  })

  it('treats the loopback addresses as unreachable', () => {
    expect(isLocalAppUrl('http://127.0.0.1:3000')).toBe(true)
  })

  it('accepts a real origin', () => {
    expect(isLocalAppUrl('https://projects.vektracorp.in')).toBe(false)
  })

  it('treats an empty or unparseable value as unreachable', () => {
    expect(isLocalAppUrl('')).toBe(true)
    expect(isLocalAppUrl('not a url')).toBe(true)
  })

  it('does not mistake a hostname that merely contains localhost', () => {
    expect(isLocalAppUrl('https://localhost.example.com')).toBe(false)
  })
})

describe('appUrlProblem', () => {
  it('stays silent in development, where localhost is correct', () => {
    setEnv('http://localhost:3000', 'development')
    expect(appUrlProblem()).toBeNull()
  })

  it('reports a localhost origin in production', () => {
    setEnv('http://localhost:3000', 'production')
    expect(appUrlProblem()).toMatch(/only works on the server itself/)
  })

  it('reports an unset origin in production', () => {
    setEnv(undefined, 'production')
    expect(appUrlProblem()).toMatch(/is not set/)
  })

  it('is satisfied by a real production origin', () => {
    setEnv('https://projects.vektracorp.in', 'production')
    expect(appUrlProblem()).toBeNull()
  })
})
