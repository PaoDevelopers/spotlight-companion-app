import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import type { Db } from "../db";
import { createTestDb } from "../db/testdb";
import { users } from "../db/schema";
import type { OidcConfig } from "../auth/config";
import { OidcError, buildAuthorizeUrl, provisionUser, roleForEmail, verifyIdToken } from "./oidc";

const cfg: OidcConfig = {
  client: "client-123",
  authorize: "https://login.example/tenant/oauth2/v2.0/authorize",
  jwks: "https://login.example/tenant/keys",
  issuer: "https://login.example/tenant/v2.0",
  staffDomain: "ykpaoschool.cn",
  studentDomain: "stu.ykpaoschool.cn",
};
let keys: JWTVerifyGetKey;
let sign: (claims: Record<string, unknown>, o?: { aud?: string; iss?: string; exp?: string; key?: CryptoKey }) => Promise<string>;
let otherKey: CryptoKey;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  otherKey = (await generateKeyPair("RS256")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", use: "sig" }] });
  sign = (claims, o = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256" }).setIssuer(o.iss ?? cfg.issuer).setAudience(o.aud ?? cfg.client)
      .setIssuedAt().setExpirationTime(o.exp ?? "5m").sign(o.key ?? privateKey);
});

const good = { nonce: "n1", email: "Ada@Stu.YKPAOSchool.cn", name: "Ada L" };

describe("verifyIdToken", () => {
  it("accepts a valid token and normalises the email", async () => {
    expect(await verifyIdToken(await sign(good), cfg, "n1", keys)).toEqual({ email: "ada@stu.ykpaoschool.cn", name: "Ada L" });
  });
  it("falls back to preferred_username when there is no email claim", async () => {
    const t = await sign({ nonce: "n1", preferred_username: "bo@ykpaoschool.cn" });
    expect((await verifyIdToken(t, cfg, "n1", keys)).email).toBe("bo@ykpaoschool.cn");
  });
  it.each([
    ["wrong audience (token minted for another app)", { aud: "someone-else" }],
    ["wrong issuer (another tenant)", { iss: "https://login.example/other/v2.0" }],
    ["expired", { exp: "-5m" }],
    ["signed by an unknown key", { key: "other" }],
  ])("rejects %s", async (_n, o) => {
    const opts = { ...o, key: "key" in o ? otherKey : undefined } as Parameters<typeof sign>[1];
    await expect(verifyIdToken(await sign(good, opts), cfg, "n1", keys)).rejects.toMatchObject({ code: "token" });
  });
  it("rejects an unsigned (alg none) token", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const t = `${b64({ alg: "none" })}.${b64({ ...good, iss: cfg.issuer, aud: cfg.client, exp: 9e9 })}.`;
    await expect(verifyIdToken(t, cfg, "n1", keys)).rejects.toMatchObject({ code: "token" });
  });
  it("rejects a nonce from a different sign-in", async () => {
    await expect(verifyIdToken(await sign(good), cfg, "other-nonce", keys)).rejects.toMatchObject({ code: "nonce" });
    await expect(verifyIdToken(await sign({ email: good.email }), cfg, "n1", keys)).rejects.toMatchObject({ code: "nonce" });
  });
  it("rejects a token with no usable email", async () => {
    await expect(verifyIdToken(await sign({ nonce: "n1", name: "x" }), cfg, "n1", keys)).rejects.toBeInstanceOf(OidcError);
  });
});

describe("roleForEmail", () => {
  it("maps exact school domains only", () => {
    expect(roleForEmail("a@stu.ykpaoschool.cn", cfg)).toBe("student");
    expect(roleForEmail("a@ykpaoschool.cn", cfg)).toBe("teacher");
    expect(roleForEmail("a@gmail.com", cfg)).toBeNull();
    expect(roleForEmail("a@evil.ykpaoschool.cn", cfg)).toBeNull();
    expect(roleForEmail("a@ykpaoschool.cn.evil.com", cfg)).toBeNull();
    expect(roleForEmail("ykpaoschool.cn@evil.com", cfg)).toBeNull();
  });
});

describe("buildAuthorizeUrl", () => {
  it("asks for a form_post id_token bound to our client, redirect and nonce", () => {
    const u = new URL(buildAuthorizeUrl(cfg, "https://app.example/auth", "n1", "n1.abc"));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "client-123", response_type: "id_token", response_mode: "form_post",
      redirect_uri: "https://app.example/auth", nonce: "n1", state: "n1.abc", scope: "openid profile email",
    });
  });
});

describe("provisionUser", () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });

  it("creates students and teachers from their school domain", async () => {
    const s = await provisionUser(db, { email: "kid@stu.ykpaoschool.cn", name: "Kid" }, cfg, []);
    const t = await provisionUser(db, { email: "ms@ykpaoschool.cn", name: "Ms T" }, cfg, []);
    expect([s.role, t.role]).toEqual(["student", "teacher"]);
  });
  it("refuses outside domains and creates nothing", async () => {
    await expect(provisionUser(db, { email: "x@gmail.com", name: "X" }, cfg, ["x@gmail.com"])).rejects.toMatchObject({ code: "domain" });
    expect(await db.select().from(users)).toHaveLength(0);
  });
  it("keeps an existing role (even a promoted one), links by email and refreshes the name", async () => {
    await db.insert(users).values({ email: "kid@stu.ykpaoschool.cn", name: "Old", role: "teacher", className: "10A" });
    const u = await provisionUser(db, { email: "kid@stu.ykpaoschool.cn", name: "New" }, cfg, []);
    expect(u).toMatchObject({ role: "teacher", name: "New", className: "10A" });
    expect(await db.select().from(users)).toHaveLength(1);
  });
  it("makes ADMIN_EMAILS addresses admins, new or existing", async () => {
    const a = await provisionUser(db, { email: "boss@ykpaoschool.cn", name: "Boss" }, cfg, ["boss@ykpaoschool.cn"]);
    expect(a.role).toBe("admin");
    await db.insert(users).values({ email: "t@ykpaoschool.cn", name: "T", role: "teacher" });
    const t = await provisionUser(db, { email: "t@ykpaoschool.cn", name: "T" }, cfg, ["t@ykpaoschool.cn"]);
    expect(t.role).toBe("admin");
  });
});
