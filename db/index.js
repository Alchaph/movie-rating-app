// db/index.js
// Database layer with SQLite using better-sqlite3
// Handles migrations, seeding, and all CRUD operations for users, contents, likes, and favorites

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fallback users when better-sqlite3 is not installed
const fallbackUsers = [
  { id: 1, name: 'DB', role: 'admin', createdAt: new Date('2024-11-02') },
  { id: 2, name: 'Fallback', role: 'user', createdAt: new Date('2025-01-15') },
  { id: 3, name: 'Data', role: 'editor', createdAt: new Date('2025-07-01') },
];

let Database = null;
let db = null;

// Try to import better-sqlite3
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (e) {
  console.warn('[db] better-sqlite3 nicht installiert – verwende Fallback-Daten.');
}

// Import slugify helper for content slug generation
import slugify from '../helpers/slugify.js';

// ---- Helper Functions ----

/**
 * Resolve the database file path from environment or default
 */
function resolveDbPath() {
  const fromEnv = process.env.DB_FILE;
  if (fromEnv) return fromEnv;
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'app.db');
}

/**
 * Check if a column exists in a table
 */
function hasColumn(instance, table, col) {
  const row = instance.prepare(`PRAGMA table_info(${table})`).all().find(c => c.name === col);
  return !!row;
}

/**
 * Generate a unique slug for content entries
 */
function makeUniqueContentSlug(instance, baseSlug) {
  let slug = baseSlug || 'eintrag';
  const exists = (s) =>
    !!instance.prepare(`SELECT 1 FROM contents WHERE slug = ? LIMIT 1`).get(s);
  
  if (!exists(slug)) return slug;
  
  let i = 2;
  while (exists(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

/**
 * Run all database migrations
 */
function migrate(instance) {
  // Enable WAL mode and foreign keys
  instance.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  // App metadata table
  instance.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Users table
  instance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','editor')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add email column if not exists
  if (!hasColumn(instance, 'users', 'email')) {
    instance.exec(`ALTER TABLE users ADD COLUMN email TEXT;`);
  }

  // Add password_hash column if not exists
  if (!hasColumn(instance, 'users', 'password_hash')) {
    instance.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT;`);
  }

  // Create unique index on email (case-insensitive)
  instance.exec(`
    DROP INDEX IF EXISTS idx_users_email_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase
      ON users(email COLLATE NOCASE);
  `);

  // Backfill created_at for existing users
  instance.exec(`
    UPDATE users
    SET created_at = datetime('now')
    WHERE created_at IS NULL OR TRIM(created_at) = '';
  `);

  // Contents table for movies
  instance.exec(`
    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('sifi','krimi','horror','komoedie')),
      image_path TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Add slug column if not exists
  if (!hasColumn(instance, 'contents', 'slug')) {
    instance.exec(`ALTER TABLE contents ADD COLUMN slug TEXT;`);
    console.log('[db] + column contents.slug');
  }

  // Backfill slugs for existing content
  const rowsNeedingSlug = instance.prepare(`
    SELECT id, title FROM contents WHERE slug IS NULL OR TRIM(slug) = ''
  `).all();

  if (rowsNeedingSlug.length) {
    const update = instance.prepare(`UPDATE contents SET slug = ? WHERE id = ?`);
    const tx = instance.transaction((rows) => {
      for (const r of rows) {
        const base = slugify(r.title || '');
        const unique = makeUniqueContentSlug(instance, base);
        update.run(unique, r.id);
      }
    });
    tx(rowsNeedingSlug);
    console.log(`[db] backfilled ${rowsNeedingSlug.length} content slugs`);
  }

  // Create unique index on slug
  instance.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contents_slug_unique ON contents(slug);
  `);

  // Performance indexes for contents
  instance.exec(`
    CREATE INDEX IF NOT EXISTS idx_contents_created_at ON contents(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contents_category ON contents(category);
    CREATE INDEX IF NOT EXISTS idx_contents_owner ON contents(owner_id);
  `);

  // Likes table
  instance.exec(`
    CREATE TABLE IF NOT EXISTS likes (
      user_id INTEGER NOT NULL,
      content_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, content_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(content_id) REFERENCES contents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_likes_content ON likes(content_id);
    CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
  `);

  // Favorites table
  instance.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      content_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, content_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(content_id) REFERENCES contents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_fav_content ON favorites(content_id);
    CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);
  `);
}

// Demo seed marker
const DEMO_SEED_KEY = 'demo_seed_v1';

/**
 * Seed demo data once
 */
function seedDemoOnce(instance) {
  const already = instance.prepare('SELECT 1 FROM app_meta WHERE key = ? LIMIT 1').get(DEMO_SEED_KEY);
  if (already) return;

  const insertUser = instance.prepare(`
    INSERT INTO users (name, role, created_at)
    VALUES (?, ?, datetime('now'))
  `);
  const markSeed = instance.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)');

  const tx = instance.transaction(() => {
    insertUser.run('Max', 'admin');
    insertUser.run('Erika', 'user');
    insertUser.run('Sam', 'editor');
    markSeed.run(DEMO_SEED_KEY, new Date().toISOString());
  });
  tx();
  console.log('[db] Demo-Seed angewendet (users).');
}

/**
 * Initialize the database
 */
function ensureDatabase() {
  if (!Database) return null;
  
  const dbPath = resolveDbPath();
  console.log('[db] using:', path.resolve(dbPath));
  
  const instance = new Database(dbPath, {});
  migrate(instance);
  seedDemoOnce(instance);
  
  // Flush WAL
  instance.pragma('wal_checkpoint(FULL)');
  
  return instance;
}

// Initialize database
db = ensureDatabase();

// ---- Graceful Shutdown ----
function closeDb() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

// ========================================
// PUBLIC API - Users
// ========================================

/**
 * Get all users from the database
 */
export function getAllUsers() {
  if (!db) return fallbackUsers.map(u => ({ ...u, email: null }));
  
  const rows = db.prepare(`
    SELECT id, name, role, email, created_at
    FROM users
    ORDER BY id ASC
  `).all();
  
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    role: r.role,
    email: r.email || null,
    createdAt: new Date(r.created_at),
  }));
}

