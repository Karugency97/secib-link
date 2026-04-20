# SECIB Link

Extension Thunderbird (MailExtension) pour le cabinet NPL — relie les mails reçus aux dossiers SECIB Neo et permet de les enregistrer en un clic.

## Fonctionnalités

- **Détection automatique** de l'expéditeur du mail sélectionné → recherche en cascade dans les tiers SECIB (email, domaine, nom)
- **Affichage des dossiers** liés à l'expéditeur avec code, intitulé, type, responsable, rôle (Client / Adversaire / …)
- **Recherche manuelle** d'un dossier par code ou nom
- **Enregistrement du mail** (.eml) dans le dossier + répertoire choisis
- **Mode avancé pièces jointes** : routage individuel des PJ vers d'autres dossiers/répertoires, avec autocomplete
- **Étape parapheur + destinataire** : possibilité d'associer le mail enregistré à une étape du parapheur SECIB et à un destinataire collaborateur (le mail apparaît dans le parapheur du destinataire à l'étape choisie)
- **.eml allégé** : option pour enregistrer le mail sans les PJ (utile quand on uploade les PJ séparément)
- **Tag "Enregistré SECIB"** posé sur le mail pour éviter les doublons
- **Fenêtre flottante persistante** : reste ouverte à côté de Thunderbird, se met à jour automatiquement quand on change de mail

## Installation (utilisateur final)

1. Télécharger le `.xpi` depuis la dernière [Release](../../releases)
2. Dans Thunderbird : **Outils → Modules complémentaires et thèmes**
3. Engrenage ⚙️ en haut à droite → **"Installer un module depuis un fichier"**
4. Choisir le `.xpi` téléchargé
5. Configurer la Gateway : ouvrir SECIB Link, cliquer sur l'icône engrenage, renseigner :
   - URL Gateway (ex. `https://apisecib.nplavocat.com`)
   - API Key (fournie par l'administrateur)

L'extension n'a plus besoin de credentials SECIB directs — la Gateway NPL-SECIB sert de pont vers SECIB Neo.

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

## API SECIB utilisées (toutes via la Gateway NPL-SECIB)

- `POST /Personne/Get` — recherche tiers (filtres `Coordonnees` / `Denomination` / `RechercheGenerique`)
- `GET /Personne/GetPersonnePhysique` / `GetPersonneMorale` — détail personne
- `GET /Partie/GetByPersonneId` — dossiers d'une personne
- `POST /Dossier/GetDossiers` — recherche dossiers (Code / Nom exacts)
- `POST /Dossier/Get` — recherche libre (RechercheGenerique)
- `GET /Dossier/GetDossierById` — détail dossier
- `GET /Document/GetListRepertoireDossier` — répertoires d'un dossier
- `GET /Document/ListeEtapeParapheur` — étapes de parapheur (cache 24h)
- `GET /Utilisateur/ListIntervenant` — intervenants du cabinet (cache 24h)
- `POST /Document/SaveOrUpdateDocument` — enregistrement d'un document (avec `EtapeParapheurId` + `DestinataireId` optionnels)

Authentification : `X-API-Key` sur toutes les requêtes. La Gateway gère l'OAuth2 SECIB côté serveur.

## Permissions requises

- `messagesRead`, `messagesUpdate`, `messagesTags`, `accountsRead`, `storage`
- `https://apisecib.nplavocat.com/*` (Gateway NPL-SECIB)

## Licence

Usage interne cabinet NPL.
