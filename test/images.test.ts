import { describe, expect, it } from 'vitest';
import {
  libraryImagePath,
  imageOptionsFor,
  isAllowedImagePath,
  parseImageCount,
  imageLabelKey,
  buildImageLabelMap,
  type BreedForImages,
} from '../src/lib/images';

describe('libraryImagePath', () => {
  it('builds a lowercase, zero-padded path', () => {
    expect(libraryImagePath('QH', 3)).toBe('/horses/qh-03.webp');
    expect(libraryImagePath('NOK', 12)).toBe('/horses/nok-12.webp');
  });

  it('pads correctly at the boundaries', () => {
    expect(libraryImagePath('QH', 1)).toBe('/horses/qh-01.webp');
    expect(libraryImagePath('QH', 9)).toBe('/horses/qh-09.webp');
    expect(libraryImagePath('QH', 10)).toBe('/horses/qh-10.webp');
    expect(libraryImagePath('QH', 99)).toBe('/horses/qh-99.webp');
  });
});

describe('imageOptionsFor', () => {
  const breeds: BreedForImages[] = [
    { code: 'QH', name: 'Quarter Horse', image_count: 3 },
    { code: 'AR', name: 'Arabian', image_count: 2 },
    { code: 'TB', name: 'Thoroughbred', image_count: 0 },
  ];

  it('a purebred yields exactly its breed set, in order', () => {
    const options = imageOptionsFor({ QH: 1 }, breeds);
    expect(options.map((o) => o.path)).toEqual(['/horses/qh-01.webp', '/horses/qh-02.webp', '/horses/qh-03.webp']);
  });

  it('a zero count yields an empty list, not a throw', () => {
    const options = imageOptionsFor({ TB: 1 }, breeds);
    expect(options).toEqual([]);
  });

  it('a cross orders the larger fraction first', () => {
    const options = imageOptionsFor({ QH: 0.75, AR: 0.25 }, breeds);
    expect(options.map((o) => o.breedCode)).toEqual(['QH', 'QH', 'QH', 'AR', 'AR']);
  });

  it('a tied cross falls back to breed code order, deterministically', () => {
    const options = imageOptionsFor({ QH: 0.5, AR: 0.5 }, breeds);
    expect(options.map((o) => o.breedCode)).toEqual(['AR', 'AR', 'QH', 'QH', 'QH']);
  });

  it('skips a composition code with no matching breed row', () => {
    const options = imageOptionsFor({ QH: 0.5, XX: 0.5 }, breeds);
    expect(options.map((o) => o.breedCode)).toEqual(['QH', 'QH', 'QH']);
  });

  it('attaches a label when one is given, and leaves it undefined otherwise', () => {
    const labels = new Map([[imageLabelKey('QH', 2), 'flashy chestnut, jumping']]);
    const options = imageOptionsFor({ QH: 1 }, breeds, labels);
    expect(options[0].label).toBeUndefined();
    expect(options[1].label).toBe('flashy chestnut, jumping');
    expect(options[2].label).toBeUndefined();
  });
});

describe('buildImageLabelMap', () => {
  const breeds = [
    { id: 1, code: 'QH' },
    { id: 2, code: 'AR' },
  ];

  it('joins breed_id-keyed rows onto breed-code keys', () => {
    const map = buildImageLabelMap([{ breedId: 1, imageIndex: 3, label: 'flashy chestnut' }], breeds);
    expect(map.get(imageLabelKey('QH', 3))).toBe('flashy chestnut');
  });

  it('skips a row whose breed_id matches no known breed', () => {
    const map = buildImageLabelMap([{ breedId: 999, imageIndex: 1, label: 'orphaned' }], breeds);
    expect(map.size).toBe(0);
  });
});

describe('isAllowedImagePath', () => {
  const breeds: BreedForImages[] = [{ code: 'QH', name: 'Quarter Horse', image_count: 3 }];
  const options = imageOptionsFor({ QH: 1 }, breeds);

  it('accepts a path the set contains', () => {
    expect(isAllowedImagePath('/horses/qh-02.webp', options)).toBe(true);
  });

  it('rejects a path from a breed not in the composition', () => {
    expect(isAllowedImagePath('/horses/fr-01.webp', options)).toBe(false);
  });

  it('rejects an index beyond the live count', () => {
    expect(isAllowedImagePath('/horses/qh-99.webp', options)).toBe(false);
  });

  it('rejects anything that is not a library path at all', () => {
    expect(isAllowedImagePath('../etc/passwd', options)).toBe(false);
    expect(isAllowedImagePath('https://example.com/qh-01.webp', options)).toBe(false);
    expect(isAllowedImagePath('', options)).toBe(false);
  });
});

describe('parseImageCount', () => {
  it('accepts the boundaries', () => {
    expect(parseImageCount('0')).toBe(0);
    expect(parseImageCount('99')).toBe(99);
  });

  it('rejects out-of-range and malformed input', () => {
    expect(parseImageCount('-1')).toBeNull();
    expect(parseImageCount('100')).toBeNull();
    expect(parseImageCount('2.5')).toBeNull();
    expect(parseImageCount('')).toBeNull();
  });
});
