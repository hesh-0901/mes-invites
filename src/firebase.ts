```typescript
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDvOcaPR-1hgc22SrTsQj1NWbXK32PABYM',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'mariage-424b1.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'mariage-424b1',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'mariage-424b1.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '24983143200',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:24983143200:web:9f0deff21ea1fddcaf0d45',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-9YE2WTHMB3',
};

const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const storage = getStorage(app);

export const firebaseConfigured = true;
export const firebaseApp = app;
```
