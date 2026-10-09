import * as oidc from "openid-client";
import { z } from "zod";
import type { VhostOauthProvider } from "@yep-anywhere/shared";

const httpsUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "An HTTPS URL without credentials, query or fragment is required");

export const vhostOauthProviderSchema = z
  .object({
    kind: z.enum(["entra", "oidc"]),
    tenantId: z.string().trim().max(128),
    issuer: z.string().trim().max(2048),
    clientId: z.string().trim().min(1).max(256),
    callbackUrl: httpsUrl.refine(
      (value) => new URL(value).pathname !== "/",
      "A callback path is required",
    ),
    visitorIp: z.enum(["peer", "cloudflare", "x-real-ip"]),
  })
  .superRefine((value, context) => {
    if (
      value.kind === "entra" &&
      !["common", "organizations"].includes(value.tenantId) &&
      !z.uuid().safeParse(value.tenantId).success
    )
      context.addIssue({
        code: "custom",
        message: "Use common, organizations, or a directory (tenant) ID",
        path: ["tenantId"],
      });
    if (value.kind === "oidc" && !httpsUrl.safeParse(value.issuer).success)
      context.addIssue({
        code: "custom",
        message: "An HTTPS OpenID Connect issuer is required",
        path: ["issuer"],
      });
  });

export const vhostEmailPatternsSchema = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(254)
      .regex(/^[^\s@]+@[^\s@]+$/),
  )
  .max(32);

/** A partial environment configuration is an error, never a silent fallback. */
export function vhostOauthEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const keys = [
    "CLIENT_ID",
    "CLIENT_SECRET",
    "CALLBACK_URL",
    "TENANT_ID",
    "ISSUER",
    "PROVIDER",
    "VISITOR_IP",
  ];
  if (!keys.some((key) => env[`YEP_VHOST_OAUTH_${key}`] !== undefined)) return;
  const provider = vhostOauthProviderSchema.safeParse({
    kind: env.YEP_VHOST_OAUTH_PROVIDER ?? "entra",
    tenantId: env.YEP_VHOST_OAUTH_TENANT_ID ?? "common",
    issuer: env.YEP_VHOST_OAUTH_ISSUER ?? "",
    clientId: env.YEP_VHOST_OAUTH_CLIENT_ID,
    callbackUrl: env.YEP_VHOST_OAUTH_CALLBACK_URL,
    visitorIp: env.YEP_VHOST_OAUTH_VISITOR_IP ?? "peer",
  });
  const secret = env.YEP_VHOST_OAUTH_CLIENT_SECRET;
  if (!provider.success || !secret || secret.length > 4096)
    throw new Error(
      "Invalid YEP_VHOST_OAUTH configuration: CLIENT_ID, CLIENT_SECRET and HTTPS CALLBACK_URL are required",
    );
  return { provider: provider.data, secret };
}

export interface VhostOauthIdentity {
  issuer: string;
  subject: string;
  email: string;
  /** Personal Microsoft claims cannot establish membership of a work domain. */
  domainVerified?: boolean;
}

/** One OpenID Connect client, shared by every configured vhost. */
export class VhostOauthProviderClient {
  private discovery?: Promise<oidc.Configuration>;
  private retryAt = 0;
  constructor(
    readonly settings: VhostOauthProvider,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private configuration(): Promise<oidc.Configuration> {
    if (!this.discovery || Date.now() >= this.retryAt) {
      this.retryAt = Number.POSITIVE_INFINITY;
      const issuer =
        this.settings.kind === "entra"
          ? `https://login.microsoftonline.com/${this.settings.tenantId}/v2.0`
          : this.settings.issuer;
      this.discovery = oidc
        .discovery(
          new URL(issuer),
          this.settings.clientId,
          this.secret,
          undefined,
          {
            [oidc.customFetch]: (url, { body, ...options }) =>
              this.fetcher(url, {
                ...options,
                body: body instanceof Uint8Array ? new Uint8Array(body) : body,
              }),
            timeout: 10,
          },
        )
        .then((config) => {
          oidc.enableNonRepudiationChecks(config);
          return config;
        })
        .catch((error: unknown) => {
          this.retryAt = Date.now() + 30_000;
          throw error;
        });
    }
    return this.discovery;
  }

  async authorizationUrl(
    state: string,
    nonce: string,
    verifier: string,
  ): Promise<string> {
    return oidc.buildAuthorizationUrl(await this.configuration(), {
      redirect_uri: this.settings.callbackUrl,
      scope:
        this.settings.kind === "entra"
          ? "openid profile email https://graph.microsoft.com/User.Read"
          : "openid email profile",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      response_mode: "query",
    }).href;
  }

  async identity(
    url: URL,
    state: string,
    nonce: string,
    verifier: string,
  ): Promise<VhostOauthIdentity> {
    const config = await this.configuration();
    const tokens = await oidc.authorizationCodeGrant(config, url, {
      expectedState: state,
      expectedNonce: nonce,
      pkceCodeVerifier: verifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error("Vhost OAuth requires an ID token");
    if (this.settings.kind === "entra") {
      if (
        !z.uuid().safeParse(claims.tid).success ||
        (!["common", "organizations"].includes(this.settings.tenantId) &&
          claims.tid !== this.settings.tenantId) ||
        claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0` ||
        typeof claims.oid !== "string"
      )
        throw new Error("Vhost OAuth tenant mismatch");
      if (claims.tid === "9188040d-6c67-4c5b-b112-36a304b66dad") {
        if (this.settings.tenantId === "organizations")
          throw new Error("A work account is required");
        const email = z
          .email()
          .max(254)
          .parse(claims.email ?? claims.preferred_username);
        return {
          issuer: claims.iss,
          subject: claims.sub,
          email: email.toLowerCase(),
          domainVerified: false,
        };
      }
      // Entra's email/preferred_username claims aren't proof of mailbox ownership.
      // Use the configured tenant's managed member account name instead.
      const response = await this.fetcher(
        "https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,userType",
        {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error("Vhost OAuth directory lookup failed");
      const account = z
        .object({
          id: z.string(),
          userPrincipalName: z.email().max(254),
          userType: z.literal("Member"),
        })
        .parse(await response.json());
      if (account.id !== claims.oid)
        throw new Error("Vhost OAuth directory identity mismatch");
      return {
        issuer: claims.iss,
        subject: claims.oid,
        email: account.userPrincipalName.toLowerCase(),
      };
    }
    const profile =
      claims.email_verified === true
        ? claims
        : await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
    const email = z.email().max(254).parse(profile.email);
    if (profile.email_verified !== true)
      throw new Error("Vhost OAuth requires a verified email");
    return {
      issuer: claims.iss,
      subject: claims.sub,
      email: email.toLowerCase(),
    };
  }
}
