const API = 'https://personal-blog-cms-stcx.onrender.com/api';
let currentUser = JSON.parse(localStorage.getItem('cms_user') || 'null');
let token = localStorage.getItem('cms_token') || '';
let activePostId = null;
let selectedCategory = '';

// Initialize App
window.onload = () => {
  updateNavUI();
  loadMeta();
  loadPosts();
};

function showSection(name) {
  ['home', 'post', 'author', 'auth', 'dashboard', 'admin'].forEach(sec => {
    document.getElementById(`sec-${sec}`).classList.add('hidden');
  });
  document.getElementById(`sec-${name}`).classList.remove('hidden');

  if (name === 'home') loadPosts();
  if (name === 'dashboard') loadDashboard();
  if (name === 'admin') loadAdmin();
}

function updateNavUI() {
  const isLogged = !!token && !!currentUser;
  document.getElementById('btn-nav-login').classList.toggle('hidden', isLogged);
  document.getElementById('btn-nav-logout').classList.toggle('hidden', !isLogged);
  document.getElementById('btn-nav-dashboard').classList.toggle('hidden', !isLogged);
  document.getElementById('btn-nav-admin').classList.toggle('hidden', !(isLogged && currentUser.role === 'admin'));
}

// 1. Load Categories, Tags & Site Settings
async function loadMeta() {
  const res = await fetch(`${API}/meta`);
  const data = await res.json();

  // Site Settings
  const titleObj = data.settings.find(s => s.setting_key === 'site_title');
  const descObj = data.settings.find(s => s.setting_key === 'site_description');
  if (titleObj) document.getElementById('nav-site-title').innerText = titleObj.setting_value;
  if (descObj) document.getElementById('nav-site-desc').innerText = descObj.setting_value;

  // Category Filter Buttons on Home
  const filterDiv = document.getElementById('category-filters');
  filterDiv.innerHTML = `<button onclick="filterCategory('')" class="px-3 py-1 rounded-full text-xs border ${selectedCategory === '' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}">All</button>` +
    data.categories.map(c => `<button onclick="filterCategory('${c.slug}')" class="px-3 py-1 rounded-full text-xs border ${selectedCategory === c.slug ? 'bg-indigo-600 text-white' : 'bg-slate-100'}">${c.name}</button>`).join('');

  // Checkboxes in Dashboard Editor
  document.getElementById('editor-categories').innerHTML = data.categories.map(c =>
    `<label class="text-xs flex items-center gap-1 bg-slate-100 px-2 py-1 rounded"><input type="checkbox" class="cat-check" value="${c.category_id}"/> ${c.name}</label>`
  ).join('');
  document.getElementById('editor-tags').innerHTML = data.tags.map(t =>
    `<label class="text-xs flex items-center gap-1 bg-slate-100 px-2 py-1 rounded"><input type="checkbox" class="tag-check" value="${t.tag_id}"/> #${t.name}</label>`
  ).join('');
}

function filterCategory(slug) {
  selectedCategory = slug;
  loadMeta();
  loadPosts();
}

// 2. Load Public Posts
async function loadPosts() {
  const search = document.getElementById('search-input').value;
  const res = await fetch(`${API}/posts?search=${encodeURIComponent(search)}&category=${encodeURIComponent(selectedCategory)}`);
  const posts = await res.json();

  const grid = document.getElementById('posts-grid');
  if (posts.length === 0) {
    grid.innerHTML = `<p class="text-slate-500 col-span-3 text-center py-8">No published blog posts yet. Log in and publish your first post!</p>`;
    return;
  }

  grid.innerHTML = posts.map(p => `
    <div class="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col justify-between">
      <div>
        ${p.cover_image ? `<img src="${p.cover_image}" class="h-44 w-full object-cover" />` : ''}
        <div class="p-5 space-y-2">
          <div class="flex gap-1 flex-wrap">
            ${(p.categories || []).map(c => `<span class="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">${c}</span>`).join('')}
          </div>
          <h3 onclick="openPost('${p.slug}')" class="text-lg font-bold hover:text-indigo-600 cursor-pointer">${p.title}</h3>
          <p class="text-sm text-slate-600 line-clamp-3">${p.content}</p>
        </div>
      </div>
      <div class="px-5 py-3 bg-slate-50 border-t flex justify-between items-center text-xs text-slate-500">
        <button onclick="openAuthor('${p.user_name}')" class="hover:underline font-medium">By @${p.user_name}</button>
        <span>❤️ ${p.like_count} Likes</span>
      </div>
    </div>
  `).join('');
}

