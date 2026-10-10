# Mes Invites

Application de gestion des invitations de mariage : organisation par tables, fiches invités, QR codes et contrôle d'entrée.

## Première livraison — frontend

L'interface comprend :
- Tableau de bord avec statistiques dérivées des données de démonstration.
- Création et ouverture de tables.
- Ajout et modification d'invités depuis une table ouverte.
- Formatage automatique des noms individuels et des invitations Couple.
- Liste des invitations et prévisualisation avec QR code de démonstration.
- Écran de scanner caméra et saisie manuelle de secours.
- Historique des contrôles.
- Écran Templates en attente du visuel original.
- Paramètres et statut Firebase.
- Mise en page responsive et manifeste PWA pour installation sur les appareils compatibles.

## Stack

- React + Vite + TypeScript
- Tailwind CSS et styles personnalisés
- Firebase Web SDK (configuration du projet fournie)
- qrcode.react
- html5-qrcode
- Lucide React

## Démarrage local

```bash
npm install
npm run dev
```

Les paramètres du projet Firebase sont documentés dans `.env.example`. Vite peut également utiliser les valeurs publiques de configuration présentes dans `src/firebase.ts`.

## Déploiement Cloudflare Pages

Le dépôt est préparé pour un déploiement Cloudflare Pages à la racine du domaine :
- Framework preset : **Vite**
- Production branch : **main**
- Build command : `npm run build`
- Build output directory : `dist`
- Root directory : laisser vide (racine du dépôt)
- Runtime Node.js : version 20 ou supérieure

Dans Cloudflare Dashboard : **Workers & Pages → Create → Pages → Connect to Git** puis sélectionner le dépôt `hesh-0901/mes-invites`. Après la première compilation réussie, chaque push sur `main` déclenchera un nouveau déploiement. Le fichier `public/_redirects` fournit le fallback SPA.

## État des fonctionnalités

**Le frontend fonctionne en mode démonstration.** Les créations, modifications, scans et validations ne sont pas encore persistés dans Firestore. Les données initiales sont fictives et réinitialisées au rechargement.

Le template graphique original n'a pas encore été fourni. Aucune dimension ni coordonnée n'est supposée : l'écran Templates indique explicitement qu'il est en attente du fichier.

## Sécurité — à respecter avant une utilisation réelle

Le cahier des charges exclut Firebase Authentication et prévoit un mot de passe personnalisé. Un mot de passe vérifié uniquement dans le navigateur ne sécurise pas Firestore : les règles ne peuvent pas faire confiance à une variable d'interface ni à un hachage envoyé par un client anonyme.

Pour cette raison, `firestore.rules` et `storage.rules` refusent toutes les opérations par défaut. Il faut implémenter un endpoint serveur de connexion et des opérations autorisées côté serveur avant d'activer les données réelles. La validation d'entrée devra utiliser une transaction atomique côté serveur pour empêcher les doubles passages simultanés.

Ne pas utiliser le mode démonstration pour contrôler un événement réel.

## Firebase

Le fichier `firebase.json` référence les règles de sécurité. Ne les déployer qu'après avoir préparé le backend qui les remplacera ou les complétera avec une politique adaptée.
