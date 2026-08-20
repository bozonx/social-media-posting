import { describe, expect, it } from 'vitest';
import { ValidationError } from '@bozonx/social-posting';
import { toTelegramInput } from '../src/telegram-media.js';

describe('toTelegramInput', () => {
  it('returns the file_id when source is a platform reference', () => {
    expect(toTelegramInput({ source: { kind: 'platformRef', ref: 'AgACAgIAAxkBAAIC...' } })).toBe(
      'AgACAgIAAxkBAAIC...',
    );
  });

  it('returns the URL when source is a URL', () => {
    expect(toTelegramInput({ source: { kind: 'url', url: 'https://example.com/image.jpg' } })).toBe(
      'https://example.com/image.jpg',
    );
  });

  it('trims a URL source', () => {
    expect(
      toTelegramInput({ source: { kind: 'url', url: '  https://example.com/image.jpg  ' } }),
    ).toBe('https://example.com/image.jpg');
  });

  it('trims a file_id platformRef', () => {
    expect(
      toTelegramInput({ source: { kind: 'platformRef', ref: '  AgACAgIAAxkBAAIC...  ' } }),
    ).toBe('AgACAgIAAxkBAAIC...');
  });

  it('rejects a malformed value that looks like a URL', () => {
    expect(() =>
      toTelegramInput({ source: { kind: 'url', url: 'https://example.com/\nimage.jpg' } }),
    ).toThrow(ValidationError);
  });

  it('rejects an input without source', () => {
    expect(() => toTelegramInput({} as never)).toThrow(ValidationError);
  });
});
