export type ExtensionKind = "channel" | "connector" | "provider" | "runtime" | "skill-source" | "device";
export type ExtensionRisk = "none" | "read" | "write" | "external" | "device";

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  kind: ExtensionKind;
  capabilities: string[];
  risks: ExtensionRisk[];
  configuration: string[];
  builtin: boolean;
}

export interface ExtensionStatus extends ExtensionManifest {
  configured: boolean;
}

export class ExtensionCatalog {
  private readonly extensions = new Map<string, { manifest: ExtensionManifest; configured: () => boolean }>();

  register(manifest: ExtensionManifest, configured: () => boolean = () => true): void {
    if (!/^[a-z][a-z0-9.-]{2,63}$/u.test(manifest.id)) throw new Error(`Invalid extension id: ${manifest.id}`);
    if (!/^\d+\.\d+\.\d+$/u.test(manifest.version)) throw new Error(`Invalid extension version: ${manifest.version}`);
    if (this.extensions.has(manifest.id)) throw new Error(`Extension ${manifest.id} is already registered`);
    if (manifest.capabilities.length === 0) throw new Error(`Extension ${manifest.id} must declare capabilities`);
    const normalized = Object.freeze({
      ...manifest,
      capabilities: Object.freeze([...new Set(manifest.capabilities)].sort()),
      risks: Object.freeze([...new Set(manifest.risks)].sort()),
      configuration: Object.freeze([...new Set(manifest.configuration)].sort()),
    }) as unknown as ExtensionManifest;
    this.extensions.set(manifest.id, { manifest: normalized, configured });
  }

  get(id: string): ExtensionStatus {
    const extension = this.extensions.get(id);
    if (!extension) throw new Error(`Unknown extension: ${id}`);
    return { ...extension.manifest, configured: extension.configured() };
  }

  list(): ExtensionStatus[] {
    return [...this.extensions.keys()].sort().map((id) => this.get(id));
  }
}

export interface BuiltinExtensionAvailability {
  browser: boolean;
  github: boolean;
  google: boolean;
  mcp: boolean;
  sandbox: boolean;
  telegram: boolean;
  privateModel: boolean;
  deviceNodes: boolean;
}

export function createBuiltinExtensionCatalog(availability: BuiltinExtensionAvailability): ExtensionCatalog {
  const catalog = new ExtensionCatalog();
  const add = (manifest: Omit<ExtensionManifest, "version" | "builtin">, configured: () => boolean) => {
    catalog.register({ ...manifest, version: "1.0.0", builtin: true }, configured);
  };

  add({ id: "channel.telegram", name: "Telegram", description: "Telegram messages, approvals, voice replies and domain-free long polling.", kind: "channel", capabilities: ["chat", "approvals", "voice", "polling", "webhook"], risks: ["external", "write"], configuration: ["TELEGRAM_BOT_TOKEN"] }, () => availability.telegram);
  add({ id: "connector.github", name: "GitHub", description: "Repository profile and repository access through an encrypted connector.", kind: "connector", capabilities: ["profile.read", "repositories.read"], risks: ["read", "external"], configuration: ["CONNECTOR_VAULT_KEY"] }, () => availability.github);
  add({ id: "connector.google", name: "Google", description: "Drive, Gmail and Calendar access through an encrypted connector.", kind: "connector", capabilities: ["calendar.read", "drive.read", "gmail.read"], risks: ["read", "external"], configuration: ["CONNECTOR_VAULT_KEY"] }, () => availability.google);
  add({ id: "connector.mcp", name: "Model Context Protocol", description: "Connect approved MCP servers and expose their tools to Barlas.", kind: "connector", capabilities: ["tools.discover", "tools.execute"], risks: ["external", "write"], configuration: ["CONNECTOR_VAULT_KEY"] }, () => availability.mcp);
  add({ id: "provider.openai", name: "OpenAI", description: "Primary native model, media and embedding provider.", kind: "provider", capabilities: ["chat", "embeddings", "media", "tools"], risks: ["external"], configuration: ["MODEL_API_KEY", "MODEL_NAME"] }, () => true);
  add({ id: "provider.openai-compatible", name: "OpenAI-compatible private model", description: "Optional self-hosted or compatible private model route.", kind: "provider", capabilities: ["chat", "tools"], risks: ["external"], configuration: ["PRIVATE_MODEL_API_KEY", "PRIVATE_MODEL_BASE_URL", "PRIVATE_MODEL_NAME"] }, () => availability.privateModel);
  add({ id: "runtime.browser", name: "Managed browser", description: "Isolated Playwright browser navigation and extraction.", kind: "runtime", capabilities: ["browser.navigate", "browser.read"], risks: ["external", "read"], configuration: ["BROWSER_WS_ENDPOINT"] }, () => availability.browser);
  add({ id: "runtime.code-sandbox", name: "Code sandbox", description: "Isolated Python, Node.js, Git and npm execution.", kind: "runtime", capabilities: ["code.execute", "git", "npm", "python"], risks: ["write"], configuration: ["SANDBOX_SHARED_TOKEN", "SANDBOX_SOCKET_PATH"] }, () => availability.sandbox);
  add({ id: "skills.builtin", name: "Versioned skills", description: "Versioned skill installation, evaluation, activation and rollback.", kind: "skill-source", capabilities: ["skills.activate", "skills.evaluate", "skills.install", "skills.rollback"], risks: ["write"], configuration: [] }, () => true);
  add({ id: "device.nodes", name: "Device nodes", description: "Token-paired desktop and mobile nodes with heartbeat, revocation and approval-gated notification delivery.", kind: "device", capabilities: ["nodes.notify", "nodes.pair", "nodes.revoke", "nodes.status"], risks: ["device", "external"], configuration: [] }, () => availability.deviceNodes);
  return catalog;
}
