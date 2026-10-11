import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDownRight, Bell, Check, CheckCircle2, ChevronDown, LoaderCircle, RefreshCw,
  ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Download, Eye,
  FileImage, Heart, LayoutDashboard, MoreHorizontal, Plus, QrCode,
  ScanLine, Search, Settings, ShieldCheck, Sparkles, Table2, Ticket, Users, X,
  AlertTriangle, Camera, LockKeyhole, Trash2, Pencil,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { Html5Qrcode } from 'html5-qrcode';
import { auth, firebaseConfigured, firestore } from './firebase';
import { createUserWithEmailAndPassword, deleteUser, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signOut, updateProfile, type User } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, where, setDoc, updateDoc } from 'firebase/firestore';
import { deleteRecord, FIRESTORE_COLLECTIONS, saveCheckinRecord, saveGuestRecord, saveRecord, saveTableRecord } from './firestoreData';
import type { Checkin, Guest, GuestTable, InvitationKind, Salutation } from './types';

type Page = 'dashboard' | 'tables' | 'guests' | 'invitations' | 'templates' | 'scanner' | 'history' | 'settings';
type Toast = { kind: 'success' | 'error' | 'info'; message: string };
const navItems: { id: Page; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, group: 'principal' },
  { id: 'tables', label: 'Tables', icon: Table2, group: 'principal' },
  { id: 'guests', label: 'Invités', icon: Users, group: 'principal' },
  { id: 'invitations', label: 'Invitations', icon: Ticket, group: 'principal' },
  { id: 'scanner', label: 'Scanner QR', icon: ScanLine, group: 'principal' },
  { id: 'history', label: 'Historique des entrées', icon: ClipboardList, group: 'principal' },
  { id: 'templates', label: 'Templates', icon: FileImage, group: 'configuration' },
  { id: 'settings', label: 'Paramètres', icon: Settings, group: 'configuration' },
];

