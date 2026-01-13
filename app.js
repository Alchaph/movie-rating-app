// app.js
// Main Express application for Movie Rating Site
// Features: SSR with Handlebars, SQLite DB, Auth, File Upload, Likes/Favorites, Filtering

import 'dotenv/config';
import express from 'express';
import { engine } from 'express-handlebars';
import session from 'express-session';
import bcrypt from 'bcrypt';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Database imports
import {
  getAllUsers,
  getUserByEmail,
  createUser,
  insertContent,
  listContents,
  getContentBySlug,
  getContentById,
  updateContent,
  deleteContentById,
  getLikeCount,
  hasUserLiked,
  toggleLike,
  isFavorite,
  toggleFavorite,
  listFavoritesOfUser,
  getUserLikedIds,
  listContentsFiltered,
  listAuthors,
} from './db/index.js';

// Helper imports
import formatDate from './helpers/formatDate.js';
import slugify from './helpers/slugify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Categories for movies
const CATEGORIES = ['sifi', 'krimi', 'horror', 'komoedie'];

// ========================================
// MIDDLEWARE SETUP
// ========================================

// Parse URL-encoded bodies and JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Upload directory setup
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const safeExt = allowed.includes(ext) ? ext : '.bin';
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;
    cb(null, name);
  },
});

// File filter - only allow images
function fileFilter(req, file, cb) {
  const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
  cb(ok ? null : new Error('Nur Bilddateien (jpg, png, webp, gif) erlaubt.'), ok);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// Session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);

// Make currentUser available to all views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// Canonical lowercase redirect for /content routes
app.use((req, res, next) => {
  const orig = req.path;
  const lower = orig.toLowerCase();
  if (orig !== lower && orig.startsWith('/content/')) {
    return res.redirect(301, lower + (req.url.slice(orig.length) || ''));
  }
  next();
});

// ========================================
// HANDLEBARS SETUP
// ========================================

app.engine(
  'hbs',
  engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views', 'layouts'),
    partialsDir: path.join(__dirname, 'views', 'partials'),
    helpers: {
      // Text & Format helpers
      upper: (s) => String(s ?? '').toUpperCase(),
      lower: (s) => String(s ?? '').toLowerCase(),
      formatDate,
      encodeURIComponent: (v) => encodeURIComponent(String(v ?? '')),

      // Comparison & Logic helpers
      eq: (a, b) => a === b,
      ne: (a, b) => a !== b,
      gt: (a, b) => Number(a) > Number(b),
      gte: (a, b) => Number(a) >= Number(b),
      lt: (a, b) => Number(a) < Number(b),
      lte: (a, b) => Number(a) <= Number(b),
      and: (...xs) => xs.slice(0, -1).every(Boolean),
      or: (...xs) => xs.slice(0, -1).some(Boolean),
      not: (v) => !v,

      // Number helpers
      add: (a, b) => Number(a) + Number(b),
      subtract: (a, b) => Number(a) - Number(b),
      increment: (n) => Number(n) + 1,
      decrement: (n) => Number(n) - 1,
      length: (v) => (Array.isArray(v) || typeof v === 'string' ? v.length : 0),

      // Permission helper
      canEdit(item, currentUser) {
        if (!currentUser || !item) return false;
        return currentUser.role === 'admin' || item.ownerId === currentUser.id;
      },

      // Date helper
      now: () => new Date(),
    },
  })
);

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// ========================================
// AUTH MIDDLEWARE
// ========================================

/**
 * Require user to be authenticated
 */
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/'));
  }
  next();
}

/**
 * Require user to be owner or admin
 */
function requireOwnerOrAdmin(req, res, next) {
  const { item } = res.locals;
  const user = req.session.user;
  
  if (!user) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  
  if (user.role === 'admin' || (item && item.ownerId === user.id)) {
    return next();
  }
  
  return res.status(403).render('error', { title: '403 – Kein Zugriff', message: 'Du hast keine Berechtigung für diese Aktion.' });
}

// ========================================
// ROUTES - PUBLIC PAGES
// ========================================

// Home page - shows movies grouped by category and top rated
app.get('/', (req, res) => {
  const allItems = listContents();
  
  // Group by category (max 3 per category)
  const groups = CATEGORIES.map((cat) => {
    const items = allItems.filter((i) => i.category === cat).slice(0, 3);
    return { category: cat, items };
  }).filter((g) => g.items.length > 0);
  
  // Top rated (by likes)
  const topRated = [...allItems]
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 3);
  
  res.render('home', {
    title: 'Movie Rating App',
    groups,
    topRated,
  });
});

// About page
app.get('/about', (req, res) => {
  res.render('about', { title: 'Über uns' });
});

