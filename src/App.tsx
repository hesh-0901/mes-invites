import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDownRight, Bell, Check, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Download, Eye,
  FileImage, Heart, LayoutDashboard, MoreHorizontal, Plus, QrCode,
  ScanLine, Search, Settings, ShieldCheck, Sparkles, Table2, Ticket, Users, X,
  AlertTriangle, Camera, LockKeyhole, Trash2, Pencil,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Html5Qrcode } from 'html5-qrcode';
import { auth, firebaseConfigured, firestore } from './firebase';
import { createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signOut, updateProfile, type User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { deleteRecord, FIRESTORE_COLLECTIONS, loadCollection, saveCheckinRecord, saveGuestRecord, saveRecord, saveTableRecord } from './firestoreData';
import { initialCheckins, initialGuests, initialTables } from './data';
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
  useEffect(() => {
    if (!auth) { setAuthReady(true); return; }
    return onAuthStateChanged(auth, (user) => { setAuthUser(user); setAuthReady(true); });
  }, []);
  const [page, setPage] = useState<Page>('dashboard');
  const [tables, setTables] = useState<GuestTable[]>(initialTables);
  const [guests, setGuests] = useState<Guest[]>(initialGuests);
  const [checkins, setCheckins] = useState<Checkin[]>(initialCheckins);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [tableModal, setTableModal] = useState(false);
  const [guestModal, setGuestModal] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [detailGuest, setDetailGuest] = useState<Guest | null>(null);
  const [newTableName, setNewTableName] = useState('');
  const [newTableDescription, setNewTableDescription] = useState('');
  const [guestName, setGuestName] = useState('');
  const [salutation, setSalutation] = useState<Salutation>('Monsieur');
  const [kind, setKind] = useState<InvitationKind>('individual');
  const [templateImage, setTemplateImage] = useState<string>(() => {
    try { return window.localStorage.getItem('mes-invites-template-image') ?? ''; } catch { return ''; }
  });
  const [templateNameX, setTemplateNameX] = useState(() => Number(window.localStorage.getItem('mes-invites-template-name-x') ?? 50));
  const [templateNameY, setTemplateNameY] = useState(() => Number(window.localStorage.getItem('mes-invites-template-name-y') ?? 55));
  const [templateQrX, setTemplateQrX] = useState(() => Number(window.localStorage.getItem('mes-invites-template-qr-x') ?? 78));
  const [templateQrY, setTemplateQrY] = useState(() => Number(window.localStorage.getItem('mes-invites-template-qr-y') ?? 82));
  const [templateQrSize, setTemplateQrSize] = useState(() => Number(window.localStorage.getItem('mes-invites-template-qr-size') ?? 14));
  const [templateNameSize, setTemplateNameSize] = useState(() => Number(window.localStorage.getItem('mes-invites-template-name-size') ?? 3));
  const [templateNameWidth, setTemplateNameWidth] = useState(() => Number(window.localStorage.getItem('mes-invites-template-name-width') ?? 60));
  const [templateNameColor] = useState(() => window.localStorage.getItem('mes-invites-template-name-color') ?? '#762d40');
  const [templateNameFont] = useState(() => window.localStorage.getItem('mes-invites-template-name-font') ?? 'Georgia');
  const [templateNameEffect] = useState(() => window.localStorage.getItem('mes-invites-template-name-effect') ?? 'shadow');
  const [templateImageDimensions, setTemplateImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [templateSampleName, setTemplateSampleName] = useState('Nom de l’invité');
  const [templateLocked, setTemplateLocked] = useState(() => window.localStorage.getItem('mes-invites-template-locked') === 'true');
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
    let cancelled = false;
    const loadCloudData = async () => {
      try {
        const [cloudTables, cloudGuests, cloudCheckins, cloudSettings] = await Promise.all([
          loadCollection<GuestTable>(FIRESTORE_COLLECTIONS.tables),
          loadCollection<Guest>(FIRESTORE_COLLECTIONS.guests),
          loadCollection<Checkin>(FIRESTORE_COLLECTIONS.checkins),
          loadCollection<{ id: string; imageUrl?: string; nameX?: number; nameY?: number; qrX?: number; qrY?: number; qrSize?: number; nameSize?: number; nameWidth?: number; locked?: boolean }>(FIRESTORE_COLLECTIONS.settings),
        ]);
        if (cancelled) return;
        if (cloudTables.length) setTables(cloudTables);
        if (cloudGuests.length) setGuests(cloudGuests);
        if (cloudCheckins.length) setCheckins(cloudCheckins);
        const templateSettings = cloudSettings.find((item) => item.id === 'template');
        if (templateSettings) {
          if (templateSettings.imageUrl) { setTemplateImage(templateSettings.imageUrl); window.localStorage.setItem('mes-invites-template-image', templateSettings.imageUrl); }
          if (typeof templateSettings.nameX === 'number') setTemplateNameX(templateSettings.nameX);
          if (typeof templateSettings.nameY === 'number') setTemplateNameY(templateSettings.nameY);
          if (typeof templateSettings.qrX === 'number') setTemplateQrX(templateSettings.qrX);
          if (typeof templateSettings.qrY === 'number') setTemplateQrY(templateSettings.qrY);
          if (typeof templateSettings.qrSize === 'number') setTemplateQrSize(templateSettings.qrSize);
          if (typeof templateSettings.nameSize === 'number') setTemplateNameSize(templateSettings.nameSize);
          if (typeof templateSettings.nameWidth === 'number') setTemplateNameWidth(templateSettings.nameWidth);
          if (templateSettings.locked) setTemplateLocked(true);
        }
      } catch {
        // Firestore remains locked until the authentication and rules phase.
        // The local demo remains usable without exposing records publicly.
      }
    };
    if (firebaseConfigured) void loadCloudData();
    return () => { cancelled = true; };
  }, []);

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
    void saveTableRecord(table).catch(() => undefined);
    setNewTableName('');
    setNewTableDescription('');
    setTableModal(false);
    notify('Table créée.');
    openTable(table.id);
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
      void saveGuestRecord(updated).catch(() => undefined);
      setDetailGuest(updated);
      notify('Fiche invité mise à jour.');
    } else {
      const guest: Guest = {
        id: makeId('guest'), tableId, name: cleanName, salutation, kind, displayName,
        createdAt: new Date().toISOString(), invitationStatus: 'not-generated', checkinStatus: 'not-checked-in',
      };
      setGuests((current) => [guest, ...current]);
      void saveGuestRecord(guest).catch(() => undefined);
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
    void saveGuestRecord(updated).catch(() => undefined);
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
      void saveCheckinRecord(entry).catch(() => undefined);
      return;
    }
    setScanValue(code);
    if (guest.checkinStatus === 'checked-in') {
      setScanResult({ state: 'used', guest, message: 'Cette invitation a déjà été utilisée.' });
      const entry: Checkin = { id: makeId('scan'), guestId: guest.id, guestName: guest.displayName, tableName: tables.find((table) => table.id === guest.tableId)?.name ?? '—', result: 'already-used', timestamp: new Date().toISOString(), operator: 'Accueil — démonstration' };
      setCheckins((current) => [entry, ...current]);
      void saveCheckinRecord(entry).catch(() => undefined);
      return;
    }
    const timestamp = new Date().toISOString();
    setGuests((current) => current.map((item) => item.id === guest.id ? { ...item, checkinStatus: 'checked-in', checkedInAt: timestamp } : item));
    const tableName = tables.find((table) => table.id === guest.tableId)?.name ?? '—';
    const entry: Checkin = { id: makeId('checkin'), guestId: guest.id, guestName: guest.displayName, tableName, result: 'accepted', timestamp, operator: 'Accueil — démonstration' };
    setCheckins((current) => [entry, ...current]);
    void saveCheckinRecord(entry).catch(() => undefined);
    void saveGuestRecord({ ...guest, checkinStatus: 'checked-in', checkedInAt: timestamp }).catch(() => undefined);
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
    if (!window.confirm(`Supprimer ${guest.displayName} des données de démonstration ?`)) return;
    setGuests((current) => current.filter((item) => item.id !== guest.id));
    void deleteRecord(FIRESTORE_COLLECTIONS.guests, guest.id).catch(() => undefined);
    setDetailGuest(null);
    notify('Invité supprimé du prototype.', 'info');
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
      const qrUrl = URL.createObjectURL(new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' }));
      try {
        const qrImage = new Image();
        qrImage.src = qrUrl;
        await new Promise<void>((resolve, reject) => {
          qrImage.onload = () => resolve();
          qrImage.onerror = () => reject(new Error('Impossible de créer le QR code.'));
        });
        const qrSize = width * templateQrSize / 100;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(width * templateQrX / 100 - qrSize / 2, height * templateQrY / 100 - qrSize / 2, qrSize, qrSize);
        ctx.drawImage(qrImage, width * templateQrX / 100 - qrSize / 2, height * templateQrY / 100 - qrSize / 2, qrSize, qrSize);
      } finally {
        URL.revokeObjectURL(qrUrl);
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Export PNG impossible.')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mes-invites-${guest.id}.png`;
      link.click();
      URL.revokeObjectURL(url);
      notify('Invitation personnalisée téléchargée en PNG.');
    } catch {
      notify('Impossible de composer le PNG. Vérifie que le template est bien accessible.', 'error');
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
          <div className="table-cards">{tables.slice(0, 4).map((table, index) => {
            const tableGuests = guests.filter((guest) => guest.tableId === table.id);
            const checked = tableGuests.filter((guest) => guest.checkinStatus === 'checked-in').length;
            return <button className="table-card" key={table.id} onClick={() => openTable(table.id)}><span className={`table-icon table-icon-${index % 3}`}><Table2 size={19} /></span><span className="table-card-main"><strong>{table.name}</strong><small>{table.description || 'Aucune description'}</small><span className="mini-progress"><span style={{ width: `${tableGuests.length ? checked / tableGuests.length * 100 : 0}%` }} /></span><small>{tableGuests.length} invité(s) · {checked} entrée(s)</small></span><ChevronRight size={17} className="muted-icon" /></button>;
          })}</div>
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
      window.localStorage.setItem('mes-invites-template-locked', 'true');
      void saveRecord(FIRESTORE_COLLECTIONS.settings, { id: 'template', imageUrl: templateImage, nameX: templateNameX, nameY: templateNameY, qrX: templateQrX, qrY: templateQrY, qrSize: templateQrSize, nameSize: templateNameSize, nameWidth: templateNameWidth, locked: true, updatedAt: new Date().toISOString() }).catch(() => undefined);
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
              <div className="template-preview-name" style={{ left: `${templateNameX}%`, top: `${templateNameY}%`, fontSize: `${templateNameSize}cqw`, maxWidth: `${templateNameWidth}%` }}>{templateSampleName || 'Nom de l’invité'}</div>
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
              <div className="template-control-group"><strong>Position du nom</strong><label>Horizontal — {templateNameX}%<input type="range" min="0" max="100" value={templateNameX} onChange={(e) => setTemplateNameX(Number(e.target.value))} /></label><label>Vertical — {templateNameY}%<input type="range" min="0" max="100" value={templateNameY} onChange={(e) => setTemplateNameY(Number(e.target.value))} /></label><label>Taille maximale du texte — {templateNameSize}% de la largeur<input type="range" min="1" max="7" step="0.25" value={templateNameSize} onChange={(e) => setTemplateNameSize(Number(e.target.value))} /></label><label>Largeur réservée au nom — {templateNameWidth}%<input type="range" min="10" max="95" step="1" value={templateNameWidth} onChange={(e) => setTemplateNameWidth(Number(e.target.value))} /></label><small className="muted-copy">Les noms longs sont automatiquement réduits pour rester dans cette zone.</small></div>
              <div className="template-control-group"><strong>Position du QR code</strong><label>Horizontal — {templateQrX}%<input type="range" min="0" max="100" value={templateQrX} onChange={(e) => setTemplateQrX(Number(e.target.value))} /></label><label>Vertical — {templateQrY}%<input type="range" min="0" max="100" value={templateQrY} onChange={(e) => setTemplateQrY(Number(e.target.value))} /></label><label>Taille — {templateQrSize}% de la largeur<input type="range" min="6" max="28" step="1" value={templateQrSize} onChange={(e) => setTemplateQrSize(Number(e.target.value))} /></label></div>
              <div className="modal-actions"><button className="button button-secondary" onClick={() => { setTemplateNameX(50); setTemplateNameY(55); setTemplateQrX(78); setTemplateQrY(82); setTemplateQrSize(14); setTemplateNameSize(3); setTemplateNameWidth(60); }}>Réinitialiser</button><button className="button button-primary" onClick={saveTemplateSettings}><Check size={16} /> Enregistrer et verrouiller</button></div>
              <p className="muted-copy small-note"><LockKeyhole size={14} /> Après l’enregistrement, les paramètres seront masqués. Utilise « Modifier » pour les afficher de nouveau.</p>
            </div>
            <div className="panel template-preview-panel"><div className="panel-heading"><div><h3>Aperçu en direct</h3><p>Exemple de placement du nom et du QR code.</p></div><Eye size={18} className="muted-icon" /></div>{templateImage && <button className="button button-secondary template-download-original" onClick={() => void downloadOriginalTemplate()}><Download size={15} /> Télécharger le template original</button>}
              {templateImage ? <div ref={templatePreviewRef} className="template-live-preview" onPointerMove={moveTemplateElement} onPointerUp={() => setDraggingTemplateElement(null)} onPointerCancel={() => setDraggingTemplateElement(null)} style={{ backgroundImage: `url("${templateImage}")`, aspectRatio: templateImageDimensions ? `${templateImageDimensions.width} / ${templateImageDimensions.height}` : '3 / 4', backgroundSize: '100% 100%' }}><div className={`template-preview-name template-draggable ${draggingTemplateElement === 'name' ? 'template-dragging' : ''}`} onPointerDown={(event) => { event.preventDefault(); setDraggingTemplateElement('name'); event.currentTarget.setPointerCapture(event.pointerId); }} style={{ left: `${templateNameX}%`, top: `${templateNameY}%`, fontSize: `${templateNameSize}cqw`, maxWidth: `${templateNameWidth}%` }}>{templateSampleName || 'Nom de l’invité'}<span className="template-drag-hint">Déplacer</span></div><div className={`template-preview-qr template-draggable ${draggingTemplateElement === 'qr' ? 'template-dragging' : ''}`} onPointerDown={(event) => { event.preventDefault(); setDraggingTemplateElement('qr'); event.currentTarget.setPointerCapture(event.pointerId); }} style={{ left: `${templateQrX}%`, top: `${templateQrY}%`, width: `${templateQrSize}%` }}><QRCodeSVG value="PREVIEW-QR-MES-INVITES" size={128} level="H" includeMargin /><span className="template-drag-hint">Déplacer</span></div></div> : <div className="template-preview-empty"><FileImage size={34} /><strong>Importe ton modèle pour commencer</strong><span>Formats acceptés : PNG, JPG et WebP. L’aperçu conserve le ratio de l’image.</span></div>}
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

  const renderSettings = () => (
    <>
      <section className="welcome-row"><div><div className="eyebrow">CONFIGURATION</div><h2>Paramètres</h2><p>État des services et informations de préparation.</p></div></section>
      <section className="settings-grid"><div className="panel"><div className="panel-heading"><div><h3>Services cloud</h3><p>Configuration Firebase du projet</p></div><Activity size={19} className="muted-icon" /></div><div className="setting-row"><span className="setting-icon"><ShieldCheck size={18} /></span><div><strong>Firebase Web SDK</strong><small>{firebaseConfigured ? 'SDK initialisé — données cloud non activées' : 'Variables d’environnement absentes'}</small></div><span className={`status-pill ${firebaseConfigured ? 'status-green' : 'status-amber'}`}><span className="status-dot" />{firebaseConfigured ? 'SDK initialisé' : 'Non connecté'}</span></div><div className="notice notice-info setting-notice"><LockKeyhole size={18} /><div><strong>La configuration n’est pas une autorisation</strong><p>Les règles Firestore et la validation côté serveur devront être définies avant toute donnée réelle.</p></div></div><button className="button button-secondary" onClick={() => notify('Configure les variables VITE_FIREBASE_* dans .env.local.', 'info')}>Voir les variables nécessaires</button></div>
      <div className="panel"><div className="panel-heading"><div><h3>Événement</h3><p>Informations générales</p></div><Heart size={19} className="muted-icon" /></div><div className="event-placeholder"><span className="event-monogram">M<span>&</span>I</span><strong>Mes Invites</strong><p>Les noms des mariés, la date et le lieu pourront être renseignés dans une prochaine étape.</p></div></div>
      <div className="panel"><div className="panel-heading"><div><h3>Mode de fonctionnement</h3><p>État de cette version</p></div><Settings size={19} className="muted-icon" /></div><div className="setting-row"><span className="setting-icon"><Activity size={18} /></span><div><strong>Données de démonstration</strong><small>Les modifications ne sont pas persistées dans le cloud.</small></div><span className="status-pill status-amber"><span className="status-dot" /> Actif</span></div><div className="setting-row"><span className="setting-icon"><FileImage size={18} /></span><div><strong>Template original</strong><small>À fournir pour déterminer les positions exactes.</small></div><span className="status-pill status-neutral"><span className="status-dot" /> À configurer</span></div><button className="button button-secondary" onClick={() => navigate('templates')}><FileImage size={16} /> Ajouter et positionner un template</button></div></section>
    </>
  );

  if (!authReady) return <div className="auth-loading">Chargement sécurisé…</div>;
  if (!authUser) return <AuthScreen />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('dashboard')}><span className="brand-mark"><Heart size={19} /></span><span><strong>mes invites</strong><small>GESTION ÉVÉNEMENTIELLE</small></span></button>
        <div className="event-switcher"><span className="event-avatar">M<span>&</span>I</span><span className="event-switcher-copy"><strong>Mon mariage</strong><small>Événement de démonstration</small></span><ChevronDown size={15} /></div>
        <nav className="sidebar-nav">
          <span className="nav-label">PRINCIPAL</span>
          {navItems.filter((item) => item.group === 'principal').map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'nav-active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.id === 'tables' && <span className="nav-count">{tables.length}</span>}</button>)}
          <span className="nav-label nav-label-spaced">CONFIGURATION</span>
          {navItems.filter((item) => item.group === 'configuration').map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'nav-active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><CircleHelp size={18} /></span><strong>Besoin d’aide ?</strong><p>Préparez vos invitations étape par étape.</p><button onClick={() => notify('Le guide d’utilisation sera ajouté dans une prochaine version.', 'info')}>Consulter le guide <ChevronRight size={14} /></button></div><div className="profile-row"><span className="profile-avatar">H</span><span><strong>Administrateur</strong><small>Mode démonstration</small></span><MoreHorizontal size={18} /></div></div>
      </aside>
      <main className="main-area"><header className="topbar"><div className="topbar-left"><span className="mobile-brand"><Heart size={19} /> Mes Invites</span><div className="breadcrumb-title"><span>Mes Invites</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div></div><div className="topbar-actions"><span className="environment-pill"><span /> Démonstration</span><button className="icon-button notification-button" aria-label="Notifications" onClick={() => notify('Aucune nouvelle notification.', 'info')}><Bell size={18} /><i /></button><span className="topbar-divider" /><button className="profile-mini" onClick={() => void signOut(auth!)} title="Se déconnecter"><span className="profile-avatar">{(authUser.displayName || authUser.email || 'U').slice(0,1).toUpperCase()}</span><ChevronDown size={15} /></button></div></header>
        <div className="page-content">{page === 'dashboard' && renderDashboard()}{page === 'tables' && renderTables()}{page === 'guests' && renderGuests()}{page === 'invitations' && renderInvitations()}{page === 'templates' && renderTemplates()}{page === 'scanner' && renderScanner()}{page === 'history' && renderHistory()}{page === 'settings' && renderSettings()}<footer className="page-footer"><span>© 2026 Mes Invites</span><span><span className="footer-dot" /> Les données affichées sont simulées</span></footer></div>
      </main>
      {tableModal && <Modal title="Créer une table" description="Définissez un nom clair pour retrouver facilement les invités." onClose={() => setTableModal(false)}><form onSubmit={saveTable} className="form-stack"><label>Nom ou numéro de table<input autoFocus value={newTableName} onChange={(event) => setNewTableName(event.target.value)} placeholder="Ex. Table 03" required /></label><label>Description <span className="optional-label">Facultatif</span><input value={newTableDescription} onChange={(event) => setNewTableDescription(event.target.value)} placeholder="Ex. Famille et proches" /></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setTableModal(false)}>Annuler</button><button type="submit" className="button button-primary"><Plus size={16} /> Créer la table</button></div></form></Modal>}
      {guestModal && <Modal title={editingGuest ? 'Modifier l’invité' : 'Ajouter un invité'} description={activeTable ? `Table sélectionnée : ${activeTable.name}` : 'L’invité doit être affecté à une table existante.'} onClose={() => setGuestModal(false)}><form onSubmit={saveGuest} className="form-stack"><label>Nom de l’invité ou des invités<input autoFocus value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder={kind === 'couple' ? 'Jean et Marie Mukendi' : 'Jean Mukendi'} required /></label><label>Type d’invitation<select value={kind} onChange={(event) => setKind(event.target.value as InvitationKind)}><option value="individual">Personne seule</option><option value="couple">Couple</option></select></label>{kind === 'individual' && <label>Civilité<select value={salutation} onChange={(event) => setSalutation(event.target.value as Salutation)}><option>Monsieur</option><option>Madame</option><option>Mademoiselle</option></select></label>}<div className="name-preview"><span>APERÇU DU NOM</span><strong>{guestName.trim() ? makeDisplayName(guestName, salutation, kind) : 'Le nom apparaîtra ici'}</strong></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setGuestModal(false)}>Annuler</button><button type="submit" className="button button-primary"><Check size={16} /> {editingGuest ? 'Enregistrer' : 'Ajouter l’invité'}</button></div></form></Modal>}
      {detailGuest && <Modal title="Détail de l’invitation" description="Fiche invité, QR unique et invitation personnalisée." onClose={() => setDetailGuest(null)} wide><div className="detail-layout"><div className="detail-invite-preview"><div className="detail-flourish"><Heart size={22} /></div><span className="detail-kicker">VOUS ÊTES CORDIALEMENT INVITÉ(E)</span><strong className="detail-name">{detailGuest.displayName}</strong><span className="detail-divider" /><span className="detail-placeholder">Template original à intégrer</span>{detailGuest.token && <div className="detail-qr" id="invitation-qr"><QRCodeSVG value={detailGuest.token} size={112} level="H" includeMargin /></div>}<small className="detail-id">{detailGuest.token ? 'QR de démonstration' : 'QR non généré'}</small></div><div className="detail-meta"><div className="detail-meta-row"><span>Table</span><strong>{tables.find((table) => table.id === detailGuest.tableId)?.name ?? 'Table inconnue'}</strong></div><div className="detail-meta-row"><span>Type</span><strong>{detailGuest.kind === 'couple' ? 'Couple' : 'Personne seule'}</strong></div><div className="detail-meta-row"><span>Invitation</span><strong>{statusLabel(detailGuest.invitationStatus)}</strong></div><div className="detail-meta-row"><span>Entrée</span><strong>{statusLabel(detailGuest.checkinStatus)}</strong></div><div className="detail-meta-row"><span>Identifiant</span><code>{detailGuest.id}</code></div><div className="detail-actions">{detailGuest.invitationStatus !== 'generated' && <button className="button button-primary button-wide" onClick={() => generateInvitation(detailGuest.id)}><QrCode size={16} /> Générer le QR code</button>}{detailGuest.token && <button className="button button-secondary button-wide" onClick={() => void downloadDemoInvitation(detailGuest)}><Download size={16} /> Télécharger l’invitation (PNG)</button>}<button className="button button-secondary button-wide" onClick={() => { setDetailGuest(null); openAddGuest(detailGuest); }}><Pencil size={15} /> Modifier la fiche</button><button className="button button-danger-ghost button-wide" onClick={() => deleteGuest(detailGuest)}><Trash2 size={15} /> Supprimer l’invité</button><p className="muted-copy small-note">Le PNG téléchargé reprend le template et les positions enregistrées dans cet éditeur.</p></div></div></div></Modal>}
      {toast && <div className={`toast toast-${toast.kind}`}><span>{toast.kind === 'success' ? <CheckCircle2 size={18} /> : toast.kind === 'error' ? <AlertTriangle size={18} /> : <CircleHelp size={18} />}</span>{toast.message}<button aria-label="Fermer" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  );
}


