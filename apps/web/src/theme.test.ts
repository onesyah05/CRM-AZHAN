import { describe, expect, it } from 'vitest';
import { getBrandForeground } from './theme';

describe('getBrandForeground', () => {
  it('uses dark text for light tenant colors', () => {
    expect(getBrandForeground('#FAF2E8')).toBe('#18181B');
    expect(getBrandForeground('#FFD54F')).toBe('#18181B');
  });

  it('uses white text for dark tenant colors and invalid values', () => {
    expect(getBrandForeground('#744C25')).toBe('#FFFFFF');
    expect(getBrandForeground('not-a-color')).toBe('#FFFFFF');
  });
});