// 3. Open Single Post
async function openPost(slug) {
  const res = await fetch(`${API}/posts/${slug}`);
  const { post, comments } = await res.json();
  activePostId = post.post_id;

  document.getElementById('single-post-content').innerHTML = `
    ${post.cover_image ? `<img src="${post.cover_image}" class="w-full h-64 object-cover rounded-lg" />` : ''}
    <h1 class="text-2xl font-bold">${post.title}</h1>
    <div class="flex justify-between items-center text-xs text-slate-500 border-b pb-3">
      <button onclick="openAuthor('${post.user_name}')" class="text-indigo-600 font-semibold">By @${post.user_name}</button>
      <button onclick="likePost(${post.post_id}, '${post.slug}')" class="bg-rose-50 text-rose-600 px-3 py-1 rounded-full font-medium">❤️ Like (${post.like_count})</button>
    </div>
    <div class="text-slate-700 whitespace-pre-line leading-relaxed">${post.content}</div>
  `;

  document.getElementById('post-comments-list').innerHTML = comments.length
    ? comments.map(c => `<div class="border-b pb-2"><p class="text-xs font-bold">${c.name}</p><p class="text-sm">${c.content}</p></div>`).join('')
    : '<p class="text-xs text-slate-400">No approved comments yet.</p>';

  showSection('post');
}

async function likePost(postId, slug) {
  if (!token) return alert('Please log in to like a post!');
  await fetch(`${API}/posts/${postId}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  openPost(slug);
}

async function submitComment() {
  const name = document.getElementById('comment-name').value || (currentUser && currentUser.user_name);
  const email = document.getElementById('comment-email').value || (currentUser && currentUser.email);
  const content = document.getElementById('comment-content').value;
  if (!name || !content) return alert('Please enter your name and comment!');

  await fetch(`${API}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: activePostId, user_id: currentUser?.user_id, name, email, content })
  });
  alert('Comment submitted! It will appear once approved by the author/admin.');
  document.getElementById('comment-content').value = '';
}

// 4. Open Author Profile
async function openAuthor(username) {
  const res = await fetch(`${API}/authors/${username}`);
  const { author, posts } = await res.json();
  document.getElementById('author-profile-box').innerHTML = `
    <h2 class="text-xl font-bold">@${author.user_name}</h2>
    <p class="text-sm text-slate-600 mt-1">${author.bio || 'No bio added yet.'}</p>
  `;
  document.getElementById('author-posts-grid').innerHTML = posts.map(p => `
    <div onclick="openPost('${p.slug}')" class="bg-white p-4 rounded-xl border shadow-sm cursor-pointer hover:border-indigo-500">
      <h4 class="font-bold">${p.title}</h4>
      <p class="text-xs text-slate-500 mt-1 line-clamp-2">${p.content}</p>
    </div>
  `).join('');
  showSection('author');
}

// 5. Authentication
async function registerUser() {
  const user_name = document.getElementById('auth-username').value;
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_name, email, password })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  alert(`Registered successfully as ${data.user.role}! Now click Login.`);
}

async function loginUser() {
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);

  token = data.token;
  currentUser = data.user;
  localStorage.setItem('cms_token', token);
  localStorage.setItem('cms_user', JSON.stringify(currentUser));
  updateNavUI();
  showSection('dashboard');
}

function logout() {
  token = '';
  currentUser = null;
  localStorage.removeItem('cms_token');
  localStorage.removeItem('cms_user');
  updateNavUI();
  showSection('home');
}

// 6. User Dashboard
async function loadDashboard() {
  document.getElementById('prof-username').value = currentUser.user_name || '';
  document.getElementById('prof-image').value = currentUser.profile_image || '';
  document.getElementById('prof-bio').value = currentUser.bio || '';

  const pRes = await fetch(`${API}/my-posts`, { headers: { Authorization: `Bearer ${token}` } });
  const myPosts = await pRes.json();
  document.getElementById('my-posts-list').innerHTML = myPosts.map(p => `
    <div class="flex justify-between items-center border-b pb-2">
      <div>
        <span class="font-semibold">${p.title}</span>
        <span class="text-xs px-2 py-0.5 rounded ${p.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${p.status}</span>
      </div>
      <div class="flex gap-2">
        <button onclick='populateEdit(${JSON.stringify(p).replace(/'/g, "&apos;")})' class="text-indigo-600 text-xs">Edit</button>
        <button onclick="deletePost(${p.post_id})" class="text-rose-600 text-xs">Delete</button>
      </div>
    </div>
  `).join('');

  const cRes = await fetch(`${API}/my-comments`, { headers: { Authorization: `Bearer ${token}` } });
  const myComments = await cRes.json();
  document.getElementById('my-comments-list').innerHTML = myComments.map(c => `
    <div class="flex justify-between items-center border-b pb-2">
      <div>
        <p class="font-medium">${c.name} on "${c.post_title}" (${c.status})</p>
        <p class="text-xs text-slate-600">${c.content}</p>
      </div>
      <div class="flex gap-2">
        ${c.status !== 'approved' ? `<button onclick="moderateComment(${c.comment_id}, 'approved')" class="text-emerald-600 text-xs font-bold">Approve</button>` : ''}
        <button onclick="moderateComment(${c.comment_id}, 'delete')" class="text-rose-600 text-xs">Delete</button>
      </div>
    </div>
  `).join('');
}

