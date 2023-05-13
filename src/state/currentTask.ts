import { attachDebugger, detachDebugger } from '../helpers/chromeDebugger';
import {
  disableIncompatibleExtensions,
  reenableExtensions,
} from '../helpers/disableExtensions';
import { getSimplifiedDom } from '../helpers/simplifyDom';
import { MyStateCreator } from './store';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { CallbackManager } from 'langchain/callbacks';
import { LLMResult } from 'langchain/schema';
import { useAppState } from '../state/store';
import { DomAgent } from '../helpers/domAgent';
import templatize from '../helpers/shrinkHTML/templatize';
import { Tool } from 'langchain/tools';
import { domTools } from '../helpers/domTools';

type ParsedResponse =
  | {
      thought: string;
      tool: string;
      input: string;
    }
  | {
      error: string;
    };

export type TaskHistoryEntry = {
  action: ParsedResponse;
};

export type CurrentTaskSlice = {
  tabId: number;
  instructions: string | null;
  history: TaskHistoryEntry[];
  status: 'idle' | 'running' | 'success' | 'error' | 'interrupted';
  actionStatus:
    | 'idle'
    | 'attaching-debugger'
    | 'pulling-dom'
    | 'transforming-dom'
    | 'performing-query'
    | 'performing-action'
    | 'waiting';
  actions: {
    runTask: (onError: (error: string) => void) => Promise<void>;
    interrupt: () => void;
  };
};
export const createCurrentTaskSlice: MyStateCreator<CurrentTaskSlice> = (
  set,
  get
) => ({
  tabId: -1,
  instructions: null,
  history: [],
  status: 'idle',
  actionStatus: 'idle',
  actions: {
    runTask: async (onError) => {
      const wasStopped = () => get().currentTask.status !== 'running';
      const setActionStatus = (status: CurrentTaskSlice['actionStatus']) => {
        set((state) => {
          state.currentTask.actionStatus = status;
        });
      };

      const instructions = get().ui.instructions;

      if (!instructions || get().currentTask.status === 'running') return;

      set((state) => {
        state.currentTask.instructions = instructions;
        state.currentTask.history = [];
        state.currentTask.status = 'running';
        state.currentTask.actionStatus = 'attaching-debugger';
      });

      const callbackManager = CallbackManager.fromHandlers({
        async handleLLMStart(_llm: { name: string }, prompts: string[]) {
          console.log(JSON.stringify(prompts, null, 2));
        },
        async handleLLMEnd(output: LLMResult) {
          for (const generation of output.generations) {
            for (const gen of generation) {
              console.log(gen.text);
            }
          }

          try {
            const action = executor.parse(output.generations[0][0].text.trim());

            set((state) => {
              state.currentTask.history.push({
                action: {
                  thought: action.thought,
                  tool: action.tool,
                  input: action.toolInput,
                },
              });
            });
          } catch {
            //
          }
        },
      });

      const controller = new AbortController();

      const openAIApiKey = useAppState.getState().settings.openAIKey || '';
      const modelName = useAppState.getState().settings.selectedModel;
      const model = new ChatOpenAI(
        {
          temperature: 0,
          modelName,
          openAIApiKey,
          callbackManager,
        },
        { baseOptions: { signal: controller.signal } }
      );
      const tools: Tool[] = [...domTools];

      const executor = new DomAgent({
        tools,
        llm: model,
        returnIntermediateSteps: true,
        verbose: true,
        getSimplifiedDom: async () => {
          const pageDOM = await getSimplifiedDom();
          const html = pageDOM ? pageDOM.outerHTML : '';
          return templatize(html);
        },
        openAIApiKey,
      });

      try {
        const activeTab = (
          await chrome.tabs.query({ active: true, currentWindow: true })
        )[0];

        if (!activeTab.id) throw new Error('No active tab found');
        const tabId = activeTab.id;
        set((state) => {
          state.currentTask.tabId = tabId;
        });

        await attachDebugger(tabId);
        await disableIncompatibleExtensions();

        // set((state) => {
        //   state.currentTask.status = 'error';
        // });

        const interval = setInterval(() => {
          if (wasStopped()) {
            // hack to stop agent, just give it no more iterations
            executor.maxIterations = 0;
            // stop the existing call
            controller.abort();
          }
        }, 500);
        setActionStatus('performing-action');
        const result = await executor.call({
          input: instructions,
        });
        clearInterval(interval);
        result.output;

        set((state) => {
          state.currentTask.status = 'success';
        });
      } catch (e: any) {
        onError(e.message);
        set((state) => {
          state.currentTask.status = 'error';
        });
      } finally {
        await detachDebugger(get().currentTask.tabId);
        await reenableExtensions();
      }
    },
    interrupt: () => {
      set((state) => {
        state.currentTask.status = 'interrupted';
      });
    },
  },
});
