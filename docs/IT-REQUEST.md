# Request to school IT: Microsoft sign-in for the Spotlight Month app

**What it is.** A small web app for the Physics / CS Spotlight Month (events, check-in, exhibits, prizes).
It uses "Sign in with Microsoft" exactly like the CCA selection system: school accounts only.

## What we need
One **app registration** in the school's Microsoft Entra tenant (`ddd3d26c-b197-4d00-a32d-1ffd84c0c295`).
Either a new one, or an extra redirect address added to the CCA one if you prefer to keep a single registration.

| Setting | Value |
|---|---|
| Supported account types | **This organization only** (single tenant) |
| Platform | **Web** |
| Redirect URI | `https://events-tracker-mocha.vercel.app/auth` (test site; we will send the final address, e.g. `https://<school-domain>/auth`, and a second one for the school server if we host it there) |
| Authentication → Implicit grant and hybrid flows | **ID tokens: enabled** (same as CCA) |
| API permissions | Delegated **openid, profile, email** only (the default sign-in permissions) |
| Client secret / certificate | **Not needed** (we verify the signed ID token against Microsoft's public keys, as CCA does) |

If your tenant requires admin consent even for basic sign-in permissions, please grant it.

## What we get and keep
From the sign-in token we read only the user's **name and school email**. We use the email domain
(`@stu.ykpaoschool.cn` = student, `@ykpaoschool.cn` = staff) and refuse any other account.
We do not call Microsoft Graph and do not receive passwords.

## Please send back
The **Application (client) ID** of the registration (it is not a secret). Nothing else.

## Notes for reference
- Redirect addresses must match exactly; Microsoft does not allow wildcards. Each address we use must be listed.
- If anything fails at sign-in, Microsoft shows an error code (for example `AADSTS50011` = redirect address not registered, `AADSTS700054` = ID tokens not enabled). Please forward it to us.

## Reply from IT (3 Nov 2026)
- Registration created. Application (client) ID `e42a56a6-39f7-4c8c-be7c-2493fe4ec29c`, tenant `ddd3d26c-b197-4d00-a32d-1ffd84c0c295`.
- Sign-in is limited to staff and high-school students by IT; other accounts are blocked by Microsoft.
- A `localhost` redirect address is registered for testing only. Ask IT to remove it once the real site signs in.
- Deploy on the school network only for now; review before publishing to the Internet. IT asked whether it shares the machine with the CCA sign-up (still to answer).