function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}
function formatDate(date: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}
function makeDisplayName(name: string, salutation: Salutation, kind: InvitationKind) {
  const clean = name.trim().replace(/^couple\s+/i, '');
  return kind === 'couple' ? `Couple ${clean}` : `${salutation} ${clean}`;
}
function statusLabel(status: Guest['invitationStatus'] | Guest['checkinStatus']) {
  const labels: Record<string, string> = {
    'not-generated': 'Non générée', generated: 'Générée', disabled: 'Désactivée',
    'not-checked-in': 'Non entrée', 'checked-in': 'Entrée validée',
  };
  return labels[status] ?? status;
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [accessState, setAccessState] = useState<'checking' | 'approved' | 'pending' | 'rejected' | 'profile-error'>('checking');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Record<string, unknown> | null>(null);
  const [adminRequests, setAdminRequests] = useState<Record<string, unknown>[]>([]);
  const [projectCollaborators, setProjectCollaborators] = useState<Record<string, unknown>[]>([]);
  const [permissionsModal, setPermissionsModal] = useState<Record<string, unknown> | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<string[]>([]);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [requestActionUid, setRequestActionUid] = useState<string | null>(null);
  const [editingCollaborator, setEditingCollaborator] = useState<Record<string, unknown> | null>(null);
  const [collaboratorDisplayName, setCollaboratorDisplayName] = useState('');
  const [collaboratorWhatsapp, setCollaboratorWhatsapp] = useState('');
  const [collaboratorSaving, setCollaboratorSaving] = useState(false);
  const [removingCollaboratorUid, setRemovingCollaboratorUid] = useState<string | null>(null);
  useEffect(() => {
    if (!auth) { setAuthReady(true); return; }
    return onAuthStateChanged(auth, async (user) => {
      if (!user || !firestore) {
        setAuthUser(null); setCurrentProfile(null); setIsSuperAdmin(false); setAccessState('checking'); setAuthReady(true); return;
      }
      setAuthUser(user); setAccessState('checking');
      try {
        const profileSnapshot = await getDoc(doc(firestore, 'users', user.uid));
        const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;
        if (!user.isAnonymous && !user.emailVerified && profile?.role !== 'collaborator') {
          if (user.email?.endsWith('@collaborateur.mesinvites.app') && !profile) { setAuthReady(true); return; }
          await signOut(auth); setAuthUser(null); setCurrentProfile(null); setIsSuperAdmin(false); setAccessState('checking'); setAuthReady(true); return;
        }
        // No profile means this anonymous session has not completed a join request.
        // Return to the join form; its submit handler can reuse auth.currentUser.
        if (!profile && user.isAnonymous) {
          setAuthUser(null);
          setCurrentProfile(null);
          setIsSuperAdmin(false);
          setAccessState('checking');
          setAuthReady(true);
          return;
        }
        setCurrentProfile(profile);
        setIsSuperAdmin(profile?.super_admin === true);
        setAccessState(profile?.super_admin === true || profile?.status === 'approved'
          ? 'approved'
          : profile?.status === 'rejected' ? 'rejected' : profile ? 'pending' : 'profile-error');
      } catch {
        setAccessState('profile-error');
      } finally {
        setAuthReady(true);
      }
    });
  }, []);
  const projectId = typeof currentProfile?.projectId === 'string' ? currentProfile.projectId : null;
  const defaultCollaboratorMenus = ['dashboard', 'tables', 'guests', 'invitations', 'scanner', 'history'];
  const allowedMenus = Array.isArray(currentProfile?.permissions) ? currentProfile.permissions as string[] : defaultCollaboratorMenus;
  const [page, setPage] = useState<Page>('dashboard');
  useEffect(() => {
    if (currentProfile?.role !== 'collaborator' || allowedMenus.length === 0) return;
    if (!allowedMenus.includes(page)) setPage(allowedMenus[0] as Page);
  }, [currentProfile?.role, allowedMenus.join('|'), page]);
  const [tables, setTables] = useState<GuestTable[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [tableModal, setTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState<GuestTable | null>(null);
  const [editTableName, setEditTableName] = useState('');
  const [editTableDescription, setEditTableDescription] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ type: 'table'; item: GuestTable; stage: 1 | 2 } | { type: 'guest'; item: Guest; stage: 1 | 2 } | null>(null);
  const [guestModal, setGuestModal] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [detailGuest, setDetailGuest] = useState<Guest | null>(null);
  const [newTableName, setNewTableName] = useState('');
  const [newTableDescription, setNewTableDescription] = useState('');
  const [guestName, setGuestName] = useState('');
  const [salutation, setSalutation] = useState<Salutation>('Monsieur');
  const [kind, setKind] = useState<InvitationKind>('individual');
  // La configuration partagée vient de Firestore, jamais du cache local d'un autre projet.
  const [templateImage, setTemplateImage] = useState<string>('');
  const [templateNameX, setTemplateNameX] = useState(50);
  const [templateNameY, setTemplateNameY] = useState(55);
  const [templateQrX, setTemplateQrX] = useState(78);
  const [templateQrY, setTemplateQrY] = useState(82);
  const [templateQrSize, setTemplateQrSize] = useState(14);
  const [templateNameSize, setTemplateNameSize] = useState(3);
  const [templateNameWidth, setTemplateNameWidth] = useState(60);
  const [templateNameColor, setTemplateNameColor] = useState('#762d40');
  const [templateNameFont, setTemplateNameFont] = useState('Georgia');
  const [templateNameEffect, setTemplateNameEffect] = useState('shadow');
  const [templateImageDimensions, setTemplateImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [templateSampleName, setTemplateSampleName] = useState('Nom de l’invité');
  const [templateLocked, setTemplateLocked] = useState(false);
  const [templateSettingsReady, setTemplateSettingsReady] = useState(false);
  const [templateSettingsProjectId, setTemplateSettingsProjectId] = useState<string | null>(null);
  const canWriteTemplateSettings = currentProfile?.role !== 'collaborator' || allowedMenus.includes('settings') || allowedMenus.includes('templates');
  const [draggingTemplateElement, setDraggingTemplateElement] = useState<'name' | 'qr' | null>(null);
  const templatePreviewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!templateImage) { setTemplateImageDimensions(null); return; }
    const image = new Image();
    image.onload = () => setTemplateImageDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = templateImage;
  }, [templateImage]);

  const fitNameFontSize = (text: string, canvasWidth: number) => {
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure) return Math.max(12, canvasWidth * templateNameSize / 100);
    const maxWidth = canvasWidth * templateNameWidth / 100;
    let size = Math.max(12, canvasWidth * templateNameSize / 100);
    const minimum = Math.max(8, canvasWidth * 0.012);
    while (size > minimum) {
      measure.font = `600 ${size}px ${templateNameFont}, serif`;
      if (measure.measureText(text).width <= maxWidth) break;
      size -= 1;
    }
    return Math.max(minimum, size);
  };

  const [cameraActive, setCameraActive] = useState(false);
  const [scanValue, setScanValue] = useState('');
  const [scanResult, setScanResult] = useState<{ state: 'valid' | 'used' | 'invalid'; guest?: Guest; message: string } | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const guestsRef = useRef(guests);
  useEffect(() => { guestsRef.current = guests; }, [guests]);
  useEffect(() => {
    if (page !== 'scanner' && scannerRef.current?.isScanning) {
      void scannerRef.current.stop().then(() => setCameraActive(false)).catch(() => setCameraActive(false));
    }
  }, [page]);
  useEffect(() => {
    if (!firebaseConfigured || !authUser || accessState !== 'approved' || !projectId || !firestore) return;
    setTemplateSettingsReady(false);
    setTemplateSettingsProjectId(null);
    const canReadTables = currentProfile?.role !== 'collaborator' || allowedMenus.includes('tables');
    const canReadGuests = currentProfile?.role !== 'collaborator' || allowedMenus.includes('guests') || allowedMenus.includes('invitations');
    const canReadCheckins = currentProfile?.role !== 'collaborator' || allowedMenus.includes('scanner') || allowedMenus.includes('history');
    // Tous les membres approuvés doivent lire le modèle partagé pour afficher/télécharger les invitations.
    const canReadSettings = true;
    const unsubscribers: Array<() => void> = [];
    const subscribe = <T,>(name: string, enabled: boolean, setter: (items: T[]) => void) => {
      if (!enabled) { setter([]); return; }
      unsubscribers.push(onSnapshot(collection(firestore, 'projects', projectId, name), (snapshot) => {
        setter(snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as T));
      }, (error) => {
        console.error('Synchronisation Firestore impossible pour ' + name, error);
        notify('La synchronisation en temps réel a échoué. Vérifie les règles Firestore.', 'error');
      }));
    };
    subscribe<GuestTable>(FIRESTORE_COLLECTIONS.tables, canReadTables, setTables);
    subscribe<Guest>(FIRESTORE_COLLECTIONS.guests, canReadGuests, setGuests);
    subscribe<Checkin>(FIRESTORE_COLLECTIONS.checkins, canReadCheckins, setCheckins);
    if (canReadSettings) {
      unsubscribers.push(onSnapshot(collection(firestore, 'projects', projectId, FIRESTORE_COLLECTIONS.settings), (snapshot) => {
        const templateSettings = snapshot.docs.map((item) => ({ ...item.data(), id: item.id })).find((item) => item.id === 'template') as {
          id: string; imageUrl?: string; nameX?: number; nameY?: number; qrX?: number; qrY?: number;
          qrSize?: number; nameSize?: number; nameWidth?: number; nameColor?: string;
          nameFont?: string; nameEffect?: string; locked?: boolean;
        } | undefined;
        if (!templateSettings) { setTemplateSettingsReady(true); setTemplateSettingsProjectId(projectId); return; }
        if (typeof templateSettings.imageUrl === 'string' && templateSettings.imageUrl !== templateImage) {
          setTemplateImage(templateSettings.imageUrl);
          try { window.localStorage.setItem('mes-invites-template-image', templateSettings.imageUrl); } catch { /* Optional cache. */ }
        }
        if (typeof templateSettings.nameX === 'number') setTemplateNameX(templateSettings.nameX);
        if (typeof templateSettings.nameY === 'number') setTemplateNameY(templateSettings.nameY);
        if (typeof templateSettings.qrX === 'number') setTemplateQrX(templateSettings.qrX);
        if (typeof templateSettings.qrY === 'number') setTemplateQrY(templateSettings.qrY);
        if (typeof templateSettings.qrSize === 'number') setTemplateQrSize(templateSettings.qrSize);
        if (typeof templateSettings.nameSize === 'number') setTemplateNameSize(templateSettings.nameSize);
        if (typeof templateSettings.nameWidth === 'number') setTemplateNameWidth(templateSettings.nameWidth);
        if (typeof templateSettings.nameColor === 'string') setTemplateNameColor(templateSettings.nameColor);
        if (typeof templateSettings.nameFont === 'string') setTemplateNameFont(templateSettings.nameFont);
        if (typeof templateSettings.nameEffect === 'string') setTemplateNameEffect(templateSettings.nameEffect);
        if (typeof templateSettings.locked === 'boolean') setTemplateLocked(templateSettings.locked);
        setTemplateSettingsReady(true);
        setTemplateSettingsProjectId(projectId);
      }, (error) => {
        console.error('Synchronisation des paramètres du modèle impossible', error);
        setTemplateSettingsReady(false);
        setTemplateSettingsProjectId(null);
        notify('Impossible de synchroniser les paramètres du modèle.', 'error');
      }));
    } else {
      setTemplateSettingsReady(false);
      setTemplateSettingsProjectId(null);
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [authUser, accessState, projectId, currentProfile, allowedMenus.join('|')]);

  useEffect(() => {
    if (!firebaseConfigured || !firestore || !projectId || accessState !== 'approved' || !templateSettingsReady || templateSettingsProjectId !== projectId || !canWriteTemplateSettings) return;
    const timeout = window.setTimeout(() => {
      void setDoc(doc(firestore, 'projects', projectId, FIRESTORE_COLLECTIONS.settings, 'template'), {
        id: 'template', imageUrl: templateImage, nameX: templateNameX, nameY: templateNameY,
        qrX: templateQrX, qrY: templateQrY, qrSize: templateQrSize, nameSize: templateNameSize,
        nameWidth: templateNameWidth, nameColor: templateNameColor, nameFont: templateNameFont,
        nameEffect: templateNameEffect, locked: templateLocked,
        updatedAt: new Date().toISOString(), updatedBy: authUser?.uid ?? null,
      }, { merge: true }).catch((error) => {
        console.error('Enregistrement des paramètres du modèle impossible', error);
        notify('Les paramètres du modèle n’ont pas pu être synchronisés.', 'error');
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [projectId, accessState, templateSettingsReady, templateSettingsProjectId, canWriteTemplateSettings, templateImage, templateNameX, templateNameY, templateQrX, templateQrY, templateQrSize, templateNameSize, templateNameWidth, templateNameColor, templateNameFont, templateNameEffect, templateLocked, authUser?.uid]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const activeTable = tables.find((table) => table.id === activeTableId) ?? null;
  const visibleGuests = useMemo(() => guests.filter((guest) => {
    const matchesSearch = guest.displayName.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'));
    return matchesSearch && (!activeTableId || page !== 'guests' || guest.tableId === activeTableId);
  }), [guests, search, activeTableId, page]);
  const checkedInCount = guests.filter((guest) => guest.checkinStatus === 'checked-in').length;
  const generatedCount = guests.filter((guest) => guest.invitationStatus === 'generated').length;
  const pageTitle = activeTable && page === 'tables' ? activeTable.name : navItems.find((item) => item.id === page)?.label ?? 'Mes Invites';

  const navigate = (nextPage: Page) => {
    setPage(nextPage);
    setSearch('');
    if (nextPage !== 'tables') setActiveTableId(null);
  };
  const openTable = (id: string) => {
    setActiveTableId(id);
    setPage('tables');
    setSearch('');
  };
  const notify = (message: string, kind: Toast['kind'] = 'success') => setToast({ message, kind });

  const saveTable = (event: FormEvent) => {
    event.preventDefault();
    const name = newTableName.trim();
    if (!name) return;
    if (tables.some((table) => table.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
      notify('Une table porte déjà ce nom.', 'error');
      return;
    }
    const table: GuestTable = { id: makeId('table'), name, description: newTableDescription.trim(), createdAt: new Date().toISOString() };
    setTables((current) => [...current, table]);
    void saveTableRecord(projectId!, table).catch(() => undefined);
    setNewTableName('');
    setNewTableDescription('');
    setTableModal(false);
    notify('Table créée.');
    openTable(table.id);
  };

  const editTable = (table: GuestTable) => {
    setEditingTable(table);
    setEditTableName(table.name);
    setEditTableDescription(table.description ?? '');
  };

  const saveEditedTable = (event: FormEvent) => {
    event.preventDefault();
    if (!editingTable) return;
    const name = editTableName.trim();
    if (!name) return;
    if (tables.some((item) => item.id !== editingTable.id && item.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
      notify('Une table porte déjà ce nom.', 'error');
      return;
    }
    const updated = { ...editingTable, name, description: editTableDescription.trim() };
    setTables((current) => current.map((item) => item.id === editingTable.id ? updated : item));
    void saveTableRecord(projectId!, updated).catch(() => notify('La table a été modifiée localement, mais la synchronisation a échoué.', 'error'));
    setEditingTable(null);
    setActiveTableId(null);
    setPage('tables');
    notify('Table modifiée. Retour à la liste des tables.');
  };

  const deleteTable = (table: GuestTable) => {
    const assigned = guests.filter((guest) => guest.tableId === table.id).length;
    if (assigned > 0) {
      notify(`Impossible de supprimer cette table : ${assigned} invité(s) y sont encore affectés. Réaffecte-les d’abord.`, 'error');
      return;
    }
    setDeleteConfirmation({ type: 'table', item: table, stage: 1 });
  };

  const openAddGuest = (guest?: Guest) => {
    if (!guest && !activeTableId) {
      notify('Ouvre une table avant d’ajouter un invité.', 'error');
      navigate('tables');
      return;
    }
    setEditingGuest(guest ?? null);
    setGuestName(guest?.name ?? '');
    setSalutation(guest?.salutation ?? 'Monsieur');
    setKind(guest?.kind ?? 'individual');
    setGuestModal(true);
  };

  const saveGuest = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = guestName.trim();
    if (!cleanName) return;
    const tableId = editingGuest?.tableId ?? activeTableId;
    if (!tableId || !tables.some((table) => table.id === tableId)) {
      notify('Une table existante est obligatoire.', 'error');
      return;
    }
    const displayName = makeDisplayName(cleanName, salutation, kind);
    if (editingGuest) {
      const updated = { ...editingGuest, name: cleanName, salutation, kind, displayName };
      setGuests((current) => current.map((guest) => guest.id === editingGuest.id ? updated : guest));
      void saveGuestRecord(projectId!, updated).catch(() => undefined);
      setDetailGuest(updated);
      notify('Fiche invité mise à jour.');
    } else {
      const guest: Guest = {
        id: makeId('guest'), tableId, name: cleanName, salutation, kind, displayName,
        createdAt: new Date().toISOString(), invitationStatus: 'not-generated', checkinStatus: 'not-checked-in',
      };
      setGuests((current) => [guest, ...current]);
      void saveGuestRecord(projectId!, guest).catch(() => undefined);
      notify('Invité ajouté à la table.');
    }
    setGuestModal(false);
    setGuestName('');
  };

  const generateInvitation = (guestId: string) => {
    if (!templateImage) {
      notify('Importe d’abord le modèle de l’invitation dans Templates.', 'error');
      navigate('templates');
      return;
    }
    const guest = guests.find((item) => item.id === guestId);
    if (!guest) return;
    const updated = { ...guest, invitationStatus: 'generated' as const, token: guest.token ?? `MESINVITES-${globalThis.crypto?.randomUUID?.() ?? makeId('invite')}` };
    setGuests((current) => current.map((item) => item.id === guestId ? updated : item));
    void saveGuestRecord(projectId!, updated).catch(() => undefined);
    setDetailGuest(updated);
    notify('QR code unique généré. Tu peux télécharger l’invitation personnalisée.');
  };

  const validateScan = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const guest = guestsRef.current.find((item) => item.token === code || item.id === code);
    if (!guest || guest.invitationStatus !== 'generated') {
      setScanResult({ state: 'invalid', message: 'Invitation inconnue, non générée ou désactivée.' });
      setScanValue(code);
      const entry: Checkin = { id: makeId('scan'), guestId: guest?.id ?? '', guestName: guest?.displayName ?? 'Invitation inconnue', tableName: tables.find((table) => table.id === guest?.tableId)?.name ?? '—', result: 'invalid', timestamp: new Date().toISOString(), operator: 'Accueil — démonstration' };
      setCheckins((current) => [entry, ...current]);
      void saveCheckinRecord(projectId!, entry).catch(() => undefined);
      return;
    }
    setScanValue(code);
    if (guest.checkinStatus === 'checked-in') {
      setScanResult({ state: 'used', guest, message: 'Cette invitation a déjà été utilisée.' });
      const entry: Checkin = { id: makeId('scan'), guestId: guest.id, guestName: guest.displayName, tableName: tables.find((table) => table.id === guest.tableId)?.name ?? '—', result: 'already-used', timestamp: new Date().toISOString(), operator: 'Accueil — démonstration' };
      setCheckins((current) => [entry, ...current]);
      void saveCheckinRecord(projectId!, entry).catch(() => undefined);
      return;
    }
    const timestamp = new Date().toISOString();
    setGuests((current) => current.map((item) => item.id === guest.id ? { ...item, checkinStatus: 'checked-in', checkedInAt: timestamp } : item));
    const tableName = tables.find((table) => table.id === guest.tableId)?.name ?? '—';
    const entry: Checkin = { id: makeId('checkin'), guestId: guest.id, guestName: guest.displayName, tableName, result: 'accepted', timestamp, operator: 'Accueil — démonstration' };
    setCheckins((current) => [entry, ...current]);
    void saveCheckinRecord(projectId!, entry).catch(() => undefined);
    void saveGuestRecord(projectId!, { ...guest, checkinStatus: 'checked-in', checkedInAt: timestamp }).catch(() => undefined);
    setScanResult({ state: 'valid', guest: { ...guest, checkinStatus: 'checked-in', checkedInAt: timestamp }, message: 'Entrée enregistrée en mode démonstration.' });
    notify('Entrée enregistrée dans les données de démonstration.', 'success');
  }, [tables]);

  const startCamera = async () => {
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (decoded) => {
        void scanner.stop().catch(() => undefined);
        setCameraActive(false);
        validateScan(decoded);
      }, () => undefined);
      setCameraActive(true);
    } catch {
      notify('Caméra indisponible. Autorise l’accès ou utilise la saisie manuelle.', 'error');
    }
  };
  const stopCamera = async () => {
    try { if (scannerRef.current?.isScanning) await scannerRef.current.stop(); } catch { /* Scanner may already have stopped. */ }
    setCameraActive(false);
  };
  useEffect(() => () => {
    const scanner = scannerRef.current;
    if (scanner?.isScanning) void scanner.stop().catch(() => undefined);
  }, []);

  const deleteGuest = (guest: Guest) => {
    setDeleteConfirmation({ type: 'guest', item: guest, stage: 1 });
  };

  const advanceDeleteConfirmation = () => {
    if (!deleteConfirmation) return;
    if (deleteConfirmation.stage === 1) {
      setDeleteConfirmation({ ...deleteConfirmation, stage: 2 });
      return;
    }
    if (deleteConfirmation.type === 'table') {
      const table = deleteConfirmation.item;
      setTables((current) => current.filter((item) => item.id !== table.id));
      void deleteRecord(projectId!, FIRESTORE_COLLECTIONS.tables, table.id).catch(() => notify('La suppression locale est faite, mais la synchronisation a échoué.', 'error'));
      if (activeTableId === table.id) setActiveTableId(null);
      notify('Table supprimée.', 'info');
    } else {
      const guest = deleteConfirmation.item;
      setGuests((current) => current.filter((item) => item.id !== guest.id));
      void deleteRecord(projectId!, FIRESTORE_COLLECTIONS.guests, guest.id).catch(() => notify('La suppression locale est faite, mais la synchronisation a échoué.', 'error'));
      setDetailGuest(null);
      notify('Invité supprimé.', 'info');
    }
    setDeleteConfirmation(null);
  };

  const downloadDemoInvitation = async (guest: Guest) => {
    if (!guest.token || !templateImage) {
      notify('Génère le QR code et importe un template avant le téléchargement.', 'error');
      return;
    }
    try {
      const background = new Image();
      background.crossOrigin = 'anonymous';
      background.src = templateImage;
      await new Promise<void>((resolve, reject) => {
        background.onload = () => resolve();
        background.onerror = () => reject(new Error('Impossible de charger le template.'));
      });
      const width = background.naturalWidth;
      const height = background.naturalHeight;
      if (!width || !height) throw new Error('Le fichier du template est vide ou illisible.');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponible.');
      ctx.drawImage(background, 0, 0, width, height);
      const fontSize = fitNameFontSize(guest.displayName, width);
      ctx.font = `600 ${fontSize}px ${templateNameFont}, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = templateNameColor;
      if (templateNameEffect === 'shadow') {
        ctx.shadowColor = '#ffffffcc';
        ctx.shadowBlur = Math.max(2, width * 0.004);
      } else if (templateNameEffect === 'outline') {
        ctx.lineWidth = Math.max(1, width * 0.0015);
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText(guest.displayName, width * templateNameX / 100, height * templateNameY / 100, width * templateNameWidth / 100);
      } else if (templateNameEffect === 'glow') {
        ctx.shadowColor = templateNameColor;
        ctx.shadowBlur = Math.max(4, width * 0.012);
      }
      ctx.fillText(guest.displayName, width * templateNameX / 100, height * templateNameY / 100, width * templateNameWidth / 100);
      ctx.shadowBlur = 0;
      const qrSvg = renderToStaticMarkup(<QRCodeSVG value={guest.token} size={512} level="H" includeMargin />);
      // SVG images loaded by Image() need an explicit SVG namespace in some browsers.
      const compatibleQrSvg = qrSvg.includes('xmlns="http://www.w3.org/2000/svg"')
        ? qrSvg
        : qrSvg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      if (!compatibleQrSvg.includes('<svg') || !compatibleQrSvg.includes('</svg>')) {
        throw new Error('Le générateur a produit un QR code SVG invalide.');
      }
      const qrUrl = URL.createObjectURL(new Blob([compatibleQrSvg], { type: 'image/svg+xml;charset=utf-8' }));
      try {
        const qrImage = new Image();
        qrImage.src = qrUrl;
        await new Promise<void>((resolve, reject) => {
          qrImage.onload = () => resolve();
          qrImage.onerror = () => reject(new Error('Le navigateur ne parvient pas à lire le QR code SVG. Réessaie après actualisation de la page.'));
        });
        const qrSize = width * templateQrSize / 100;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(width * templateQrX / 100 - qrSize / 2, height * templateQrY / 100 - qrSize / 2, qrSize, qrSize);
        ctx.drawImage(qrImage, width * templateQrX / 100 - qrSize / 2, height * templateQrY / 100 - qrSize / 2, qrSize, qrSize);
      } finally {
        URL.revokeObjectURL(qrUrl);
      }
      const blob = await new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob((result) => result
            ? resolve(result)
            : reject(new Error('Le navigateur n’a pas pu exporter le PNG.')), 'image/png');
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Export PNG impossible.'));
        }
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const fileGuestName = guest.name
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const invitationFileName = guest.kind === 'couple'
        ? `Couple_${fileGuestName}_Inv.png`
        : `${fileGuestName}_Inv.png`;
      link.download = invitationFileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Keep the temporary file alive briefly so the browser can begin downloading it.
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify('Invitation personnalisée téléchargée en PNG.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Erreur inconnue.';
      const corsError = /tainted|cross-origin|security|cross origin/i.test(detail);
      notify(corsError
        ? 'Le serveur du template bloque son export. Vérifie les autorisations CORS de l’image hébergée.'
        : `Composition PNG impossible : ${detail}`, 'error');
    }
  };

  const renderGuestTable = (items: Guest[]) => (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Invité</th><th>Table</th><th>Type</th><th>Invitation</th><th>Entrée</th><th /></tr></thead>
        <tbody>
          {items.map((guest) => (
            <tr key={guest.id}>
              <td><button className="guest-cell" onClick={() => setDetailGuest(guest)}><span className="avatar">{initials(guest.displayName)}</span><span><strong>{guest.displayName}</strong><small>Ajouté le {formatDate(guest.createdAt)}</small></span></button></td>
              <td>{tables.find((table) => table.id === guest.tableId)?.name ?? 'Table supprimée'}</td>
              <td><span className="type-label">{guest.kind === 'couple' ? 'Couple' : 'Individuelle'}</span></td>
              <td><span className={`status-pill ${guest.invitationStatus === 'generated' ? 'status-green' : guest.invitationStatus === 'disabled' ? 'status-red' : 'status-neutral'}`}><span className="status-dot" />{statusLabel(guest.invitationStatus)}</span></td>
              <td><span className={`status-pill ${guest.checkinStatus === 'checked-in' ? 'status-green' : 'status-neutral'}`}><span className="status-dot" />{statusLabel(guest.checkinStatus)}</span></td>
              <td><button className="icon-button" aria-label="Voir l’invité" onClick={() => setDetailGuest(guest)}><MoreHorizontal size={18} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <div className="empty-state"><Users size={28} /><strong>Aucun invité trouvé</strong><span>Modifie la recherche ou ajoute un invité depuis une table.</span></div>}
    </div>
  );

  const renderDashboard = () => (
    <>
      <section className="welcome-row"><div><div className="eyebrow">VOTRE ÉVÉNEMENT</div><h2>Le grand jour se prépare.</h2><p>Retrouvez l’essentiel de vos invitations en un coup d’œil.</p></div><button className="button button-primary" onClick={() => setTableModal(true)}><Plus size={17} /> Nouvelle table</button></section>
      <section className="stat-grid">
        <StatCard label="Tables créées" value={tables.length} note="Organisation des places" icon={Table2} trend="Espace de réception" />
        <StatCard label="Invitations" value={guests.length} note={`${generatedCount} invitation(s) générée(s)`} icon={Ticket} trend="Individus et couples" />
        <StatCard label="Entrées validées" value={checkedInCount} note={`${Math.max(guests.length - checkedInCount, 0)} en attente`} icon={ShieldCheck} trend="Suivi des arrivées" />
        <StatCard label="À générer" value={guests.filter((guest) => guest.invitationStatus !== 'generated').length} note="Invitations restantes" icon={QrCode} trend="Personnalisation" />
      </section>
      <section className="dashboard-grid">
        <div className="panel panel-large"><div className="panel-heading"><div><h3>Vos tables</h3><p>Accédez directement aux listes d’invités.</p></div><button className="text-button" onClick={() => navigate('tables')}>Toutes les tables <ChevronRight size={16} /></button></div>
          <div className="table-wrap"><table><thead><tr><th>Table</th><th>Invités</th><th>Entrées</th><th>Actions</th></tr></thead><tbody>{tables.map((table) => {
            const tableGuests = guests.filter((guest) => guest.tableId === table.id);
            const checked = tableGuests.filter((guest) => guest.checkinStatus === 'checked-in').length;
            return <tr key={table.id}><td><button className="guest-cell" onClick={() => openTable(table.id)}><span className="avatar"><Table2 size={16} /></span><span><strong>{table.name}</strong><small>{table.description || 'Aucune description'}</small></span></button></td><td>{tableGuests.length}</td><td>{checked}</td><td><div className="inline-actions"><button className="icon-button" aria-label={`Modifier ${table.name}`} title="Modifier" onClick={() => editTable(table)}><Pencil size={16} /></button><button className="icon-button" aria-label={`Supprimer ${table.name}`} title="Supprimer" onClick={() => deleteTable(table)}><Trash2 size={16} /></button></div></td></tr>;
          })}{tables.length === 0 && <tr><td colSpan={4}>Aucune table créée.</td></tr>}</tbody></table></div>
          <button className="add-table-line" onClick={() => setTableModal(true)}><Plus size={16} /> Créer une table</button>
        </div>
        <div className="panel"><div className="panel-heading"><div><h3>Activité récente</h3><p>Derniers mouvements</p></div><Activity size={18} className="muted-icon" /></div>
          <div className="activity-list">{checkins.slice(0, 5).map((entry) => <div className="activity-item" key={entry.id}><span className={`activity-icon ${entry.result === 'accepted' ? 'activity-ok' : 'activity-warn'}`}>{entry.result === 'accepted' ? <Check size={15} /> : <AlertTriangle size={15} />}</span><div><strong>{entry.guestName}</strong><small>{entry.result === 'accepted' ? 'Entrée validée' : entry.result === 'already-used' ? 'Déjà utilisée' : 'Invitation invalide'}</small></div><time>{formatDate(entry.timestamp)}</time></div>)}{checkins.length === 0 && <p className="muted-copy">Aucune entrée enregistrée.</p>}</div>
          <button className="text-button full-link" onClick={() => navigate('history')}>Voir l’historique <ChevronRight size={16} /></button>
        </div>
      </section>
      <section className="panel"><div className="panel-heading"><div><h3>Invités récemment ajoutés</h3><p>Suivez l’avancement de vos invitations.</p></div><button className="text-button" onClick={() => navigate('guests')}>Voir les invités <ChevronRight size={16} /></button></div>{renderGuestTable(guests.slice(0, 4))}</section>
    </>
  );

  const renderTables = () => activeTable ? (
    <>
      <div className="breadcrumbs"><button onClick={() => setActiveTableId(null)}><ChevronLeft size={15} /> Toutes les tables</button><ChevronRight size={14} /><span>{activeTable.name}</span></div>
      <section className="welcome-row"><div><div className="eyebrow">DÉTAIL DE LA TABLE</div><h2>{activeTable.name}</h2><p>{activeTable.description || 'Liste des invités affectés à cette table.'}</p></div><button className="button button-primary" onClick={() => openAddGuest()}><Plus size={17} /> Ajouter un invité</button></section>
      <section className="stat-grid stat-grid-small"><StatCard label="Invités" value={guests.filter((guest) => guest.tableId === activeTable.id).length} icon={Users} /><StatCard label="Invitations générées" value={guests.filter((guest) => guest.tableId === activeTable.id && guest.invitationStatus === 'generated').length} icon={QrCode} /><StatCard label="Entrées validées" value={guests.filter((guest) => guest.tableId === activeTable.id && guest.checkinStatus === 'checked-in').length} icon={CheckCircle2} /></section>
      <section className="panel"><div className="panel-heading"><div><h3>Invités de {activeTable.name}</h3><p>Les nouveaux invités sont automatiquement affectés à cette table.</p></div><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un invité" /></div></div>{renderGuestTable(visibleGuests.filter((guest) => guest.tableId === activeTable.id))}</section>
    </>
  ) : (
    <>
      <section className="welcome-row"><div><div className="eyebrow">ORGANISATION</div><h2>Les tables</h2><p>Organisez les invités par table et retrouvez leurs invitations.</p></div><button className="button button-primary" onClick={() => setTableModal(true)}><Plus size={17} /> Nouvelle table</button></section>
      <section className="table-overview-grid">{tables.map((table, index) => {
        const tableGuests = guests.filter((guest) => guest.tableId === table.id);
        const generated = tableGuests.filter((guest) => guest.invitationStatus === 'generated').length;
        const checked = tableGuests.filter((guest) => guest.checkinStatus === 'checked-in').length;
        return <article className="table-overview-card" key={table.id}><div className="table-overview-top"><span className={`table-icon table-icon-${index % 3}`}><Table2 size={20} /></span><button className="icon-button" onClick={() => openTable(table.id)} aria-label="Ouvrir la table"><MoreHorizontal size={19} /></button></div><h3>{table.name}</h3><p>{table.description || 'Aucune description'}</p><div className="table-overview-stats"><div><strong>{tableGuests.length}</strong><span>Invités</span></div><div><strong>{generated}</strong><span>Invitations</span></div><div><strong>{checked}</strong><span>Entrées</span></div></div><button className="button button-secondary button-wide" onClick={() => openTable(table.id)}>Ouvrir la table <ArrowDownRight size={16} /></button></article>;
      })}<button className="table-create-card" onClick={() => setTableModal(true)}><span className="create-plus"><Plus size={22} /></span><strong>Créer une table</strong><span>Ajouter une nouvelle table à l’événement</span></button></section>
    </>
  );

  const renderGuests = () => (
    <>
      <section className="welcome-row"><div><div className="eyebrow">RÉPERTOIRE</div><h2>Tous les invités</h2><p>Chaque invité doit être rattaché à une table existante.</p></div><button className="button button-primary" onClick={() => { notify('Sélectionne une table avant d’ajouter un invité.', 'info'); navigate('tables'); }}><Plus size={17} /> Ajouter un invité</button></section>
      <section className="panel"><div className="panel-heading"><div><h3>Liste des invités</h3><p>{guests.length} fiche(s) dans les données de démonstration</p></div><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom de l’invité" /></div></div>{renderGuestTable(visibleGuests)}</section>
    </>
  );

  const renderInvitations = () => (
    <>
      <section className="welcome-row"><div><div className="eyebrow">PERSONNALISATION</div><h2>Les invitations</h2><p>Générez et consultez les invitations associées aux invités.</p></div><button className="button button-secondary" onClick={() => navigate('templates')}><FileImage size={17} /> Voir les templates</button></section>
      <section className={`notice ${templateImage ? 'notice-success' : 'notice-info'}`}><Sparkles size={18} /><div><strong>{templateImage ? 'Template prêt' : 'Importe le visuel de ton invitation'}</strong><p>{templateImage ? 'Vérifie les positions dans Templates, puis génère un QR unique pour chaque invité. Le téléchargement produit une invitation PNG personnalisée.' : 'Ouvre Templates pour envoyer le visuel, régler le nom et le QR code, puis revenir ici pour générer les invitations.'}</p></div></section>
      <section className="panel"><div className="panel-heading"><div><h3>Invitations individuelles</h3><p>Une invitation par personne ou par couple.</p></div><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher" /></div></div><div className="invitation-list">{guests.filter((guest) => guest.displayName.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))).map((guest) => <div className="invitation-row" key={guest.id}><div className="invitation-thumb">{templateImage ? <img src={templateImage} alt="" /> : <Heart size={21} />}<span>INVITATION</span></div><div className="invitation-info"><strong>{guest.displayName}</strong><small>{tables.find((table) => table.id === guest.tableId)?.name ?? 'Table inconnue'} · {guest.kind === 'couple' ? 'Couple' : 'Personne seule'}</small><span className={`status-pill ${guest.invitationStatus === 'generated' ? 'status-green' : 'status-neutral'}`}><span className="status-dot" />{statusLabel(guest.invitationStatus)}</span></div><div className="invitation-actions">{guest.invitationStatus === 'generated' ? <><button className="button button-secondary button-small" onClick={() => setDetailGuest(guest)}><Eye size={15} /> Aperçu</button><button className="button button-secondary button-small" onClick={() => void downloadDemoInvitation(guest)} disabled={!guest.token || !templateImage}><Download size={15} /> PNG</button></> : <button className="button button-primary button-small" onClick={() => generateInvitation(guest.id)}><QrCode size={15} /> Générer</button>}</div></div>)}</div></section>
    </>
  );

  const moveTemplateElement = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingTemplateElement || !templatePreviewRef.current) return;
    const rect = templatePreviewRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    if (draggingTemplateElement === 'name') { setTemplateNameX(x); setTemplateNameY(y); }
    else { setTemplateQrX(x); setTemplateQrY(y); }
  };

  const downloadOriginalTemplate = async () => {
    if (!templateImage) return;
    try {
      const response = await fetch(templateImage);
      if (!response.ok) throw new Error('Téléchargement impossible.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `template-original${blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : '.jpg'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Template original téléchargé sans ajout ni modification.');
    } catch {
      notify('Le téléchargement direct a échoué. Vérifie que le template Cloudinary est accessible.', 'error');
    }
  };

  const saveTemplateSettings = () => {
    try {
      window.localStorage.setItem('mes-invites-template-name-x', String(templateNameX));
      window.localStorage.setItem('mes-invites-template-name-y', String(templateNameY));
      window.localStorage.setItem('mes-invites-template-qr-x', String(templateQrX));
      window.localStorage.setItem('mes-invites-template-qr-y', String(templateQrY));
      window.localStorage.setItem('mes-invites-template-qr-size', String(templateQrSize));
      window.localStorage.setItem('mes-invites-template-name-size', String(templateNameSize));
      window.localStorage.setItem('mes-invites-template-name-width', String(templateNameWidth));
      window.localStorage.setItem('mes-invites-template-name-color', templateNameColor);
      window.localStorage.setItem('mes-invites-template-name-font', templateNameFont);
      window.localStorage.setItem('mes-invites-template-name-effect', templateNameEffect);
      window.localStorage.setItem('mes-invites-template-locked', 'true');
      void saveRecord(projectId!, FIRESTORE_COLLECTIONS.settings, { id: 'template', imageUrl: templateImage, nameX: templateNameX, nameY: templateNameY, qrX: templateQrX, qrY: templateQrY, qrSize: templateQrSize, nameSize: templateNameSize, nameWidth: templateNameWidth, nameColor: templateNameColor, nameFont: templateNameFont, nameEffect: templateNameEffect, locked: true, updatedAt: new Date().toISOString() }).catch(() => undefined);
      setTemplateLocked(true);
      notify('Modèle enregistré. Éditeur verrouillé.');
    } catch { notify('Impossible d’enregistrer les paramètres du template.', 'error'); }
  };

  const importTemplate = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Choisis une image PNG, JPG ou WebP.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      notify('Le fichier dépasse la limite de 10 Mo.', 'error');
      return;
    }
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/upload-template', { method: 'POST', body });
      const result = await response.json() as { secure_url?: string; error?: string };
      if (!response.ok || !result.secure_url) throw new Error(result.error || 'Échec de l’envoi vers Cloudinary.');
      window.localStorage.setItem('mes-invites-template-image', result.secure_url);
      setTemplateImage(result.secure_url);
      notify('Template envoyé sur Cloudinary et chargé dans l’éditeur.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Échec de l’envoi du template.', 'error');
    }
  };

  const renderTemplates = () => (
    <>
      {templateLocked && templateImage ? (
        <section className="template-locked-workspace">
          <div className="template-locked-topline"><span><LockKeyhole size={14} /> MODÈLE CONFIGURÉ</span><button className="template-edit-discreet" onClick={() => { setTemplateLocked(false); window.localStorage.setItem('mes-invites-template-locked', 'false'); }}><Pencil size={14} /> Modifier</button></div>
          <div className="template-locked-canvas" style={{ aspectRatio: templateImageDimensions ? `${templateImageDimensions.width} / ${templateImageDimensions.height}` : '3 / 4' }}>
            <div className="template-live-preview" style={{ backgroundImage: `url("${templateImage}")`, aspectRatio: templateImageDimensions ? `${templateImageDimensions.width} / ${templateImageDimensions.height}` : '3 / 4', backgroundSize: '100% 100%' }}>
              <div className="template-preview-name" style={{ left: `${templateNameX}%`, top: `${templateNameY}%`, fontSize: `${(fitNameFontSize(templateSampleName || 'Nom de l’invité', templateImageDimensions?.width ?? 1000) / (templateImageDimensions?.width ?? 1000)) * 100}cqw`, maxWidth: `${templateNameWidth}%`, overflowWrap: 'anywhere', wordBreak: 'break-word', color: templateNameColor, fontFamily: templateNameFont, textShadow: templateNameEffect === 'shadow' ? '0 1px 3px #ffffffcc' : templateNameEffect === 'glow' ? `0 0 8px ${templateNameColor}` : 'none', WebkitTextStroke: templateNameEffect === 'outline' ? '0.6px white' : '0px transparent' }}>{templateSampleName || 'Nom de l’invité'}</div>
              <div className="template-preview-qr" style={{ left: `${templateQrX}%`, top: `${templateQrY}%`, width: `${templateQrSize}%` }}><QRCodeSVG value="APERÇU-MODÈLE-MES-INVITES" size={128} level="H" includeMargin /></div>
            </div>
          </div>
          <p className="template-locked-caption"><CheckCircle2 size={14} /> Le modèle est prêt pour générer les invitations.</p>
        </section>
      ) : (
        <>
          <section className="welcome-row"><div><div className="eyebrow">PERSONNALISATION</div><h2>Templates d’invitation</h2><p>Importe ton visuel, règle le nom et le QR code, puis enregistre pour verrouiller la configuration.</p></div><label className="button button-primary template-upload-button"><Plus size={16} /> Importer un template<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => importTemplate(event.target.files?.[0])} /></label></section>
          <section className="template-editor-grid">
            <div className="panel template-controls">
              <div className="panel-heading"><div><h3>Configuration du modèle</h3><p>Les positions sont exprimées en pourcentage du visuel.</p></div><Settings size={18} className="muted-icon" /></div>
              <label className="template-field">Nom de prévisualisation<input value={templateSampleName} onChange={(event) => setTemplateSampleName(event.target.value)} placeholder="Nom de l’invité" /></label>
              <div className="template-control-group"><strong>Style du texte</strong><label>Police<select value={templateNameFont} onChange={(e) => setTemplateNameFont(e.target.value)}><option value="Georgia">Georgia — classique</option><option value="Arial">Arial — moderne</option><option value="Times New Roman">Times New Roman</option><option value="Garamond">Garamond — élégant</option><option value="Verdana">Verdana — lisible</option><option value="Courier New">Courier New</option></select></label><label>Couleur du texte<input type="color" value={templateNameColor} onChange={(e) => setTemplateNameColor(e.target.value)} /></label><label>Effet du texte<select value={templateNameEffect} onChange={(e) => setTemplateNameEffect(e.target.value)}><option value="none">Aucun</option><option value="shadow">Ombre claire</option><option value="outline">Contour blanc</option><option value="glow">Lueur</option></select></label></div>
              <div className="template-control-group"><strong>Position du nom</strong><label>Horizontal — {templateNameX}%<input type="range" min="0" max="100" value={templateNameX} onChange={(e) => setTemplateNameX(Number(e.target.value))} /></label><label>Vertical — {templateNameY}%<input type="range" min="0" max="100" value={templateNameY} onChange={(e) => setTemplateNameY(Number(e.target.value))} /></label><label>Taille maximale du texte — {templateNameSize}% de la largeur<input type="range" min="1" max="7" step="0.25" value={templateNameSize} onChange={(e) => setTemplateNameSize(Number(e.target.value))} /></label><label>Largeur réservée au nom — {templateNameWidth}%<input type="range" min="10" max="95" step="1" value={templateNameWidth} onChange={(e) => setTemplateNameWidth(Number(e.target.value))} /></label><small className="muted-copy">Les noms longs sont automatiquement réduits pour rester dans cette zone.</small></div>
              <div className="template-control-group"><strong>Position du QR code</strong><label>Horizontal — {templateQrX}%<input type="range" min="0" max="100" value={templateQrX} onChange={(e) => setTemplateQrX(Number(e.target.value))} /></label><label>Vertical — {templateQrY}%<input type="range" min="0" max="100" value={templateQrY} onChange={(e) => setTemplateQrY(Number(e.target.value))} /></label><label>Taille — {templateQrSize}% de la largeur<input type="range" min="6" max="28" step="1" value={templateQrSize} onChange={(e) => setTemplateQrSize(Number(e.target.value))} /></label></div>
              <div className="modal-actions"><button className="button button-secondary" onClick={() => { setTemplateNameX(50); setTemplateNameY(55); setTemplateQrX(78); setTemplateQrY(82); setTemplateQrSize(14); setTemplateNameSize(3); setTemplateNameWidth(60); setTemplateNameColor('#762d40'); setTemplateNameFont('Georgia'); setTemplateNameEffect('shadow'); }}>Réinitialiser</button><button className="button button-primary" onClick={saveTemplateSettings}><Check size={16} /> Enregistrer et verrouiller</button></div>
              <p className="muted-copy small-note"><LockKeyhole size={14} /> Après l’enregistrement, les paramètres seront masqués. Utilise « Modifier » pour les afficher de nouveau.</p>
            </div>
            <div className="panel template-preview-panel"><div className="panel-heading"><div><h3>Aperçu en direct</h3><p>Exemple de placement du nom et du QR code.</p></div><Eye size={18} className="muted-icon" /></div>{templateImage && <button className="button button-secondary template-download-original" onClick={() => void downloadOriginalTemplate()}><Download size={15} /> Télécharger le template original</button>}
              {templateImage ? <div ref={templatePreviewRef} className="template-live-preview" onPointerMove={moveTemplateElement} onPointerUp={() => setDraggingTemplateElement(null)} onPointerCancel={() => setDraggingTemplateElement(null)} style={{ backgroundImage: `url("${templateImage}")`, aspectRatio: templateImageDimensions ? `${templateImageDimensions.width} / ${templateImageDimensions.height}` : '3 / 4', backgroundSize: '100% 100%' }}><div className={`template-preview-name template-draggable ${draggingTemplateElement === 'name' ? 'template-dragging' : ''}`} onPointerDown={(event) => { event.preventDefault(); setDraggingTemplateElement('name'); event.currentTarget.setPointerCapture(event.pointerId); }} style={{ left: `${templateNameX}%`, top: `${templateNameY}%`, fontSize: `${(fitNameFontSize(templateSampleName || 'Nom de l’invité', templateImageDimensions?.width ?? 1000) / (templateImageDimensions?.width ?? 1000)) * 100}cqw`, maxWidth: `${templateNameWidth}%`, overflowWrap: 'anywhere', wordBreak: 'break-word', color: templateNameColor, fontFamily: templateNameFont, textShadow: templateNameEffect === 'shadow' ? '0 1px 3px #ffffffcc' : templateNameEffect === 'glow' ? `0 0 8px ${templateNameColor}` : 'none', WebkitTextStroke: templateNameEffect === 'outline' ? '0.6px white' : '0px transparent' }}>{templateSampleName || 'Nom de l’invité'}<span className="template-drag-hint">Déplacer</span></div><div className={`template-preview-qr template-draggable ${draggingTemplateElement === 'qr' ? 'template-dragging' : ''}`} onPointerDown={(event) => { event.preventDefault(); setDraggingTemplateElement('qr'); event.currentTarget.setPointerCapture(event.pointerId); }} style={{ left: `${templateQrX}%`, top: `${templateQrY}%`, width: `${templateQrSize}%` }}><QRCodeSVG value="PREVIEW-QR-MES-INVITES" size={128} level="H" includeMargin /><span className="template-drag-hint">Déplacer</span></div></div> : <div className="template-preview-empty"><FileImage size={34} /><strong>Importe ton modèle pour commencer</strong><span>Formats acceptés : PNG, JPG et WebP. L’aperçu conserve le ratio de l’image.</span></div>}
              {templateImage && <button className="button button-danger-ghost" onClick={() => { window.localStorage.removeItem('mes-invites-template-image'); window.localStorage.setItem('mes-invites-template-locked', 'false'); setTemplateLocked(false); setTemplateImage(''); notify('Template retiré de cet appareil.', 'info'); }}><Trash2 size={15} /> Retirer ce template</button>}
            </div>
          </section>
        </>
      )}
    </>
  );

  const renderScanner = () => (
    <>
      <section className="welcome-row"><div><div className="eyebrow">ACCUEIL & CONTRÔLE</div><h2>Scanner une invitation</h2><p>Vérifiez une invitation avant de valider l’entrée.</p></div><span className="demo-tag"><span /> Mode démonstration</span></section>
      <section className="scanner-layout"><div className="panel scanner-panel"><div className="panel-heading"><div><h3>Lecteur QR</h3><p>Utilisez une caméra compatible ou saisissez un code.</p></div><ScanLine size={20} className="muted-icon" /></div><div className="scanner-frame"><div id="qr-reader" className="qr-reader" />{!cameraActive && <div className="scanner-placeholder"><span className="scanner-corners"><ScanLine size={43} /></span><strong>Placez le QR code dans le cadre</strong><small>La caméra peut nécessiter une autorisation du navigateur.</small></div>}</div><div className="scanner-controls">{cameraActive ? <button className="button button-secondary button-wide" onClick={() => void stopCamera()}>Arrêter la caméra</button> : <button className="button button-primary button-wide" onClick={() => void startCamera()}><Camera size={17} /> Activer la caméra</button>}<div className="manual-scan"><label htmlFor="scan-code">Ou saisir un identifiant de démonstration</label><div><input id="scan-code" value={scanValue} onChange={(event) => setScanValue(event.target.value)} placeholder="Ex. demo-1002 ou identifiant invité" /><button className="button button-secondary" onClick={() => validateScan(scanValue)}>Vérifier</button></div></div><p className="muted-copy small-note"><LockKeyhole size={14} /> Cette version modifie uniquement l’état local de démonstration. La validation réelle devra passer par le serveur.</p></div></div>
        <div className="panel scan-result-panel"><div className="panel-heading"><div><h3>Résultat du contrôle</h3><p>Les informations apparaissent après la lecture.</p></div><ShieldCheck size={20} className="muted-icon" /></div>{!scanResult ? <div className="empty-state scan-empty"><QrCode size={30} /><strong>En attente d’un scan</strong><span>Scannez une invitation ou saisissez un code connu.</span></div> : <div className={`scan-result scan-result-${scanResult.state}`}><span className="scan-result-icon">{scanResult.state === 'valid' ? <CheckCircle2 size={25} /> : scanResult.state === 'used' ? <AlertTriangle size={25} /> : <X size={25} />}</span><strong>{scanResult.state === 'valid' ? 'Invitation valide' : scanResult.state === 'used' ? 'Entrée déjà enregistrée' : 'Invitation invalide'}</strong><p>{scanResult.message}</p>{scanResult.guest && <div className="scan-guest-card"><span className="avatar avatar-large">{initials(scanResult.guest.displayName)}</span><div><strong>{scanResult.guest.displayName}</strong><small>{tables.find((table) => table.id === scanResult.guest?.tableId)?.name ?? 'Table inconnue'}</small><small>{statusLabel(scanResult.guest.checkinStatus)}</small></div></div>}</div>}<div className="scanner-rules"><div><CheckCircle2 size={16} /><span>Vérification de l’identifiant</span></div><div><ShieldCheck size={16} /><span>Prévention des doubles entrées à connecter côté serveur</span></div></div></div></section>
    </>
  );

  const renderHistory = () => (
    <>
      <section className="welcome-row"><div><div className="eyebrow">TRAÇABILITÉ</div><h2>Historique des entrées</h2><p>Consultez les contrôles effectués pendant l’accueil.</p></div><button className="button button-secondary" onClick={() => notify('L’export sera activé avec les données persistées.', 'info')}><Download size={16} /> Exporter</button></section>
      <section className="panel"><div className="panel-heading"><div><h3>Journal des contrôles</h3><p>{checkins.length} événement(s) dans la démonstration</p></div><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un nom" /></div></div><div className="table-wrap"><table><thead><tr><th>Invité</th><th>Table</th><th>Date et heure</th><th>Résultat</th><th>Opérateur</th></tr></thead><tbody>{checkins.filter((entry) => entry.guestName.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))).map((entry) => <tr key={entry.id}><td><strong>{entry.guestName}</strong></td><td>{entry.tableName}</td><td>{formatDate(entry.timestamp)}</td><td><span className={`status-pill ${entry.result === 'accepted' ? 'status-green' : entry.result === 'invalid' ? 'status-red' : 'status-amber'}`}><span className="status-dot" />{entry.result === 'accepted' ? 'Entrée acceptée' : entry.result === 'already-used' ? 'Déjà utilisée' : 'Invalide'}</span></td><td>{entry.operator}</td></tr>)}</tbody></table>{checkins.length === 0 && <div className="empty-state"><ClipboardList size={28} /><strong>Aucune entrée</strong><span>Les scans apparaîtront ici.</span></div>}</div></section>
    </>
  );

  const loadAdminRequests = async () => {
    if (!firestore || (!isSuperAdmin && currentProfile?.role !== 'admin')) return;
    setRequestsLoading(true);
    try {
      const usersRef = collection(firestore, 'users');
      const snapshot = isSuperAdmin
        ? await getDocs(query(usersRef, where('role', '==', 'admin'), where('status', '==', 'pending')))
        : await getDocs(query(usersRef, where('role', '==', 'collaborator'), where('projectId', '==', currentProfile?.projectId), where('status', '==', 'pending')));
      const requests: Record<string, unknown>[] = snapshot.docs.map((entry) => ({ ...entry.data(), uid: entry.id }));
      setAdminRequests(requests.filter((entry) => entry.super_admin !== true));
    } catch {
      notify('Impossible de charger les demandes. Vérifie les règles Firestore publiées.', 'error');
    } finally { setRequestsLoading(false); }
  };

  const loadProjectCollaborators = async () => {
    if (!firestore || !projectId || currentProfile?.role !== 'admin') return;
    setCollaboratorsLoading(true);
    try {
      const snapshot = await getDocs(query(collection(firestore, 'users'), where('role', '==', 'collaborator'), where('projectId', '==', projectId), where('status', '==', 'approved')));
      setProjectCollaborators(snapshot.docs.map((entry) => ({ ...entry.data(), uid: entry.id })));
    } catch {
      notify('Impossible de charger les collaborateurs approuvés.', 'error');
    } finally { setCollaboratorsLoading(false); }
  };

  const openPermissions = (collaborator: Record<string, unknown>) => {
    const saved = Array.isArray(collaborator.permissions) ? collaborator.permissions as string[] : defaultCollaboratorMenus;
    setPermissionDraft([...saved]);
    setPermissionsModal(collaborator);
  };

  const saveCollaboratorPermissions = async () => {
    if (!firestore || !projectId || !permissionsModal || currentProfile?.role !== 'admin') return;
    setPermissionsSaving(true);
    try {
      const target = projectCollaborators.find((entry) => entry.uid === permissionsModal.uid);
      if (!target || target.projectId !== projectId || target.status !== 'approved') throw new Error('Collaborateur non autorisé.');
      await updateDoc(doc(firestore, 'users', String(permissionsModal.uid)), { permissions: permissionDraft, permissionsUpdatedAt: new Date().toISOString(), permissionsUpdatedBy: authUser?.uid ?? null });
      setProjectCollaborators((items) => items.map((entry) => entry.uid === permissionsModal.uid ? { ...entry, permissions: [...permissionDraft] } : entry));
      setPermissionsModal(null);
      notify('Autorisations du collaborateur enregistrées.', 'success');
    } catch {
      notify('Impossible d’enregistrer les autorisations. Vérifie les règles Firestore.', 'error');
    } finally { setPermissionsSaving(false); }
  };

  const openCollaboratorEditor = (collaborator: Record<string, unknown>) => {
    setEditingCollaborator(collaborator);
    setCollaboratorDisplayName(String(collaborator.displayName ?? [collaborator.firstName, collaborator.lastName].filter(Boolean).join(' ')));
    setCollaboratorWhatsapp(String(collaborator.whatsapp ?? ''));
  };

  const saveCollaboratorProfile = async () => {
    if (!firestore || !projectId || !editingCollaborator || currentProfile?.role !== 'admin') return;
    const uid = String(editingCollaborator.uid ?? '');
    const target = projectCollaborators.find((entry) => entry.uid === uid);
    const displayName = collaboratorDisplayName.trim();
    if (!target || target.projectId !== projectId || target.status !== 'approved' || !displayName) {
      notify('Vérifie le nom et le collaborateur sélectionné.', 'error');
      return;
    }
    setCollaboratorSaving(true);
    try {
      await updateDoc(doc(firestore, 'users', uid), {
        displayName,
        whatsapp: collaboratorWhatsapp.trim(),
        profileUpdatedAt: new Date().toISOString(),
        profileUpdatedBy: authUser?.uid ?? null,
      });
      setProjectCollaborators((items) => items.map((entry) => entry.uid === uid
        ? { ...entry, displayName, whatsapp: collaboratorWhatsapp.trim() }
        : entry));
      setEditingCollaborator(null);
      notify('Profil du collaborateur mis à jour.');
    } catch {
      notify('Impossible de modifier ce collaborateur. Vérifie les règles Firestore publiées.', 'error');
    } finally { setCollaboratorSaving(false); }
  };

  const removeCollaborator = async (collaborator: Record<string, unknown>) => {
    if (!firestore || !projectId || currentProfile?.role !== 'admin') return;
    const uid = String(collaborator.uid ?? '');
    const target = projectCollaborators.find((entry) => entry.uid === uid);
    if (!uid || !target || target.projectId !== projectId || target.status !== 'approved') {
      notify('Ce collaborateur ne peut pas être supprimé de cet espace.', 'error');
      return;
    }
    const name = String(target.displayName ?? [target.firstName, target.lastName].filter(Boolean).join(' ') ?? 'ce collaborateur');
    if (!window.confirm('Retirer ' + name + ' de votre projet ? Il perdra immédiatement l’accès à cet espace.')) return;
    setRemovingCollaboratorUid(uid);
    try {
      // Supprime le profil d’accès Firestore du collaborateur dans cet espace.
      // Le compte Firebase Authentication reste conservé : le client ne peut pas
      // supprimer de façon sécurisée un autre utilisateur Auth.
      await deleteDoc(doc(firestore, 'users', uid));
      setProjectCollaborators((items) => items.filter((entry) => entry.uid !== uid));
      if (String(permissionsModal?.uid ?? '') === uid) setPermissionsModal(null);
      notify('Profil du collaborateur supprimé. Son compte ne peut plus accéder à cet espace.');
    } catch {
      notify('Impossible de retirer ce collaborateur. Vérifie les règles Firestore publiées.', 'error');
    } finally { setRemovingCollaboratorUid(null); }
  };

  const decideAdminRequest = async (uid: string, status: 'approved' | 'rejected') => {
    if (!firestore || (!isSuperAdmin && currentProfile?.role !== 'admin')) return;
    setRequestActionUid(uid);
    let stage = 'lecture de la demande';
    try {
      const requestSnapshot = await getDoc(doc(firestore, 'users', uid));
      if (!requestSnapshot.exists()) throw new Error('Demande introuvable.');
      const request = requestSnapshot.data();
      if (isSuperAdmin && request.role === 'admin' && status === 'approved') {
        stage = 'création de l’espace';
        const projectRef = doc(collection(firestore, 'projects'));
        await setDoc(projectRef, {
          id: projectRef.id, ownerUid: uid, ownerEmail: request.email ?? '',
          name: `Espace de ${String(request.firstName ?? 'l’administrateur')} ${String(request.lastName ?? '')}`.trim(),
          status: 'active', createdAt: new Date().toISOString(),
        });
        stage = 'mise à jour du compte administrateur';
        await updateDoc(doc(firestore, 'users', uid), { status, projectId: projectRef.id, reviewedAt: new Date().toISOString(), reviewedBy: auth.currentUser?.uid ?? null });
      } else {
        if (!isSuperAdmin && (request.role !== 'collaborator' || request.projectId !== currentProfile?.projectId)) {
          throw new Error('Cette demande ne dépend pas de votre espace.');
        }
        stage = 'mise à jour du statut du collaborateur';
        await updateDoc(doc(firestore, 'users', uid), { status, reviewedAt: new Date().toISOString(), reviewedBy: auth.currentUser?.uid ?? null });
      }
      setAdminRequests((current) => current.filter((entry) => entry.uid !== uid));
      if (!isSuperAdmin && request.role === 'collaborator' && status === 'approved') void loadProjectCollaborators();
      notify(status === 'approved' ? (isSuperAdmin ? 'Compte administrateur approuvé et espace créé.' : 'Collaborateur approuvé.') : 'Demande refusée.', 'success');
    } catch (error) {
      const firebaseError = error as { code?: string; message?: string };
      const code = firebaseError.code ?? 'erreur-inconnue';
      console.error('Échec de la décision d’accès :', code, firebaseError.message ?? error);
      notify(`Échec pendant : ${stage} (${code}). Vérifie les règles Firestore publiées.`, 'error');
    } finally { setRequestActionUid(null); }
  };

  const [settingsTab, setSettingsTab] = useState<'general' | 'event' | 'template' | 'access'>('general');
  const [showProjectKey, setShowProjectKey] = useState(false);

  const renderSettings = () => (
    <>
      <section className="welcome-row"><div><div className="eyebrow">ESPACE DE CONFIGURATION</div><h2>Paramètres</h2><p>Gérez votre compte, votre événement et les accès à votre espace.</p></div></section>
      <div className="settings-tabs" role="tablist" aria-label="Catégories des paramètres">
        <button role="tab" aria-selected={settingsTab === 'general'} className={settingsTab === 'general' ? 'settings-tab active' : 'settings-tab'} onClick={() => setSettingsTab('general')}><Activity size={16}/> Général</button>
        <button role="tab" aria-selected={settingsTab === 'event'} className={settingsTab === 'event' ? 'settings-tab active' : 'settings-tab'} onClick={() => setSettingsTab('event')}><Heart size={16}/> Événement</button>
        <button role="tab" aria-selected={settingsTab === 'template'} className={settingsTab === 'template' ? 'settings-tab active' : 'settings-tab'} onClick={() => setSettingsTab('template')}><FileImage size={16}/> Invitations</button>
        {(isSuperAdmin || currentProfile?.role === 'admin') && <button role="tab" aria-selected={settingsTab === 'access'} className={settingsTab === 'access' ? 'settings-tab active' : 'settings-tab'} onClick={() => { setSettingsTab('access'); void loadAdminRequests(); if (!isSuperAdmin) void loadProjectCollaborators(); }}><ShieldCheck size={16}/> Accès & comptes</button>}
      </div>
      {settingsTab === 'general' && <>
        {currentProfile?.role === 'admin' && <section className="panel project-key-panel">
          <div className="project-key-heading">
            <span className="project-key-icon"><LockKeyhole size={25}/></span>
            <div className="project-key-title"><h3>Clé ID de mon projet</h3><p>Partage cette clé uniquement avec les collaborateurs autorisés à rejoindre ton espace. Elle leur permet d’envoyer une demande d’accès.</p></div>
            <span className="project-key-admin"><LockKeyhole size={15}/> Visible uniquement par l’administrateur</span>
          </div>
          <label className="project-key-label">CLÉ ID DU PROJET</label>
          <div className="project-key-value">
            <span className="project-key-symbol"><ShieldCheck size={19}/></span>
            <code>{projectId ? (showProjectKey ? projectId : '•'.repeat(Math.min(projectId.length, 24))) : 'Aucun ID attribué'}</code>
            <button type="button" className="project-key-icon-button" disabled={!projectId} aria-label={showProjectKey ? 'Masquer la clé' : 'Afficher la clé'} title={showProjectKey ? 'Masquer la clé' : 'Afficher la clé'} onClick={() => setShowProjectKey((visible) => !visible)}><Eye size={20}/></button>
            <button type="button" className="button button-primary project-key-copy" disabled={!projectId} onClick={() => { if (!projectId) return; void navigator.clipboard.writeText(projectId).then(() => notify('Clé ID du projet copiée.')).catch(() => notify('Copie impossible. Sélectionne la clé et copie-la manuellement.', 'error')); }}><ClipboardList size={17}/> Copier</button>
          </div>
          <div className="project-key-notice"><span className="project-key-notice-icon"><CircleHelp size={20}/></span><div><strong>Important</strong><p>Cette clé est propre à ton projet. Ne la partage qu’avec des personnes de confiance. L’accès au projet reste soumis à ton approbation.</p></div></div>
        </section>}
        <section className="settings-grid">
        <div className="panel"><div className="panel-heading"><div><h3>État des services</h3><p>Connexion et configuration cloud</p></div><Activity size={19} className="muted-icon"/></div><div className="setting-row"><span className="setting-icon"><ShieldCheck size={18}/></span><div><strong>Firebase</strong><small>{firebaseConfigured ? 'Configuration détectée' : 'Variables VITE_FIREBASE_* absentes'}</small></div><span className={firebaseConfigured ? 'status-pill status-green' : 'status-pill status-amber'}><span className="status-dot"/>{firebaseConfigured ? 'Configuré' : 'À configurer'}</span></div><div className="notice notice-info setting-notice"><LockKeyhole size={18}/><div><strong>Accès sécurisé</strong><p>La connexion nécessite un e-mail vérifié et un compte approuvé.</p></div></div></div>
        <div className="panel"><div className="panel-heading"><div><h3>Compte connecté</h3><p>Identité de la session actuelle</p></div><Users size={19} className="muted-icon"/></div><div className="settings-profile-head"><span className="settings-large-avatar">{(authUser?.displayName || authUser?.email || 'U').slice(0,1).toUpperCase()}</span><div><h3>{authUser?.displayName || 'Utilisateur'}</h3><p>{authUser?.email || 'E-mail indisponible'}</p><span className="status-pill status-green"><span className="status-dot"/>Connecté</span></div></div><button className="button button-secondary" onClick={() => auth && void signOut(auth)}><LockKeyhole size={16}/> Se déconnecter</button></div>
        </section>
      </>}
      {settingsTab === 'event' && <section className="panel settings-detail-panel"><div className="panel-heading"><div><h3>Informations de l’événement</h3><p>Les détails de votre réception seront configurables ici.</p></div><Heart size={20} className="muted-icon"/></div><div className="event-placeholder"><span className="event-monogram">M<span>&</span>I</span><strong>Votre événement</strong><p>Le nom des mariés, la date, le lieu et les informations de contact seront regroupés dans cette section.</p><span className="status-pill status-neutral"><span className="status-dot"/>À configurer</span></div></section>}
      {settingsTab === 'template' && <section className="panel settings-detail-panel"><div className="panel-heading"><div><h3>Modèle d’invitation</h3><p>Gérez le visuel utilisé pour personnaliser vos invitations.</p></div><FileImage size={20} className="muted-icon"/></div><div className="settings-template-summary"><span className="setting-icon"><FileImage size={20}/></span><div><strong>{templateImage ? 'Un modèle est chargé' : 'Aucun modèle importé'}</strong><small>{templateImage ? 'Le modèle est prêt dans l’éditeur.' : 'Importez un PNG, JPG ou WebP dans Templates.'}</small></div></div><button className="button button-primary" onClick={() => navigate('templates')}><FileImage size={16}/> Ouvrir l’éditeur de templates</button></section>}
      {settingsTab === 'access' && (isSuperAdmin || currentProfile?.role === 'admin') && <>
        <div className="access-page">
          <section className="access-overview">
            <div className="access-overview-heading">
              <h3>Accès &amp; comptes</h3>
              <button type="button" className="access-refresh" onClick={() => { void loadAdminRequests(); if (!isSuperAdmin) void loadProjectCollaborators(); }} disabled={requestsLoading || collaboratorsLoading}><RefreshCw size={15} className={requestsLoading || collaboratorsLoading ? 'access-spin' : ''}/>{requestsLoading || collaboratorsLoading ? 'Actualisation…' : 'Actualiser'}</button>
            </div>
            <div className="access-metrics">
              <span><i className="access-dot-amber"/> {adminRequests.length} en attente</span>
              {!isSuperAdmin && <><span className="access-metric-separator">·</span><span><i className="access-dot-green"/> {projectCollaborators.length} collaborateurs actifs</span></>}
            </div>
          </section>

          <section className="access-panel">
            <div className="access-section-heading"><h4>{isSuperAdmin ? 'Demandes propriétaire' : 'Demandes en attente'}</h4><span className="access-count">{adminRequests.length}</span></div>
            {requestsLoading ? <div className="access-skeleton-list" aria-label="Chargement des demandes"><div className="access-skeleton-row"/><div className="access-skeleton-row"/></div>
              : adminRequests.length === 0 ? <div className="access-empty"><CheckCircle2 size={16}/><span>Aucune demande en attente</span></div>
              : <div className="access-request-list">{adminRequests.map((request) => {
                const personName = `${String(request.firstName ?? '')} ${String(request.lastName ?? '')}`.trim() || 'Utilisateur sans nom';
                const created = typeof request.createdAt === 'string' && !Number.isNaN(Date.parse(request.createdAt)) ? new Date(request.createdAt).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}) : 'Date inconnue';
                return <article className="access-request-card" key={String(request.uid)}>
                  <span className="access-person-avatar">{initials(personName)}</span>
                  <div className="access-person-info"><strong>{personName}</strong><div className="access-request-meta"><span className="access-status access-status-pending"><i/>En attente</span><span>{isSuperAdmin ? 'Propriétaire' : 'Collaborateur'}</span></div><small>{String(request.email || request.whatsapp || (request.projectId ? `Espace · ${request.projectId}` : 'Coordonnées non renseignées'))} · {created}</small></div>
                  <div className="access-request-actions"><button type="button" className="access-approve" disabled={requestActionUid !== null} onClick={() => void decideAdminRequest(String(request.uid),'approved')}>{requestActionUid === request.uid ? <LoaderCircle size={15} className="access-spin"/> : <Check size={15}/>}Approuver</button><button type="button" className="access-reject" disabled={requestActionUid !== null} onClick={() => void decideAdminRequest(String(request.uid),'rejected')}>{requestActionUid === request.uid ? <LoaderCircle size={15} className="access-spin"/> : <X size={15}/>}Refuser</button></div>
                </article>;
              })}</div>}
          </section>

          {!isSuperAdmin && <section className="access-panel">
            <div className="access-section-heading"><h4>Collaborateurs</h4><span className="access-count">{projectCollaborators.length}</span></div>
            {collaboratorsLoading ? <div className="access-skeleton-list" aria-label="Chargement des collaborateurs"><div className="access-skeleton-row"/><div className="access-skeleton-row"/></div>
              : projectCollaborators.length === 0 ? <div className="access-empty"><Users size={16}/><span>Aucun collaborateur actif</span></div>
              : <div className="access-collaborator-list">{projectCollaborators.map((person) => {
                const personName = String(person.displayName ?? `${String(person.firstName ?? '')} ${String(person.lastName ?? '')}`.trim()) || 'Collaborateur';
                const permissions = Array.isArray(person.permissions) ? person.permissions as string[] : defaultCollaboratorMenus;
                return <article className="access-collaborator-card" key={String(person.uid)}>
                  <span className="access-person-avatar">{initials(personName)}</span>
                  <div className="access-person-info"><strong>{personName}</strong><div className="access-request-meta"><span className="access-status access-status-active"><i/>Actif</span><span className="access-menu-count">{permissions.length}/{navItems.length} menus</span></div></div>
                  <div className="access-collaborator-actions"><button type="button" className="access-edit-button" onClick={() => openCollaboratorEditor(person)} aria-label={`Modifier le profil de ${personName}`} title="Modifier le profil"><Pencil size={15}/></button><button type="button" className="access-manage-button" onClick={() => openPermissions(person)}><Settings size={15}/>Gérer les accès</button><button type="button" className="access-remove-button" disabled={removingCollaboratorUid === person.uid} onClick={() => void removeCollaborator(person)} aria-label={"Retirer " + personName} title="Retirer du projet">{removingCollaboratorUid === person.uid ? <LoaderCircle size={15} className="access-spin"/> : <Trash2 size={15}/>}</button></div>
                </article>;
              })}</div>}
          </section>}
        </div>

    </>
  );

  if (!authReady || (authUser && accessState === 'checking')) return <div className="auth-loading">Chargement sécurisé…</div>;
  if (!authUser) return <AuthScreen />;
  if (accessState !== 'approved') return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><span className="auth-mark"><ShieldCheck size={24}/></span><span>Mes Invites<small>CONTRÔLE DES ACCÈS</small></span></div><div className="auth-intro"><span className="eyebrow">ESPACE SÉCURISÉ</span><h1>{accessState === 'pending' ? 'Demande en attente' : accessState === 'rejected' ? 'Demande refusée' : 'Accès indisponible'}</h1><p>{accessState === 'pending' ? 'Ton adresse e-mail est vérifiée. Un super administrateur doit approuver ton compte avant que tu puisses accéder à ton espace.' : accessState === 'rejected' ? 'La demande d’accès à ce compte a été refusée. Contacte le support si tu penses qu’il s’agit d’une erreur.' : 'Le profil de ce compte ne peut pas être vérifié. Réessaie plus tard ou contacte le support.'}</p></div><button className="button button-secondary auth-submit" onClick={() => auth && void signOut(auth)}>Se déconnecter</button></section></main>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('dashboard')}><span className="brand-mark"><Heart size={19} /></span><span><strong>mes invites</strong><small>GESTION ÉVÉNEMENTIELLE</small></span></button>
        <div className="event-switcher"><span className="event-avatar">M<span>&</span>I</span><span className="event-switcher-copy"><strong>Mon mariage</strong><small>Votre espace événementiel</small></span><ChevronDown size={15} /></div>
        <nav className="sidebar-nav">
          <span className="nav-label">PRINCIPAL</span>
          {navItems.filter((item) => item.group === 'principal' && (isSuperAdmin || currentProfile?.role !== 'collaborator' || allowedMenus.includes(item.id))).map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'nav-active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.id === 'tables' && <span className="nav-count">{tables.length}</span>}</button>)}
          <span className="nav-label nav-label-spaced">CONFIGURATION</span>
          {navItems.filter((item) => item.group === 'configuration' && (isSuperAdmin || currentProfile?.role !== 'collaborator' || allowedMenus.includes(item.id))).map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'nav-active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><CircleHelp size={18} /></span><strong>Besoin d’aide ?</strong><p>Préparez vos invitations étape par étape.</p><button onClick={() => notify('Le guide d’utilisation sera ajouté dans une prochaine version.', 'info')}>Consulter le guide <ChevronRight size={14} /></button></div><div className="profile-row"><span className="profile-avatar">{(authUser.displayName || authUser.email || 'U').slice(0,1).toUpperCase()}</span><span className="profile-user-copy"><strong>{authUser.displayName || 'Utilisateur'}</strong><small>{authUser.email || (isSuperAdmin ? 'Super administrateur' : 'Administrateur')}</small></span><button className="profile-menu-button" aria-label="Se déconnecter" title="Se déconnecter" onClick={() => void signOut(auth!)}><MoreHorizontal size={18}/></button></div></div>
      </aside>
      <main className="main-area"><header className="topbar"><div className="topbar-left"><span className="mobile-brand"><Heart size={19} /> Mes Invites</span><div className="breadcrumb-title"><span>Mes Invites</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div></div><div className="topbar-actions"><button className="icon-button notification-button" aria-label="Notifications" onClick={() => notify('Aucune nouvelle notification.', 'info')}><Bell size={18} /><i /></button><span className="topbar-divider" /><button className="profile-mini" onClick={() => void signOut(auth!)} title="Se déconnecter"><span className="profile-avatar">{(authUser.displayName || authUser.email || 'U').slice(0,1).toUpperCase()}</span><ChevronDown size={15} /></button></div></header>
        <div className="page-content">{currentProfile?.role === 'collaborator' && allowedMenus.length === 0 ? <section className="access-empty project-no-permissions"><span className="access-empty-icon"><LockKeyhole size={24}/></span><strong>Accès au projet confirmé</strong><p>Votre compte est actif dans cet espace, mais aucun menu ne vous a encore été attribué. Demandez à l’administrateur de vous accorder les autorisations nécessaires.</p></section> : <>{page === 'dashboard' && renderDashboard()}{page === 'tables' && renderTables()}{page === 'guests' && renderGuests()}{page === 'invitations' && renderInvitations()}{page === 'templates' && renderTemplates()}{page === 'scanner' && renderScanner()}{page === 'history' && renderHistory()}{page === 'settings' && renderSettings()}</>}<footer className="page-footer"><span>© 2026 Mes Invites</span><span><span className="footer-dot" /> Espace privé</span></footer></div>
      </main>
      {editingTable && <Modal title="Modifier la table" description="Modifie les informations, puis tu reviendras à la liste de toutes les tables." onClose={() => setEditingTable(null)}><form onSubmit={saveEditedTable} className="form-stack"><label>Nom de la table<input autoFocus value={editTableName} onChange={(event) => setEditTableName(event.target.value)} required /></label><label>Description <span className="optional-label">Facultatif</span><input value={editTableDescription} onChange={(event) => setEditTableDescription(event.target.value)} placeholder="Ex. Famille et proches" /></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditingTable(null)}>Annuler</button><button type="submit" className="button button-primary"><Check size={16} /> Enregistrer</button></div></form></Modal>}
      {deleteConfirmation && <Modal title={deleteConfirmation.type === 'table' ? (deleteConfirmation.stage === 1 ? "Supprimer cette table ?" : "Confirmer la suppression de la table") : (deleteConfirmation.stage === 1 ? "Supprimer cet invité ?" : "Confirmer la suppression de l’invité")} description={deleteConfirmation.type === 'table' ? (deleteConfirmation.stage === 1 ? "Vérifie la table concernée avant de continuer." : "Dernière étape : cette table sera retirée de ton événement.") : (deleteConfirmation.stage === 1 ? "Vérifie l’invité concerné avant de continuer." : "Dernière étape : cette fiche invité sera supprimée.")} onClose={() => setDeleteConfirmation(null)}><div className="delete-confirm-content"><span className="delete-confirm-icon"><AlertTriangle size={25} /></span><h3>{deleteConfirmation.stage === 1 ? (deleteConfirmation.type === 'table' ? "Veux-tu vraiment supprimer cette table ?" : "Veux-tu vraiment supprimer cet invité ?") : (deleteConfirmation.type === 'table' ? "Confirmer la suppression définitive de cette table ?" : "Confirmer la suppression définitive de cet invité ?")}</h3><p className="delete-confirm-item-name">{deleteConfirmation.type === 'table' ? deleteConfirmation.item.name : deleteConfirmation.item.displayName}</p><p className="delete-confirm-warning">{deleteConfirmation.stage === 1 ? (deleteConfirmation.type === 'table' ? "La suppression n’a pas encore eu lieu. Une deuxième confirmation sera demandée." : "La suppression n’a pas encore eu lieu. Une deuxième confirmation sera demandée.") : (deleteConfirmation.type === 'table' ? "Cette action est définitive. La table ne pourra pas être récupérée." : "Cette action est définitive. La fiche invité ne pourra pas être récupérée.")}</p><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setDeleteConfirmation(null)}>Annuler</button><button type="button" className="button button-danger-ghost" onClick={advanceDeleteConfirmation}><Trash2 size={16} /> {deleteConfirmation.stage === 1 ? "Oui, continuer" : "Supprimer définitivement"}</button></div></div></Modal>}
      {tableModal && <Modal title="Créer une table" description="Définissez un nom clair pour retrouver facilement les invités." onClose={() => setTableModal(false)}><form onSubmit={saveTable} className="form-stack"><label>Nom ou numéro de table<input autoFocus value={newTableName} onChange={(event) => setNewTableName(event.target.value)} placeholder="Ex. Table 03" required /></label><label>Description <span className="optional-label">Facultatif</span><input value={newTableDescription} onChange={(event) => setNewTableDescription(event.target.value)} placeholder="Ex. Famille et proches" /></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setTableModal(false)}>Annuler</button><button type="submit" className="button button-primary"><Plus size={16} /> Créer la table</button></div></form></Modal>}
      {guestModal && <Modal title={editingGuest ? 'Modifier l’invité' : 'Ajouter un invité'} description={activeTable ? `Table sélectionnée : ${activeTable.name}` : 'L’invité doit être affecté à une table existante.'} onClose={() => setGuestModal(false)}><form onSubmit={saveGuest} className="form-stack"><label>Nom de l’invité ou des invités<input autoFocus value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder={kind === 'couple' ? 'Jean et Marie Mukendi' : 'Jean Mukendi'} required /></label><label>Type d’invitation<select value={kind} onChange={(event) => setKind(event.target.value as InvitationKind)}><option value="individual">Personne seule</option><option value="couple">Couple</option></select></label>{kind === 'individual' && <label>Civilité<select value={salutation} onChange={(event) => setSalutation(event.target.value as Salutation)}><option>Monsieur</option><option>Madame</option><option>Mademoiselle</option></select></label>}<div className="name-preview"><span>APERÇU DU NOM</span><strong>{guestName.trim() ? makeDisplayName(guestName, salutation, kind) : 'Le nom apparaîtra ici'}</strong></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setGuestModal(false)}>Annuler</button><button type="submit" className="button button-primary"><Check size={16} /> {editingGuest ? 'Enregistrer' : 'Ajouter l’invité'}</button></div></form></Modal>}
      {detailGuest && <Modal title="Détail de l’invitation" description="Fiche invité, QR unique et invitation personnalisée." onClose={() => setDetailGuest(null)} wide><div className="detail-layout"><div className="detail-invite-preview" style={{ position: 'relative', overflow: 'hidden', padding: 0, background: templateImage ? 'transparent' : undefined, aspectRatio: templateImageDimensions ? `${templateImageDimensions.width} / ${templateImageDimensions.height}` : '3 / 4', width: '100%', containerType: 'inline-size' }}>{templateImage ? <><img src={templateImage} alt="Template original de l’invitation" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} /><strong className="template-preview-name" style={{ position: 'absolute', left: `${templateNameX}%`, top: `${templateNameY}%`, transform: 'translate(-50%, -50%)', fontSize: `${(fitNameFontSize(detailGuest.displayName, templateImageDimensions?.width ?? 1000) / (templateImageDimensions?.width ?? 1000)) * 100}cqw`, maxWidth: `${templateNameWidth}%`, overflowWrap: 'anywhere', wordBreak: 'break-word', color: templateNameColor, fontFamily: templateNameFont, textShadow: templateNameEffect === 'shadow' ? '0 1px 3px #ffffffcc' : templateNameEffect === 'glow' ? `0 0 8px ${templateNameColor}` : 'none', WebkitTextStroke: templateNameEffect === 'outline' ? '0.6px white' : '0px transparent' }}>{detailGuest.displayName}</strong>{detailGuest.token && <div className="template-preview-qr" style={{ position: 'absolute', left: `${templateQrX}%`, top: `${templateQrY}%`, width: `${templateQrSize}%`, transform: 'translate(-50%, -50%)' }}><QRCodeSVG value={detailGuest.token} size={256} level="H" includeMargin /></div>}</> : <div className="template-preview-empty"><FileImage size={28} /><strong>Aucun template importé</strong></div>}</div><div className="detail-meta"><div className="detail-meta-row"><span>Table</span><strong>{tables.find((table) => table.id === detailGuest.tableId)?.name ?? 'Table inconnue'}</strong></div><div className="detail-meta-row"><span>Type</span><strong>{detailGuest.kind === 'couple' ? 'Couple' : 'Personne seule'}</strong></div><div className="detail-meta-row"><span>Invitation</span><strong>{statusLabel(detailGuest.invitationStatus)}</strong></div><div className="detail-meta-row"><span>Entrée</span><strong>{statusLabel(detailGuest.checkinStatus)}</strong></div><div className="detail-meta-row"><span>Identifiant</span><code>{detailGuest.id}</code></div><div className="detail-actions">{detailGuest.invitationStatus !== 'generated' && <button className="button button-primary button-wide" onClick={() => generateInvitation(detailGuest.id)}><QrCode size={16} /> Générer le QR code</button>}{detailGuest.token && <button className="button button-secondary button-wide" onClick={() => void downloadDemoInvitation(detailGuest)}><Download size={16} /> Télécharger l’invitation (PNG)</button>}<button className="button button-secondary button-wide" onClick={() => { setDetailGuest(null); openAddGuest(detailGuest); }}><Pencil size={15} /> Modifier la fiche</button><button className="button button-danger-ghost button-wide" onClick={() => deleteGuest(detailGuest)}><Trash2 size={15} /> Supprimer l’invité</button><p className="muted-copy small-note">Le PNG téléchargé reprend le template et les positions enregistrées dans cet éditeur.</p></div></div></div></Modal>}
      {editingCollaborator && <Modal title="Modifier le collaborateur" description="Modifiez son nom affiché et son numéro de contact. Son identifiant de connexion reste inchangé." onClose={() => { if (!collaboratorSaving) setEditingCollaborator(null); }}>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void saveCollaboratorProfile(); }}>
          <label>Nom affiché<input autoFocus value={collaboratorDisplayName} onChange={(event) => setCollaboratorDisplayName(event.target.value)} required maxLength={100}/></label>
          <label>Numéro WhatsApp<input type="tel" value={collaboratorWhatsapp} onChange={(event) => setCollaboratorWhatsapp(event.target.value)} placeholder="+243…" maxLength={30}/></label>
          <p className="muted-copy small-note">Le nom utilisé pour se connecter n’est pas modifié, afin de ne pas bloquer son accès.</p>
          <div className="modal-actions"><button type="button" className="button button-secondary" disabled={collaboratorSaving} onClick={() => setEditingCollaborator(null)}>Annuler</button><button type="submit" className="button button-primary" disabled={collaboratorSaving}>{collaboratorSaving ? <><LoaderCircle size={15} className="access-spin"/>Enregistrement…</> : <><Check size={15}/>Enregistrer</>}</button></div>
        </form>
      </Modal>}
      {permissionsModal && createPortal(<div className="permission-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !permissionsSaving) setPermissionsModal(null); }}><section className="permission-modal" role="dialog" aria-modal="true" aria-labelledby="permissions-modal-title">
        <div className="permission-modal-head"><span className="permission-modal-icon"><ShieldCheck size={21}/></span><div><span className="access-eyebrow">GESTION DES AUTORISATIONS</span><h2 id="permissions-modal-title">{String(permissionsModal.firstName ?? '')} {String(permissionsModal.lastName ?? '')}</h2><p>Choisissez les fonctionnalités accessibles à ce collaborateur.</p></div><button className="permission-close" aria-label="Fermer" disabled={permissionsSaving} onClick={() => setPermissionsModal(null)}><X size={18}/></button></div>
        <div className="permission-modal-toolbar"><span><strong>{permissionDraft.length}</strong> / {navItems.length} menus autorisés</span><div><button type="button" onClick={() => setPermissionDraft(navItems.map((item) => item.id))}>Tout sélectionner</button><button type="button" onClick={() => setPermissionDraft([])}>Tout désélectionner</button></div></div>
        <div className="permission-modal-body">{navItems.map((item) => {
          const descriptions: Record<string,string> = {dashboard:'Vue d’ensemble et indicateurs',tables:'Organisation des places et des tables',guests:'Liste et fiches des invités',invitations:'Création des invitations personnalisées',scanner:'Contrôle des QR codes à l’entrée',history:'Journal des entrées et des contrôles',templates:'Modèles et mise en page',settings:'Préférences de l’espace'};
          const checked = permissionDraft.includes(item.id);
          return <button type="button" className={`permission-option ${checked ? 'permission-option-active' : ''}`} key={item.id} aria-pressed={checked} onClick={() => setPermissionDraft((current) => checked ? current.filter((id) => id !== item.id) : [...current,item.id])}><span className="permission-option-icon"><item.icon size={17}/></span><span className="permission-option-copy"><strong>{item.label}</strong><small>{descriptions[item.id] ?? 'Accès à cette fonctionnalité'}</small></span><span className={`permission-toggle ${checked ? 'permission-toggle-on' : ''}`} aria-hidden="true"><i/></span></button>;
        })}</div>
        <div className="permission-modal-footer"><span>{permissionDraft.length} menu{permissionDraft.length > 1 ? 'x' : ''} activé{permissionDraft.length > 1 ? 's' : ''}</span><div><button type="button" className="button button-secondary" disabled={permissionsSaving} onClick={() => setPermissionsModal(null)}>Annuler</button><button type="button" className="button button-primary" disabled={permissionsSaving} onClick={() => void saveCollaboratorPermissions()}>{permissionsSaving ? <><LoaderCircle size={15} className="access-spin"/>Enregistrement…</> : <><Check size={15}/>Enregistrer les droits</>}</button></div></div>
      </section></div>, document.body)}
      {toast && <div className={`toast toast-${toast.kind}`}><span>{toast.kind === 'success' ? <CheckCircle2 size={18} /> : toast.kind === 'error' ? <AlertTriangle size={18} /> : <CircleHelp size={18} />}</span>{toast.message}<button aria-label="Fermer" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  );
}


