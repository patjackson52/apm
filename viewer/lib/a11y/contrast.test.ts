import { describe, it, expect } from 'vitest';
import { relativeLuminance, contrastRatio } from './contrast';

describe('contrast', () => {
  it('luminance of white is 1, black is 0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
  it('is symmetric (order independent)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });
  it('identical colors are 1:1', () => {
    expect(contrastRatio('#3b66f5', '#3b66f5')).toBeCloseTo(1, 5);
  });
  it('accepts 3-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
  });
  it('throws on non-hex input', () => {
    expect(() => relativeLuminance('rgb(0,0,0)')).toThrow();
    expect(() => relativeLuminance('#12345')).toThrow();
  });
});
