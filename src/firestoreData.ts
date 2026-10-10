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

function projectCollection(projectId: string, name: CollectionName) {
  if (!firestore) throw new Error('Firebase n’est pas configuré.');
  return collection(firestore, 'projects', projectId, name);
}

export async function loadCollection<T>(projectId: string, name: CollectionName): Promise<T[]> {
  const snapshot = await getDocs(projectCollection(projectId, name));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as T);
}

export async function saveRecord<T extends { id: string }>(projectId: string, name: CollectionName, record: T): Promise<void> {
  await setDoc(doc(projectCollection(projectId, name), record.id), record, { merge: true });
}

export async function deleteRecord(projectId: string, name: CollectionName, id: string): Promise<void> {
  await deleteDoc(doc(projectCollection(projectId, name), id));
}

export const saveTableRecord = (projectId: string, record: GuestTable) => saveRecord(projectId, FIRESTORE_COLLECTIONS.tables, record);
export const saveGuestRecord = (projectId: string, record: Guest) => saveRecord(projectId, FIRESTORE_COLLECTIONS.guests, record);
export const saveCheckinRecord = (projectId: string, record: Checkin) => saveRecord(projectId, FIRESTORE_COLLECTIONS.checkins, record);