function AuthScreen() {
  const [mode, setMode] = useState<'landing' | 'owner-register' | 'owner-login' | 'collaborator-register' | 'collaborator-login'>('landing');
  const openAuth = (role: 'owner' | 'collaborator', action: 'login' | 'register' = 'login') => { setMode(role === 'owner' ? (action === 'register' ? 'owner-register' : 'owner-login') : (action === 'register' ? 'collaborator-register' : 'collaborator-login')); setError(''); setMessage(''); setVerificationPending(false); };
  const [projectId, setProjectId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [verificationPending, setVerificationPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (!auth || !firestore) { setError('Firebase n’est pas configuré.'); return; }
    if ((mode === 'owner-register' || mode === 'collaborator-register') && password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (mode === 'owner-register' && password !== confirmPassword) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    if (mode === 'collaborator-register' && !projectId.trim()) { setError('Saisis le code de ton espace.'); return; }
    if ((mode === 'collaborator-register' || mode === 'collaborator-login') && !firstName.trim()) { setError('Saisis ton nom de collaborateur.'); return; }
    setBusy(true);
    let operation = 'initialisation';
    try {
      if (mode === 'collaborator-register') {
        const normalizedProjectId = projectId.trim();
        const cleanName = firstName.trim().replace(/\s+/g, ' ');
        const usernameEmail = collaboratorLoginEmail(cleanName);
        operation = 'création du compte collaborateur';
        const credential = await createUserWithEmailAndPassword(auth, usernameEmail, password);
        await updateProfile(credential.user, { displayName: cleanName });
        operation = 'lecture du projet';
        const projectSnapshot = await getDoc(doc(firestore, 'projects', normalizedProjectId));
        if (!projectSnapshot.exists() || projectSnapshot.data().status !== 'active') {
          await deleteUser(credential.user);
          setError('Code d’espace introuvable ou inactif. Vérifie le code fourni par le responsable.');
          return;
        }
        operation = 'création du profil collaborateur';
        await setDoc(doc(firestore, 'users', credential.user.uid), {
          uid: credential.user.uid, firstName: cleanName, lastName: '', email: usernameEmail, whatsapp: '',
          role: 'collaborator', status: 'pending', super_admin: false, projectId: normalizedProjectId,
          createdAt: new Date().toISOString(),
        });
        await signOut(auth);
        setMessage('Compte créé. Ta demande d’accès est envoyée ; connecte-toi avec ton nom et ton mot de passe après validation.');
      } else if (mode === 'collaborator-login') {
        const cleanName = firstName.trim().replace(/\s+/g, ' ');
        operation = 'connexion du collaborateur';
        await signInWithEmailAndPassword(auth, collaboratorLoginEmail(cleanName), password);
      } else if (mode === 'owner-register') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
        await updateProfile(credential.user, { displayName });
        await setDoc(doc(firestore, 'users', credential.user.uid), {
          uid: credential.user.uid, firstName: firstName.trim(), lastName: lastName.trim(),
          whatsapp: whatsapp.trim(), email: email.trim().toLowerCase(),
          role: 'admin', status: 'pending', super_admin: false, projectId: null,
          createdAt: new Date().toISOString(),
        });
        await sendEmailVerification(credential.user);
        setVerificationPending(true);
        setMessage('Demande de compte administrateur envoyée. Vérifie ton e-mail ; ton accès sera activé après approbation par le super administrateur.');
        await signOut(auth);
      } else {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (!credential.user.emailVerified) {
          await signOut(auth);
          setVerificationPending(true);
          setError('Ton adresse e-mail n’est pas encore vérifiée. Ouvre le lien reçu par e-mail avant de te connecter.');
          return;
        }
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      const messages: Record<string,string> = {
        'auth/email-already-in-use': 'Cette adresse e-mail possède déjà un compte.',
        'auth/invalid-email': 'Adresse e-mail invalide.',
        'auth/weak-password': 'Choisis un mot de passe plus robuste.',
        'auth/invalid-credential': 'Adresse e-mail ou mot de passe incorrect.',
        'auth/too-many-requests': 'Trop de tentatives. Réessaie plus tard.',
        'auth/user-not-found': 'Aucun compte ne correspond à cette adresse.',
        'permission-denied': 'Firestore a refusé l’opération. Vérifie les règles et les champs envoyés.',
        'firestore/permission-denied': 'Firestore a refusé l’opération. Vérifie les règles et les champs envoyés.',
      };
      const detail = messages[code] ?? (e instanceof Error ? e.message : 'Une erreur est survenue.');
      setError(code === 'permission-denied' || code === 'firestore/permission-denied'
        ? `Accès Firestore refusé pendant : ${operation}. Vérifie que les règles corrigées sont bien publiées dans Firebase.`
        : detail);
    } finally { setBusy(false); }
  };
  if (mode === 'landing') return <main className="landing-page">
    <header className="landing-nav"><button className="landing-brand" onClick={() => setMode('landing')}><span className="landing-brand-mark"><Heart size={22}/></span><span>mes invites<small>VOS MOMENTS, VOS INVITATIONS</small></span></button><div className="landing-nav-actions"><button className="landing-login-link" onClick={() => openAuth('owner', 'login')}>Propriétaire</button><button className="button button-primary landing-nav-cta" onClick={() => openAuth('collaborator', 'login')}>Collaborateur <ArrowDownRight size={16}/></button></div></header>
    <section className="landing-hero"><div className="landing-hero-copy"><span className="landing-eyebrow"><span/> L’ART DE RECEVOIR, SIMPLEMENT</span><h1>Vos invitations méritent une expérience <em>inoubliable.</em></h1><p>Créez de belles invitations personnalisées, organisez vos invités et accueillez chacun en toute sérénité. Tout votre événement, dans un seul espace.</p><div className="landing-hero-actions"><button className="button button-primary" onClick={() => openAuth('owner', 'login')}>Propriétaire <ChevronRight size={17}/></button><button className="button button-secondary landing-role-button" onClick={() => openAuth('collaborator', 'login')}>Collaborateur <Users size={16}/></button></div><div className="landing-trust"><span><ShieldCheck size={16}/> Espace privé</span><span><CheckCircle2 size={16}/> Gestion simplifiée</span></div></div>
      <div className="landing-visual" aria-label="Aperçu d’une invitation élégante"><div className="landing-orbit landing-orbit-one"/><div className="landing-orbit landing-orbit-two"/><div className="landing-invitation-card"><span className="landing-card-kicker">VOUS ÊTES CORDIALEMENT INVITÉ(E)</span><span className="landing-card-flourish"><Heart size={20}/></span><span className="landing-card-script">Une journée</span><strong>à célébrer</strong><span className="landing-card-line"/><span className="landing-card-date">AMOUR · JOIE · PARTAGE</span><span className="landing-card-monogram">M <i>&</i> I</span></div><div className="landing-float landing-float-qr"><QrCode size={21}/><span><b>QR code unique</b><small>Entrée simplifiée</small></span></div><div className="landing-float landing-float-guests"><Users size={20}/><span><b>Vos invités</b><small>Tout est organisé</small></span></div><span className="landing-spark landing-spark-a">✳</span><span className="landing-spark landing-spark-b">✦</span></div>
    </section>
    <section className="landing-benefits"><div className="landing-section-heading"><span className="landing-eyebrow">TOUT AU MÊME ENDROIT</span><h2>Moins d’organisation à gérer.<br/><em>Plus de moments à vivre.</em></h2></div><div className="landing-feature-grid"><article className="landing-feature"><span><Heart size={20}/></span><h3>Invitations personnalisées</h3><p>Adaptez votre modèle et préparez des invitations au nom de chaque invité.</p></article><article className="landing-feature"><span><Users size={20}/></span><h3>Invités bien organisés</h3><p>Répartissez les personnes par table et gardez vos listes faciles à gérer.</p></article><article className="landing-feature"><span><ScanLine size={20}/></span><h3>Accueil avec QR code</h3><p>Vérifiez les invitations à l’entrée et suivez les arrivées simplement.</p></article></div></section>
    <section className="landing-bottom-cta"><div><span className="landing-eyebrow">VOTRE ÉVÉNEMENT COMMENCE ICI</span><h2>Prêt à préparer votre réception ?</h2><p>Créez votre espace et rassemblez toute votre organisation au même endroit.</p></div><div className="landing-cta-actions"><button className="button button-primary" onClick={() => openAuth('owner', 'register')}>Créer mon espace <ChevronRight size={17}/></button><button className="button button-secondary" onClick={() => openAuth('collaborator', 'login')}>Accès collaborateur</button></div></section>
    <footer className="landing-footer"><button className="landing-brand landing-footer-brand" onClick={() => setMode('landing')}><span className="landing-brand-mark"><Heart size={18}/></span><span>mes invites</span></button><span>© 2026 Mes Invites · Vos moments, en toute simplicité.</span><button className="landing-login-link" onClick={() => openAuth('owner', 'login')}>Propriétaire</button><button className="landing-login-link" onClick={() => openAuth('collaborator', 'login')}>Collaborateur</button></footer>
  </main>;
  return <main className="auth-screen"><button className="auth-backdrop-close" type="button" aria-label="Fermer" onClick={() => setMode('landing')}></button><section className="auth-card auth-dialog" role="dialog" aria-modal="true" aria-label="Accès à Mes Invites"><div className="auth-brand"><span className="auth-mark"><Heart size={24}/></span><span>Mes Invites<small>Gestion élégante de vos invitations</small></span></div><button className="auth-dialog-close" type="button" aria-label="Fermer" onClick={() => setMode('landing')}><X size={18}/></button><div className="auth-intro"><span className="eyebrow">{mode.startsWith('owner-') ? 'ESPACE PROPRIÉTAIRE' : 'ESPACE COLLABORATEUR'}</span><h1>{mode === 'owner-register' ? 'Créer votre espace' : mode === 'collaborator-register' ? 'Rejoindre un espace' : mode === 'collaborator-login' ? 'Connexion collaborateur' : 'Connexion propriétaire'}</h1><p>{mode === 'owner-register' ? 'Créez votre espace privé pour organiser votre événement.' : mode === 'collaborator-register' ? 'Créez votre accès avec le code transmis par le propriétaire.' : mode === 'collaborator-login' ? 'Connectez-vous avec votre nom et votre mot de passe.' : 'Retrouvez votre espace et poursuivez votre organisation.'}</p></div>
  <div className="auth-tabs" role="tablist" aria-label="Type d’accès"><button type="button" role="tab" aria-selected={mode.endsWith('login')} className={mode.endsWith('login') ? 'active' : ''} onClick={() => { setMode(mode.startsWith('owner-') ? 'owner-login' : 'collaborator-login'); setError(''); setMessage(''); }}>Se connecter</button><button type="button" role="tab" aria-selected={mode.endsWith('register')} className={mode.endsWith('register') ? 'active' : ''} onClick={() => { setMode(mode.startsWith('owner-') ? 'owner-register' : 'collaborator-register'); setError(''); setMessage(''); }}>Créer un compte</button></div><form className="form-stack auth-form" onSubmit={submit}>
  {mode === 'owner-register' && <div className="auth-name-grid"><label>Prénom<input autoComplete="given-name" value={firstName} onChange={e=>setFirstName(e.target.value)} required/></label><label>Nom<input autoComplete="family-name" value={lastName} onChange={e=>setLastName(e.target.value)} required/></label></div>}
  {(mode === 'collaborator-register' || mode === 'collaborator-login') && <label>Nom unique du collaborateur<input autoComplete="username" value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="Nom et prénom" required /></label>}
  {mode === 'owner-register' && <label>Numéro WhatsApp<input type="tel" autoComplete="tel" value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} placeholder="+243…" required/></label>}
  {mode === 'collaborator-register' && <label>Code de l’espace<input autoComplete="off" value={projectId} onChange={e=>setProjectId(e.target.value)} placeholder="Code fourni par le responsable" required /></label>}
  {(mode === 'owner-register' || mode === 'owner-login') && <><label>Adresse e-mail<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="vous@exemple.com" required/></label>
  <label>Mot de passe<input type="password" autoComplete={mode === 'owner-register' ? 'new-password' : 'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/></label>
  {mode === 'owner-register' && <label>Confirmer le mot de passe<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={8} required/></label>}</>}{(mode === 'collaborator-register' || mode === 'collaborator-login') && <label>Mot de passe<input type="password" autoComplete={mode === 'collaborator-register' ? 'new-password' : 'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/></label>}
  {error && <p className="auth-alert auth-error" role="alert">{error}</p>}{message && <p className="auth-alert auth-success" role="status">{message}</p>}
  {verificationPending && mode === 'owner-login' && <button className="button button-secondary auth-submit" disabled={busy} type="button" onClick={async()=>{if(!auth) return;setBusy(true);setError('');try{const credential=await signInWithEmailAndPassword(auth,email.trim(),password);await sendEmailVerification(credential.user);await signOut(auth);setMessage('Nouveau lien de vérification envoyé.');}catch(e){setError(e instanceof Error?e.message:'Impossible de renvoyer le lien.');}finally{setBusy(false);}}}>Renvoyer le lien de vérification</button>}
  <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? 'Patiente…' : mode === 'owner-register' ? 'Créer mon espace' : mode === 'collaborator-register' ? 'Envoyer ma demande' : 'Se connecter'}</button>
  </form><p className="auth-switch">{mode === 'owner-register' ? 'Vous avez déjà un compte ?' : mode === 'owner-login' ? 'Vous découvrez Mes Invites ?' : mode === 'collaborator-register' ? 'Déjà un accès collaborateur ?' : 'Première visite ?'} <button type="button" onClick={()=>{setMode(mode === 'owner-register' ? 'owner-login' : mode === 'owner-login' ? 'owner-register' : mode === 'collaborator-register' ? 'collaborator-login' : 'collaborator-register');setError('');setMessage('');}}>{mode === 'owner-register' || mode === 'collaborator-register' ? 'Se connecter' : 'Créer un compte'}</button></p><p className="auth-switch auth-role-switch">{mode.startsWith('owner-') ? 'Vous êtes collaborateur ?' : 'Vous êtes propriétaire ?'} <button type="button" onClick={() => openAuth(mode.startsWith('owner-') ? 'collaborator' : 'owner', mode.endsWith('register') ? 'register' : 'login')}>Changer de profil</button></p><p className="auth-footnote"><ShieldCheck size={14}/> Vos informations sont protégées.</p></section></main>;
}

function collaboratorLoginEmail(name: string) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized.length < 3) throw new Error('Le nom du collaborateur doit contenir au moins 3 caractères distinctifs.');
  return `${normalized}@collaborateur.mesinvites.app`;
}

function StatCard({ label, value, note, icon: Icon, trend }: { label: string; value: number; note?: string; icon: typeof Users; trend?: string }) {
  return <article className="stat-card"><div className="stat-card-top"><span>{label}</span><span className="stat-icon"><Icon size={18} strokeWidth={1.8} /></span></div><div className="stat-value">{value.toLocaleString('fr-FR')}</div><div className="stat-bottom">{note && <span>{note}</span>}{trend && <small>{trend}</small>}</div></article>;
}

function Modal({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><h3>{title}</h3>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Fermer"><X size={19} /></button></div>{children}</section></div>;
}
