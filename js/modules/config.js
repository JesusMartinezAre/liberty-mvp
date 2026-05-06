// ── APPLICATION CONSTANTS ──────────────────────────────────────────────────
// Single source of truth for all configuration. Nothing here should mutate.

export const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyBraEBnVPracs_l7YJVWU2YlVabP-86DbI',
  authDomain:        'coca-liberty-inventory.firebaseapp.com',
  databaseURL:       'https://coca-liberty-inventory-default-rtdb.firebaseio.com',
  projectId:         'coca-liberty-inventory',
  storageBucket:     'coca-liberty-inventory.firebasestorage.app',
  messagingSenderId: '447099037329',
  appId:             '1:447099037329:web:c1fc7167d653160cff4130',
};

export const COLLECTION     = 'liberty_inventory';
export const OFFLINE_KEY    = 'liberty_offline_queue';
export const CORRECT_PIN    = '2026';
export const PAGE_ORDER     = ['overview', 'inventory', 'map'];

// ── CLOUDINARY ───────────────────────────────────────────────────────────────
export const CLOUDINARY_CLOUD      = 'dbiwafffa';
export const CLOUDINARY_PRESET     = 'liberty_photos';
export const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;

// ── EMAILJS ──────────────────────────────────────────────────────────────────
export const EMAILJS_SERVICE  = 'service_17309zo';
export const EMAILJS_TEMPLATE = 'template_3em34jk';
export const EMAILJS_KEY      = '-7R-WGSWEXH7vT1Xj';
export const NOTIFY_EMAIL     = 'efr@popatelier.net';

// ── STATUS DEFINITIONS ────────────────────────────────────────────────────────
export const STATUSES = [
  { label: 'In Assembly',       color: 'var(--s0)', bg: 'rgba(85,85,85,.15)'       },
  { label: 'Completed',         color: 'var(--s1)', bg: 'var(--navori-dim)'         },
  { label: 'Shipped',           color: 'var(--s2)', bg: 'rgba(245,158,11,.12)'      },
  { label: 'With Client',       color: 'var(--s3)', bg: 'rgba(168,85,247,.12)'      },
  { label: 'Installed at Venue',color: 'var(--s4)', bg: 'rgba(34,197,94,.12)'       },
];
export const STATUS_LABELS = STATUSES.map(s => s.label);

