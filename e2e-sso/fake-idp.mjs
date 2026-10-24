// A stand-in for Microsoft sign-in, for tests only: an account picker that posts a signed ID token
// back to the app (response_mode=form_post), plus the public key set the app verifies against.
import http from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const PORT = 3401, ISSUER = `http://localhost:${PORT}/v2.0`, CLIENT = "client-e2e";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwks = { keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", use: "sig", kid: "k1" }] };

const PEOPLE = {
  student: { email: "student.one@stu.ykpaoschool.cn", name: "Student One" },
  teacher: { email: "teacher.one@ykpaoschool.cn", name: "Teacher One" },
  admin: { email: "boss@ykpaoschool.cn", name: "Boss Person" },
  outsider: { email: "someone@gmail.com", name: "Outsider" },
  otherapp: { email: "student.two@stu.ykpaoschool.cn", name: "Other App", aud: "a-different-app" },
  badnonce: { email: "student.three@stu.ykpaoschool.cn", name: "Bad Nonce", nonce: "not-the-nonce" },
};

const token = (p, nonce) =>
  new SignJWT({ nonce: p.nonce ?? nonce, email: p.email, name: p.name })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience(p.aud ?? CLIENT)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/keys") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(jwks)); }
  if (url.pathname === "/authorize") {
    const q = url.searchParams;
    if (q.get("client_id") !== CLIENT) { res.statusCode = 400; return res.end("unknown client"); }
    const forms = await Promise.all(Object.entries(PEOPLE).map(async ([id, p]) => `
      <form method="post" action="${q.get("redirect_uri")}">
        <input type="hidden" name="id_token" value="${await token(p, q.get("nonce"))}">
        <input type="hidden" name="state" value="${q.get("state")}">
        <button id="pick-${id}">${p.email}</button>
      </form>`));
    res.setHeader("content-type", "text/html");
    return res.end(`<h1>Pick an account</h1>${forms.join("")}`);
  }
  res.statusCode = 404; res.end();
}).listen(PORT, () => console.log("fake idp on", PORT));