// Users list (protected)
app.get('/users', requireAuth, (req, res) => {
  try {
    const users = getAllUsers();
    res.render('users', { title: 'Benutzer', users });
  } catch (err) {
    console.error('[/users] Fehler:', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Fehler beim Laden der Benutzer' });
  }
});

// ========================================
// ROUTES - AUTHENTICATION
// ========================================

// Register page
app.get('/register', (req, res) => {
  res.render('register', { title: 'Registrieren' });
});

// Register handler
app.post('/register', async (req, res) => {
  const { name, email, password, password_confirm } = req.body || {};
  const errors = [];
  
  if (!name?.trim()) errors.push('Name ist erforderlich.');
  if (!email?.trim()) errors.push('E-Mail ist erforderlich.');
  if (!password) errors.push('Passwort ist erforderlich.');
  if (password !== password_confirm) errors.push('Passwörter stimmen nicht überein.');
  if (password && password.length < 8) errors.push('Passwort muss mind. 8 Zeichen lang sein.');
  
  const existing = email ? getUserByEmail(email.trim().toLowerCase()) : null;
  if (existing) errors.push('Diese E-Mail ist bereits registriert.');
  
  if (errors.length) {
    return res.status(400).render('register', {
      title: 'Registrieren',
      errors,
      values: { name, email },
    });
  }
  
  const passwordHash = await bcrypt.hash(password, 11);
  const id = createUser({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    role: 'user',
  });
  
  // Auto-login after registration
  req.session.user = {
    id,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role: 'user',
  };
  
  res.redirect('/content');
});

// Login page
app.get('/login', (req, res) => {
  res.render('login', { title: 'Login', next: req.query.next || '' });
});

// Login handler
app.post('/login', async (req, res) => {
  const { email, password, next: nextUrl } = req.body || {};
  const errors = [];
  
  if (!email?.trim() || !password) {
    errors.push('E-Mail und Passwort sind erforderlich.');
    return res.status(400).render('login', { title: 'Login', errors, values: { email } });
  }
  
  const user = getUserByEmail(email.trim().toLowerCase());
  
  if (!user || !user.password_hash) {
    errors.push('E-Mail oder Passwort ist falsch.');
    return res.status(401).render('login', { title: 'Login', errors, values: { email } });
  }
  
  const ok = await bcrypt.compare(password, user.password_hash);
  
  if (!ok) {
    errors.push('E-Mail oder Passwort ist falsch.');
    return res.status(401).render('login', { title: 'Login', errors, values: { email } });
  }
  
  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
  
  const redirectTo = nextUrl && /^\/[^\s]*$/.test(nextUrl) ? nextUrl : '/content';
  res.redirect(redirectTo);
});

// Logout handler
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ========================================
// ROUTES - CONTENT LISTING & FILTERING
// ========================================

// Content list with filtering and sorting
app.get('/content', (req, res) => {
  const { category = '', author = '', sort = 'newest' } = req.query || {};
  
  // Validate category
  const validCategory = CATEGORIES.includes(category) ? category : '';
  
  // Validate author ID
  const authorId = Number(author);
  const validAuthorId = Number.isInteger(authorId) && authorId > 0 ? authorId : null;
  
  // Validate sort
  const validSort = sort === 'likes' ? 'likes' : 'newest';
  
  // Load data
  const items = listContentsFiltered({
    category: validCategory || null,
    ownerId: validAuthorId || null,
    sort: validSort,
  });
  
  const authors = listAuthors();
  
  res.render('content_list', {
    title: 'Filme',
    items,
    categories: CATEGORIES,
    authors,
    selectedCategory: validCategory,
    selectedAuthorId: validAuthorId,
    selectedSort: validSort,
    hasFilterActive: !!(validCategory || validAuthorId || validSort === 'likes'),
  });
});

// ========================================
// ROUTES - CONTENT CRUD
// ========================================

// New content form (protected)
app.get('/content/new', requireAuth, (req, res) => {
  res.render('content_new', {
    title: 'Neuer Film',
    categories: CATEGORIES,
  });
});

// Create content handler
app.post('/content', requireAuth, upload.single('image'), (req, res) => {
  const { title, description, category } = req.body || {};
  const errors = [];
  
  if (!title?.trim()) errors.push('Titel ist erforderlich.');
  if (!description?.trim()) errors.push('Beschrieb ist erforderlich.');
  if (!CATEGORIES.includes(category)) errors.push('Ungültige Kategorie.');
  if (!req.file) errors.push('Bild ist erforderlich.');
  
  if (errors.length) {
    // Clean up uploaded file if validation failed
    if (req.file) {
      try {
        fs.unlinkSync(path.join(uploadDir, req.file.filename));
      } catch { /* ignore */ }
    }
    return res.status(400).render('content_new', {
      title: 'Neuer Film',
      categories: CATEGORIES,
      errors,
      values: { title, description, category },
    });
  }
  
  const webPath = '/uploads/' + req.file.filename;
  const ownerId = req.session.user.id;
  
  insertContent({
    title: title.trim(),
    description: description.trim(),
    category,
    imagePath: webPath,
    ownerId,
  });
  
  res.redirect('/content');
});

// Content detail page
app.get('/content/:slug', (req, res, next) => {
  const base = getContentBySlug(req.params.slug);
  if (!base) return next();
  
  const item = getContentById(base.id) || base;
  const likeCount = getLikeCount(item.id);
  
  const isLiked = req.session.user
    ? hasUserLiked({ userId: req.session.user.id, contentId: item.id })
    : false;
  
  const favorite = req.session.user
    ? isFavorite({ userId: req.session.user.id, contentId: item.id })
    : false;
  
  res.render('detail', {
    title: item.title,
    item,
    likeCount,
    isLiked,
    favorite,
  });
});

// Redirect from ID to slug
app.get('/content/id/:id', (req, res, next) => {
  const { id } = req.params || {};
  const item = getContentById(Number(id));
  if (!item) return next();
  return res.redirect(301, `/content/${item.slug}`);
});

// Edit content form
app.get('/content/:slug/edit', requireAuth, (req, res, next) => {
  const item = getContentBySlug(req.params.slug);
  if (!item) return next();
  
  res.locals.item = getContentById(item.id);
  
  return requireOwnerOrAdmin(req, res, () => {
    res.render('content_edit', {
      title: `Bearbeiten: ${item.title}`,
      item: res.locals.item,
      categories: CATEGORIES,
    });
  });
});

// Update content handler
app.post('/content/:slug/edit', requireAuth, upload.single('image'), (req, res, next) => {
  const existing = getContentBySlug(req.params.slug);
  if (!existing) return next();
  
  res.locals.item = getContentById(existing.id);
  
  requireOwnerOrAdmin(req, res, async () => {
    const { title, description, category } = req.body || {};
    const errors = [];
    
    if (!title?.trim()) errors.push('Titel ist erforderlich.');
    if (!description?.trim()) errors.push('Beschrieb ist erforderlich.');
    if (!CATEGORIES.includes(category)) errors.push('Ungültige Kategorie.');
    
    let newImagePath = null;
    if (req.file) newImagePath = '/uploads/' + req.file.filename;
    
    if (errors.length) {
      if (req.file) {
        try {
          fs.unlinkSync(path.join(uploadDir, req.file.filename));
        } catch { /* ignore */ }
      }
      return res.status(400).render('content_edit', {
        title: `Bearbeiten: ${existing.title}`,
        item: { ...res.locals.item, title, description, category },
        categories: CATEGORIES,
        errors,
      });
    }
    
    // Delete old image if replaced
    if (newImagePath) {
      try {
        const rel = (res.locals.item?.imagePath || '').replace(/^\//, '');
        const oldAbs = path.join(__dirname, 'public', rel);
        if (rel && fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
      } catch { /* ignore */ }
    }
    
    updateContent({
      id: res.locals.item.id,
      title: title.trim(),
      description: description.trim(),
      category,
      imagePath: newImagePath || undefined,
    });
    
    res.redirect(`/content/${existing.slug}`);
  });
});

// Delete content handler
app.post('/content/:slug/delete', requireAuth, (req, res, next) => {
  const item = getContentBySlug(req.params.slug);
  if (!item) return next();
  
  res.locals.item = getContentById(item.id);
  
  requireOwnerOrAdmin(req, res, () => {
    // Delete associated image file
    try {
      const rel = (res.locals.item?.imagePath || '').replace(/^\//, '');
      const abs = path.join(__dirname, 'public', rel);
      if (rel && fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch { /* ignore */ }
    
    deleteContentById(res.locals.item.id);
    res.redirect('/content');
  });
});

// ========================================
// ROUTES - LIKES & FAVORITES
// ========================================

// Like toggle
app.post('/content/:slug/like', requireAuth, (req, res, next) => {
  const item = getContentBySlug(req.params.slug);
  if (!item) return next();
  
  toggleLike({ userId: req.session.user.id, contentId: item.id });
  res.redirect(req.get('referer') || `/content/${item.slug}`);
});

// Favorite toggle
app.post('/content/:slug/fav', requireAuth, (req, res, next) => {
  const item = getContentBySlug(req.params.slug);
  if (!item) return next();
  
  toggleFavorite({ userId: req.session.user.id, contentId: item.id });
  res.redirect(req.get('referer') || `/content/${item.slug}`);
});

// User's favorites list
app.get('/me/favorites', requireAuth, (req, res) => {
  const items = listFavoritesOfUser(req.session.user.id);
  res.render('favorites_list', {
    title: 'Meine Favoriten',
    items,
  });
});

// ========================================
// ERROR HANDLERS
// ========================================

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 – Nicht gefunden',
    message: 'Die angeforderte Seite wurde nicht gefunden.',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).render('error', {
    title: '500 – Serverfehler',
    message: 'Ein unerwarteter Fehler ist aufgetreten.',
  });
});

// ========================================
// START SERVER
// ========================================

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
