import type { AgentIdentity, AgentPlan } from '../../shared/agent.js';
import { isWrite } from '../../shared/agent.js';
import { planMessage, AgentError } from './agent.js';
import { babyScope, executePlan, formatResults, type ToolConfig, type ToolResult } from './tools.js';

export interface AgentCheckpoint { plan?: AgentPlan; results: ToolResult[]; reply?: string }
export interface AgentRunConfig extends ToolConfig { apiKey: string; model: string; timeZone: string }

export async function prepareAgentReply(input: { identity: AgentIdentity; text: string; receivedAt: number },
  config: AgentRunConfig, checkpoint: AgentCheckpoint, save: (state: AgentCheckpoint) => Promise<void>,
  guard: () => void): Promise<string> {
  guard();
  // Revalidate server-side grants even when retrying a cached reply/plan.
  const baby = await babyScope(input.identity, config); guard();
  if (checkpoint.reply) return checkpoint.reply;
  if (!checkpoint.plan) {
    checkpoint.plan = await planMessage({ text: input.text, receivedAt: input.receivedAt, baby,
      writesEnabled: config.writesEnabled, timeZone: config.timeZone }, { apiKey: config.apiKey, model: config.model });
    guard(); await save(checkpoint); // Commit stable plan before any mutation.
  }
  if (!config.writesEnabled && checkpoint.plan.operations.some(op => isWrite(op.name))) {
    checkpoint.reply = '当前尚未开启成长记录写入，这条消息没有保存。请先完成微信收发验收与业务部署。';
  } else {
    checkpoint.results = await executePlan(input.identity, checkpoint.plan, config, checkpoint.results,
      async results => { checkpoint.results = results; await save(checkpoint); }, guard);
    guard(); checkpoint.reply = formatResults(checkpoint.plan, checkpoint.results).slice(0, 3500);
  }
  guard(); await save(checkpoint);
  return checkpoint.reply;
}

export function retryableAgentError(error: unknown): boolean { return error instanceof AgentError && error.retryable; }
