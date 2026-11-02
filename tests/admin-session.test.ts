import {test} from "node:test";
import assert from "node:assert/strict";
import {readKey,sealAdminSession,unsealAdminSession,sameOrigin,ADMIN_COOKIE} from "../src/modules/auth/session";
const key=readKey(Buffer.alloc(32,73).toString("base64"));
test("session tokens are encrypted, expire and cannot be tampered",()=>{
 const now=Date.now();
 const session={accessToken:"x".repeat(100),expiresAt:now+120000};
 const cookie=sealAdminSession(session,key);
 assert.ok(!cookie.includes(session.accessToken));
 assert.deepEqual(unsealAdminSession(cookie,key,now),session);
 assert.equal(unsealAdminSession(cookie,key,now+120001),null);
 assert.equal(unsealAdminSession(cookie.slice(0,-8)+"tampered",key,now),null);
 assert.equal(unsealAdminSession(cookie,Buffer.alloc(32,20),now),null);
});
test("cookies are host-scoped, strict origin required",()=>{
 assert.equal(ADMIN_COOKIE,"__Host-an-admin");
 assert.equal(sameOrigin("https://store.example","https://store.example"),true);
 assert.equal(sameOrigin("https://evil.example","https://store.example"),false);
 assert.equal(sameOrigin(null,"https://store.example"),false);
});
