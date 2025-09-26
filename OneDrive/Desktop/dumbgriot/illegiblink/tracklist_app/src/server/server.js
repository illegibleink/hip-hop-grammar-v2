require('dotenv').config();
const express = require('express');
const { createYoga } = require('graphql-yoga');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { shield, rule, and } = require('graphql-shield');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-09-30.acacia' });
const session = require('express-session');
const PGSession = require('connect-pg-simple')(session);
const SQLiteStore = require('connect-sqlite3')(session);
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const crypto = require('crypto');
const fs = require('fs');

// Log Stripe SDK version and API version at startup
const stripeModule = require('stripe');
console.log('Stripe SDK version:', stripeModule.VERSION || 'Unknown (possible module issue)');
console.log('Stripe module details:', {
  version: stripeModule.VERSION,
  hasVersion: !!stripeModule.VERSION,
  isFunction: typeof stripe === 'function',
  stripeKeys: Object.keys(stripeModule).slice(0, 10)
});
console.log('Stripe API version:', '2024-09-30.acacia');
(async () => {
  try {
    const balance = await stripe.balance.retrieve();
    console.log('Stripe API connectivity test successful, balance retrieved:', balance);
  } catch (error) {
    console.error('Stripe API connectivity test failed:', {
      message: error.message,
      code: error.code,
      type: error.type,
      stack: error.stack
    });
  }
})();

const app = express();
app.set('view engine', 'pug');
app.set('views', './src/views');

