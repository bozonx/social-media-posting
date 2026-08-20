import { describe, it, expect } from 'vitest';
import { validateMediaUrl } from '../src/media/media-url.js';
import { ValidationError } from '../src/errors/posting-error.js';

describe('media URL validation', () => {
  describe('validateMediaUrl', () => {
    it('should accept valid HTTP URL', () => {
      expect(() => {
        validateMediaUrl('http://example.com/image.jpg');
      }).not.toThrow();
    });

    it('should accept valid HTTPS URL', () => {
      expect(() => {
        validateMediaUrl('https://example.com/image.jpg');
      }).not.toThrow();
    });

    it('should accept URL with query parameters', () => {
      expect(() => {
        validateMediaUrl('https://example.com/image.jpg?size=large&quality=high');
      }).not.toThrow();
    });

    it('should accept URL with port', () => {
      expect(() => {
        validateMediaUrl('https://example.com:8080/image.jpg');
      }).not.toThrow();
    });

    it('should accept URL with hash', () => {
      expect(() => {
        validateMediaUrl('https://example.com/image.jpg#section');
      }).not.toThrow();
    });

    it('should accept empty string without throwing', () => {
      expect(() => {
        validateMediaUrl('');
      }).not.toThrow();
    });

    it('should reject FTP protocol', () => {
      expect(() => {
        validateMediaUrl('ftp://example.com/file.txt');
      }).toThrow(ValidationError);
      expect(() => {
        validateMediaUrl('ftp://example.com/file.txt');
      }).toThrow('Invalid media URL protocol: ftp:');
    });

    it('should reject file protocol', () => {
      expect(() => {
        validateMediaUrl('file:///path/to/file.jpg');
      }).toThrow(ValidationError);
      expect(() => {
        validateMediaUrl('file:///path/to/file.jpg');
      }).toThrow('Invalid media URL protocol: file:');
    });

    it('should reject malformed URLs', () => {
      expect(() => {
        validateMediaUrl('not-a-url');
      }).toThrow(ValidationError);
      expect(() => {
        validateMediaUrl('not-a-url');
      }).toThrow('Invalid media URL format');
    });

    it('should reject invalid protocol schemes', () => {
      expect(() => {
        validateMediaUrl('javascript:alert("XSS")');
      }).toThrow(ValidationError);
    });

    it('should reject data URLs', () => {
      expect(() => {
        validateMediaUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA');
      }).toThrow(ValidationError);
    });
  });
});
