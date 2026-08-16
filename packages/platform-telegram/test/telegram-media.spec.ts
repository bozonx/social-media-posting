import { describe, expect, it } from 'vitest';
import { ValidationError } from '@bozonx/social-posting';
import { toTelegramInput } from '../src/telegram-media.js';

describe('toTelegramInput', () => {
  it('returns the file_id when src is a platform reference', () => {
    expect(toTelegramInput({ src: 'AgACAgIAAxkBAAIC...' })).toBe('AgACAgIAAxkBAAIC...');
  });

  it('returns the URL when src is a URL', () => {
    expect(toTelegramInput({ src: 'https://example.com/image.jpg' })).toBe(
      'https://example.com/image.jpg',
    );
  });

  it('trims a URL src', () => {
    expect(toTelegramInput({ src: '  https://example.com/image.jpg  ' })).toBe(
      'https://example.com/image.jpg',
    );
  });

  it('trims a file_id src', () => {
    expect(toTelegramInput({ src: '  AgACAgIAAxkBAAIC...  ' })).toBe('AgACAgIAAxkBAAIC...');
  });

  it('rejects a malformed value that looks like a URL', () => {
    expect(() => toTelegramInput({ src: 'https://example.com/\nimage.jpg' })).toThrow(
      ValidationError,
    );
  });

  it('rejects an input without src', () => {
    expect(() => toTelegramInput({} as never)).toThrow(ValidationError);
  });
});
