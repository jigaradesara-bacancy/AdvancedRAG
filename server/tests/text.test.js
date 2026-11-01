import { describe, it, expect } from 'vitest';
import { splitSentences, extractNumbers, keywords } from '../src/utils/text.js';

describe('splitSentences', () => {
  it('does not split decimals or initials', () => {
    const s = splitSentences('Growth was 3.5 percent in FY 2018. The U.S. share rose. Staff visited 85 libraries.');
    expect(s).toHaveLength(3);
    expect(s[0]).toContain('3.5 percent');
  });
});

describe('extractNumbers', () => {
  it('normalises thousands separators', () => {
    expect(extractNumbers('1,234 libraries and 12.5% growth')).toEqual(['1234', '12.5']);
  });
});

describe('keywords', () => {
  it('drops stop words and keeps numbers', () => {
    expect(keywords('How many libraries did GPO visit in 2018?')).toEqual(['libraries', 'gpo', 'visit', '2018']);
  });
});
