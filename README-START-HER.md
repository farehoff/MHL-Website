# MHL – ren Cloudflare Pages-installasjon fra GitHub

Denne utgaven er basert på MHL v9. Den er tilpasset **nytt Cloudflare Pages-prosjekt fra GitHub**, og inneholder både nettside, Pages Functions, D1-oppsett, R2-bildebibliotek og eksisterende MHL-grunndata.

## VIKTIG – unngå tidligere databasefeil

- Opprett **en helt ny D1-database**, for eksempel `mhl-db`.
- `schema.sql` oppretter BÅDE `site_state` og `photos`. Du skal **ikke** kjøre `migrations/002_photos.sql` (den er ikke med i denne pakken).
- `seed.sql` skal kun kjøres **én gang**, og bare på en ny og tom database. Den initialiserer MHL-innholdet.
- Å slette et Pages-prosjekt sletter ikke nødvendigvis en separat D1-database eller R2-bucket. Kontroller navn og eksisterende ressurser før du fortsetter.
- Ta alltid database-backup før senere endringer, og ikke kjør `seed.sql` på nytt etter at admin har registrert ekte data.

## 1. Legg prosjektet på GitHub

1. Opprett et nytt, privat repo, eksempelvis `mhl-nettside`.
2. Pakk ut ZIP-filen og last opp **alle filer og mapper i rot**, særlig `public/`, `functions/`, `schema.sql` og `seed.sql`.
3. Standardgren: `main`.
4. Det er ingen GitHub Actions-workflow her; Cloudflare kobles direkte til GitHub og deployer ved endringer.

## 2. Opprett nytt Cloudflare Pages-prosjekt

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** (grensesnittnavn kan variere).
2. Velg GitHub og repoet du opprettet.
3. Sett følgende build-innstillinger:
   - Framework preset: `None`
   - Build command: **tom** (ingen bygging)
   - Build output directory: `public`
   - Root directory: repoets rot (`/`)
   - Production branch: `main`
4. Start første deploy. API-et vil foreløpig trenge databasebinding og secrets før det fungerer.

Tips: Cloudflare Pages finner `functions/` i repoets rot ved Git-basert deploy. Ikke flytt den inn i `public/`.

## 3. Opprett og fyll D1-databasen

1. Cloudflare Dashboard → **D1 SQL Database** → Create. Bruk navnet `mhl-db` hvis det er tilgjengelig.
2. Installer Node.js lokalt, åpne terminal i repo-mappen, og kjør:

```sh
npx wrangler login
npx wrangler d1 execute mhl-db --remote --file=./schema.sql
npx wrangler d1 execute mhl-db --remote --file=./seed.sql
```

Disse to SQL-filene kjøres **i denne rekkefølgen, én gang**, mot riktig database. Du kan kontrollere initialisering med:

```sh
npx wrangler d1 execute mhl-db --remote --command="SELECT id, revision FROM site_state; SELECT count(*) AS bilder FROM photos;"
```

Hvis du gir databasen et annet navn, bytt `mhl-db` i kommandoene.

## 4. Opprett R2-bucket og bind ressursene til Pages

1. Opprett en R2-bucket med navn `mhl-images` i Cloudflare (R2 kan kreve aktivert fakturering).
2. Åpne Pages-prosjektet → **Settings → Bindings**.
3. Legg til en **D1-binding**: Variable name `DB` → D1-databasen `mhl-db`.
4. Legg til en **R2-binding**: Variable name `IMAGES` → bucket `mhl-images`.
5. Gjør dette for **Production**. Hvis du skal teste preview deployments, konfigurer tilsvarende preview-ressurser bevisst og unngå å bruke produksjonsdatabase til tester.

## 5. Konfigurer sikre administratorhemmeligheter

I Pages-prosjektet under **Settings → Variables and Secrets** (eller tilsvarende miljøinnstillinger), opprett **secrets** for Production:

- `ADMIN_USERNAME` – administratorkontoens brukernavn
- `ADMIN_PASSWORD` – et sterkt, unikt passord
- `SESSION_SECRET` – en lang, tilfeldig hemmelighet (minst 32 tilfeldige byte)

Eksempel for å generere en tilfeldig hemmelighet i PowerShell:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Ikke legg noen av hemmelighetene i GitHub eller `public/`.

## 6. Kjør en ny deployment

Push en liten commit til `main` eller bruk **Retry deployment** i Cloudflare. En ny deploy er nødvendig etter bindinger. Åpne:

- `https://<ditt-prosjektnavn>.pages.dev/`
- `https://<ditt-prosjektnavn>.pages.dev/api/state` (skal returnere JSON med `data` og `revision`)
- `https://<ditt-prosjektnavn>.pages.dev/api/photos` (skal vise bildebibliotekets metadata)

Logg deretter inn i Admin og test et innlegg og et bildebibliotek-bilde. Test i en annen nettleser for å bekrefte at data faktisk lagres sentralt.

## 7. Koble domenet mhl-trondelag.no

Når alt virker: Pages-prosjektet → **Custom domains** → **Set up a domain**. Domenet må eies og DNS må peke riktig. Cloudflare forklarer eventuelle nødvendige DNS-endringer. Koble gjerne `www.mhl-trondelag.no` også og velg én primæradresse.

## Om eksisterende data

Pakken leveres med MHL v9 sine eksisterende grunndata. Nye oppdateringer i admin lagres i D1. Hvis du hadde registrert data i nettleseren på den gamle nettsiden, følger ikke de automatisk med. Eksporter dem fra gammel nettleser-backup dersom de skal overføres, og importer kun etter kontroll for duplikate kamper.

## Innhold i prosjektet

- `public/`: nettsted, bilder, favicon og klientkode
- `functions/`: server-API, adminautentisering og R2-bildeendepunkter
- `schema.sql`: én samlet databasestruktur for ren installasjon
- `seed.sql`: startdata – brukes kun på tom database
- `package.json`: Wrangler for vedlikehold og lokale kommandoer

## Sikkerhet før lansering

Dette er en løsning med serverbasert innlogging, men fortsatt bare én administratorkonto. Aktiver gjerne ekstra tilgangsbeskyttelse/2FA, ta sikkerhetskopier og gjennomfør manuell ende-til-ende-test før andre får adminrettigheter. Det er ikke gjennomført en live-test mot din Cloudflare-konto her.
