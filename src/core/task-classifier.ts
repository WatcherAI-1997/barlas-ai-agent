import type { AgentMessage } from "./models.js";

export type TaskClass = "fast" | "deep" | "private";

const DEEP_WORK = /\b(analy[sz]e|audit|architect|build|compare|debug|design|develop|implement|investigate|plan|research|review|strategy|verify)\b|(?:анализ|аудит|архитект|исслед|план|проверь|разработ|реализ|сравни|стратег|создай|сделай\s+все)/iu;
const MULTI_STEP = /(?:\bthen\b|\bafter that\b|\bfirst\b[^.]{0,120}\bthen\b|затем|после этого|сначала[^.]{0,120}потом)/iu;

export function inferTaskClass(input: {
  messages: AgentMessage[];
  hasProject?: boolean;
  hasSkill?: boolean;
}): Exclude<TaskClass, "private"> {
  const userText = input.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")
    .slice(-20_000);
  let score = 0;
  if (userText.length >= 600) score += 2;
  else if (userText.length >= 180) score += 1;
  if (DEEP_WORK.test(userText)) score += 2;
  if (MULTI_STEP.test(userText)) score += 1;
  if (input.hasProject) score += 1;
  if (input.hasSkill) score += 1;
  return score >= 2 ? "deep" : "fast";
}