// ── VENUE DEFINITIONS ─────────────────────────────────────────────────────────
export const VENUES = {
  metlife: {
    name: 'MetLife Stadium — New York / New Jersey',
    areas: [
      { id:'100-north', label:'Field Level North',  sub:'Sections 107–118 · Cat 1',    color:'#d97706', slots:8 },
      { id:'100-south', label:'Field Level South',  sub:'Sections 134–146 · Cat 1',    color:'#d97706', slots:8 },
      { id:'100-east',  label:'Field Level East',   sub:'Sections 119–133 · Cat 1',    color:'#d97706', slots:8 },
      { id:'100-west',  label:'Field Level West',   sub:'Sections 101–106 · Cat 1',    color:'#d97706', slots:8 },
      { id:'200-north', label:'Mezzanine North',    sub:'Sections 208–219 · Cat 2/3',  color:'#dc2626', slots:6 },
      { id:'200-south', label:'Mezzanine South',    sub:'Sections 236–244 · Cat 2/3',  color:'#dc2626', slots:6 },
      { id:'200-east',  label:'Mezzanine East',     sub:'Sections 220–235 · Cat 2/3',  color:'#dc2626', slots:6 },
      { id:'200-west',  label:'Mezzanine West',     sub:'Sections 201–207 · Suites',   color:'#dc2626', slots:6 },
      { id:'300-north', label:'Upper Level North',  sub:'Sections 307–321 · Cat 3/4',  color:'#2563eb', slots:4 },
      { id:'300-south', label:'Upper Level South',  sub:'Sections 332–346 · Cat 3/4',  color:'#2563eb', slots:4 },
      { id:'300-east',  label:'Upper Level East',   sub:'Sections 322–331 · Cat 4',    color:'#16a34a', slots:4 },
      { id:'300-west',  label:'Upper Level West',   sub:'Sections 301–306 · Cat 4',    color:'#16a34a', slots:4 },
    ],
  },
  lincoln: {
    name: 'Lincoln Financial Field — Philadelphia, PA',
    areas: [
      { id:'100-north', label:'Field Level North',  sub:'Sections 100–120 · Lower Bowl', color:'#d97706', slots:8 },
      { id:'100-south', label:'Field Level South',  sub:'Sections 130–150 · Lower Bowl', color:'#d97706', slots:8 },
      { id:'100-east',  label:'Field Level East',   sub:'Sections 120–130 · Lower Bowl', color:'#d97706', slots:8 },
      { id:'100-west',  label:'Field Level West',   sub:'Sections 100–110 · Lower Bowl', color:'#d97706', slots:8 },
      { id:'200-north', label:'Mezzanine North',    sub:'Sections 200–220 · Club/Suite', color:'#dc2626', slots:6 },
      { id:'200-south', label:'Mezzanine South',    sub:'Sections 230–250 · Club/Suite', color:'#dc2626', slots:6 },
      { id:'200-east',  label:'Mezzanine East',     sub:'Sections 220–230 · Lexus Club', color:'#dc2626', slots:6 },
      { id:'200-west',  label:'Mezzanine West',     sub:'Sections 200–210 · Club/Suite', color:'#dc2626', slots:6 },
      { id:'300-north', label:'Upper Level North',  sub:'Sections 300–320 · Upper Deck', color:'#2563eb', slots:4 },
      { id:'300-south', label:'Upper Level South',  sub:'Sections 330–350 · Upper Deck', color:'#2563eb', slots:4 },
      { id:'300-east',  label:'Upper Level East',   sub:'Sections 320–330 · Upper Deck', color:'#16a34a', slots:4 },
      { id:'300-west',  label:'Upper Level West',   sub:'Sections 300–310 · Upper Deck', color:'#16a34a', slots:4 },
    ],
  },
  rockefeller: {
    name: 'Rockefeller Plaza — New York, NY',
    areas: [
      { id:'plaza-main',      label:'Main Plaza',       sub:'Central plaza area',         color:'#d97706', slots:8 },
      { id:'plaza-north',     label:'North Plaza',      sub:'North entrance · 50th St',   color:'#d97706', slots:6 },
      { id:'plaza-south',     label:'South Plaza',      sub:'South entrance · 49th St',   color:'#d97706', slots:6 },
      { id:'concourse',       label:'Concourse Level',  sub:'Underground retail area',    color:'#dc2626', slots:6 },
      { id:'rink-level',      label:'Rink Level',       sub:'Skating rink perimeter',     color:'#dc2626', slots:4 },
      { id:'channel-gardens', label:'Channel Gardens',  sub:'Promenade area · 5th Ave',   color:'#2563eb', slots:4 },
      { id:'top-rock',        label:'Top of the Rock',  sub:'Observation deck',           color:'#16a34a', slots:4 },
    ],
  },
};

// ── ZONE OPTIONS (for venue/area assignment dropdown in modal) ─────────────────
export const ZONE_OPTIONS = {
  metlife: [
    { value:'100-north', label:'Field Level North (107–118)' },
    { value:'100-south', label:'Field Level South (134–146)' },
    { value:'100-east',  label:'Field Level East (119–133)'  },
    { value:'100-west',  label:'Field Level West (101–106)'  },
    { value:'200-north', label:'Mezzanine North (208–219)'   },
    { value:'200-south', label:'Mezzanine South (236–244)'   },
    { value:'200-east',  label:'Mezzanine East (220–235)'    },
    { value:'200-west',  label:'Mezzanine West / Suites (201–207)' },
    { value:'300-north', label:'Upper Level North (307–321)' },
    { value:'300-south', label:'Upper Level South (332–346)' },
    { value:'300-east',  label:'Upper Level East (322–331)'  },
    { value:'300-west',  label:'Upper Level West (301–306)'  },
  ],
  lincoln: [
    { value:'100-north', label:'Field Level North (115–126)' },
    { value:'100-south', label:'Field Level South (101–107)' },
    { value:'100-east',  label:'Field Level East (108–114)'  },
    { value:'100-west',  label:'Field Level West (127–138)'  },
    { value:'200-north', label:'Club Level North (C19–C27)'  },
    { value:'200-south', label:'Club Level South (C1–C6)'    },
    { value:'200-east',  label:'Club Level East (M10–M14)'   },
    { value:'200-west',  label:'Club Level West (C35–C40)'   },
    { value:'300-north', label:'Upper Level North (219–231)' },
    { value:'300-south', label:'Upper Level South (201–207)' },
    { value:'300-east',  label:'Upper Level East (209–218)'  },
    { value:'300-west',  label:'Upper Level West (233–241)'  },
  ],
};

// ── ACTIVITY LOG TYPE LABELS ──────────────────────────────────────────────────
export const TIPO = {
  status: { label:'Status Change',    color:'#3b82f6', bg:'rgba(59,130,246,.12)', icon:'📋' },
  venue:  { label:'Venue Assignment', color:'#a855f7', bg:'rgba(168,85,247,.12)', icon:'📍' },
};
