# AN IPA STORE — server-verified Admin authentication

## Status
Implemented admin-only password sign-in through Supabase Auth `/auth/v1/token`, followed by a fresh `/auth/v1/user` check and a server-secret lookup in `public.roles` for `(user_id, role='admin')`. **No account creation, self-signup, role editing or admin role granting endpoint exists.** The Supabase project had no users at the time of initial inspection. Only an operator with direct Supabase Dashboard access can create/confirm an Admin user and grant its role; never grant based on a user-controlled email form or metadata.

## Security model
- `/admin/**` is protected by a server-side layout and fresh user+role check on every request. Client-side route guards are not trusted.
- `/auth` is public but only shows the login form if `ADMIN_AUTH_ENABLED=true`, `ADMIN_AUTH_WAF_READY=true`, secure app origin, Supabase keys and encryption key are configured.
- The email/password are sent through the first-party HTTPS login endpoint to Supabase Auth and **not stored or logged**. The client gets only a short-lived opaque AES-GCM encrypted `__Host-an-admin` HttpOnly/Secure/SameSite=Strict cookie.
- Maximum session length: 45 minutes without automatic refresh. After expiration Admin signs in again. The server calls Supabase Auth to revalidate identity and rechecks current Admin membership every time.
- Login/logout POST requests require exact same-origin; login requires JSON, bounded payload. WAF rate limiting, brute force protection and Auth email verification are mandatory.
- Admin auth **does not grant permission to upload IPA or issue OTA**. Those separate systems are still disabled.
- Server-only `SUPABASE_SECRET_KEY` is required for role lookup. It must never appear in frontend bundles, GitHub, logs or `NEXT_PUBLIC_*`.
- Access tokens embedded in encrypted cookie can remain valid with Supabase until JWT expiry; logout clears the browser cookie but does not guarantee immediate server-side revocation of a stolen token. Introduce server-side session revocation and MFA before exposing sensitive mutations.

## Operator configuration
1. In Supabase project `an-ipa-store`, create a single dedicated Admin user via Dashboard, require confirmed email, set strong authentication policies, restrict public signups and configure Auth rate limiting.
2. Assign role with an authenticated administrative operation to `public.roles` for exact authenticated UUID, not based on email or user metadata. Inspect the existing role schema and unique constraint before insertion.
3. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_ORIGIN` and `ADMIN_SESSION_KEY_B64` in hosting secret manager only. Never send actual values through chat.
4. Put application behind HTTPS/WAF and test password guessing, cross-origin login/logout, revoked users/roles, session expiry, XSS and mobile Safari. Then and only then enable both Admin flags.

## Tests
`tests/admin-session.test.ts` verifies encrypted short-lived session data, tamper rejection and same-origin policy. CI performs TypeScript/build checks. **No real Admin sign-in was tested** because no configured Admin credentials or HTTPS deployment were available. RLS multi-user integration and 2FA remain future security gates.
