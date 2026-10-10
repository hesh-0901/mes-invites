import type { Checkin, Guest, GuestTable } from './types';

export const initialTables: GuestTable[] = [
  { id: 'table-honneur', name: 'Table d’honneur', description: 'Famille proche', createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 'table-01', name: 'Table 01', description: 'Famille Mukendi', createdAt: '2026-10-02T10:00:00.000Z' },
  { id: 'table-02', name: 'Table 02', description: 'Amis et proches', createdAt: '2026-10-03T10:00:00.000Z' },
];

export const initialGuests: Guest[] = [
  { id: 'guest-1001', tableId: 'table-honneur', name: 'Jean Mukendi', salutation: 'Monsieur', kind: 'individual', displayName: 'Monsieur Jean Mukendi', createdAt: '2026-10-04T09:00:00.000Z', invitationStatus: 'generated', checkinStatus: 'checked-in', token: 'demo-1001', checkedInAt: '2026-10-10T08:05:00.000Z' },
  { id: 'guest-1002', tableId: 'table-honneur', name: 'Marie Kabeya', salutation: 'Madame', kind: 'individual', displayName: 'Madame Marie Kabeya', createdAt: '2026-10-04T09:30:00.000Z', invitationStatus: 'generated', checkinStatus: 'not-checked-in', token: 'demo-1002' },
  { id: 'guest-1003', tableId: 'table-01', name: 'Jean et Marie Mukendi', salutation: 'Monsieur', kind: 'couple', displayName: 'Couple Jean et Marie Mukendi', createdAt: '2026-10-05T10:00:00.000Z', invitationStatus: 'generated', checkinStatus: 'not-checked-in', token: 'demo-1003' },
  { id: 'guest-1004', tableId: 'table-02', name: 'Sarah Ilunga', salutation: 'Mademoiselle', kind: 'individual', displayName: 'Mademoiselle Sarah Ilunga', createdAt: '2026-10-05T11:00:00.000Z', invitationStatus: 'not-generated', checkinStatus: 'not-checked-in' },
];

export const initialCheckins: Checkin[] = [
  { id: 'checkin-1', guestId: 'guest-1001', guestName: 'Monsieur Jean Mukendi', tableName: 'Table d’honneur', result: 'accepted', timestamp: '2026-10-10T08:05:00.000Z', operator: 'Accueil — démonstration' },
];