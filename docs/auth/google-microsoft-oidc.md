# Google and Microsoft OIDC Credential Setup

This guide explains how to create the credentials that QFlow expects in `Settings -> SSO`.

QFlow uses the OAuth 2.0 authorization code flow with OpenID Connect and requests:

- `openid`
- `email`
- `profile`

## What QFlow expects

| Provider  | QFlow field               | Provider value          |
| --------- | ------------------------- | ----------------------- |
| Google    | `Google Client ID`        | OAuth 2.0 Client ID     |
| Google    | `Google Client Secret`    | OAuth 2.0 Client Secret |
| Microsoft | `Microsoft Client ID`     | Application (client) ID |
| Microsoft | `Microsoft Client Secret` | Client secret `Value`   |
| Microsoft | `Microsoft tenant`        | Directory (tenant) ID   |

Notes:

- Microsoft sign-in is bound to one configured Directory tenant ID. QFlow verifies the exact tenant
  issuer returned in the ID token.
- In production, root-domain social login is brokered by the tenant slug in
  `QFLOW_PUBLIC_OIDC_TENANT_SLUG`. For `qflowlearn.com`, that broker tenant is `t-b9b5d8ba`
  (workspace name `QFlow`).

## Decide which redirect URIs to register

Register every QFlow host that can initiate Google or Microsoft login.

Typical callbacks:

- Tenant-host login: `https://<tenant-host>/auth/oidc/callback`
- Root-domain login: `https://<root-domain>/auth/oidc/callback`

Examples:

- `https://acme.qflowlearn.com/auth/oidc/callback`
- `https://qflowlearn.com/auth/oidc/callback`

The broker tenant's provider app must allow the root-domain callback URI in addition to any
tenant-host callback URIs you use.

## Google

1. Open Google Cloud Console and either create a project or choose an existing one.
2. Configure the OAuth consent screen if the project does not already have one. Use `External` if
   users outside your Google Workspace need to sign in. Use `Internal` only if all users are in the
   same Google Workspace organization.
3. Go to `APIs & Services -> Credentials`.
4. Select `Create Credentials -> OAuth client ID`.
5. Choose `Web application` as the application type.
6. Add every QFlow callback URI under `Authorized redirect URIs`.
7. Create the client and copy:
   - `Client ID`
   - `Client secret`
8. In QFlow, open `Settings -> SSO -> OIDC providers` and paste those values into:
   - `Google Client ID`
   - `Google Client Secret`
9. Enable Google OIDC and save.

QFlow does not use Google's browser JavaScript SDK for sign-in, so you generally do not need to add
`Authorized JavaScript origins` unless you are separately integrating Google client-side auth.

## Microsoft

1. Open the Microsoft Entra admin center.
2. Go to `Entra ID -> App registrations -> New registration`.
3. Enter an app name such as `QFlow`.
4. Choose the single-tenant account type and put that tenant's Directory (tenant) ID into QFlow's
   `Microsoft tenant` field.
5. Under `Redirect URI`, choose `Web` and add a QFlow callback URI. Add any other QFlow callback
   URIs you need after the app is created.
6. Create the app registration and record the `Application (client) ID`.
7. Record the `Directory (tenant) ID`.
8. Open `Certificates & secrets -> Client secrets -> New client secret`.
9. Create the secret and immediately copy the secret `Value`. Microsoft only shows that value once.
10. In QFlow, open `Settings -> SSO -> OIDC providers` and paste:
    - `Application (client) ID` into `Microsoft Client ID`
    - secret `Value` into `Microsoft Client Secret`
    - `Directory (tenant) ID` into `Microsoft tenant`
11. Enable Microsoft OIDC and save.

## QFlow configuration checklist

1. Save the provider credentials in the tenant's `Settings -> SSO` page.
2. Root-domain social login uses the broker tenant slug from `QFLOW_PUBLIC_OIDC_TENANT_SLUG`.
3. If you use domain-routed SSO, add domain mappings in `Settings -> SSO`.
4. Test each configured login path:
   - tenant-host `/login`
   - root-domain `/login` if public social login is enabled

## Official references

- Google OAuth 2.0 for web server applications:
  `https://developers.google.com/identity/protocols/oauth2/web-server`
- Google OAuth consent screen and client creation overview:
  `https://support.google.com/cloud/answer/15549257`
- Microsoft Entra app registration quickstart:
  `https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app`
- Microsoft Entra client secret creation:
  `https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials`
