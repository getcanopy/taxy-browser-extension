import { DynamicTool } from 'langchain/tools';
import { click, setValue } from './domActions';

export const domTools = [
  new DynamicTool({
    name: 'click',
    description:
      'focuses on and sets the value of an input element. input is the elementId number)',
    func: async (inputs: string) => {
      console.log('click', inputs);
      const [elementIdString, _tabId] = inputs.split(',').map((input) => {
        let t = input.trim();
        t = t.startsWith('"') ? t.slice(1) : t;
        t = t.endsWith('"') ? t.slice(0, -1) : t;
        return t.trim();
      });

      const elementId = parseInt(elementIdString);
      if (isNaN(elementId)) {
        return 'elementId was not a number';
      }
      try {
        await click({ elementId });
        return 'clicked';
      } catch (e) {
        if (e) {
          return e.toString();
        }
        return 'click failed for unknown reason';
      }
    },
  }),
  new DynamicTool({
    name: 'setValue',
    description:
      'focuses on and sets the value of an input element. input is comma seperated strings "elementId","value"',
    func: async (inputs) => {
      console.log('setValue', inputs);
      const [elementIdString, value, _tabId] = inputs
        .split(',')
        .map((input) => {
          let t = input.trim();
          t = t.startsWith('"') ? t.slice(1) : t;
          t = t.endsWith('"') ? t.slice(0, -1) : t;
          return t.trim();
        });

      const elementId = parseInt(elementIdString);
      if (isNaN(elementId)) {
        return 'elementId was not a number';
      }
      try {
        await setValue({ elementId, value });
        return 'value set';
      } catch (e) {
        if (e) {
          return e.toString();
        }
        return 'setValue failed for unknown reason';
      }
    },
  }),
];
