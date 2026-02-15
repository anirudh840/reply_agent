import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility function to merge Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sleep utility for delays
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Format date to readable string
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/**
 * Safely parse a date string that might be ISO or human-readable
 * (e.g., "Sat, Feb 14, 2026 at 11:52 AM" from email quote headers).
 * Returns null if the date cannot be parsed.
 */
export function safeParseDate(date: string | Date): Date | null {
  if (date instanceof Date) return isNaN(date.getTime()) ? null : date;
  if (!date) return null;

  // Try native parsing first (works for ISO strings)
  const d = new Date(date);
  if (!isNaN(d.getTime())) return d;

  // Try parsing "Fri, Feb 14, 2026 at 5:54 PM" style from email headers
  const emailDateMatch = date.match(
    /(\w+,\s+)?(\w+)\s+(\d+),?\s+(\d{4})\s+at\s+(\d+):(\d+)\s*(AM|PM)?/i
  );
  if (emailDateMatch) {
    const [, , month, day, year, hour, minute, ampm] = emailDateMatch;
    const dateStr = `${month} ${day}, ${year} ${hour}:${minute} ${ampm || ''}`.trim();
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

/**
 * Format a date safely — returns formatted string or the raw input if unparseable.
 */
export function safeFormatDate(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const parsed = safeParseDate(date);
  if (!parsed) return typeof date === 'string' ? date : 'Unknown date';
  return new Intl.DateTimeFormat('en-US', options || {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

/**
 * Format date to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const d = safeParseDate(date);
  if (!d) return typeof date === 'string' ? date : 'Unknown';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(d);
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Calculate confidence score color
 */
export function getConfidenceColor(score: number): string {
  if (score >= 8) return 'text-green-600';
  if (score >= 6) return 'text-yellow-600';
  return 'text-red-600';
}

/**
 * Calculate confidence score badge variant
 */
export function getConfidenceBadgeVariant(
  score: number
): 'default' | 'secondary' | 'destructive' {
  if (score >= 8) return 'default';
  if (score >= 6) return 'secondary';
  return 'destructive';
}

/**
 * Exponential backoff calculator
 */
export function calculateBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * 0.3 * exponential;
  return exponential + jitter;
}

/**
 * Retry wrapper with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseMs: number = 1000,
  maxMs: number = 30000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on client errors (4xx)
      if (error instanceof Error && 'statusCode' in error) {
        const statusCode = (error as any).statusCode;
        if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
          throw error;
        }
      }

      if (attempt < maxRetries - 1) {
        const backoffMs = calculateBackoff(attempt, baseMs, maxMs);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError!;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Extract domain from email
 */
export function extractDomain(email: string): string {
  return email.split('@')[1] || '';
}

/**
 * Generate a random ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Parse JSON safely
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Chunk array into smaller arrays
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Remove HTML tags from string
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Encrypt sensitive data (simple base64 for now - use proper encryption in production)
 */
export function encrypt(text: string): string {
  // TODO: Implement proper encryption with a key
  return Buffer.from(text).toString('base64');
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encrypted: string): string {
  // TODO: Implement proper decryption with a key
  return Buffer.from(encrypted, 'base64').toString('utf-8');
}

/**
 * Calculate percentage
 */
export function calculatePercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

/**
 * Format number with commas
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, waitMs);
  };
}

/**
 * Deep clone object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