function populateEdit(post) {
  document.getElementById('editor-heading').innerText = 'Edit Post';
  document.getElementById('edit-post-id').value = post.post_id;
  document.getElementById('post-title').value = post.title;
  document.getElementById('post-image').value = post.cover_image || '';
  document.getElementById('post-content').value = post.content;
}

async function savePost(status) {
  const editId = document.getElementById('edit-post-id').value;
  const title = document.getElementById('post-title').value;
  const cover_image = document.getElementById('post-image').value;
  const content = document.getElementById('post-content').value;
  const category_ids = Array.from(document.querySelectorAll('.cat-check:checked')).map(cb => Number(cb.value));
  const tag_ids = Array.from(document.querySelectorAll('.tag-check:checked')).map(cb => Number(cb.value));

  const url = editId ? `${API}/posts/${editId}` : `${API}/posts`;
  const method = editId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, content, cover_image, status, category_ids, tag_ids })
  });
  if (res.ok) {
    alert(`Post ${status}!`);
    document.getElementById('edit-post-id').value = '';
    document.getElementById('post-title').value = '';
    document.getElementById('post-image').value = '';
    document.getElementById('post-content').value = '';
    document.getElementById('editor-heading').innerText = 'Create New Post / Draft';
    loadDashboard();
  }
}

async function deletePost(id) {
  await fetch(`${API}/posts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  loadDashboard();
  if (!document.getElementById('sec-admin').classList.contains('hidden')) loadAdmin();
}

async function moderateComment(id, status) {
  await fetch(`${API}/comments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status })
  });
  loadDashboard();
  if (!document.getElementById('sec-admin').classList.contains('hidden')) loadAdmin();
}

async function updateProfile() {
  const user_name = document.getElementById('prof-username').value;
  const profile_image = document.getElementById('prof-image').value;
  const bio = document.getElementById('prof-bio').value;
  const res = await fetch(`${API}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_name, profile_image, bio })
  });
  currentUser = await res.json();
  localStorage.setItem('cms_user', JSON.stringify(currentUser));
  alert('Profile updated!');
}

async function addCategory() {
  const name = document.getElementById('new-cat-name').value;
  if (!name) return;
  await fetch(`${API}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name })
  });
  document.getElementById('new-cat-name').value = '';
  loadMeta();
}

async function addTag() {
  const name = document.getElementById('new-tag-name').value;
  if (!name) return;
  await fetch(`${API}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name })
  });
  document.getElementById('new-tag-name').value = '';
  loadMeta();
}

// 7. Admin Panel
async function loadAdmin() {
  const res = await fetch(`${API}/admin/overview`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();

  document.getElementById('admin-users-list').innerHTML = data.users.map(u => `
    <div class="flex justify-between border-b pb-1">
      <span>@${u.user_name} (${u.role})</span>
      <button onclick="deleteUser(${u.user_id})" class="text-rose-600">Delete</button>
    </div>
  `).join('');

  document.getElementById('admin-posts-list').innerHTML = data.posts.map(p => `
    <div class="flex justify-between border-b pb-1">
      <span>${p.title} (@${p.user_name})</span>
      <button onclick="deletePost(${p.post_id})" class="text-rose-600">Delete</button>
    </div>
  `).join('');

  document.getElementById('admin-comments-list').innerHTML = data.comments.map(c => `
    <div class="flex justify-between border-b pb-1">
      <span>${c.name}: ${c.content} (${c.status})</span>
      <div class="flex gap-1">
        ${c.status !== 'approved' ? `<button onclick="moderateComment(${c.comment_id}, 'approved')" class="text-emerald-600">Approve</button>` : ''}
        <button onclick="moderateComment(${c.comment_id}, 'delete')" class="text-rose-600">Del</button>
      </div>
    </div>
  `).join('');
}

async function deleteUser(id) {
  await fetch(`${API}/admin/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  loadAdmin();
}

async function updateSiteSettings() {
  const site_title = document.getElementById('admin-site-title').value;
  const site_description = document.getElementById('admin-site-desc').value;
  await fetch(`${API}/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ site_title, site_description })
  });
  alert('Site settings updated!');
  loadMeta();
}

async function subscribeNewsletter() {
  const email = document.getElementById('newsletter-email').value;
  if (!email) return;
  await fetch(`${API}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  alert('Subscribed to newsletter!');
  document.getElementById('newsletter-email').value = '';
}