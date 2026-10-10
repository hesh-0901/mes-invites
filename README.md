# Mes Invites

Application de gestion d'invitations de mariage : organisation par tables, invitations personnalisées, QR codes uniques et contrôle d'entrée.

## État actuel

Cette première livraison pose les fondations du frontend et du parcours utilisateur. Les données sont en mode démonstration tant que les services Firestore et la validation serveur ne sont pas configurés.

## Stack prévue

- React + Vite + TypeScript
- Tailwind CSS
- Firebase Web SDK (configuration via variables d'environnement)
- QR code et scanner caméra
- PWA installable sur ordinateur compatible

## Démarrage

```bash
npm install
npm run dev
```

Copier `.env.example` vers `.env.local` et compléter les variables Firebase si nécessaire.

## Sécurité

La configuration Firebase Web identifie le projet mais ne protège pas les données. Les validations d'entrée devront passer par une opération serveur atomique et les règles Firestore devront être auditées avant toute utilisation réelle. Ne pas utiliser cette version de démonstration pour contrôler un véritable événement.

## Template

Le template original n'a pas encore été fourni. Aucune dimension ni coordonnée graphique n'est codée à ce stade.