function AuthScreen() {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (!auth || !firestore) { setError('Firebase n’est pas configuré.'); return; }
    if (mode === 'register' && password !== confirmPassword) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    if (mode === 'register' && password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    setBusy(true);
    try {
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
        await updateProfile(credential.user, { displayName });
        await setDoc(doc(firestore, 'users', credential.user.uid), {
          uid: credential.user.uid, firstName: firstName.trim(), lastName: lastName.trim(),
          whatsapp: whatsapp.trim(), email: email.trim().toLowerCase(), createdAt: new Date().toISOString(),
        });
        await sendEmailVerification(credential.user);
        setMessage('Compte créé. Un e-mail de vérification vient de t’être envoyé.');
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      const messages: Record<string,string> = {
        'auth/email-already-in-use': 'Cette adresse e-mail possède déjà un compte.',
        'auth/invalid-email': 'Adresse e-mail invalide.',
        'auth/weak-password': 'Choisis un mot de passe plus robuste.',
        'auth/invalid-credential': 'Adresse e-mail ou mot de passe incorrect.',
        'auth/too-many-requests': 'Trop de tentatives. Réessaie plus tard.',
        'permission-denied': 'Le profil n’a pas pu être enregistré : vérifie les règles Firestore.',
      };
      setError(messages[code] ?? (e instanceof Error ? e.message : 'Une erreur est survenue.'));
    } finally { setBusy(false); }
  };
  return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><span className="auth-mark"><Heart size={24}/></span><span>Mes Invites<small>Gestion élégante de vos invitations</small></span></div><div className="auth-intro"><span className="eyebrow">ESPACE PRIVÉ</span><h1>{mode === 'register' ? 'Créez votre compte' : 'Bon retour'}</h1><p>{mode === 'register' ? 'Inscrivez-vous pour préparer et gérer vos invitations.' : 'Connectez-vous pour accéder à votre espace.'}</p></div>
  <form className="form-stack auth-form" onSubmit={submit}>
  {mode === 'register' && <div className="auth-name-grid"><label>Prénom<input autoComplete="given-name" value={firstName} onChange={e=>setFirstName(e.target.value)} required/></label><label>Nom<input autoComplete="family-name" value={lastName} onChange={e=>setLastName(e.target.value)} required/></label></div>}
  {mode === 'register' && <label>Numéro WhatsApp<input type="tel" autoComplete="tel" value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} placeholder="+243…" required/></label>}
  <label>Adresse e-mail<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="vous@exemple.com" required/></label>
  <label>Mot de passe<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/></label>
  {mode === 'register' && <label>Confirmer le mot de passe<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={8} required/></label>}
  {error && <p className="auth-alert auth-error" role="alert">{error}</p>}{message && <p className="auth-alert auth-success" role="status">{message}</p>}
  <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? 'Patiente…' : mode === 'register' ? 'Créer mon compte' : 'Se connecter'}</button>
  </form><p className="auth-switch">{mode === 'register' ? 'Vous avez déjà un compte ?' : 'Vous n’avez pas encore de compte ?'} <button type="button" onClick={()=>{setMode(mode === 'register' ? 'login' : 'register');setError('');setMessage('');}}>{mode === 'register' ? 'Se connecter' : 'Créer un compte'}</button></p><p className="auth-footnote"><ShieldCheck size={14}/> Vos informations sont protégées.</p></section></main>;
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