/**
 * Insert a new user (simple version without auth)
 */
export function insertUser(name, role = 'user') {
  if (!db) return null;
  const info = db.prepare(`
    INSERT INTO users (name, role, created_at)
    VALUES (?, ?, datetime('now'))
  `).run(name, role);
  return info.lastInsertRowid;
}

/**
 * Get user by email for authentication
 */
export function getUserByEmail(email) {
  if (!db) return null;
  return db.prepare(`
    SELECT id, name, role, email, password_hash, created_at
    FROM users WHERE email = ?
  `).get(email);
}

/**
 * Create a new user with full registration data
 */
export function createUser({ name, email, passwordHash, role = 'user' }) {
  if (!db) return null;
  const stmt = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const info = stmt.run(name, email, passwordHash, role);
  return info.lastInsertRowid;
}

// ========================================
// PUBLIC API - Contents
// ========================================

/**
 * List all contents with like counts
 */
export function listContents() {
  if (!db) return [];
  
  const rows = db.prepare(`
    SELECT
      c.id,
      c.title,
      c.description,
      c.category,
      c.image_path,
      c.slug,
      c.created_at,
      c.owner_id,
      u.name AS owner_name,
      (SELECT COUNT(*) FROM likes l WHERE l.content_id = c.id) AS like_count
    FROM contents c
    LEFT JOIN users u ON u.id = c.owner_id
    ORDER BY c.created_at DESC
  `).all();
  
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    imagePath: r.image_path,
    slug: r.slug,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    likeCount: r.like_count ?? 0,
    createdAt: new Date(r.created_at),
  }));
}

/**
 * Insert a new content entry (movie)
 */
export function insertContent({ title, description, category, imagePath, ownerId }) {
  if (!db) return null;
  
  const baseSlug = slugify(title);
  const slug = makeUniqueContentSlug(db, baseSlug);
  
  const stmt = db.prepare(`
    INSERT INTO contents (title, description, category, image_path, owner_id, slug, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const info = stmt.run(title, description, category, imagePath, ownerId, slug);
  return info.lastInsertRowid;
}

/**
 * Get content by slug
 */
export function getContentBySlug(slug) {
  if (!db) return null;
  
  const r = db.prepare(`
    SELECT
      c.id, c.title, c.description, c.category, c.image_path, c.slug,
      c.created_at, c.owner_id, u.name AS owner_name
    FROM contents c
    LEFT JOIN users u ON u.id = c.owner_id
    WHERE c.slug = ?
    LIMIT 1
  `).get(slug);
  
  if (!r) return null;
  
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    imagePath: r.image_path,
    slug: r.slug,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    createdAt: new Date(r.created_at),
  };
}

/**
 * Get content by ID
 */
export function getContentById(id) {
  if (!db) return null;
  
  const r = db.prepare(`
    SELECT
      c.id, c.title, c.description, c.category, c.image_path, c.slug,
      c.created_at, u.name AS owner_name, c.owner_id
    FROM contents c
    LEFT JOIN users u ON u.id = c.owner_id
    WHERE c.id = ?
    LIMIT 1
  `).get(id);
  
  if (!r) return null;
  
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    imagePath: r.image_path,
    slug: r.slug,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    createdAt: new Date(r.created_at),
  };
}

/**
 * Update content
 */
export function updateContent({ id, title, description, category, imagePath }) {
  if (!db) return 0;
  
  if (imagePath) {
    const stmt = db.prepare(`
      UPDATE contents
      SET title = ?, description = ?, category = ?, image_path = ?
      WHERE id = ?
    `);
    return stmt.run(title, description, category, imagePath, id).changes;
  } else {
    const stmt = db.prepare(`
      UPDATE contents
      SET title = ?, description = ?, category = ?
      WHERE id = ?
    `);
    return stmt.run(title, description, category, id).changes;
  }
}

/**
 * Delete content by ID
 */
export function deleteContentById(id) {
  if (!db) return 0;
  const stmt = db.prepare(`DELETE FROM contents WHERE id = ?`);
  return stmt.run(id).changes;
}

// ========================================
// PUBLIC API - Likes
// ========================================

/**
 * Get like count for a content
 */
export function getLikeCount(contentId) {
  if (!db) return 0;
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM likes WHERE content_id = ?`
  ).get(contentId);
  return row?.c ?? 0;
}

