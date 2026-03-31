import { buildCalendlyPrefilledUrl } from '../booking';

describe('buildCalendlyPrefilledUrl', () => {
  it('appends name and email as query params', () => {
    const url = buildCalendlyPrefilledUrl(
      'https://calendly.com/d/abc-123/30min',
      'Tony Rey',
      'sales@totencarry.com',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('name')).toBe('Tony Rey');
    expect(parsed.searchParams.get('email')).toBe('sales@totencarry.com');
  });

  it('appends month and date when date is provided', () => {
    const url = buildCalendlyPrefilledUrl(
      'https://calendly.com/d/abc-123/30min',
      'Tony Rey',
      'sales@totencarry.com',
      '2026-04-02',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('month')).toBe('2026-04');
    expect(parsed.searchParams.get('date')).toBe('2026-04-02');
    expect(parsed.searchParams.get('name')).toBe('Tony Rey');
    expect(parsed.searchParams.get('email')).toBe('sales@totencarry.com');
  });

  it('handles URLs that already have query params', () => {
    const url = buildCalendlyPrefilledUrl(
      'https://calendly.com/d/abc-123/30min?utm_source=email',
      'John Doe',
      'john@example.com',
      '2026-04-15',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('utm_source')).toBe('email');
    expect(parsed.searchParams.get('name')).toBe('John Doe');
    expect(parsed.searchParams.get('email')).toBe('john@example.com');
    expect(parsed.searchParams.get('date')).toBe('2026-04-15');
  });

  it('omits date/month params when no date provided', () => {
    const url = buildCalendlyPrefilledUrl(
      'https://calendly.com/d/abc-123/30min',
      'Jane',
      'jane@test.com',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.has('month')).toBe(false);
    expect(parsed.searchParams.has('date')).toBe(false);
  });

  it('handles empty name/email gracefully', () => {
    const url = buildCalendlyPrefilledUrl(
      'https://calendly.com/d/abc-123/30min',
      '',
      '',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.has('name')).toBe(false);
    expect(parsed.searchParams.has('email')).toBe(false);
  });
});
