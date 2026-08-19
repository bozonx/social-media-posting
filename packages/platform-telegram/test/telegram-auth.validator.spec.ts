import { describe, expect, it } from 'vitest';
import { TelegramAuthValidator } from '../src/telegram-auth.validator.js';

describe('TelegramAuthValidator', () => {
  const validator = new TelegramAuthValidator();

  it('has providerName "telegram"', () => {
    expect(validator.providerName).toBe('telegram');
  });

  it('accepts a valid Telegram bot token', () => {
    const result = validator.validate({
      apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    });

    expect(result.errors).toEqual([]);
  });

  it('rejects missing or empty apiKey', () => {
    expect(validator.validate({}).errors).toContain("Field 'apiKey' is required for Telegram auth");
    expect(validator.validate({ apiKey: '' }).errors).toContain(
      "Field 'apiKey' is required for Telegram auth",
    );
  });

  it('rejects non-string apiKey', () => {
    expect(validator.validate({ apiKey: 123456 as never }).errors).toContain(
      "Field 'apiKey' must be a string",
    );
    expect(validator.validate({ apiKey: true as never }).errors).toContain(
      "Field 'apiKey' must be a string",
    );
  });

  it('rejects invalid bot token formats', () => {
    // Missing colon
    expect(validator.validate({ apiKey: '123456789ABCDEF' }).errors).toContain(
      "Field 'apiKey' has invalid format (expected: 123456789:ABC-DEF...)",
    );

    // Non-numeric prefix before colon
    expect(validator.validate({ apiKey: 'bot123456789:ABCDEF' }).errors).toContain(
      "Field 'apiKey' has invalid format (expected: 123456789:ABC-DEF...)",
    );

    // Invalid characters in secret part
    expect(validator.validate({ apiKey: '123456789:ABC DEF!' }).errors).toContain(
      "Field 'apiKey' has invalid format (expected: 123456789:ABC-DEF...)",
    );
  });
});
