import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeIndonesianPhone } from './phone.js';

describe('normalizeIndonesianPhone', () => {
  it.each([
    ['0812-3456-7890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['81234567890', '+6281234567890'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeIndonesianPhone(input)).toBe(expected);
  });

  it('returns an empty value for invalid input', () => {
    expect(normalizeIndonesianPhone('abc')).toBe('');
  });
});

describe('maskPhone', () => {
  it('masks the middle digits', () => {
    expect(maskPhone('081234567890')).toBe('+6281••••890');
  });
});
