/* eslint-disable no-console */
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { DomAgent } from './domAgent';
import { beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { DynamicTool } from 'langchain/tools';
import { generateSimplifiedDom } from './generateSimplifiedDom';

describe('DomAgent should use tools correctly', () => {
  let asana1DomArray: string[];

  beforeAll(async () => {
    asana1DomArray = ['asanaTasks1.html'].map((filename) => {
      const fullDom = readFileSync(`./src/fixtures/${filename}`, 'utf8');

      const dom = new DOMParser().parseFromString(fullDom, 'text/html');

      const interactiveElements: HTMLElement[] = [];

      const simplifiedDom = generateSimplifiedDom(
        dom.documentElement,
        interactiveElements
      ) as HTMLElement;

      return simplifiedDom.outerHTML;
    });
  });

  it('should click first post', async () => {
    const llm = new ChatOpenAI({
      modelName: 'gpt-3.5-turbo',
      openAIApiKey: process.env.OPENAI_API_KEY,
      temperature: 0,
      verbose: true,
    });

    const tools = [
      new DynamicTool({
        name: 'click',
        description:
          'focuses on and sets the value of an input element. input is the elementId number)',
        func: async (inputs: string) => {
          console.log('clicked', inputs);
          return 'clicked';
        },
      }),
      new DynamicTool({
        name: 'setValue',
        description:
          'focuses on and sets the value of an input element. input is comma seperated strings "elementId","value"',
        func: async (inputs: string) => {
          console.log('click', inputs);
          return 'value set';
        },
      }),
    ];

    const executor = new DomAgent({
      tools,
      llm,
      returnIntermediateSteps: true,
      verbose: true,
      getSimplifiedDom: async () => {
        let currentIndex = 0;

        return new Promise<string>((resolve) => {
          const result = asana1DomArray[currentIndex];
          currentIndex = (currentIndex + 1) % asana1DomArray.length;
          resolve(result);
        });
      },
      openAIApiKey: process.env.OPENAI_API_KEY || '',
    });

    const input = 'Add Task "Book recording studio for fall banger"';
    console.log(`Executing with input "${input}"...`);

    const result = await executor.call({
      input,
    });

    // currently fails, dom simplification doesnt show the field
    expect(result.intermediateSteps.length).toEqual(3); // just guessing
    expect(result.intermediateSteps[0].action.tool).toEqual('click');
    expect(result.intermediateSteps[0].action.toolInput).not.toEqual('388');
    // todo the rest

    console.log(JSON.stringify(result, null, 2));
  });
});
