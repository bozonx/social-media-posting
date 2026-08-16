import { ValidationError } from '../errors/posting-error.js';

/**
 * Validate that a media URL is well-formed and uses http(s).
 * @param url - URL to validate. Empty values are ignored.
 * @throws ValidationError if the URL is malformed or uses another protocol.
 */
export function validateMediaUrl(url: string): void {
  if (!url) {
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new ValidationError(`Invalid media URL format: ${url}`, { cause: error });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ValidationError(
      `Invalid media URL protocol: ${parsedUrl.protocol}. Only HTTP and HTTPS are allowed.`,
    );
  }
}

/**
 * Validate several media URLs.
 * @param urls - URLs to validate.
 * @throws ValidationError on the first malformed URL.
 */
export function validateMediaUrls(urls: string[]): void {
  if (!urls || urls.length === 0) {
    return;
  }

  urls.forEach(url => validateMediaUrl(url));
}