/**
 * Check if user has liked a content
 */
export function hasUserLiked({ userId, contentId }) {
  if (!db) return false;
  const row = db.prepare(`
    SELECT 1 FROM likes
    WHERE user_id = ? AND content_id = ?
    LIMIT 1
  `).get(userId, contentId);
  return !!row;
}

/**
 * Toggle like for a user on a content
 */
export function toggleLike({ userId, contentId }) {
  if (!db) return { liked: false, count: 0 };
  
  const liked = hasUserLiked({ userId, contentId });
  
  if (liked) {
    db.prepare(`
      DELETE FROM likes
      WHERE user_id = ? AND content_id = ?
    `).run(userId, contentId);
  } else {
    db.prepare(`
      INSERT INTO likes (user_id, content_id)
      VALUES (?, ?)
    `).run(userId, contentId);
  }
  
  return { liked: !liked, count: getLikeCount(contentId) };
}

/**
 * Get all content IDs that a user has liked
 */
export function getUserLikedIds(userId) {
  if (!db) return new Set();
  const rows = db.prepare(`
    SELECT content_id FROM likes WHERE user_id = ?
  `).all(userId);
  return new Set(rows.map(r => r.content_id));
}

// ========================================
// PUBLIC API - Favorites
// ========================================

/**
 * Check if content is in user's favorites
 */
export function isFavorite({ userId, contentId }) {
  if (!db) return false;
  const row = db.prepare(`
    SELECT 1 FROM favorites
    WHERE user_id = ? AND content_id = ?
    LIMIT 1
  `).get(userId, contentId);
  return !!row;
}

/**
 * Toggle favorite for a user on a content
 */
export function toggleFavorite({ userId, contentId }) {
  if (!db) return { favorite: false };
  
  const fav = isFavorite({ userId, contentId });
  
  if (fav) {
    db.prepare(`
      DELETE FROM favorites
      WHERE user_id = ? AND content_id = ?
    `).run(userId, contentId);
  } else {
    db.prepare(`
      INSERT INTO favorites (user_id, content_id)
      VALUES (?, ?)
    `).run(userId, contentId);
  }
  
  return { favorite: !fav };
}

/**
 * List all favorites for a user
 */
export function listFavoritesOfUser(userId) {
  if (!db) return [];
  
  const rows = db.prepare(`
    SELECT
      c.id, c.title, c.description, c.category, c.image_path, c.slug,
      c.created_at, u.name AS owner_name
    FROM favorites f
    JOIN contents c ON c.id = f.content_id
    LEFT JOIN users u ON u.id = c.owner_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(userId);
  
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    imagePath: r.image_path,
    slug: r.slug,
    ownerName: r.owner_name,
    createdAt: new Date(r.created_at),
  }));
}

// ========================================
// PUBLIC API - Filtering & Sorting
// ========================================

/**
 * List all authors (users) for filter dropdown
 */
export function listAuthors() {
  if (!db) return [];
  return db.prepare(`
    SELECT id, name
    FROM users
    ORDER BY name COLLATE NOCASE
  `).all();
}

/**
 * List contents with filtering and sorting
 * @param {Object} options
 * @param {string|null} options.category - Filter by category
 * @param {number|null} options.ownerId - Filter by owner
 * @param {string} options.sort - 'newest' or 'likes'
 */
export function listContentsFiltered({ category = null, ownerId = null, sort = 'newest' } = {}) {
  if (!db) return [];
  
  const where = ['1=1'];
  const params = [];
  
  if (category) {
    where.push('c.category = ?');
    params.push(category);
  }
  
  if (ownerId) {
    where.push('c.owner_id = ?');
    params.push(ownerId);
  }
  
  const orderBy =
    sort === 'likes'
      ? 'COALESCE(lc.likeCount, 0) DESC, c.created_at DESC, c.id DESC'
      : 'c.created_at DESC, c.id DESC';
  
  const rows = db.prepare(`
    SELECT
      c.id,
      c.title,
      c.description,
      c.category,
      c.image_path AS imagePath,
      c.slug,
      c.created_at,
      c.owner_id,
      u.name AS ownerName,
      COALESCE(lc.likeCount, 0) AS likeCount
    FROM contents c
    LEFT JOIN users u ON u.id = c.owner_id
    LEFT JOIN (
      SELECT content_id, COUNT(*) AS likeCount
      FROM likes
      GROUP BY content_id
    ) lc ON lc.content_id = c.id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
  `).all(...params);
  
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    imagePath: r.imagePath,
    slug: r.slug,
    ownerId: r.owner_id,
    ownerName: r.ownerName,
    likeCount: r.likeCount ?? 0,
    createdAt: new Date(r.created_at),
  }));
}
