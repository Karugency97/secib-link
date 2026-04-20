# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Nature du projet

SECIB Link est une **MailExtension Thunderbird** (manifest V2, Thunderbird 115+) qui relie les mails au GED du cabinet NPL (SECIB Neo). Elle est en cours de portage vers Gmail (dossier `gmail/`, MV3 Chrome/Firefox) — cf. `docs/superpowers/plans/`.

Cabinet-interne, distribué en `.xpi` signé via addons.thunderbird.net (ATN) en canal **unlisted**.

## Commandes usuelles

Pas de toolchain JS (pas de `package.json`, pas de bundler, pas de tests). Les seuls outils :

```bash
# Vérification syntaxique (pré-commit + CI)
for f in background.js sidebar/*.js compose/*.js; do node --check "$f"; done

# Dev : charger comme extension temporaire
#   Thunderbird → about:debugging → "Ce Thunderbird"
#   → "Charger un module temporaire" → sélectionner manifest.json

# Build .xpi local (la CI le fait automatiquement sur tag vX.Y.Z)
zip -r ../secib-link-$(jq -r .version manifest.json).xpi . \
  -x "*.DS_Store" -x "*/.git/*" -x "*.xpi" -x "README.md" -x ".gitignore" -x "docs/*"

# Signature ATN (unlisted)
export WEB_EXT_API_KEY='user:12345:67'
export WEB_EXT_API_SECRET='<secret>'
web-ext sign   # config dans .web-ext-config.cjs
```

## Flux de release

1. Bumper `"version"` dans `manifest.json`.
2. `git tag v1.2.0 && git push --tags` → GitHub Action `build-xpi.yml` build un `.xpi` non-signé et crée une **draft release**.
3. Soumettre le `.xpi` à ATN (manuel, mode "On your own"). Récupérer le `.xpi` signé (suffixe `-tb.xpi`).
4. Remplacer le `.xpi` non signé dans la release, publier.
5. `update-manifest.yml` met automatiquement à jour `updates.json` (hébergé dans la branche `main`), ce qui déclenche l'auto-update côté Thunderbird via `browser_specific_settings.gecko.update_url`.

Le `tag v$VERSION` **doit** correspondre exactement à `manifest.json > version`, sinon le workflow échoue.

## Architecture

Deux fenêtres popup indépendantes, gérées par `background.js` :

- **Sidebar lecture** (`sidebar/`) — déclenchée par `messageDisplayAction` ou `browserAction`. Affiche dossiers liés à l'expéditeur du mail sélectionné, propose l'enregistrement `.eml` + pièces jointes dans SECIB. Reçoit les changements de mail via `messageDisplay.onMessageDisplayed` → `tabs.sendMessage({ type: "secib-link/setMessage", messageId })`.
- **Compose helper** (`compose/`) — déclenché par `composeAction`. Permet de choisir un dossier SECIB, cocher des parties (→ To/Cc) et des documents (→ pièces jointes) puis "Appliquer au mail" en une fois. Interagit avec la fenêtre de composition via `browser.compose.getComposeDetails` / `setComposeDetails` / `addAttachment`.

`background.js` ne fait **que** de l'ouverture/focus de fenêtres popup. Aucune logique métier, aucun appel API — tout se passe dans les popups, qui chargent `sidebar/secib-api.js`.

## Backend : Gateway-only (règle stricte depuis v2.0.0)

**Toutes** les communications avec SECIB Neo passent par la Gateway NPL-SECIB (`https://apisecib.nplavocat.com/api/v1`). L'extension n'a **plus** de credentials OAuth2 SECIB directs (supprimés au `onStartup` / `onInstalled` — cf. `background.js:11-35`).

- Auth unique : header `X-API-Key` (stockage `browser.storage.local.gateway_api_key`).
- Base URL configurable : `browser.storage.local.gateway_url`.
- La Gateway unwrap les réponses SECIB sous `{ data: ... }` → `sidebar/secib-api.js` extrait `.data` systématiquement.
- Quand vous ajoutez un appel SECIB : **ne jamais fetch directement** l'API SECIB. Ajoutez un endpoint côté Gateway (repo séparé) puis une méthode dans `secib-api.js`.

Raison : SECIB attend le body JSON sur certains GET (impossible en `fetch`), et la Gateway centralise l'OAuth2 + le rate limiting + les logs cabinet.

Endpoints Gateway utilisés (tous `GET` sauf mention) :
- `/personnes`, `/personnes/{id}`, `/personnes/{id}/dossiers`
- `/dossiers`, `/dossiers/{id}`, `/dossiers/{id}/repertoires`, `/dossiers/{id}/parties`
- `/documents?dossierId=`, `/documents/{id}/content`, `POST /documents/save-or-update`
- `/referentiel/etapes-parapheur`, `/referentiel/intervenants` (cachés 24 h côté client)

## Conventions non-évidentes

- **Manifest V2 obligatoire** (Thunderbird n'est pas encore MV3). Ne pas "moderniser" vers MV3 sans cible explicite.
- **Tag "Enregistré SECIB"** (`secib-saved`, couleur `#059669`) posé sur le mail après upload réussi. Sert à éviter les doublons (bandeau "déjà enregistré"). Créé à la volée via `browser.messages.tags.create` si absent.
- **Étape parapheur + destinataire** : doivent être fournis ensemble au `POST /documents/save-or-update`, ou aucun des deux. Contrainte SECIB — vérifiée client-side dans `sidebar.js`.
- **`.eml` allégé** : option pour enregistrer le mail sans PJ (quand on uploade les PJ séparément vers d'autres dossiers). La logique de stripping MIME est dans `sidebar.js` autour de `getRaw`.
- **Compose helper ≠ Sidebar** : deux fenêtres distinctes, deux `tabId` suivis indépendamment dans `background.js`. Ne pas les fusionner — ils ciblent des contextes Thunderbird différents (lecture vs compose).
- **Popup type `popup`** (pas `panel`) pour contourner des bugs de focus sur macOS.

## Docs internes

- `docs/gateway/` — spec REST de la Gateway NPL-SECIB (référence pour l'extension).
- `docs/superpowers/specs/` + `docs/superpowers/plans/` — specs design + plans d'exécution détaillés (format superpowers plugin). Consulter ces documents avant toute évolution structurelle (compose, parapheur, gateway).

## Portage Gmail (en cours, dossier `gmail/`)

Le dossier `gmail/` hébergera une extension **Chrome/Firefox MV3** réutilisant `sidebar/secib-api.js` tel quel (c'est du `fetch` pur). Les APIs Thunderbird (`browser.messages.*`, `browser.compose.*`, `browser.messageDisplay.*`) seront remplacées par la **Gmail API** (OAuth2 Google) + un **content script** sur `mail.google.com`. Voir le plan dans `docs/superpowers/plans/` pour le détail. Ne pas mélanger les deux manifests.
