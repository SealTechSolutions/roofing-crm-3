# SealTech CRM — Native App Setup Guide

**Goal:** Turn the SealTech CRM into a real iOS app installable on team iPhones via TestFlight.

**Repo:** `https://github.com/SealTechSolutions/roofing-crm-3`
**Apple Team ID:** `2J8T63SX9L` (SealTech Building Solutions — Individual enrollment)
**Bundle ID:** `com.sealtechbuilding.crm`
**Codemagic Team ID:** `6a5fc8d6c7a9522664488997`

## Where we are

- [x] Capacitor 7 installed in `/app/frontend`
- [x] `capacitor.config.ts` configured — bundle ID `com.sealtechbuilding.crm`, name "SealTech CRM", SealTech-navy splash, camera + GPS permission strings
- [x] App icon (1024×1024) and splash (2732×2732) generated at `/app/frontend/resources/`
- [x] Native-capabilities helper (`src/lib/nativeCapabilities.ts`) — dynamically imports Capacitor plugins so the same React code works in both browser and native
- [ ] **User signs up for Apple Developer** ($99/yr — [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll))
- [ ] Cloud iOS build (Codemagic free tier — 500 build-minutes/month, no Mac needed)
- [ ] Upload signed `.ipa` to TestFlight
- [ ] Invite team by email → they tap "Install" in the TestFlight iPhone app → SealTech CRM appears on their home screen

## Step-by-step: Apple Developer signup (~20 min)

1. Go to [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll)
2. Sign in with an Apple ID (existing personal is fine, or make a new one dedicated to SealTech)
3. Choose enrollment: **Individual** (fastest — approves in hours). Organization requires D-U-N-S number and adds 2-3 days.
4. Fill out contact info, accept the license
5. Pay $99 (auto-renews annually)
6. Wait for the approval email — usually same day
7. Once approved, log into [App Store Connect](https://appstoreconnect.apple.com)
8. **Send me your Apple Team ID** — visible at [developer.apple.com/account](https://developer.apple.com/account) → Membership → "Team ID" (looks like `A1B2C3D4E5`)

## Step-by-step: Codemagic (free Mac cloud build)

Codemagic gives you 500 iOS build-minutes/month on Apple M1 Macs, no credit card required.

1. Go to [codemagic.io](https://codemagic.io) → Sign up with your GitHub account
2. Connect this repository (`Save to Github` from the Emergent chat → the codebase pushes to your GitHub)
3. In Codemagic, add your Apple Developer account:
   - Team Settings → Integrations → Apple Developer → Add
   - Sign in with the same Apple ID as your Developer account
4. In Codemagic, add an **App Store Connect API key**:
   - App Store Connect → Users and Access → Keys → Generate
   - Download the `.p8` file, note the Key ID and Issuer ID
   - Paste into Codemagic → Team Settings → Integrations → Developer Portal
5. Create a **workflow** — copy `/app/codemagic.yaml` (also in this repo) into the project root of GitHub — Codemagic auto-detects it
6. Trigger a build — takes ~15-20 minutes on the free tier

## Step-by-step: TestFlight distribution

Once Codemagic delivers the signed `.ipa` to App Store Connect:

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → My Apps → SealTech CRM → TestFlight
2. Wait for the build to appear (~5-10 min after Codemagic upload)
3. Enable **External Testing** — add tester emails (up to 100 team members)
4. Each tester gets an email invite — they tap the link on their iPhone
5. Downloads the free **TestFlight** app from the App Store (one-time)
6. TestFlight installs your SealTech CRM app → home-screen icon → no URL bar → done

## Notes on the app config

- **Bundle ID** — `com.sealtechbuilding.crm`. Register this in App Store Connect BEFORE the first build. To change later requires publishing a new app.
- **App server URL** — the compiled app opens `https://roofing-crm-3.preview.emergentagent.com` by default. Once production DNS is set up (e.g. `crm.sealtechsolutions.co`), update `server.allowNavigation` in `capacitor.config.ts` and rebuild.
- **Camera / GPS** — permission strings are set in `capacitor.config.ts`. iOS shows these to the user the first time each is requested.
- **App Icon** — currently uses the SealTech logo from `/app/frontend/public/icon-512.png`. Higher-res source or design-agency icon can be dropped into `/app/frontend/resources/icon.png` before build.

## Updating the app after launch

When you ship a feature and want it on your team's iPhones:

- **Web content only?** Nothing to do — Capacitor can be configured to fetch web updates from the live URL, so the app auto-refreshes when your team next opens it (already configured via `server.url`).
- **Native change** (new permission, plugin, icon)? Trigger a Codemagic build → new TestFlight version → team taps "Update" in the TestFlight app.

## Costs

| Item | Cost | Frequency |
|---|---|---|
| Apple Developer Program | $99 | Per year |
| Codemagic (free tier — 500 min/mo) | $0 | Ongoing |
| Team member licenses | $0 | Ongoing (TestFlight covers 100 external testers free) |
| Total year 1 | **$99** | |

## Timeline

- Day 1 — Apple Developer signup (in progress)
- Day 2 — Apple approves account; user shares Team ID
- Day 2-3 — I register the App ID in App Store Connect, set up Codemagic, run first build
- Day 3-4 — First `.ipa` delivered to TestFlight; user invites team
- Day 4 — Team installs SealTech CRM on iPhones
