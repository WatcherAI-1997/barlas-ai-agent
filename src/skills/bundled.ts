import type { SkillDefinition } from "./registry.js";

const SAFE_FILE_TOOLS = ["files.list", "files.read", "files.write", "terminal.inspect"];
const CODE_TOOLS = [...SAFE_FILE_TOOLS, "code.run", "agent.delegate"];

/**
 * Core workflows adapted for Barlas' isolated tools. These are deliberately
 * declarative: installing Barlas installs the workflows without downloading
 * scripts or executing package-manager hooks at runtime.
 */
export const bundledCoreSkills: readonly SkillDefinition[] = [
  {
    id: "research.grounded-citations",
    version: "1.2.0",
    description: "Research with verifiable inline citations, an evidence ledger, and explicit uncertainty.",
    instructions: [
      "Build a source ledger before drafting: for every external claim retain its URL, title, retrieval context, and the exact supporting passage.",
      "Use numbered inline citations in first-use order and finish with a Sources section mapping every number to a URL. Never invent a citation or cite a source that does not support the sentence.",
      "Prefer primary and recent sources, corroborate consequential claims, label model knowledge as unverified, and state conflicts or missing evidence plainly.",
    ].join(" "),
    allowedTools: ["web.search", "browser.open", "browser.interact", "files.list", "files.read", "files.write", "agent.delegate"],
  },
  {
    id: "development.codebase-inspection",
    version: "1.0.0",
    description: "Inspect a codebase's structure, languages, size, hotspots, and boundaries before changing it.",
    instructions: [
      "Inspect repository guidance and the file tree first. Measure rather than guess: identify languages, entry points, tests, generated or vendored paths, and unusually large files.",
      "Keep all analysis inside the user's isolated workspace. Exclude dependencies and build output from metrics unless the user explicitly asks for them.",
      "Return a compact map of the codebase, the commands or evidence used, and the highest-risk areas for the requested task.",
    ].join(" "),
    allowedTools: CODE_TOOLS,
  },
  {
    id: "development.systematic-debugging",
    version: "1.1.0",
    description: "Root-cause debugging through reproduction, evidence, hypothesis testing, and regression verification.",
    instructions: [
      "Do not patch a symptom before establishing a reproducible failure and tracing the bad value or state to its origin.",
      "Work in four phases: reproduce and gather evidence; compare working and failing paths; form one falsifiable hypothesis at a time; implement the smallest root-cause fix and add a regression test.",
      "If three hypotheses fail, stop stacking changes and reassess the architecture or missing evidence. Report what was observed separately from what is inferred.",
    ].join(" "),
    allowedTools: CODE_TOOLS,
  },
  {
    id: "development.test-driven",
    version: "1.1.0",
    description: "Develop changes using a strict red-green-refactor cycle and focused regression tests.",
    instructions: [
      "Write the smallest behavior-focused test first and run it to observe the expected failure. If it passes immediately, prove that it can detect the missing behavior before proceeding.",
      "Implement only enough production code to make the test pass, run the focused test, then the relevant suite, and refactor only while green.",
      "Never weaken assertions to accommodate broken behavior. Cover errors and boundaries, avoid tests of implementation details, and report the exact verification commands and outcomes.",
    ].join(" "),
    allowedTools: CODE_TOOLS,
  },
  {
    id: "development.code-review",
    version: "2.1.0",
    description: "Pre-commit review with security, correctness, regression, and maintainability gates.",
    instructions: [
      "Review the actual diff and surrounding contracts before declaring work ready. Prioritize exploitable security issues, data loss, broken behavior, isolation failures, and missing tests over style preferences.",
      "Use an independent delegated reviewer when available. Validate findings against the code, fix only confirmed issues within scope, and rerun the narrow and broad checks affected by each fix.",
      "Return findings ordered by severity with file references, then verification evidence and residual risks. If no defect is found, say so without implying proof of perfection.",
    ].join(" "),
    allowedTools: CODE_TOOLS,
  },
  {
    id: "development.simplify",
    version: "1.1.0",
    description: "Simplify working code by removing duplication, accidental complexity, waste, and weak abstractions.",
    instructions: [
      "Treat this as a cleanup pass after correctness is established. Review recent changes from four angles: reuse, clarity, efficiency, and abstraction level; delegate those reviews in parallel when useful.",
      "Apply only changes that make the code demonstrably easier to understand or maintain. Preserve public behavior, avoid speculative frameworks, and keep the diff proportional to the task.",
      "Run the relevant tests after cleanup and summarize what became simpler and what intentionally stayed unchanged.",
    ].join(" "),
    allowedTools: CODE_TOOLS,
  },
  {
    id: "development.spike",
    version: "1.0.0",
    description: "Run a bounded throwaway experiment to answer a concrete feasibility question before a real build.",
    instructions: [
      "Start with one decision, explicit success and failure criteria, a time or step budget, and the cheapest experiment that can resolve the uncertainty.",
      "Keep prototype code isolated and clearly disposable. Record setup, observations, constraints, and surprising failures; do not silently turn the spike into production implementation.",
      "End with a verdict: feasible, infeasible, or inconclusive; cite the evidence and recommend the smallest next step. Preserve only useful notes or artifacts requested by the user.",
    ].join(" "),
    allowedTools: CODE_TOOLS,
  },
  {
    id: "delivery.sdlc-review",
    version: "1.1.0",
    description: "Independently verify a completed project step and route it to approval, changes, or escalation.",
    instructions: [
      "Review the stated acceptance criteria, implementation evidence, and affected artifacts without taking the implementer's claims on trust.",
      "Check scope, correctness, tests, security, recoverability, and documentation. Distinguish blocking defects from non-blocking suggestions and avoid expanding the task with unrelated improvements.",
      "Issue exactly one verdict: approve, request changes with reproducible evidence, or escalate because required evidence or authority is missing. Update project state only after the verdict is supported.",
    ].join(" "),
    allowedTools: [...CODE_TOOLS, "projects.get", "projects.step.update", "projects.checkpoint.create"],
  },
  {
    id: "productivity.document-actions",
    version: "0.1.0",
    description: "Extract cited obligations, deadlines, owners, risks, and proposed actions from documents.",
    instructions: [
      "Extract the document first, preserving page, section, heading, or quoted-text anchors for every fact. Separate explicit obligations from recommendations and inferences.",
      "For each action provide the source anchor, owner if stated, deadline with timezone if stated, dependencies, confidence, and ambiguity. Never manufacture an owner or date.",
      "Present proposed mutations as a reviewable list. Creating project steps, reminders, or outbound messages requires the normal approval flow; document analysis is not legal advice.",
    ].join(" "),
    allowedTools: ["files.list", "files.read", "documents.extract", "media.pdf.analyze", "projects.get", "projects.step.create"],
  },
  {
    id: "productivity.meeting-actions",
    version: "0.1.0",
    description: "Turn notes or transcripts into cited decisions, owners, open questions, and follow-up actions.",
    instructions: [
      "Work only from supplied or retrieved meeting material. Separate decisions, action items, risks, and unresolved questions, and attach a timestamp, speaker, or exact quote wherever available.",
      "Do not infer agreement, ownership, or deadlines from vague discussion. Mark uncertainty and conflicts between notes or transcripts.",
      "Draft a concise follow-up with an owner and due date for each confirmed action. Any email, calendar, or project mutation remains approval-gated.",
    ].join(" "),
    allowedTools: ["files.list", "files.read", "documents.extract", "media.audio.transcribe", "gmail.draft.create", "google_calendar.event.create", "projects.step.create"],
  },
  {
    id: "productivity.weekly-review",
    version: "0.1.0",
    description: "Run a bounded weekly reset across projects, mail, calendar, and workspace notes.",
    instructions: [
      "Confirm the review window and sources, then inventory completed work, open commitments, waiting items, stale projects, and the next calendar horizon.",
      "Reconcile contradictions without silently deleting anything. Propose a realistic next-week plan ranked by importance and capacity, with explicit carryovers and items to drop or defer.",
      "Read operations may run immediately; drafts and changes to mail, calendar, files, or project state require the normal approval flow. End with a short review summary and concrete next actions.",
    ].join(" "),
    allowedTools: ["files.list", "files.read", "projects.get", "gmail.messages", "google_calendar.events", "gmail.draft.create", "google_calendar.event.create", "projects.step.create", "projects.step.update"],
  },
  {
    id: "documents.docx",
    version: "1.1.0",
    description: "Safely read and create Word documents with structured, reviewable content.",
    instructions: [
      "For existing DOCX files, extract and inspect before editing; preserve headings, lists, tables, and important metadata in the review summary.",
      "For new documents, establish audience, purpose, outline, and filename, then generate semantic headings and concise sections rather than simulating page layout with spaces.",
      "Never claim pixel-perfect rendering or unsupported tracked-change behavior. Save only inside the user's workspace, use a .docx extension, and verify the resulting file can be extracted after creation.",
    ].join(" "),
    allowedTools: ["files.list", "files.read", "documents.extract", "documents.create", "terminal.inspect"],
  },
  {
    id: "documents.pdf",
    version: "1.1.0",
    description: "Read and analyze text or scanned PDFs with citations and clear capability boundaries.",
    instructions: [
      "Use bounded text extraction for text PDFs and visual PDF analysis when scans, diagrams, or layout matter. Preserve page references for quotations and key findings.",
      "State OCR uncertainty and never infer unreadable values. Do not claim merge, form filling, encryption, or pixel-level editing unless an available tool actually performed it.",
      "Keep source files unchanged unless the user explicitly requests a supported output, and verify every created artifact before presenting it.",
    ].join(" "),
    allowedTools: ["files.list", "files.read", "documents.extract", "media.pdf.analyze", "documents.create", "terminal.inspect"],
  },
  {
    id: "email.inbox-triage",
    version: "0.2.0",
    description: "Triage an inbox into a bounded priority queue and prepare replies without sending silently.",
    instructions: [
      "Define the mailbox window, retrieve the minimum necessary messages, and group related messages into threads before ranking them.",
      "Classify each thread as urgent action, important follow-up, waiting, informational, or low value. Explain priority using sender, deadline, user impact, and unanswered commitments; do not treat marketing urgency as real urgency.",
      "Draft concise replies when useful, preserving unanswered questions and never inventing commitments. Sending mail or changing external state requires explicit approval.",
    ].join(" "),
    allowedTools: ["gmail.messages", "gmail.draft.create", "gmail.send", "google_calendar.events", "google_calendar.event.create"],
  },
  {
    id: "web.blocked-page-recovery",
    version: "1.0.0",
    description: "Recover research when a page is blocked without looping, bypassing access controls, or inventing content.",
    instructions: [
      "When a fetch fails, identify the failure once and do not repeatedly hammer the same URL. Search for a public archive, an official API or feed, a publisher mirror, or an independently accessible source covering the same claim.",
      "Use an interactive browser only when configured and appropriate. Do not bypass authentication, paywalls, CAPTCHAs, robots restrictions, or technical access controls.",
      "Clearly label archived or secondary material, preserve the original URL, compare dates and versions, and report when the source cannot be verified.",
    ].join(" "),
    allowedTools: ["web.search", "browser.open", "browser.interact", "files.write"],
  },
  {
    id: "research.arxiv",
    version: "1.0.0",
    description: "Find and compare arXiv papers by topic, author, category, date, or identifier.",
    instructions: [
      "Translate the request into precise search concepts and use arXiv pages or APIs as the primary record. Capture title, authors, identifier, version, submission date, abstract, and canonical URL.",
      "Distinguish preprints from peer-reviewed publications and never imply that arXiv publication is peer review. Prefer the latest version while noting materially relevant version changes.",
      "For synthesis, compare methods, datasets, limitations, and results using citations. State when only the abstract was inspected and avoid conclusions unsupported by the paper text.",
    ].join(" "),
    allowedTools: ["web.search", "browser.open", "files.write", "agent.delegate"],
  },
  {
    id: "research.competitor-monitor",
    version: "0.1.0",
    description: "Monitor named organizations for material, cited changes without duplicating old news.",
    instructions: [
      "Confirm the monitored entities, time window, markets, and what counts as material. Search primary company sources plus credible independent coverage.",
      "Normalize each event by company, date, event type, canonical URL, and evidence, then deduplicate syndicated or repeated stories. Separate confirmed events from rumors and commentary.",
      "Rank by likely impact and produce a concise digest with inline citations, what changed since the previous window, uncertainties, and suggested follow-up questions.",
    ].join(" "),
    allowedTools: ["web.search", "browser.open", "files.list", "files.read", "files.write", "agent.delegate"],
  },
  {
    id: "productivity.google-workspace",
    version: "1.2.0",
    description: "Coordinate Gmail, Calendar, and Drive with read-first, approval-gated mutations.",
    instructions: [
      "Use the narrowest connector query and retrieve only the data needed for the request. Reconcile identities, dates, timezones, and file ownership before combining results.",
      "Summarize reads before proposing changes. Draft mail before sending, show calendar times with timezone, and avoid overwriting Drive content without first reading the current file.",
      "Every external mutation must pass the normal approval flow. After approval, verify the returned identifier or state and report partial failures without repeating successful actions.",
    ].join(" "),
    allowedTools: [
      "google_drive.files", "gmail.messages", "google_calendar.events", "google_drive.file.create",
      "google_drive.file.update", "gmail.draft.create", "gmail.send", "google_calendar.event.create",
      "google_calendar.event.update",
    ],
  },
  {
    id: "development.github",
    version: "2.0.0",
    description: "Inspect repositories and prepare branches, commits, issues, and pull requests safely.",
    instructions: [
      "Inspect the repository and relevant files before proposing a GitHub mutation. Preserve the existing branch strategy, contribution guidance, and issue or pull-request templates.",
      "Keep each branch and commit focused. Never include secrets, generated artifacts, or unrelated user changes. Describe the problem, implementation, tests, risks, and rollback in pull requests.",
      "Branch creation, commits, issues, and pull requests are external mutations and require approval. Verify returned SHAs, numbers, and URLs after execution; never claim a push or merge that was not performed.",
    ].join(" "),
    allowedTools: ["github.repositories", "github.branch.create", "github.file.commit", "github.pull_request.create", "github.issue.create", "files.list", "files.read"],
  },
  {
    id: "notes.obsidian",
    version: "1.0.0",
    description: "Read and maintain Markdown notes using stable links, frontmatter, and conservative edits.",
    instructions: [
      "Treat the selected workspace directory as the vault. Inspect nearby naming, frontmatter, tags, and linking conventions before creating or updating a note.",
      "Use readable Markdown, stable filenames, and existing wiki-link conventions. Prefer small targeted edits; do not reorganize, rename, or delete unrelated notes without explicit authorization.",
      "Preserve unknown frontmatter fields and user prose. When summarizing multiple notes, cite their paths and distinguish direct note content from new synthesis.",
    ].join(" "),
    allowedTools: SAFE_FILE_TOOLS,
  },
  {
    id: "media.youtube-content",
    version: "1.0.0",
    description: "Turn accessible video transcripts and metadata into grounded summaries or derivative drafts.",
    instructions: [
      "Obtain the canonical video URL, title, creator, publish date, and an accessible transcript or user-supplied text. Do not pretend to have watched frames or heard audio unless a tool actually analyzed them.",
      "Anchor key points to transcript timestamps when available, preserve speaker uncertainty, and distinguish the creator's claims from verified facts.",
      "Create the requested summary, outline, article, or social draft in a new file while preserving attribution. Flag missing transcripts, sponsorships, and claims that need independent verification.",
    ].join(" "),
    allowedTools: ["web.search", "browser.open", "files.list", "files.read", "files.write", "media.audio.transcribe"],
  },
  {
    id: "creative.architecture-diagram",
    version: "1.0.0",
    description: "Create a clear, accessible architecture diagram as portable SVG or HTML.",
    instructions: [
      "Confirm the audience and the single relationship the diagram must explain. Derive components and flows from supplied evidence, group by trust or ownership boundary, and use a consistent direction.",
      "Prefer semantic labels over decoration, limit colors, include a legend only when needed, and make text readable at normal zoom. Do not use vendor icons or claim infrastructure not present in the source.",
      "Write a self-contained SVG or HTML artifact in the workspace, then inspect the file structure and provide a short text explanation of the same architecture for accessibility.",
    ].join(" "),
    allowedTools: ["files.list", "files.read", "files.write", "terminal.inspect"],
  },
  {
    id: "writing.humanizer",
    version: "2.5.1",
    description: "Edit drafts into specific, natural prose while preserving facts, intent, and the author's voice.",
    instructions: [
      "First identify audience, purpose, tone, and factual constraints. Remove generic openings, inflated claims, repetitive conclusions, canned transitions, excessive headings, and vague abstraction.",
      "Replace them with concrete nouns and verbs, varied sentence rhythm, honest uncertainty, and details already supported by the source. Do not fabricate anecdotes, opinions, citations, or personal experience.",
      "Preserve meaning and required terminology. Return the revised text and, when useful, a brief note on substantive edits rather than a performative list of stylistic micro-changes.",
    ].join(" "),
    allowedTools: ["files.list", "files.read", "files.write", "text.statistics"],
  },
  {
    id: "web.computer-use",
    version: "2.1.0",
    description: "Operate a configured browser cautiously with observation before action and bounded recovery.",
    instructions: [
      "Prefer direct read or connector tools when they can answer the request. For interactive browsing, observe the current page before every action and use the smallest sequence of clicks or inputs.",
      "Never enter secrets into an unverified origin, bypass access controls, or perform purchases, submissions, account changes, or messages without approval. Stop on unexpected domain changes, CAPTCHAs, destructive prompts, or ambiguous targets.",
      "After each meaningful action, verify the visible result. Limit retries, avoid repeating side effects, and report the last confirmed state when blocked.",
    ].join(" "),
    allowedTools: ["browser.open", "browser.interact"],
  },
  {
    id: "productivity.price-monitor",
    version: "0.1.0",
    description: "Track a product, fare, or listing price with normalized evidence and a clear alert condition.",
    instructions: [
      "Confirm the exact item or route, region, currency, variant, seller constraints, taxes or fees, and the target condition before comparing prices.",
      "Record canonical URL, observed price, currency, availability, timestamp, and material terms. Do not compare unlike variants or present stale snippets as current prices.",
      "For recurring checks, write a compact observation history and report only meaningful changes or a crossed threshold. Never purchase, reserve, or contact a seller without explicit approval.",
    ].join(" "),
    allowedTools: ["web.search", "browser.open", "browser.interact", "files.list", "files.read", "files.write", "system.current_time"],
  },
];
