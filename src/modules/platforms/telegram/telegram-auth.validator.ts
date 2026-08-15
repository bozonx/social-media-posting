import { Injectable } from '@nestjs/common';
import { IAuthValidator } from '../base/auth-validator.interface.js';

/**
 * Telegram-specific auth validator
 * Validates apiKey presence and format
 */
@Injectable()
export class TelegramAuthValidator implements IAuthValidator {
  readonly providerName = 'telegram';

  /**
   * Validate Telegram auth object
   * @param auth - Auth object with apiKey
   * @returns Array of error messages (empty if valid)
   */
  validate(auth: Record<string, any>): string[] {
    const errors: string[] = [];

    if (!auth) {
      errors.push('Auth object is required for Telegram');
      return errors;
    }

    // Validate apiKey
    if (!auth.apiKey) {
      errors.push("Field 'apiKey' is required for Telegram auth");
    } else if (typeof auth.apiKey !== 'string') {
      errors.push("Field 'apiKey' must be a string");
    } else if (!this.isValidBotToken(auth.apiKey)) {
      errors.push("Field 'apiKey' has invalid format (expected: 123456789:ABC-DEF...)");
    }

    return errors;
  }

  /**
   * Check if apiKey (bot token) has valid format
   * Telegram bot tokens have format: 123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
   */
  private isValidBotToken(token: string): boolean {
    // Basic format check: number:alphanumeric-string
    const tokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
    return tokenRegex.test(token);
  }
}
