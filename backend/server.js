const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { verifyToken, isAdmin } = require('./auth');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Root route check
app.get('/', (req, res) => {
  res.send('Personal Blog CMS Backend API is running! Go to /api/test-db to check database.');
});

// Test Database Connection
app.get('/api/test-db', async (req, res) => {
  try {
    const categories = await pool.query('SELECT * FROM categories');
    const settings = await pool.query('SELECT * FROM settings');
    res.json({
      message: 'Database connected successfully!',
      categories: categories.rows,
      settings: settings.rows
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

// ==========================================
// 1. AUTHENTICATION & PROFILE ROUTES (User)
// ==========================================

// Register User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { user_name, email, password, bio, profile_image } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    // Automatically make the very first user in the database an 'admin' for easy testing!
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const role = parseInt(userCount.rows[0].count) === 0 ? 'admin' : 'user';

    const result = await pool.query(
      `INSERT INTO users (user_name, email, password, bio, profile_image, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING user_id, user_name, email, bio, profile_image, role, created_at`,
      [user_name, email, hashedPassword, bio || '', profile_image || '', role]
    );
    res.status(201).json({ message: 'User registered!', user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });

    const user = result.rows[0];
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign(
      { user_id: user.user_id, user_name: user.user_name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        user_id: user.user_id,
        user_name: user.user_name,
        email: user.email,
        bio: user.bio,
        profile_image: user.profile_image,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update My Profile
app.put('/api/profile', verifyToken, async (req, res) => {
  try {
    const { user_name, bio, profile_image } = req.body;
    const result = await pool.query(
      `UPDATE users SET user_name = $1, bio = $2, profile_image = $3, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $4 RETURNING user_id, user_name, email, bio, profile_image, role`,
      [user_name, bio, profile_image, req.user.user_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 2. PUBLIC BLOG ROUTES (Readers)
// ==========================================

// Get All Published Posts (with Search & Category Filter)
app.get('/api/posts', async (req, res) => {
  try {
    const { search, category } = req.query;
    let query = `
      SELECT p.*, u.user_name, u.profile_image,
        COALESCE((SELECT COUNT(*) FROM likes l WHERE l.post_id = p.post_id), 0) AS like_count,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT c.name), NULL) AS categories,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT t.name), NULL) AS tags
      FROM posts p
      JOIN users u ON p.user_id = u.user_id
      LEFT JOIN post_categories pc ON p.post_id = pc.post_id
      LEFT JOIN categories c ON pc.category_id = c.category_id
      LEFT JOIN post_tags pt ON p.post_id = pt.post_id
      LEFT JOIN tags t ON pt.tag_id = t.tag_id
      WHERE p.status = 'published'
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.title ILIKE $${params.length} OR p.content ILIKE $${params.length})`;
    }
    if (category) {
      params.push(category);
      query += ` AND c.slug = $${params.length}`;
    }

    query += ` GROUP BY p.post_id, u.user_name, u.profile_image ORDER BY p.created_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Single Post by Slug (Plus Approved Comments)
app.get('/api/posts/:slug', async (req, res) => {
  try {
    const postRes = await pool.query(
      `SELECT p.*, u.user_name, u.bio, u.profile_image,
        COALESCE((SELECT COUNT(*) FROM likes l WHERE l.post_id = p.post_id), 0) AS like_count
       FROM posts p JOIN users u ON p.user_id = u.user_id
       WHERE p.slug = $1`,
      [req.params.slug]
    );
    if (postRes.rows.length === 0) return res.status(404).json({ error: 'Post not found' });

    const post = postRes.rows[0];
    const commentsRes = await pool.query(
      `SELECT * FROM comments WHERE post_id = $1 AND status = 'approved' ORDER BY created_at DESC`,
      [post.post_id]
    );
    res.json({ post, comments: commentsRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// View Author Profile & Their Published Posts
app.get('/api/authors/:username', async (req, res) => {
  try {
    const userRes = await pool.query(
      `SELECT user_id, user_name, bio, profile_image, created_at FROM users WHERE user_name = $1`,
      [req.params.username]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Author not found' });

    const postsRes = await pool.query(
      `SELECT * FROM posts WHERE user_id = $1 AND status = 'published' ORDER BY created_at DESC`,
      [userRes.rows[0].user_id]
    );
    res.json({ author: userRes.rows[0], posts: postsRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Categories, Tags & Site Settings (Optimized with Promise.all)
app.get('/api/meta', async (req, res) => {
  try {
    const [categories, tags, settings] = await Promise.all([
      pool.query('SELECT * FROM categories ORDER BY name'),
      pool.query('SELECT * FROM tags ORDER BY name'),
      pool.query('SELECT * FROM settings')
    ]);
    res.json({ categories: categories.rows, tags: tags.rows, settings: settings.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leave a Comment (Public or Logged-In)
app.post('/api/comments', async (req, res) => {
  try {
    const { post_id, user_id, name, email, content } = req.body;
    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, name, email, content, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
      [post_id, user_id || null, name, email, content]
    );
    res.status(201).json({ message: 'Comment submitted for approval!', comment: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Like a Post (Logged-in User)
app.post('/api/posts/:id/like', verifyToken, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.user_id]
    );
    res.json({ message: 'Post liked!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Subscribe to Newsletter
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    await pool.query(`INSERT INTO subscribers (email) VALUES ($1) ON CONFLICT DO NOTHING`, [email]);
    res.json({ message: 'Subscribed to newsletter successfully!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 3. USER DASHBOARD ROUTES (Authors)
// ==========================================

// View My Posts (Published + Drafts)
app.get('/api/my-posts', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Post or Save Draft (with Categories & Tags)
app.post('/api/posts', verifyToken, async (req, res) => {
  try {
    const { title, content, cover_image, status, category_ids, tag_ids } = req.body;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString().slice(-4);

    const postRes = await pool.query(
      `INSERT INTO posts (user_id, title, slug, content, cover_image, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.user_id, title, slug, content, cover_image || '', status || 'draft']
    );
    const post = postRes.rows[0];

    if (Array.isArray(category_ids)) {
      for (const catId of category_ids) {
        await pool.query(`INSERT INTO post_categories (post_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [post.post_id, catId]);
      }
    }
    if (Array.isArray(tag_ids)) {
      for (const tagId of tag_ids) {
        await pool.query(`INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [post.post_id, tagId]);
      }
    }
    res.status(201).json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Edit Post
app.put('/api/posts/:id', verifyToken, async (req, res) => {
  try {
    const { title, content, cover_image, status } = req.body;
    const result = await pool.query(
      `UPDATE posts SET title = $1, content = $2, cover_image = $3, status = $4, updated_at = CURRENT_TIMESTAMP
       WHERE post_id = $5 AND (user_id = $6 OR $7 = 'admin') RETURNING *`,
      [title, content, cover_image, status, req.params.id, req.user.user_id, req.user.role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Post
app.delete('/api/posts/:id', verifyToken, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM posts WHERE post_id = $1 AND (user_id = $2 OR $3 = 'admin')`,
      [req.params.id, req.user.user_id, req.user.role]
    );
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// View Comments on My Posts (For User Moderation)
app.get('/api/my-comments', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, p.title AS post_title FROM comments c
       JOIN posts p ON c.post_id = p.post_id
       WHERE p.user_id = $1 ORDER BY c.created_at DESC`,
      [req.user.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve or Delete a Comment
app.patch('/api/comments/:id', verifyToken, async (req, res) => {
  try {
    const { status } = req.body; // 'approved' or 'delete'
    if (status === 'delete') {
      await pool.query(`DELETE FROM comments WHERE comment_id = $1`, [req.params.id]);
      return res.json({ message: 'Comment deleted' });
    }
    const result = await pool.query(
      `UPDATE comments SET status = $1 WHERE comment_id = $2 RETURNING *`,
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create Category or Tag
app.post('/api/categories', verifyToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const result = await pool.query(
      `INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3) RETURNING *`,
      [name, slug, description || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/tags', verifyToken, async (req, res) => {
  try {
    const { name } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const result = await pool.query(
      `INSERT INTO tags (name, slug) VALUES ($1, $2) RETURNING *`,
      [name, slug]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 4. ADMIN ROUTES (Admin Panel)
// ==========================================

// Optimized Admin Overview with Promise.all
app.get('/api/admin/overview', verifyToken, isAdmin, async (req, res) => {
  try {
    const [users, posts, comments] = await Promise.all([
      pool.query('SELECT user_id, user_name, email, role, created_at FROM users ORDER BY created_at DESC'),
      pool.query('SELECT p.*, u.user_name FROM posts p JOIN users u ON p.user_id = u.user_id ORDER BY p.created_at DESC'),
      pool.query('SELECT c.*, p.title AS post_title FROM comments c JOIN posts p ON c.post_id = p.post_id ORDER BY c.created_at DESC')
    ]);
    res.json({ users: users.rows, posts: posts.rows, comments: comments.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE user_id = $1', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/settings', verifyToken, isAdmin, async (req, res) => {
  try {
    const { site_title, site_description } = req.body;
    await pool.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('site_title', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1`, [site_title]);
    await pool.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('site_description', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1`, [site_description]);
    res.json({ message: 'Site settings updated!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`CMS Backend API running on http://localhost:${PORT}`));