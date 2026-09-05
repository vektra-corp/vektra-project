import { describe, expect, it } from 'vitest'
import { checkSniffedType, sniffMimeType } from '../utils/magic-bytes'

const bytes = (...values: number[]) => new Uint8Array(values)
const fromAscii = (text: string, ...rest: number[]) =>
  new Uint8Array([...[...text].map((c) => c.charCodeAt(0)), ...rest])

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)
const PDF = fromAscii('%PDF-1.7')
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)
const WEBP = fromAscii('RIFF    WEBPVP8 ')
const WAV = fromAscii('RIFF    WAVEfmt ')
const EXE = fromAscii('MZ ')
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01)
const SHELL = fromAscii('#!/bin/sh')
const TEXT = fromAscii('name,status')

describe('sniffMimeType', () => {
  it('identifies the common image formats', () => {
    expect(sniffMimeType(PNG)).toBe('image/png')
    expect(sniffMimeType(JPEG)).toBe('image/jpeg')
    expect(sniffMimeType(fromAscii('GIF89a'))).toBe('image/gif')
    expect(sniffMimeType(WEBP)).toBe('image/webp')
  })

  it('tells RIFF containers apart by their subtype', () => {
    // Both start "RIFF"; only the bytes at offset 8 separate them.
    expect(sniffMimeType(WEBP)).toBe('image/webp')
    expect(sniffMimeType(WAV)).toBe('audio/wav')
  })

  it('identifies documents and archives', () => {
    expect(sniffMimeType(PDF)).toBe('application/pdf')
    expect(sniffMimeType(ZIP)).toBe('application/zip')
  })

  it('identifies executables so they can be named in a rejection', () => {
    expect(sniffMimeType(EXE)).toBe('application/x-msdownload')
    expect(sniffMimeType(ELF)).toBe('application/x-elf')
    expect(sniffMimeType(SHELL)).toBe('application/x-shellscript')
  })

  it('returns null for content it does not recognise', () => {
    expect(sniffMimeType(TEXT)).toBeNull()
    expect(sniffMimeType(bytes())).toBeNull()
    expect(sniffMimeType(bytes(0x00, 0x01))).toBeNull()
  })

  it('does not match a signature longer than the data', () => {
    // A truncated PNG header must not read past the end of the buffer.
    expect(sniffMimeType(bytes(0x89, 0x50))).toBeNull()
  })
})

describe('checkSniffedType', () => {
  it('accepts a file that is what it says it is', () => {
    expect(checkSniffedType(PNG, 'image/png', 'png')).toEqual({ ok: true, mime: 'image/png' })
    expect(checkSniffedType(PDF, 'application/pdf', 'pdf')).toEqual({
      ok: true,
      mime: 'application/pdf',
    })
  })

  it('refuses an executable renamed as an image', () => {
    // The case the whole check exists for.
    const verdict = checkSniffedType(EXE, 'image/png', 'png')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/executable/i)
  })

  it('refuses a shell script whatever it claims', () => {
    expect(checkSniffedType(SHELL, 'text/plain', 'txt').ok).toBe(false)
    expect(checkSniffedType(ELF, 'application/pdf', 'pdf').ok).toBe(false)
  })

  it('refuses a PDF declared as an image', () => {
    const verdict = checkSniffedType(PDF, 'image/png', 'png')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/does not match/i)
  })

  it('stores the truth when the subtype is merely wrong', () => {
    // A JPEG uploaded as image/png is a harmless client mistake, but the stored
    // type should be what it actually is.
    expect(checkSniffedType(JPEG, 'image/png', 'png')).toEqual({ ok: true, mime: 'image/jpeg' })
  })

  it('lets a zip present as any zip-backed Office format', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    expect(checkSniffedType(ZIP, docx, 'docx')).toEqual({ ok: true, mime: docx })
    expect(checkSniffedType(ZIP, 'application/zip', 'zip')).toEqual({
      ok: true,
      mime: 'application/zip',
    })
  })

  it('refuses a zip claiming to be a PDF', () => {
    expect(checkSniffedType(ZIP, 'application/pdf', 'pdf').ok).toBe(false)
  })

  it('accepts genuine text, which has no signature', () => {
    expect(checkSniffedType(TEXT, 'text/csv', 'csv')).toEqual({ ok: true, mime: 'text/csv' })
    expect(checkSniffedType(TEXT, 'application/octet-stream', 'txt')).toEqual({
      ok: true,
      mime: 'text/plain',
    })
  })

  it('refuses binary content wearing a .txt extension', () => {
    // Unrecognised AND containing NUL: not text, not anything known.
    const binary = bytes(0x01, 0x02, 0x00, 0x03, 0x04)
    expect(checkSniffedType(binary, 'text/plain', 'txt').ok).toBe(false)
  })

  it('fails closed on anything it cannot identify', () => {
    const unknown = bytes(0x11, 0x22, 0x33, 0x44, 0x55)
    const verdict = checkSniffedType(unknown, 'image/png', 'png')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/could not be identified/i)
  })

  it('refuses an empty file', () => {
    expect(checkSniffedType(bytes(), 'image/png', 'png').ok).toBe(false)
  })
})
