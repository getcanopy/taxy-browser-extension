// console.log('Content script loaded..');

import { callRPC } from './pageRPC';
import { generateSimplifiedDom } from './generateSimplifiedDom';

export async function getSimplifiedDom() {
  const fullDom = await callRPC('getAnnotatedDOM', [], 3);
  if (!fullDom) return null;

  console.log(fullDom);
  const dom = new DOMParser().parseFromString(fullDom, 'text/html');

  // Mount the DOM to the document in an iframe so we can use getComputedStyle

  const interactiveElements: HTMLElement[] = [];

  const simplifiedDom = generateSimplifiedDom(
    dom.documentElement,
    interactiveElements
  ) as HTMLElement;

  return simplifiedDom;
}
