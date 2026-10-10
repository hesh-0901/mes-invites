import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { firestore } from './firebase';
import type { Checkin, Guest, GuestTable } from './types';

export const FIRESTORE_COLLECTIONS = {
  tables: 'tables',
  guests: 'guests',
  checkins: 'checkins',
  settings: 'eventSettings',
} as const;

export type CollectionName = typeof FIRESTORE_COLLECTIONS[keyof typeof FIRESTORE_COLLECTIONS];

export async function loadCollection<T>(name: CollectionName): Promise<T[]> {
  if (!firestore) throw new Error('Firebase n’est pas configuré.');
  const snapshot = await getDocs(collection(firestore, name));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as T);
}

export async function saveRecord<T extends { id: string }>(name: CollectionName, record: T): Promise<void> {
  if (!firestore) throw new Error('Firebase n’est pas configuré.');
  await setDoc(doc(firestore, name, record.id), record, { merge: true });
}

export async function deleteRecord(name: CollectionName, id: string): Promise<void> {
  if (!firestore) throw new Error('Firebase n’est pas configuré.');
  await deleteDoc(doc(firestore, name, id));
}

export const saveTableRecord = (record: GuestTable) => saveRecord(FIRESTORE_COLLECTIONS.tables, record);
export const saveGuestRecord = (record: Guest) => saveRecord(FIRESTORE_COLLECTIONS.guests, record);
export const saveCheckinRecord = (record: Checkin) => saveRecord(FIRESTORE_COLLECTIONS.checkins, record);
