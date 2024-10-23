// Define types for header handling
type EmailHeader = string;
type HeaderName = string;
type EmailHeaders = Record<string, EmailHeader>;

const DECODABLE_HEADERS: ReadonlySet<string> = new Set([
  'subject',
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'comments',
  'keywords',
  'organization',
  'content-description',
  'display-name',
]);

/**
 * Decodes a quoted-printable string
 * @param input - The quoted-printable encoded string
 */
function decodeQuotedPrintable(input: string): string {
  return input.replace(/=([0-9A-F]{2})/gi, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
}

/**
 * Decodes a MIME encoded header string
 * @param header - The header value to decode
 * @param headerName - Optional header name for selective decoding
 * @returns The decoded header string
 */
function decodeMIMEHeader(header: EmailHeader, headerName?: HeaderName): string {
  // Early return if headerName is provided and not in decodable list
  if (headerName && !DECODABLE_HEADERS.has(headerName.toLowerCase())) {
    return header;
  }

  // Regular expression to match MIME encoded-word syntax
  const encodedWordRegex = /=\?UTF-8\?([QB])\?(.*?)\?=/gi;

  return header.replace(encodedWordRegex, (match, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'Q') {
        // Handle Q-encoded text (quoted-printable)
        const decoded = decodeQuotedPrintable(text.replace(/_/g, ' '));
        return new TextDecoder('utf-8').decode(
          new Uint8Array([...decoded].map(c => c.charCodeAt(0)))
        );
      } else if (encoding.toUpperCase() === 'B') {
        // Handle Base64 encoded text
        const decoded = atob(text.replace(/[^\w+\/=]/g, ''));
        return new TextDecoder('utf-8').decode(
          new Uint8Array([...decoded].map(c => c.charCodeAt(0)))
        );
      }
    } catch (error) {
      console.error('Error decoding MIME header:', error);
      return match; // Return original text if decoding fails
    }
    return match;
  });
}

/**
 * Processes all headers in an object, decoding only the safe ones
 * @param headers - Object containing email headers
 * @returns Object with processed headers
 */
export function processHeaders(headers: EmailHeaders): EmailHeaders {
  return Object.entries(headers).reduce<EmailHeaders>((acc, [name, value]) => {
    acc[name] = decodeMIMEHeader(value, name);
    return acc;
  }, {});
}