if (process.env.NODE_ENV === 'production' && !app.get('env').includes('localhost')) {
  app.use((req, res, next) => {
    if (!req.secure && req.get('x-forwarded-proto') !== 'https') {
      console.log(`Redirecting HTTP to HTTPS for ${req.url}`);
      return res.redirect(`https://${req.get('host')}${req.url}`);
    }
    next();
  });
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://*.stripe.com'],
      scriptSrc: ["'self'", 'https://js.stripe.com/v3/', 'https://*.stripe.com'],
      frameSrc: ['https://js.stripe.com', 'https://checkout.stripe.com', 'https://*.stripe.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.stripe.com', 'https://checkout.stripe.com', 'https://*.stripe.com']
    }
  }
}));
app.use(express.static('public', {
  setHeaders: (res, path) => {
    if (path.match(/\.(css|js|woff2|ttf|otf)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }
}));
app.use(express.json());
app.use(session({
  store: process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
    ? new SQLiteStore({ db: 'sessions.db', dir: './data' })
    : new PGSession({
        pool: new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }),
        tableName: 'session'
      }),
  secret: process.env.SESSION_SECRET || 'default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production' && !app.get('env').includes('localhost'),
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

const algorithm = 'aes-256-cbc';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const decryptFile = () => {
  try {
    const data = fs.readFileSync('./data/tracks.json.enc');
    const iv = data.slice(0, 16);
    const encrypted = data.slice(16);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const rawData = JSON.parse(decrypted.toString());
    const tracklists = {};
    rawData.tracklists.forEach((tracklist, index) => {
      const setId = `set${index + 1}`;
      tracklists[setId] = {
        name: tracklist.name || `#${index + 1}`,
        price: typeof tracklist.price === 'number' ? tracklist.price : (index < 12 ? 0 : 10.0),
        tracks: Array.isArray(tracklist.tracks) ? tracklist.tracks.map((track, trackIndex) => ({
          name: track.name || `Track ${index + 1}-${trackIndex + 1}`,
          artists: Array.isArray(track.artists) ? track.artists : ['Unknown Artist'],
          spotify_id: track.spotify_id || `spotify_${index + 1}_${trackIndex}`,
          recording_mbid: track.recording_mbid || `mbid_${index + 1}_${trackIndex}`,
          isrc: track.isrc || `isrc_${index + 1}_${trackIndex}`,
          release_date: track.release_date || '1989-01-01',
          genre: Array.isArray(track.genre) && track.genre.length > 0 ? track.genre[0] : 'Unknown'
        })) : []
      };
    });
    console.log(`Loaded ${Object.keys(tracklists).length} tracklists`);
    return tracklists;
  } catch (error) {
    console.error('Decryption failed:', error.message);
    return {};
  }
};
const tracklists = decryptFile();
if (Object.keys(tracklists).length === 0) {
  console.error('No tracklists loaded, check tracks.json.enc and ENCRYPTION_KEY');
}

let pool;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')) {
  pool = new sqlite3.Database(process.env.DATABASE_URL.replace('sqlite://', ''), (err) => {
    if (err) console.error('SQLite connection error:', err);
  });
  pool.query = (query, params = []) => new Promise((resolve, reject) => {
    pool.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve({ rows });
    });
  });
} else {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

const initDatabase = async () => {
  try {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')) {
      await pool.query('DROP TABLE IF EXISTS purchases');
      await pool.query('DROP TABLE IF EXISTS cart');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS purchases (
          userId TEXT,
          tracklistName TEXT,
          purchaseDate TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (userId, tracklistName)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cart (
          userId TEXT,
          tracklistName TEXT,
          PRIMARY KEY (userId, tracklistName)
        )
      `);
    } else {
      await pool.query(`
        DROP TABLE IF EXISTS purchases;
        DROP TABLE IF EXISTS cart;
        CREATE TABLE IF NOT EXISTS purchases (
          userId VARCHAR(255),
          tracklistName VARCHAR(255),
          purchaseDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (userId, tracklistName)
        );
        CREATE TABLE IF NOT EXISTS cart (
          userId VARCHAR(255),
          tracklistName VARCHAR(255),
          PRIMARY KEY (userId, tracklistName)
        );
        CREATE INDEX IF NOT EXISTS idx_userId ON purchases (userId);
        CREATE INDEX IF NOT EXISTS idx_cart_userId ON cart (userId);
      `);
    }
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};
initDatabase().catch(err => {
  console.error('Failed to initialize database, exiting:', err);
  process.exit(1);
});

const ensureAuthenticated = (req, res, next) => {
  if (!req.session.userId) {
    console.log('Redirecting to /login for authentication');
    return res.redirect(`/login?redirect=/tracks?page=${req.query.page || 1}`);
  }
  next();
};

const typeDefs = `
  type Track {
    name: String!
    artists: [String!]!
    spotify_id: String!
    recording_mbid: String!
    isrc: String!
    release_date: String!
    genre: String
  }
  type Tracklist {
    name: String!
    tracks: [Track!]!
    price: Float!
    yearSpan: String!
    uniqueGenres: [String!]!
  }
  type Query {
    tracklists(page: Int!): [Tracklist!]!
    cart: [Tracklist!]!
  }
  type Mutation {
    addToCart(tracklistName: String!): Boolean!
    addAllToCart(page: Int!): Boolean!
    clearCart: Boolean!
    purchaseTracklist(tracklistName: String!): Boolean!
  }
`;
const resolvers = {
  Query: {
    tracklists: (_, { page }) => {
      const start = (page - 1) * 12;
      const tracklistsPage = Object.entries(tracklists).slice(start, start + 12).map(([name, tracklist]) => {
        const years = tracklist.tracks.map(t => parseInt(t.release_date.slice(0, 4))).filter(y => !isNaN(y));
        const minYear = years.length ? Math.min(...years) : 1989;
        const maxYear = years.length ? Math.max(...years) : 1989;
        const yearSpan = `${minYear}-${maxYear} (${maxYear - minYear} years)`;
        const uniqueGenres = [...new Set(tracklist.tracks.map(t => t.genre).filter(g => g))];
        return { name, ...tracklist, yearSpan, uniqueGenres };
      });
      console.log(`Query tracklists page ${page}: ${tracklistsPage.length} items`);
      return tracklistsPage;
    },
    cart: async (_, __, { userId }) => {
      if (!userId) return [];
      const cartItems = (await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'SELECT tracklistName FROM cart WHERE userId = ?'
          : 'SELECT tracklistName FROM cart WHERE userId = $1',
        [userId]
      )).rows.map(c => tracklists[c.tracklistName]).filter(Boolean);
      return cartItems.map(tracklist => {
        const years = tracklist.tracks.map(t => parseInt(t.release_date.slice(0, 4))).filter(y => !isNaN(y));
        const minYear = years.length ? Math.min(...years) : 1989;
        const maxYear = years.length ? Math.max(...years) : 1989;
        const yearSpan = `${minYear}-${maxYear} (${maxYear - minYear} years)`;
        const uniqueGenres = [...new Set(tracklist.tracks.map(t => t.genre).filter(g => g))];
        return { name: tracklist.name, ...tracklist, yearSpan, uniqueGenres };
      });
    }
  },
  Mutation: {
    addToCart: async (_, { tracklistName }, { userId }) => {
      if (!userId) throw new Error('Not authenticated');
      if (!tracklists[tracklistName]) throw new Error('Invalid tracklist');
      if (tracklists[tracklistName].price === 0) throw new Error('Free tracklists cannot be added to cart');
      const count = (await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'SELECT COUNT(*) AS count FROM cart WHERE userId = ?'
          : 'SELECT COUNT(*) FROM cart WHERE userId = $1',
        [userId]
      )).rows[0].count;
      if (count >= 12) throw new Error('Cart full (max 12)');
      await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'INSERT OR IGNORE INTO cart (userId, tracklistName) VALUES (?, ?)'
          : 'INSERT INTO cart (userId, tracklistName) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, tracklistName]
      );
      return true;
    },
    addAllToCart: async (_, { page }, { userId }) => {
      if (!userId) throw new Error('Not authenticated');
      const count = (await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'SELECT COUNT(*) AS count FROM cart WHERE userId = ?'
          : 'SELECT COUNT(*) FROM cart WHERE userId = $1',
        [userId]
      )).rows[0].count;
      const start = (page - 1) * 12;
      const tracklistsToAdd = Object.keys(tracklists).slice(start, start + 12).filter(name => tracklists[name].price !== 0);
      if (count + tracklistsToAdd.length > 12) throw new Error('Cart would exceed max 12');
      for (const tracklistName of tracklistsToAdd) {
        await pool.query(
          process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
            ? 'INSERT OR IGNORE INTO cart (userId, tracklistName) VALUES (?, ?)'
            : 'INSERT INTO cart (userId, tracklistName) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, tracklistName]
        );
      }
      return true;
    },
    clearCart: async (_, __, { userId }) => {
      if (!userId) throw new Error('Not authenticated');
      await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'DELETE FROM cart WHERE userId = ?'
          : 'DELETE FROM cart WHERE userId = $1',
        [userId]
      );
      return true;
    },
    purchaseTracklist: async (_, { tracklistName }, { userId }) => {
      if (!userId) throw new Error('Not authenticated');
      if (!tracklists[tracklistName]) throw new Error('Invalid tracklist');
      await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'INSERT OR IGNORE INTO purchases (userId, tracklistName) VALUES (?, ?)'
          : 'INSERT INTO purchases (userId, tracklistName) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, tracklistName]
      );
      console.log(`Purchased tracklist ${tracklistName} for user ${userId}`);
      return true;
    }
  }
};
const isAuthenticated = rule()(async (_, __, { userId }) => !!userId);
const isPurchased = rule()(async (_, { name }, { userId }) => {
  const purchase = await pool.query(
    process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
      ? 'SELECT * FROM purchases WHERE userId = ? AND tracklistName = ?'
      : 'SELECT * FROM purchases WHERE userId = $1 AND tracklistName = $2',
    [userId, name]
  );
  return purchase.rows.length > 0;
});
const permissions = shield({
  Track: { name: isAuthenticated, artists: and(isAuthenticated, isPurchased) },
  Query: { cart: isAuthenticated },
  Mutation: { addToCart: isAuthenticated, addAllToCart: isAuthenticated, clearCart: isAuthenticated, purchaseTracklist: isAuthenticated }
});
app.use('/graphql', createYoga({
  schema: makeExecutableSchema({ typeDefs, resolvers }),
  context: ({ req }) => ({ userId: req.session.userId })
}));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!req.session.userId) {
    req.session.userId = crypto.randomUUID();
  }
  res.render('title', { stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// In the tracklists page route
app.get('/tracks', ensureAuthenticated, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const page = parseInt(req.query.page) || 1;
  const purchasedTracklists = req.session.userId
    ? (await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'SELECT tracklistName FROM purchases WHERE userId = ?'
          : 'SELECT tracklistName FROM purchases WHERE userId = $1',
        [req.session.userId]
      )).rows.map(p => p.tracklistName)
    : [];
  const tracklistsWithMetadata = Object.fromEntries(
    Object.entries(tracklists).slice((page - 1) * 12, page * 12).map(([name, tracklist]) => {
      const years = tracklist.tracks.map(t => parseInt(t.release_date.slice(0, 4))).filter(y => !isNaN(y));
      const minYear = years.length ? Math.min(...years) : 1989;
      const maxYear = years.length ? Math.max(...years) : 1989;
      const yearSpan = `${minYear}-${maxYear} (${maxYear - minYear} years)`;
      const uniqueGenres = [...new Set(tracklist.tracks.map(t => t.genre).filter(g => g))];
      return [name, { ...tracklist, yearSpan, uniqueGenres }];
    })
  );
  const totalPages = Math.ceil(Object.keys(tracklists).length / 12) || 1;
  const houseNumber = page;
  const houseTitles = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
  const pageTitle = `${houseTitles[page - 1] || page + 'th'} House`;
  console.log(`Rendering /tracks?page=${page}, tracklists: ${Object.keys(tracklistsWithMetadata).length}, total: ${Object.keys(tracklists).length}, totalPages: ${totalPages}`);
  res.render('tracklists', {
    tracklists: tracklistsWithMetadata,
    purchasedTracklists,
    page,
    totalPages,
    pageTitle,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    theme: req.session.theme || 'light-mode'
  });
});

app.get('/checkout', ensureAuthenticated, async (req, res) => {
  const { page } = req.query;
  try {
    const pageNum = parseInt(page) || 1;
    const cartItems = (await pool.query(
      process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
        ? 'SELECT tracklistName FROM cart WHERE userId = ?'
        : 'SELECT tracklistName FROM cart WHERE userId = $1',
      [req.session.userId]
    )).rows.map(c => c.tracklistName).filter(name => tracklists[name]?.price !== 0);
    if (cartItems.length === 0) {
      console.error('Checkout failed: No premium tracklists in cart');
      return res.status(400).json({ code: 400, message: 'No premium tracklists in cart' });
    }
    console.log('Creating Stripe checkout session with API version 2024-09-30.acacia');
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      payment_method_types: ['card'],
      line_items: cartItems.map(name => ({
        price_data: {
          currency: 'usd',
          product_data: { name: `Tracklist ${tracklists[name].name}` },
          unit_amount: Math.round(tracklists[name].price * 100)
        },
        quantity: 1
      })),
      mode: 'payment',
      return_url: `${req.protocol}://${req.get('host')}/success?page=${pageNum}&session_id={CHECKOUT_SESSION_ID}`
    });
    res.json({ client_secret: session.client_secret, session_id: session.id });
  } catch (error) {
    console.error('Stripe checkout error:', {
      message: error.message,
      code: error.code,
      type: error.type,
      stack: error.stack
    });
    res.status(500).json({ code: 500, message: `Checkout failed: ${error.message}` });
  }
});

