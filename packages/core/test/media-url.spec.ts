import { describe, it, expect } from 'vitest';
import { validateMediaUrl, validateMediaUrls } from '../src/media/media-url.js';
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

  describe('validateMediaUrls', () => {
    it('should validate all URLs in array', () => {
      const urls = [
        'https://example.com/image1.jpg',
        'https://example.com/image2.jpg',
        'https://example.com/image3.jpg',
      ];

      expect(() => {
        validateMediaUrls(urls);
      }).not.toThrow();
    });

    it('should accept empty array', () => {
      expect(() => {
        validateMediaUrls([]);
      }).not.toThrow();
    });

    it('should throw on first invalid URL', () => {
      const urls = [
        'https://example.com/image1.jpg',
        'ftp://example.com/file.txt',
        'https://example.com/image3.jpg',
      ];

      expect(() => {
        validateMediaUrls(urls);
      }).toThrow(ValidationError);
      expect(() => {
        validateMediaUrls(urls);
      }).toThrow('Invalid media URL protocol: ftp:');
    });

    it('should throw on malformed URL in array', () => {
      const urls = [
        'https://example.com/image1.jpg',
        'not-a-url',
        'https://example.com/image3.jpg',
      ];

      expect(() => {
        validateMediaUrls(urls);
      }).toThrow(ValidationError);
      expect(() => {
        validateMediaUrls(urls);
      }).toThrow('Invalid media URL format');
    });

    it('should handle array with empty strings', () => {
      const urls = ['https://example.com/image1.jpg', '', 'https://example.com/image3.jpg'];

      expect(() => {
        validateMediaUrls(urls);
      }).not.toThrow();
    });

    it('should validate multiple URLs with different formats', () => {
      const urls = [
        'http://example.com/image1.jpg',
        'https://cdn.example.com:443/image2.png?v=123',
        'https://example.com/videos/video.mp4#start=10',
      ];

      expect(() => {
        validateMediaUrls(urls);
      }).not.toThrow();
    });
  });
});
