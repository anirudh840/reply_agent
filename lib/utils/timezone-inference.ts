/**
 * Infer a lead's timezone from phone area codes found in their metadata or conversation.
 * Covers major US/Canada area codes + international indicators.
 */

// Major US area codes mapped to IANA timezones
const US_AREA_CODE_TZ: Record<string, string> = {
  // Eastern (ET)
  '201': 'America/New_York', '202': 'America/New_York', '203': 'America/New_York',
  '207': 'America/New_York', '212': 'America/New_York', '215': 'America/New_York',
  '216': 'America/New_York', '217': 'America/Chicago', '234': 'America/New_York',
  '239': 'America/New_York', '240': 'America/New_York', '248': 'America/New_York',
  '252': 'America/New_York', '267': 'America/New_York', '272': 'America/New_York',
  '301': 'America/New_York', '302': 'America/New_York', '304': 'America/New_York',
  '305': 'America/New_York', '310': 'America/Los_Angeles', '312': 'America/Chicago',
  '313': 'America/New_York', '314': 'America/Chicago', '315': 'America/New_York',
  '316': 'America/Chicago', '317': 'America/New_York', '318': 'America/Chicago',
  '319': 'America/Chicago', '320': 'America/Chicago', '321': 'America/New_York',
  '323': 'America/Los_Angeles', '325': 'America/Chicago', '330': 'America/New_York',
  '331': 'America/Chicago', '334': 'America/Chicago', '336': 'America/New_York',
  '337': 'America/Chicago', '339': 'America/New_York', '346': 'America/Chicago',
  '347': 'America/New_York', '351': 'America/New_York', '352': 'America/New_York',
  '360': 'America/Los_Angeles', '361': 'America/Chicago',
  '401': 'America/New_York', '402': 'America/Chicago', '404': 'America/New_York',
  '405': 'America/Chicago', '407': 'America/New_York', '408': 'America/Los_Angeles',
  '409': 'America/Chicago', '410': 'America/New_York', '412': 'America/New_York',
  '413': 'America/New_York', '414': 'America/Chicago', '415': 'America/Los_Angeles',
  '417': 'America/Chicago', '419': 'America/New_York', '423': 'America/New_York',
  '424': 'America/Los_Angeles', '425': 'America/Los_Angeles',
  '430': 'America/Chicago', '432': 'America/Chicago', '434': 'America/New_York',
  '440': 'America/New_York', '442': 'America/Los_Angeles', '443': 'America/New_York',
  '469': 'America/Chicago', '470': 'America/New_York', '475': 'America/New_York',
  '478': 'America/New_York', '479': 'America/Chicago', '480': 'America/Phoenix',
  '484': 'America/New_York',
  '501': 'America/Chicago', '502': 'America/New_York', '503': 'America/Los_Angeles',
  '504': 'America/Chicago', '505': 'America/Denver', '507': 'America/Chicago',
  '508': 'America/New_York', '509': 'America/Los_Angeles', '510': 'America/Los_Angeles',
  '512': 'America/Chicago', '513': 'America/New_York', '515': 'America/Chicago',
  '516': 'America/New_York', '517': 'America/New_York', '518': 'America/New_York',
  '520': 'America/Phoenix', '530': 'America/Los_Angeles', '531': 'America/Chicago',
  '540': 'America/New_York', '541': 'America/Los_Angeles', '551': 'America/New_York',
  '559': 'America/Los_Angeles', '561': 'America/New_York', '562': 'America/Los_Angeles',
  '563': 'America/Chicago', '567': 'America/New_York', '571': 'America/New_York',
  '573': 'America/Chicago', '574': 'America/New_York', '580': 'America/Chicago',
  '585': 'America/New_York', '586': 'America/New_York',
  '601': 'America/Chicago', '602': 'America/Phoenix', '603': 'America/New_York',
  '605': 'America/Chicago', '606': 'America/New_York', '607': 'America/New_York',
  '608': 'America/Chicago', '609': 'America/New_York', '610': 'America/New_York',
  '612': 'America/Chicago', '614': 'America/New_York', '615': 'America/Chicago',
  '616': 'America/New_York', '617': 'America/New_York', '618': 'America/Chicago',
  '619': 'America/Los_Angeles', '620': 'America/Chicago', '623': 'America/Phoenix',
  '626': 'America/Los_Angeles', '628': 'America/Los_Angeles', '629': 'America/Chicago',
  '630': 'America/Chicago', '631': 'America/New_York', '636': 'America/Chicago',
  '646': 'America/New_York', '650': 'America/Los_Angeles', '651': 'America/Chicago',
  '657': 'America/Los_Angeles', '660': 'America/Chicago',
  '678': 'America/New_York', '681': 'America/New_York',
  '701': 'America/Chicago', '702': 'America/Los_Angeles', '703': 'America/New_York',
  '704': 'America/New_York', '706': 'America/New_York', '707': 'America/Los_Angeles',
  '708': 'America/Chicago', '712': 'America/Chicago', '713': 'America/Chicago',
  '714': 'America/Los_Angeles', '715': 'America/Chicago', '716': 'America/New_York',
  '717': 'America/New_York', '718': 'America/New_York', '719': 'America/Denver',
  '720': 'America/Denver', '724': 'America/New_York', '725': 'America/Los_Angeles',
  '727': 'America/New_York', '731': 'America/Chicago', '732': 'America/New_York',
  '734': 'America/New_York', '737': 'America/Chicago', '740': 'America/New_York',
  '747': 'America/Los_Angeles', '754': 'America/New_York', '757': 'America/New_York',
  '760': 'America/Los_Angeles', '762': 'America/New_York', '763': 'America/Chicago',
  '765': 'America/New_York', '770': 'America/New_York', '772': 'America/New_York',
  '773': 'America/Chicago', '774': 'America/New_York', '775': 'America/Los_Angeles',
  '779': 'America/Chicago',
  '801': 'America/Denver', '802': 'America/New_York', '803': 'America/New_York',
  '804': 'America/New_York', '805': 'America/Los_Angeles', '806': 'America/Chicago',
  '808': 'Pacific/Honolulu', '810': 'America/New_York', '812': 'America/New_York',
  '813': 'America/New_York', '814': 'America/New_York', '815': 'America/Chicago',
  '816': 'America/Chicago', '817': 'America/Chicago', '818': 'America/Los_Angeles',
  '828': 'America/New_York', '830': 'America/Chicago', '831': 'America/Los_Angeles',
  '832': 'America/Chicago', '843': 'America/New_York', '845': 'America/New_York',
  '847': 'America/Chicago', '848': 'America/New_York', '850': 'America/Chicago',
  '856': 'America/New_York', '857': 'America/New_York', '858': 'America/Los_Angeles',
  '859': 'America/New_York', '860': 'America/New_York', '862': 'America/New_York',
  '863': 'America/New_York', '864': 'America/New_York',
  '901': 'America/Chicago', '903': 'America/Chicago', '904': 'America/New_York',
  '906': 'America/New_York', '907': 'America/Anchorage', '908': 'America/New_York',
  '909': 'America/Los_Angeles', '910': 'America/New_York', '912': 'America/New_York',
  '913': 'America/Chicago', '914': 'America/New_York', '915': 'America/Denver',
  '916': 'America/Los_Angeles', '917': 'America/New_York', '918': 'America/Chicago',
  '919': 'America/New_York', '920': 'America/Chicago', '925': 'America/Los_Angeles',
  '928': 'America/Phoenix', '929': 'America/New_York', '931': 'America/Chicago',
  '936': 'America/Chicago', '937': 'America/New_York', '940': 'America/Chicago',
  '941': 'America/New_York', '947': 'America/New_York', '949': 'America/Los_Angeles',
  '951': 'America/Los_Angeles', '952': 'America/Chicago', '954': 'America/New_York',
  '956': 'America/Chicago', '959': 'America/New_York', '970': 'America/Denver',
  '971': 'America/Los_Angeles', '972': 'America/Chicago', '973': 'America/New_York',
  '978': 'America/New_York', '979': 'America/Chicago', '980': 'America/New_York',
  '984': 'America/New_York', '985': 'America/Chicago',
};

