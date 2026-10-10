import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDxj2LH5k1EpE3-ssQb2E1D4WPOZwBn1l8',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'japhm-6445b.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'japhm-6445b',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'japhm-6445b.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '433387974348',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:433387974348:web:3c6bd215f0350378c1dc69',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-297W02X06F',
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
);

export const firebaseApp = firebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

export const firestore = firebaseApp ? getFirestore(firebaseApp) : null;
export const storage = firebaseApp ? getStorage(firebaseApp) : null;

// This module only initializes client SDKs. Sensitive operations such as check-in
// must be verified by a trusted server and atomic database transaction.
