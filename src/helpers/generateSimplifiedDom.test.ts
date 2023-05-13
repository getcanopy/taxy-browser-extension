/* eslint-disable no-console */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { generateSimplifiedDom } from './generateSimplifiedDom';

describe('DomAgent should use tools correctly', () => {
  const asana1 = readFileSync('./src/fixtures/asanaTasks1.html', 'utf8');

  it('should simplify dom elements', async () => {
    const dom = new DOMParser().parseFromString(asana1, 'text/html');

    // Mount the DOM to the document in an iframe so we can use getComputedStyle

    const interactiveElements: HTMLElement[] = [];

    const simplifiedDom = generateSimplifiedDom(
      dom.documentElement,
      interactiveElements
    ) as HTMLElement;

    // currently fails, dom simplification doesnt show the column text
    expect(simplifiedDom.outerHTML).toContain('Add task...');
  });
});