// Short timezone labels for display
const TZ_SHORT_LABELS: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'America/Phoenix': 'AZ (MST)',
  'America/Anchorage': 'AK',
  'Pacific/Honolulu': 'HI',
};

/**
 * Extract phone numbers from text. Returns array of cleaned digit strings.
 */
function extractPhoneNumbers(text: string): string[] {
  // Match common phone formats: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, +1xxxxxxxxxx
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const matches: string[] = [];
  let match;
  while ((match = phoneRegex.exec(text)) !== null) {
    matches.push(match[1]); // Capture area code
  }
  return matches;
}

/**
 * Infer timezone from an area code.
 */
function areaCodeToTimezone(areaCode: string): string | null {
  return US_AREA_CODE_TZ[areaCode] || null;
}

export interface InferredTimezone {
  timezone: string;      // IANA timezone, e.g. "America/Chicago"
  shortLabel: string;    // e.g. "CT"
  source: string;        // How it was inferred, e.g. "phone: 817"
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Infer a lead's timezone from all available data.
 * Checks: lead_metadata, conversation thread content.
 */
export function inferLeadTimezone(params: {
  leadMetadata?: Record<string, any>;
  conversationContent?: string;
}): InferredTimezone | null {
  const { leadMetadata, conversationContent } = params;

  // Source 1: Phone number in lead_metadata (custom_variables or direct fields)
  if (leadMetadata) {
    const metaStr = JSON.stringify(leadMetadata);
    const areaCodes = extractPhoneNumbers(metaStr);
    for (const code of areaCodes) {
      const tz = areaCodeToTimezone(code);
      if (tz) {
        return {
          timezone: tz,
          shortLabel: TZ_SHORT_LABELS[tz] || tz,
          source: `phone: ${code}`,
          confidence: 'high',
        };
      }
    }
  }

  // Source 2: Phone number in conversation content (email signatures)
  if (conversationContent) {
    const areaCodes = extractPhoneNumbers(conversationContent);
    for (const code of areaCodes) {
      const tz = areaCodeToTimezone(code);
      if (tz) {
        return {
          timezone: tz,
          shortLabel: TZ_SHORT_LABELS[tz] || tz,
          source: `phone: ${code}`,
          confidence: 'medium',
        };
      }
    }
  }

  return null;
}
