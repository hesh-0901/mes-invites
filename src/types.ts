export type Salutation = 'Monsieur' | 'Madame' | 'Mademoiselle';
export type InvitationKind = 'individual' | 'couple';
export type InvitationStatus = 'not-generated' | 'generated' | 'disabled';
export type CheckinStatus = 'not-checked-in' | 'checked-in';

export interface Guest {
  id: string;
  tableId: string;
  name: string;
  salutation: Salutation;
  kind: InvitationKind;
  displayName: string;
  createdAt: string;
  invitationStatus: InvitationStatus;
  checkinStatus: CheckinStatus;
  token?: string;
  checkedInAt?: string;
  lastCheckinId?: string;
}

export interface GuestTable {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface Checkin {
  id: string;
  guestId: string;
  guestName: string;
  tableName: string;
  result: 'accepted' | 'already-used' | 'invalid';
  timestamp: string;
  operator: string;
  operatorUid?: string;
}