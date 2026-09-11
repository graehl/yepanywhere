/** Experimental, provider-neutral issue/session association contract. */
export interface IssueSettings {
  enabled: boolean;
  scope: "viewed" | "recent";
  recentDays: number;
  /** Absent means discovery never contacts a tracker, the original contract. */
  confirmation?: IssueConfirmationSettings;
  /**
   * Uppercase project parts ignored when a Jira key is seen without a URL.
   * Absent means {@link DEFAULT_JIRA_KEY_BLOCKLIST}; an empty array means none.
   */
  jiraKeyBlocklist?: string[];
  /** Recognize unknown bare ticket keys. Absent/false requires URL evidence. */
  aggressiveMatching?: boolean;
}

/**
 * Opt-in tracker confirmation.
 *
 * Text extraction alone cannot tell `PROJ-7` from `UTF-8`, so an installation
 * that has tracker credentials can let YA ask the tracker once whether a newly
 * seen reference is real. Off by default: turning it on is what authorizes
 * outbound requests carrying a credential.
 */
export interface IssueConfirmationSettings {
  enabled: boolean;
  /** Jira site for keys seen without a URL, e.g. https://x.atlassian.net. */
  jiraSite: string;
  /** Jira Cloud account email; the API token is its password. */
  jiraEmail: string;
}

/**
 * Uppercase prose tokens that look exactly like a Jira key before a number.
 *
 * A bare `PROJ-7` is indistinguishable from `UTF-8` by shape alone, and these
 * appear constantly in engineering transcripts. Blocking them applies only to
 * keys seen without a URL: a Jira browse URL still identifies its issue, so a
 * tracker whose real project key is on this list keeps working through links,
 * and an installation can edit the list.
 */
export const DEFAULT_JIRA_KEY_BLOCKLIST = [
  "AES",
  "AGPL",
  "ANSI",
  "BSD",
  "COVID",
  "CVE",
  "CWE",
  "ECMA",
  "EPL",
  "FIPS",
  "GMT",
  "GPL",
  "GPT",
  "IEC",
  "IEEE",
  "ISO",
  "JPEG",
  "LGPL",
  "MPEG",
  "MPL",
  "PEP",
  "RFC",
  "SHA",
  "SOC",
  "SQL",
  "SSH",
  "TLS",
  "USB",
  "UTC",
  "UTF",
  "WCAG",
] as const;

export type IssueCredentialProvider = "github" | "jira";

/** One place a credential can come from, and whether it is there now. */
export interface IssueCredentialSource {
  /** Environment variable name, stored-key label, or CLI command. */
  name: string;
  kind: "stored" | "env" | "cli";
  present: boolean;
}

/** Never carries a key: presence and origin only. */
export interface IssueCredentialStatus {
  provider: IssueCredentialProvider;
  /** Resolution order; the first present source wins. */
  sources: IssueCredentialSource[];
  /** Name of the source a lookup would use now, or null when none is usable. */
  active: string | null;
}

export interface IssueCredentialsResult {
  credentials: IssueCredentialStatus[];
}
export type IssueSort = "activity" | "mentioned" | "number";

export interface IssueItem {
  id: string;
  key: string;
  title: string | null;
  url: string | null;
  provider: string;
  kind: string;
  sessionCount: number;
  lastSessionActivityAt?: string | null;
  lastMentionAt?: string | null;
  unresolved: boolean;
  /**
   * What the tracker said when this reference was first seen, when
   * confirmation is on. Absent means nothing was ever asked.
   */
  confirmation?: {
    state: "pending" | "confirmed" | "rejected" | "unreachable";
    /** The tracker's own summary, present only for a confirmed reference. */
    title: string | null;
  };
}
export interface IssueEvidence {
  id: number;
  sessionId: string;
  projectId: string;
  messageId: string;
  excerpt: string;
  value: string;
  kind: string;
  observedAt: number;
  sourceTime: string | null;
  sourceAvailable?: boolean;
  sessionTitle?: string;
  state: string;
}
export interface KnownJiraProject {
  prefix: string;
  site: string;
}
export interface IssueSession {
  sessionId: string;
  projectId: string;
  title?: string;
  updatedAt?: string;
  createdAt?: string;
  provider?: import("./types.js").ProviderName;
  projectName?: string;
  initialPrompt?: string | null;
  model?: string;
  ownership?: import("./app-types.js").SessionOwnership;
  activity?: import("./app-types.js").AgentActivity;
  lastAgentText?: string | null;
  sourceAvailable?: boolean;
  state: string;
  evidenceCount: number;
  evidence: IssueEvidence[];
}
export interface IssueSessionsResult {
  sessions: IssueSession[];
  nextOffset: number | null;
}
export interface IssueCoverage {
  knownJiraProjects?: KnownJiraProject[];
  settings: IssueSettings;
  active: boolean;
  error: string | null;
  counts: Array<{ state: string; count: number }>;
}
export interface IssueSearchResult {
  /** Absent on earlier experimental servers; do not offer unsupported sorting. */
  supportedSorts?: IssueSort[];
  sort?: IssueSort | "key";
  items: IssueItem[];
  coverage: IssueCoverage;
  nextOffset: number | null;
}
export interface IssueEvidenceResult {
  evidence: IssueEvidence[];
  nextOffset: number | null;
}
