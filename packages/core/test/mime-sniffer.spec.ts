import { describe, expect, it } from 'vitest';
import { SNIFF_BYTES, mediaKindOf, sniffMimeType } from '../src/media/mime-sniffer.js';

describe('mime-sniffer', () => {
  it('exports SNIFF_BYTES constant as 16', () => {
    expect(SNIFF_BYTES).toBe(16);
  });

  describe('sniffMimeType', () => {
    it('recognises JPEG magic bytes', () => {
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(sniffMimeType(jpeg)).toBe('image/jpeg');
    });

    it('recognises PNG magic bytes', () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(sniffMimeType(png)).toBe('image/png');
    });

    it('recognises GIF magic bytes', () => {
      const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(sniffMimeType(gif)).toBe('image/gif');
    });

    it('recognises WebP magic bytes with RIFF header and WEBP chunk', () => {
      const webp = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // 'RIFF'
        0x20,
        0x00,
        0x00,
        0x00, // file size (wildcard bytes)
        0x57,
        0x45,
        0x42,
        0x50, // 'WEBP'
      ]);
      expect(sniffMimeType(webp)).toBe('image/webp');
    });

    it('recognises MP4 with ftyp at offset 4', () => {
      const mp4 = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x18, // size
        0x66,
        0x74,
        0x79,
        0x70, // 'ftyp'
        0x69,
        0x73,
        0x6f,
        0x6d, // 'isom'
      ]);
      expect(sniffMimeType(mp4)).toBe('video/mp4');
    });

    it('recognises WebM magic bytes', () => {
      const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
      expect(sniffMimeType(webm)).toBe('video/webm');
    });

    it('recognises MP3 with ID3 header tag', () => {
      const mp3Id3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
      expect(sniffMimeType(mp3Id3)).toBe('audio/mpeg');
    });

    it('recognises MP3 sync frame (0xff 0xfb)', () => {
      const mp3Sync = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
      expect(sniffMimeType(mp3Sync)).toBe('audio/mpeg');
    });

    it('recognises OGG audio/stream container (OggS)', () => {
      const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
      expect(sniffMimeType(ogg)).toBe('audio/ogg');
    });

    it('recognises WAV audio with RIFF header and WAVE chunk', () => {
      const wav = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // 'RIFF'
        0x24,
        0x08,
        0x00,
        0x00, // file size (wildcard bytes)
        0x57,
        0x41,
        0x56,
        0x45, // 'WAVE'
      ]);
      expect(sniffMimeType(wav)).toBe('audio/wav');
    });

    it('recognises PDF header (%PDF)', () => {
      const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
      expect(sniffMimeType(pdf)).toBe('application/pdf');
    });

    it('returns undefined when byte array is too short for any signature', () => {
      const tiny = new Uint8Array([0x52]);
      expect(sniffMimeType(tiny)).toBeUndefined();
    });

    it('returns undefined when byte array is empty', () => {
      expect(sniffMimeType(new Uint8Array([]))).toBeUndefined();
    });

    it('returns undefined for unknown binary formats', () => {
      const unknown = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
      expect(sniffMimeType(unknown)).toBeUndefined();
    });
  });

  describe('mediaKindOf', () => {
    it('classifies image MIME types as image', () => {
      expect(mediaKindOf('image/jpeg')).toBe('image');
      expect(mediaKindOf('image/png')).toBe('image');
      expect(mediaKindOf('image/gif')).toBe('image');
      expect(mediaKindOf('image/webp')).toBe('image');
      expect(mediaKindOf('image/svg+xml')).toBe('image');
    });

    it('classifies video MIME types as video', () => {
      expect(mediaKindOf('video/mp4')).toBe('video');
      expect(mediaKindOf('video/webm')).toBe('video');
      expect(mediaKindOf('video/quicktime')).toBe('video');
    });

    it('classifies audio MIME types as audio', () => {
      expect(mediaKindOf('audio/mpeg')).toBe('audio');
      expect(mediaKindOf('audio/ogg')).toBe('audio');
      expect(mediaKindOf('audio/wav')).toBe('audio');
    });

    it('classifies unknown, text, application, or undefined as document', () => {
      expect(mediaKindOf('application/pdf')).toBe('document');
      expect(mediaKindOf('application/zip')).toBe('document');
      expect(mediaKindOf('text/plain')).toBe('document');
      expect(mediaKindOf(undefined)).toBe('document');
      expect(mediaKindOf('')).toBe('document');
    });
  });
});
