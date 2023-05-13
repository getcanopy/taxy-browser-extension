import { BaseLanguageModel } from 'langchain/base_language';
import {
  CallbackManager,
  CallbackManagerForChainRun,
} from 'langchain/callbacks';
import { ChainInputs, LLMChain } from 'langchain/chains';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from 'langchain/prompts';
import { ChainValues } from 'langchain/schema';
import { Tool } from 'langchain/tools';
import { Document } from 'langchain/document';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

export type AgentAction = {
  thought: string;
  tool: string;
  toolInput: string;
};

export type AgentAction2 = AgentAction & {
  log: string;
};

export type AgentStep = {
  action: AgentAction2;
  observation: string;
};

interface DomAgentInput extends ChainInputs {
  returnIntermediateSteps?: boolean;
  llm: BaseLanguageModel;
  tools: Tool[];
  maxIterations?: number;
  getSimplifiedDom: () => Promise<string>;
  openAIApiKey: string;
}

const finishToolName = 'finished';
const MAX_ITERATIONS = 15;

export class DomAgent extends LLMChain implements DomAgentInput {
  format_instructions: string;
  tools: Tool[];
  returnIntermediateSteps = false;
  maxIterations: number;
  getSimplifiedDom: () => Promise<string>;
  openAIApiKey: string;

  constructor(fields: DomAgentInput) {
    const messages = [
      SystemMessagePromptTemplate.fromTemplate(`You are a browser automation assistant. You will complete tasks on a fragments of a reduced version of a DOM. The fragments will consist of nested elements with elementId's which are ALWAYS a number. For example, below you would find a jump button with elementId of 124, and a search input with elementId of 149

      <div>Press J to jump to the feed. Press question mark to learn the rest of the keyboard shortcuts <button role="button" id="124">Jump to content </button><a aria-label="Home" id="126"><svg id="127"><g id="128"><circle id="129"/><path id="130"/></g></svg><svg id="131"><g id="132"><path id="133"/><circle id="134"/><path id="135"/><path id="136"/><path id="137"/><path id="138"/><path id="139"/></g></svg></a><div aria-label="Start typing to filter your communities or use up and down to select." role="navigation" id="140"><button id="141"><span id="142"><h1 id="143">Popular </h1></span><i id="144"/><i id="145"/></button></div><form role="search" id="149">Search all of Reddit <input name="q" type="search" placeholder="Search Reddit" value=" id="154"/></form></div>

      Here is the DOM you will operate on:
      {domText}`),
      HumanMessagePromptTemplate.fromTemplate(
        `My request: {input}\n{agent_scratchpad}`
      ),
    ];

    super({
      prompt: ChatPromptTemplate.fromPromptMessages(messages),
      llm: fields.llm,
      callbacks: fields.callbacks ?? undefined,
    });

    const toolNames = fields.tools.map((tool) => tool.name).join(',');

    this.format_instructions = `What is the SINGLE next tool you should use to finish this task. Your response should consist ONLY of a fenced code block formatted with a with this exact schema:
\`\`\`
{
"thought": string, \\ You must think concisely whether the next tool should be ${finishToolName} and why
"tool": string, \\ you MUST provide the name of a tool to use (${finishToolName},${toolNames})
"toolInput": string \\ the valid input to the tool, remember I have forgotten all other responses
} \\ all done as only one object should be returned
\`\`\``;

    this.maxIterations = fields.maxIterations ?? MAX_ITERATIONS;
    this.tools = fields.tools;
    this.returnIntermediateSteps =
      fields.returnIntermediateSteps ?? this.returnIntermediateSteps;
    this.getSimplifiedDom = fields.getSimplifiedDom;
    this.openAIApiKey = fields.openAIApiKey;
  }
  callbackManager?: CallbackManager | undefined;

  async constructScratchPad(steps: AgentStep[]): Promise<string> {
    const thoughts: string[] = [];
    for (const step of steps) {
      thoughts.push(step.action.log);
      thoughts.push(`${step.observation} responds "${step.action.tool}"`);
    }

    thoughts.push(
      `Your responses to me will consist solely of valid tool uses. These are the available tools:
      ${this.tools
        .map((tool) => `${tool.name}: ${tool.description}`)
        .join('\n')}
      ${finishToolName}: The final tool to use when you have a response to my request. The input MUST be your final response to my request, as I forget all other text.
      
      Reflect on the the original request and subsequent thought and tool response
      ${this.format_instructions}`
    );

    return thoughts.join('\n');
  }

  // hook call to override
  async _call(
    values: ChainValues,
    runManager?: CallbackManagerForChainRun
  ): Promise<ChainValues> {
    const toolsByName = Object.fromEntries(
      this.tools.map((t) => [t.name.toLowerCase(), t])
    );

    const steps: AgentStep[] = [];
    let iterations = 0;

    while (iterations < this.maxIterations) {
      const domText = await this.getDomText(values.input);

      const promptValue = await this.prompt.formatPromptValue({
        ...values,
        domText,
        agent_scratchpad: await this.constructScratchPad(steps),
      });

      const {
        generations: [[{ text }]],
      } = await this.llm.generatePrompt(
        [promptValue],
        {},
        runManager?.getChild()
      );

      let action: AgentAction;
      try {
        action = this.parse(text);
      } catch (e) {
        return {
          output: 'Failed to parse. Text: "${text}". Error: ${e}',
          log: text,
        };
      }

      if (action.tool === finishToolName) {
        const result = { output: action.toolInput } as ChainValues;
        if (this.returnIntermediateSteps) result.intermediateSteps = steps;
        return result;
      }

      //todo returndirect
      const tool = toolsByName[action.tool?.toLowerCase()];
      const observation = tool
        ? await tool.call(action.toolInput, runManager?.getChild())
        : `${action.tool} is not a valid tool, try another one.`;

      steps.push({
        action: { ...action, log: text },
        observation,
      });

      iterations += 1;
    }

    return {
      output: 'Agent stopped due to max iterations.',
    };
  }

  parse(text: string): AgentAction {
    const json = text.includes('```')
      ? text.trim().split(/```(?:json)?/)[1]
      : text.trim();

    return JSON.parse(json);
  }

  async getDomText(input: string): Promise<string> {
    const domText = await this.getSimplifiedDom();

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2000,
      chunkOverlap: 200,
    });
    const texts = await textSplitter.splitText(domText);

    const docs = texts.map(
      (pageContent: string) =>
        new Document({
          pageContent,
          metadata: [],
        })
    );

    const vectorStore = await MemoryVectorStore.fromDocuments(
      docs,
      new OpenAIEmbeddings({ openAIApiKey: this.openAIApiKey })
    );
    const results = await vectorStore.similaritySearch(input, 4);
    const context = results.map((res: Document) => res.pageContent).join('\n');
    return context;
  }
}