app.get('/success', ensureAuthenticated, async (req, res) => {
  const { page, session_id } = req.query;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status === 'paid') {
      const cartItems = (await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'SELECT tracklistName FROM cart WHERE userId = ?'
          : 'SELECT tracklistName FROM cart WHERE userId = $1',
        [req.session.userId]
      )).rows.map(c => c.tracklistName);
      for (const tracklistName of cartItems) {
        await pool.query(
          process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
            ? 'INSERT OR IGNORE INTO purchases (userId, tracklistName) VALUES (?, ?)'
            : 'INSERT INTO purchases (userId, tracklistName) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.session.userId, tracklistName]
        );
      }
      await pool.query(
        process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('sqlite')
          ? 'DELETE FROM cart WHERE userId = ?'
          : 'DELETE FROM cart WHERE userId = $1',
        [req.session.userId]
      );
      res.redirect(`/tracks?page=${page || 1}`);
    } else {
      res.redirect(`/tracks?page=${page || 1}&error=Payment not completed`);
    }
  } catch (error) {
    console.error('Payment verification error:', error.message);
    res.redirect(`/tracks?page=${page || 1}&error=Verification failed: ${error.message}`);
  }
});

app.get('/login', (req, res) => {
  req.session.userId = crypto.randomUUID();
  console.log('User logged in, userId:', req.session.userId);
  const redirectTo = req.query.redirect || '/tracks?page=1';
  res.redirect(redirectTo);
});

