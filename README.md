# SECIB Link

Extension Thunderbird (MailExtension) pour le cabinet NPL — relie les mails reçus aux dossiers SECIB Neo et permet de les enregistrer en un clic.

## Fonctionnalités

- **Détection automatique** de l'expéditeur du mail sélectionné → recherche en cascade dans les tiers SECIB (email, domaine, nom)
- **Affichage des dossiers** liés à l'expéditeur avec code, intitulé, type, responsable, rôle (Client / Adversaire / …)
- **Recherche manuelle** d'un dossier par code ou nom
- **Enregistrement du mail** (.eml) dans le dossier + répertoire choisis
- **Mode avancé pièces jointes** : routage individuel des PJ vers d'autres dossiers/répertoires, avec autocomplete
- **.eml allégé** : option pour enregistrer le mail sans les PJ (utile quand on uploade les PJ séparément)
- **Tag "Enregistré SECIB"** posé sur le mail pour éviter les doublons
- **Fenêtre flottante persistante** : reste ouverte à côté de Thunderbird, se met à jour automatiquement quand on change de mail

## Installation (utilisateur final)

1. Télécharger le `.xpi` depuis la dernière [Release](../../releases)
2. Dans Thunderbird : **Outils → Modules complémentaires et thèmes**
3. Engrenage ⚙️ en haut à droite → **"Installer un module depuis un fichier"**
4. Choisir le `.xpi` téléchargé
5. Configurer l'API : ouvrir SECIB Link, cliquer sur l'icône engrenage, renseigner :
   - URL API (ex. `https://secibneo.secib.fr/8.2.1`)
   - Cabinet ID (GUID)
   - Client ID + Client Secret OAuth2

## Installation (développeur)

```bash
git clone https://github.com/Karugency97/secib-link.git
cd secib-link
```

Puis dans Thunderbird : `about:debugging` → "Ce Thunderbird" → "Charger un module temporaire" → sélectionner `manifest.json`.

## Build du .xpi

```bash
zip -r ../secib-link-$(grep '"version"' manifest.json | cut -d'"' -f4).xpi . \
  -x "*.DS_Store" -x "*/.git/*" -x "*.xpi" -x "README.md" -x ".gitignore"
```

## Architecture

```
SECIB-Link/
├── manifest.json          # MailExtension v2 (Thunderbird 115+)
├── background.js          # Logique fenêtre flottante + comm avec sidebar
├── icons/                 # 16/32/48/96 px
└── sidebar/
    ├── sidebar.html       # UI : recherche, dossiers, modale enregistrement
    ├── sidebar.css        # Styles (fenêtre 440x720)
    ├── secib-api.js       # Module API SECIB (OAuth2 + appels REST)
    └── sidebar.js         # Orchestration UI + logique métier
```

## API SECIB utilisées

- `POST /Personne/Get` — recherche tiers (Coordonnees / Denomination)
- `GET /Partie/GetByPersonneId` — dossiers d'une personne
- `POST /Dossier/GetDossiers` — recherche libre de dossiers (Code / Nom)
- `GET /Document/GetListRepertoireDossier` — répertoires d'un dossier
- `POST /Document/SaveOrUpdateDocument` — enregistrement d'un fichier dans un dossier+répertoire

Authentification OAuth2 client_credentials sur `https://api.secib.fr/forward/{cabinetId}/ApiToken`.

## Permissions requises

- `messagesRead`, `messagesUpdate`, `messagesTags`, `accountsRead`, `storage`
- `https://secibneo.secib.fr/*`, `https://api.secib.fr/*`

## Licence

Usage interne cabinet NPL.
