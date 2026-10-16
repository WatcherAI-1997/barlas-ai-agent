import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import type {
  GenerateRequest,
  GenerateResult,
  GenerateToolRequest,
  GenerateToolResult,
  ModelToolCall,
  ToolCapableModelProvider,
} from "../core/models.js";

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_DIAGNOSTIC_CHARS = 8_000;

interface CliDecision {
  kind: "answer" | "tool";
  text: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
}

interface WireDecision {
  kind: "answer" | "tool";
  text: string;
  toolName: string;
  toolArgumentsJson: string;
}

interface CliContinuation {
  toolName: string;
  toolArguments: Record<string, unknown>;
}

export class CodexCliProvider implements ToolCapableModelProvider {
  readonly name = "openai-account";
  private readonly codexScript: string;

  constructor(private readonly options: {
    model: string;
    timeoutMs?: number;
    codexScript?: string;
    runCli?: (input: { prompt: string; schemaPath: string; outputPath: string; cwd: string; model: string }) => Promise<void>;
  }) {
    this.codexScript = options.codexScript ?? require.resolve("@openai/codex/bin/codex.js");
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const result = await this.decide({ ...request, tools: [] });
    const usage = estimateUsage(request, result);
    return {
      text: result.text,
      provider: this.name,
      model: this.options.model,
      usage,
    };
  }

  async generateWithTools(request: GenerateToolRequest): Promise<GenerateToolResult> {
    const decision = await this.decide(request);
    const usage = estimateUsage(request, decision);
    const toolCalls: ModelToolCall[] = [];
    if (decision.kind === "tool") {
      if (!request.tools.some((tool) => tool.name === decision.toolName)) {
        throw new Error(`OpenAI account model requested an unavailable tool: ${decision.toolName}`);
      }
      toolCalls.push({ callId: randomUUID(), name: decision.toolName, arguments: decision.toolArguments });
    }
    const continuation: CliContinuation | undefined = toolCalls[0]
      ? { toolName: toolCalls[0].name, toolArguments: toolCalls[0].arguments as Record<string, unknown> }
      : undefined;
    return {
      text: decision.text,
      provider: this.name,
      model: this.options.model,
      ...(continuation ? { responseId: encodeContinuation(continuation) } : {}),
      toolCalls,
      usage,
    };
  }

  private async decide(request: GenerateToolRequest): Promise<CliDecision> {
    const previous = request.previousResponseId ? decodeContinuation(request.previousResponseId) : undefined;
    const prompt = [
      "You are the reasoning engine inside Barlas AI Agent.",
      "Return only the JSON object required by the supplied schema.",
      "Choose kind=tool only when one listed Barlas tool is necessary. Choose at most one tool.",
      "Do not use your own shell, filesystem, browser, network, MCP, or other built-in tools.",
      "For a direct answer choose kind=answer, put the full answer in text, and use empty toolName and '{}' in toolArgumentsJson.",
      "For a tool request choose kind=tool, put the exact listed name in toolName, a JSON object serialized as a string in toolArgumentsJson, and a short status in text.",
      `Conversation: ${JSON.stringify(request.messages)}`,
      `Available Barlas tools: ${JSON.stringify(request.tools)}`,
      previous ? `Previous requested tool: ${JSON.stringify(previous)}` : "",
      request.toolOutputs?.length ? `Results from that tool: ${JSON.stringify(request.toolOutputs)}` : "",
    ].filter(Boolean).join("\n\n");

    const directory = await mkdtemp(join(tmpdir(), "barlas-model-"));
    const schemaPath = join(directory, "response.schema.json");
    const outputPath = join(directory, "response.json");
    try {
      await writeFile(schemaPath, JSON.stringify(responseSchema), { encoding: "utf8", mode: 0o600 });
      if (this.options.runCli) {
        await this.options.runCli({ prompt, schemaPath, outputPath, cwd: directory, model: this.options.model });
      } else {
        await this.run(prompt, schemaPath, outputPath, directory);
      }
      const parsed = JSON.parse(await readFile(outputPath, "utf8")) as Partial<WireDecision>;
      if ((parsed.kind !== "answer" && parsed.kind !== "tool") || typeof parsed.text !== "string" ||
          typeof parsed.toolName !== "string" || typeof parsed.toolArgumentsJson !== "string") {
        throw new Error("OpenAI account model returned an invalid structured response");
      }
      const toolArguments = JSON.parse(parsed.toolArgumentsJson) as unknown;
      if (!isRecord(toolArguments)) throw new Error("OpenAI account model returned invalid tool arguments");
      return { kind: parsed.kind, text: parsed.text, toolName: parsed.toolName, toolArguments };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async run(prompt: string, schemaPath: string, outputPath: string, cwd: string): Promise<void> {
    const environment = { ...process.env };
    delete environment.OPENAI_API_KEY;
    delete environment.CODEX_API_KEY;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [
        this.codexScript, "exec", "-", "--model", this.options.model,
        "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check",
        "--ignore-user-config", "--ignore-rules", "--color", "never",
        "--disable", "shell_tool", "--disable", "apps", "--disable", "plugins",
        "--disable", "memories", "--disable", "multi_agent", "--disable", "remote_plugin",
        "--config", 'web_search="disabled"',
        "--config", "skills.include_instructions=false", "--config", "skills.bundled.enabled=false",
        "--output-schema", schemaPath, "--output-last-message", outputPath,
      ], { cwd, env: environment, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
      let diagnostic = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        diagnostic = (diagnostic + chunk).slice(-MAX_DIAGNOSTIC_CHARS);
      });
      const timer = setTimeout(() => child.kill(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`OpenAI account model failed${diagnostic.trim() ? `: ${diagnostic.trim()}` : ""}`));
      });
      child.stdin.end(prompt, "utf8");
    });
  }
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["answer", "tool"] },
    text: { type: "string" },
    toolName: { type: "string" },
    toolArgumentsJson: { type: "string" },
  },
  required: ["kind", "text", "toolName", "toolArgumentsJson"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function encodeContinuation(value: CliContinuation): string {
  return `barlas-cli:${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decodeContinuation(value: string): CliContinuation {
  if (!value.startsWith("barlas-cli:") || value.length > 100_000) throw new Error("Invalid OpenAI account continuation");
  const parsed = JSON.parse(Buffer.from(value.slice("barlas-cli:".length), "base64url").toString("utf8")) as unknown;
  if (!isRecord(parsed) || typeof parsed.toolName !== "string" || !isRecord(parsed.toolArguments)) {
    throw new Error("Invalid OpenAI account continuation");
  }
  return parsed as unknown as CliContinuation;
}

function estimateUsage(request: GenerateRequest | GenerateToolRequest, decision: CliDecision) {
  // The account-backed CLI does not expose billable API usage to this bridge.
  // A conservative character estimate keeps Barlas token budgets enforceable.
  const inputTokens = Math.ceil(JSON.stringify(request).length / 4);
  const outputTokens = Math.ceil(JSON.stringify(decision).length / 4);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd: 0 };
}