app.get('/toc', ensureAuthenticated, (req, res) => {
  res.redirect('/tracks?page=1');
});

app.post('/add-to-cart', ensureAuthenticated, async (req, res) => {
  const { tracklistName } = req.body;
  if (!tracklists[tracklistName]) {
    console.error('Add to cart failed: Invalid tracklistName:', tracklistName);
    return res.status(400).json({ code: 400, message: 'Invalid tracklist' });
  }
  if (tracklists[tracklistName].price === 0) {
    console.error('Add to cart failed: Free tracklists cannot be added to cart');
    return res.status(400).json({ code: 400, message: 'Free tracklists cannot be added to cart' });
  }
  try {
    await resolvers.Mutation.addToCart(null, { tracklistName }, { userId: req.session.userId });
    res.json({ success: true });
  } catch (error) {
    console.error('Add to cart error:', error.message);
    res.status(400).json({ code: 400, message: error.message });
  }
});

app.post('/purchase', ensureAuthenticated, async (req, res) => {
  const { tracklistName } = req.body;
  if (!tracklists[tracklistName]) {
    console.error('Purchase failed: Invalid tracklistName:', tracklistName);
    return res.status(400).json({ code: 400, message: 'Invalid tracklist' });
  }
  try {
    await resolvers.Mutation.purchaseTracklist(null, { tracklistName }, { userId: req.session.userId });
    res.json({ success: true });
  } catch (error) {
    console.error('Purchase error:', error.message);
    res.status(400).json({ code: 400, message: error.message });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ code: 500, message: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));