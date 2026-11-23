/* ==========================================================================
   LibraDB — Frontend Controller Connected to Live MySQL Backend
   ========================================================================== */

const API_BASE =
  window.location.port === "3000" ? "/api" : "http://localhost:3000/api";
const FINE_PER_DAY = 5;

let state = {
  books: [],
  members: [],
  transactions: [],
  logs: []
};

let currentView = "dashboard";
let currentChartType = "bar";
let currentTxFilter = "ALL";
let activeReportIndex = 0;
let categoryChartInstance = null;

// ---------- Date Helpers ----------
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function todayISO() {
  return formatDate(new Date());
}

function daysBetween(dateA, dateB) {
  const msPerDay = 86400000;
  const a = new Date(dateA + "T00:00:00");
  const b = new Date(dateB + "T00:00:00");
  return Math.floor((b - a) / msPerDay);
}

// ---------- API Client ----------
async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.title = data.title || "Database Error";
    err.sql = data.sql;
    throw err;
  }
  return data;
}

function updateConnectionBadge(connected, detail) {
  const dot = document.querySelector(".status-dot");
  const title = document.querySelector(".db-status-row strong");
  const meta = document.querySelector(".db-status-meta");
  if (!dot || !title || !meta) return;

  dot.style.background = connected ? "var(--emerald)" : "var(--rose)";
  title.textContent = connected ? "MySQL Connected" : "MySQL Offline";
  meta.textContent = detail;
}

async function refreshFromMySQL() {
  try {
    const [health, data] = await Promise.all([
      apiRequest("/health"),
      apiRequest("/state")
    ]);
    state.books = data.books;
    state.members = data.members;
    state.transactions = data.transactions;
    updateConnectionBadge(true, `${health.db} · FK Restrict · ₹5/day`);
    renderAll();
    if (currentView === "workbench") {
      await runPresetQuery(activeReportIndex);
    }
  } catch (err) {
    updateConnectionBadge(false, "Run `npm start` in VS Code");
    showToast(
      "Backend Not Reachable",
      "Start server.js with `npm start` in VS Code terminal.",
      "error"
    );
  }
}

// ---------- SQL Logger & Toast ----------
function logSQL(sql, status = "OK") {
  if (!sql) return;
  state.logs.unshift({
    ts: new Date().toLocaleTimeString(),
    status,
    sql: sql.trim()
  });
  if (state.logs.length > 50) state.logs.pop();
  renderSQLLog();
}

function showToast(title, message, type = "ok") {
  const stack = document.getElementById("toast-stack");
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.innerHTML = `<strong>${escapeHTML(title)}</strong><span>${escapeHTML(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightSQL(sql) {
  const escaped = escapeHTML(sql);
  return escaped
    .replace(/'([^']*)'/g, `<span class="sql-str">'$1'</span>`)
    .replace(
      /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|JOIN|INNER|LEFT|ON|GROUP|BY|ORDER|DESC|ASC|AS|AND|OR|IS|NULL|NOT|CASE|WHEN|THEN|ELSE|END|COUNT|SUM|CONCAT|DATEDIFF|CURRENT_DATE|BEGIN|COMMIT|ROLLBACK)\b/g,
      `<span class="sql-kw">$1</span>`
    )
    .replace(/\b(\d+)\b/g, `<span class="sql-num">$1</span>`);
}

// ---------- Domain Calculations ----------
function getBorrowLimit(role) {
  return role === "Faculty" ? 5 : 3;
}

function getActiveLoansForMember(memberId) {
  return state.transactions.filter(
    (t) => t.member_id === memberId && t.return_date === null
  );
}

function getTxStatus(tx) {
  if (tx.return_date) return "RETURNED";
  return daysBetween(tx.due_date, todayISO()) > 0 ? "OVERDUE" : "ISSUED";
}

function calculateLiveFine(tx) {
  if (tx.return_date) return Number(tx.fine_amount || 0);
  const overdueDays = daysBetween(tx.due_date, todayISO());
  return overdueDays > 0 ? overdueDays * FINE_PER_DAY : 0;
}

// ---------- Navigation & Theme ----------
const PAGE_META = {
  dashboard: ["Dashboard", "Live MySQL overview of library inventory, loans, and fines"],
  books: ["Books Catalog", "Live CRUD on MySQL BOOKS table with UNIQUE & CHECK rules"],
  members: ["Members Directory", "Student & Faculty rows in MySQL MEMBERS table"],
  circulation: ["Circulation Desk", "Transactional MySQL Issue/Return with triggers & ₹5/day fines"],
  workbench: ["DBMS Workbench", "3NF ER schema, live MySQL SQL reports, and real query log"]
};

function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${viewName}`).classList.add("active");

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });

  const [title, sub] = PAGE_META[viewName];
  document.getElementById("page-title").textContent = title;
  document.getElementById("page-subtitle").textContent = sub;
  document.getElementById("sidebar").classList.remove("open");

  if (viewName === "dashboard") renderChart();
  if (viewName === "workbench") runPresetQuery(activeReportIndex);
}

function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  document.getElementById("theme-icon").textContent = isDark ? "🌙" : "☀️";
  localStorage.setItem("libradb_theme", isDark ? "light" : "dark");
  renderChart();
}

// ---------- Rendering Pipeline ----------
function renderAll() {
  renderBadges();
  renderDashboard();
  renderBooksTable();
  renderMembersTable();
  renderTransactionsTable();
  renderSQLLog();
}

function renderBadges() {
  const overdueCount = state.transactions.filter((t) => getTxStatus(t) === "OVERDUE").length;
  document.getElementById("badge-books").textContent = state.books.length;
  document.getElementById("badge-members").textContent = state.members.length;
  document.getElementById("badge-overdue").textContent = overdueCount;
}

function renderDashboard() {
  const totalCopies = state.books.reduce((s, b) => s + Number(b.total_copies), 0);
  const availCopies = state.books.reduce((s, b) => s + Number(b.available_copies), 0);
  const activeLoans = state.transactions.filter((t) => !t.return_date);
  const returnedLoans = state.transactions.filter((t) => t.return_date);
  const overdueLoans = activeLoans.filter((t) => getTxStatus(t) === "OVERDUE");
  const pendingFines = overdueLoans.reduce((s, t) => s + calculateLiveFine(t), 0);
  const studentCount = state.members.filter((m) => m.role === "Student").length;
  const facultyCount = state.members.filter((m) => m.role === "Faculty").length;

  document.getElementById("kpi-books").textContent = state.books.length;
  document.getElementById("kpi-books-sub").textContent = `${availCopies} of ${totalCopies} copies available`;

  document.getElementById("kpi-loans").textContent = activeLoans.length;
  document.getElementById("kpi-loans-sub").textContent = `${returnedLoans.length} returned all-time`;

  document.getElementById("kpi-members").textContent = state.members.length;
  document.getElementById("kpi-members-sub").textContent = `${studentCount} Students · ${facultyCount} Faculty`;

  document.getElementById("kpi-fines").textContent = `₹${pendingFines}`;
  document.getElementById("kpi-fines-sub").textContent = `${overdueLoans.length} active overdue loan(s)`;

  renderChart();

  const recentEl = document.getElementById("recent-activity");
  const recent = [...state.transactions].sort((a, b) => b.tx_id - a.tx_id).slice(0, 6);
  recentEl.innerHTML = recent
    .map((tx) => {
      const book = state.books.find((b) => b.book_id === tx.book_id);
      const member = state.members.find((m) => m.member_id === tx.member_id);
      const status = getTxStatus(tx);
      const badgeClass =
        status === "OVERDUE" ? "rose" : status === "RETURNED" ? "emerald" : "indigo";
      return `
        <div class="activity-item">
          <div>
            <div class="activity-title">${escapeHTML(book?.title || "Unknown")}</div>
            <div class="activity-meta">${escapeHTML(member?.full_name || "Unknown")} · Due ${tx.due_date}</div>
          </div>
          <span class="badge ${badgeClass}">${status}</span>
        </div>
      `;
    })
    .join("");
}

function renderChart() {
  const canvas = document.getElementById("categoryChart");
  if (!canvas || typeof Chart === "undefined") return;

  const grouped = {};
  state.books.forEach((b) => {
    if (!grouped[b.category]) grouped[b.category] = { total: 0, avail: 0 };
    grouped[b.category].total += Number(b.total_copies);
    grouped[b.category].avail += Number(b.available_copies);
  });

  const labels = Object.keys(grouped);
  const totalData = labels.map((l) => grouped[l].total);
  const availData = labels.map((l) => grouped[l].avail);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const textColor = isDark ? "#cbd5e1" : "#475569";
  const gridColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.2)";

  if (categoryChartInstance) categoryChartInstance.destroy();

  const datasets =
    currentChartType === "bar"
      ? [
          { label: "Total Copies", data: totalData, backgroundColor: "#6366f1", borderRadius: 6 },
          { label: "Available", data: availData, backgroundColor: "#10b981", borderRadius: 6 }
        ]
      : [
          {
            label: "Total Copies",
            data: totalData,
            backgroundColor: ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ec4899", "#8b5cf6"],
            borderWidth: 0
          }
        ];

  categoryChartInstance = new Chart(canvas, {
    type: currentChartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, font: { family: "Inter", size: 12 } } }
      },
      scales:
        currentChartType === "bar"
          ? {
              x: { ticks: { color: textColor }, grid: { display: false } },
              y: { beginAtZero: true, ticks: { color: textColor, stepSize: 2 }, grid: { color: gridColor } }
            }
          : {}
    }
  });
}

function renderBooksTable() {
  const search = document.getElementById("books-search").value.trim().toLowerCase();
  const catSelect = document.getElementById("books-category-filter");
  const stockFilter = document.getElementById("books-stock-filter").value;

  const prevCat = catSelect.value || "ALL";
  const categories = [...new Set(state.books.map((b) => b.category))].sort();
  catSelect.innerHTML =
    `<option value="ALL">All Categories</option>` +
    categories.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
  catSelect.value = categories.includes(prevCat) ? prevCat : "ALL";

  const filtered = state.books.filter((b) => {
    const matchText =
      !search ||
      b.title.toLowerCase().includes(search) ||
      b.author.toLowerCase().includes(search) ||
      b.isbn.toLowerCase().includes(search);
    const matchCat = catSelect.value === "ALL" || b.category === catSelect.value;
    const matchStock =
      stockFilter === "ALL" ||
      (stockFilter === "AVAILABLE" && b.available_copies > 0) ||
      (stockFilter === "OUT" && b.available_copies === 0);
    return matchText && matchCat && matchStock;
  });

  const tbody = document.getElementById("books-tbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px;">No matching books found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((b) => {
      const statusBadge =
        b.available_copies === 0
          ? `<span class="badge rose">Out of Stock</span>`
          : b.available_copies === 1
          ? `<span class="badge amber">Low Stock</span>`
          : `<span class="badge emerald">Available</span>`;

      return `
        <tr>
          <td class="mono">#${b.book_id}</td>
          <td>
            <div class="cell-primary">${escapeHTML(b.title)}</div>
            <div class="cell-sub">${escapeHTML(b.author)}</div>
          </td>
          <td class="mono">${escapeHTML(b.isbn)}</td>
          <td><span class="badge indigo">${escapeHTML(b.category)}</span></td>
          <td class="mono">${b.available_copies} / ${b.total_copies}</td>
          <td>${statusBadge}</td>
          <td class="text-right">
            <div class="row-actions">
              <button class="btn btn-outline btn-sm" onclick="openBookModal(${b.book_id})">Edit</button>
              <button class="btn btn-ghost btn-sm danger-text" onclick="deleteBook(${b.book_id})">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderMembersTable() {
  const search = document.getElementById("members-search").value.trim().toLowerCase();
  const roleFilter = document.getElementById("members-role-filter").value;

  const filtered = state.members.filter((m) => {
    const matchText =
      !search ||
      m.full_name.toLowerCase().includes(search) ||
      m.reg_code.toLowerCase().includes(search) ||
      m.email.toLowerCase().includes(search) ||
      m.department.toLowerCase().includes(search);
    const matchRole = roleFilter === "ALL" || m.role === roleFilter;
    return matchText && matchRole;
  });

  const tbody = document.getElementById("members-tbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px;">No matching members found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((m) => {
      const active = getActiveLoansForMember(m.member_id).length;
      const limit = getBorrowLimit(m.role);
      const roleClass = m.role === "Faculty" ? "sky" : "indigo";
      return `
        <tr>
          <td class="mono">#${m.member_id}</td>
          <td>
            <div class="cell-primary">${escapeHTML(m.full_name)}</div>
            <div class="cell-sub">${escapeHTML(m.reg_code)} · ${escapeHTML(m.email)}</div>
          </td>
          <td>
            <span class="badge ${roleClass}">${m.role}</span>
            <span class="cell-sub" style="margin-left:6px;">${escapeHTML(m.department)}</span>
          </td>
          <td class="mono">${active} / ${limit}</td>
          <td class="mono">${m.joined_date}</td>
          <td class="text-right">
            <div class="row-actions">
              <button class="btn btn-outline btn-sm" onclick="openMemberModal(${m.member_id})">Edit</button>
              <button class="btn btn-ghost btn-sm danger-text" onclick="deleteMember(${m.member_id})">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderTransactionsTable() {
  const search = document.getElementById("tx-search").value.trim().toLowerCase();

  const filtered = [...state.transactions]
    .sort((a, b) => b.tx_id - a.tx_id)
    .filter((tx) => {
      const status = getTxStatus(tx);
      if (currentTxFilter === "ISSUED" && tx.return_date !== null) return false;
      if (currentTxFilter === "OVERDUE" && status !== "OVERDUE") return false;
      if (currentTxFilter === "RETURNED" && status !== "RETURNED") return false;

      if (!search) return true;
      const book = state.books.find((b) => b.book_id === tx.book_id);
      const member = state.members.find((m) => m.member_id === tx.member_id);
      return (
        (book && book.title.toLowerCase().includes(search)) ||
        (member && member.full_name.toLowerCase().includes(search)) ||
        String(tx.tx_id).includes(search)
      );
    });

  const tbody = document.getElementById("tx-tbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px;">No transactions match this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((tx) => {
      const book = state.books.find((b) => b.book_id === tx.book_id);
      const member = state.members.find((m) => m.member_id === tx.member_id);
      const status = getTxStatus(tx);
      const fine = calculateLiveFine(tx);
      const badgeClass =
        status === "OVERDUE" ? "rose" : status === "RETURNED" ? "emerald" : "indigo";

      return `
        <tr>
          <td class="mono">#${tx.tx_id}</td>
          <td>
            <div class="cell-primary">${escapeHTML(book?.title || "Unknown")}</div>
            <div class="cell-sub mono">book_id: ${tx.book_id}</div>
          </td>
          <td>
            <div class="cell-primary">${escapeHTML(member?.full_name || "Unknown")}</div>
            <div class="cell-sub">${escapeHTML(member?.reg_code || "")}</div>
          </td>
          <td class="mono">${tx.issue_date}</td>
          <td class="mono">${tx.due_date}</td>
          <td class="mono">${tx.return_date || "—"}</td>
          <td class="mono" style="font-weight:600;color:${fine > 0 ? "var(--rose)" : "inherit"}">₹${fine}</td>
          <td><span class="badge ${badgeClass}">${status}</span></td>
          <td class="text-right">
            ${
              tx.return_date
                ? `<span class="cell-sub">Closed</span>`
                : `<button class="btn btn-primary btn-sm" onclick="returnBook(${tx.tx_id})">Return</button>`
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderSQLLog() {
  const el = document.getElementById("sql-log");
  if (!state.logs.length) {
    el.innerHTML = `<p class="muted">No SQL commands recorded yet.</p>`;
    return;
  }
  el.innerHTML = state.logs
    .map(
      (entry) => `
      <div class="log-entry ${entry.status === "ERROR" ? "error" : ""}">
        <div class="log-meta">
          <span class="badge ${entry.status === "ERROR" ? "rose" : "emerald"}">${entry.status}</span>
          <span class="mono">${entry.ts}</span>
        </div>
        <div class="log-sql">${highlightSQL(entry.sql)}</div>
      </div>
    `
    )
    .join("");
}

// ---------- Modals & Live MySQL CRUD ----------
function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function openBookModal(bookId = null) {
  const form = document.getElementById("form-book");
  form.reset();
  document.getElementById("book-id").value = bookId || "";
  document.getElementById("modal-book-title").textContent = bookId ? "Edit Book" : "Add New Book";

  if (bookId) {
    const b = state.books.find((x) => x.book_id === bookId);
    if (!b) return;
    document.getElementById("book-title").value = b.title;
    document.getElementById("book-author").value = b.author;
    document.getElementById("book-isbn").value = b.isbn;
    document.getElementById("book-category").value = b.category;
    document.getElementById("book-total").value = b.total_copies;
  }
  openModal("modal-book");
}

async function handleBookSubmit(e) {
  e.preventDefault();
  const idVal = document.getElementById("book-id").value;
  const payload = {
    title: document.getElementById("book-title").value.trim(),
    author: document.getElementById("book-author").value.trim(),
    isbn: document.getElementById("book-isbn").value.trim(),
    category: document.getElementById("book-category").value,
    total_copies: parseInt(document.getElementById("book-total").value, 10)
  };

  try {
    const res = idVal
      ? await apiRequest(`/books/${idVal}`, { method: "PUT", body: JSON.stringify(payload) })
      : await apiRequest("/books", { method: "POST", body: JSON.stringify(payload) });

    logSQL(res.sql);
    showToast(idVal ? "Book Updated in MySQL" : "Book Inserted in MySQL", `"${payload.title}" saved.`);
    closeModal("modal-book");
    await refreshFromMySQL();
  } catch (err) {
    logSQL(err.sql || `-- ERROR: ${err.message}`, "ERROR");
    showToast(err.title || "Error", err.message, "error");
  }
}

async function deleteBook(bookId) {
  const book = state.books.find((b) => b.book_id === bookId);
  if (!book) return;

  try {
    const res = await apiRequest(`/books/${bookId}`, { method: "DELETE" });
    logSQL(res.sql);
    showToast("Book Deleted from MySQL", `Removed "${book.title}".`);
    await refreshFromMySQL();
  } catch (err) {
    logSQL(err.sql || `-- ERROR: ${err.message}`, "ERROR");
    showToast(err.title || "Delete Blocked", err.message, "error");
  }
}

function openMemberModal(memberId = null) {
  const form = document.getElementById("form-member");
  form.reset();
  document.getElementById("member-id").value = memberId || "";
  document.getElementById("modal-member-title").textContent = memberId
    ? "Edit Member"
    : "Register Member";

  if (memberId) {
    const m = state.members.find((x) => x.member_id === memberId);
    if (!m) return;
    document.getElementById("member-name").value = m.full_name;
    document.getElementById("member-reg").value = m.reg_code;
    document.getElementById("member-email").value = m.email;
    document.getElementById("member-role").value = m.role;
    document.getElementById("member-dept").value = m.department;
  }
  openModal("modal-member");
}

async function handleMemberSubmit(e) {
  e.preventDefault();
  const idVal = document.getElementById("member-id").value;
  const payload = {
    full_name: document.getElementById("member-name").value.trim(),
    reg_code: document.getElementById("member-reg").value.trim(),
    email: document.getElementById("member-email").value.trim(),
    role: document.getElementById("member-role").value,
    department: document.getElementById("member-dept").value.trim()
  };

  try {
    const res = idVal
      ? await apiRequest(`/members/${idVal}`, { method: "PUT", body: JSON.stringify(payload) })
      : await apiRequest("/members", { method: "POST", body: JSON.stringify(payload) });

    logSQL(res.sql);
    showToast(idVal ? "Member Updated in MySQL" : "Member Inserted in MySQL", payload.full_name);
    closeModal("modal-member");
    await refreshFromMySQL();
  } catch (err) {
    logSQL(err.sql || `-- ERROR: ${err.message}`, "ERROR");
    showToast(err.title || "Error", err.message, "error");
  }
}

async function deleteMember(memberId) {
  const m = state.members.find((x) => x.member_id === memberId);
  if (!m) return;

  try {
    const res = await apiRequest(`/members/${memberId}`, { method: "DELETE" });
    logSQL(res.sql);
    showToast("Member Deleted from MySQL", `${m.full_name} removed.`);
    await refreshFromMySQL();
  } catch (err) {
    logSQL(err.sql || `-- ERROR: ${err.message}`, "ERROR");
    showToast(err.title || "Delete Blocked", err.message, "error");
  }
}

function openIssueModal() {
  const bookSel = document.getElementById("issue-book-id");
  const memSel = document.getElementById("issue-member-id");

  bookSel.innerHTML = state.books
    .map(
      (b) =>
        `<option value="${b.book_id}" ${b.available_copies === 0 ? "disabled" : ""}>${escapeHTML(
          b.title
        )} (${b.available_copies}/${b.total_copies} avail)</option>`
    )
    .join("");

  memSel.innerHTML = state.members
    .map((m) => {
      const active = getActiveLoansForMember(m.member_id).length;
      const limit = getBorrowLimit(m.role);
      return `<option value="${m.member_id}">${escapeHTML(m.full_name)} · ${m.role} (${active}/${limit} borrowed)</option>`;
    })
    .join("");

  document.getElementById("issue-date").value = todayISO();
  document.getElementById("issue-due-date").value = addDays(new Date(), 14);
  openModal("modal-issue");
}

async function handleIssueSubmit(e) {
  e.preventDefault();
  const payload = {
    book_id: Number(document.getElementById("issue-book-id").value),
    member_id: Number(document.getElementById("issue-member-id").value),
    issue_date: document.getElementById("issue-date").value,
    due_date: document.getElementById("issue-due-date").value
  };

  if (daysBetween(payload.issue_date, payload.due_date) < 1) {
    showToast("Invalid Dates", "Due date must be after the issue date.", "error");
    return;
  }

  try {
    const res = await apiRequest("/transactions/issue", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    logSQL(res.sql);
    showToast("Book Issued in MySQL", res.message);
    closeModal("modal-issue");
    await refreshFromMySQL();
  } catch (err) {
    logSQL(err.sql || `-- ERROR: ${err.message}`, "ERROR");
    showToast(err.title || "Issue Failed", err.message, "error");
  }
}

async function returnBook(txId) {
  try {
    const res = await apiRequest(`/transactions/${txId}/return`, { method: "POST" });
    logSQL(res.sql);
    showToast(
      "Book Returned in MySQL",
      res.fine_amount > 0
        ? `Returned "${res.book_title}". Fine recorded: ₹${res.fine_amount}.`
        : `Returned "${res.book_title}" on time (₹0 fine).`
    );
    await refreshFromMySQL();
  } catch (err) {
    logSQL(err.sql || `-- ERROR: ${err.message}`, "ERROR");
    showToast("Return Failed", err.message, "error");
  }
}

// ---------- DBMS Workbench: Live MySQL Preset Queries ----------
async function initPresetQueries() {
  const container = document.getElementById("preset-buttons");
  try {
    const reports = await apiRequest("/reports");
    container.innerHTML = reports
      .map((r) => `<button class="preset-btn" data-preset="${r.id}">${escapeHTML(r.label)}</button>`)
      .join("");

    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".preset-btn");
      if (!btn) return;
      runPresetQuery(Number(btn.dataset.preset));
    });

    await runPresetQuery(0);
  } catch (_err) {
    container.innerHTML = `<span class="muted">Start the Node.js server to run live MySQL reports.</span>`;
  }
}

async function runPresetQuery(index) {
  activeReportIndex = index;
  document.querySelectorAll(".preset-btn").forEach((b, i) => {
    b.classList.toggle("active", i === index);
  });

  try {
    const res = await apiRequest(`/reports/${index}`);
    document.getElementById("active-sql-code").innerHTML = highlightSQL(res.sql);

    const table = document.getElementById("sql-result-table");
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    if (!res.rows.length) {
      thead.innerHTML = "";
      tbody.innerHTML = `<tr><td class="muted" style="padding:16px;text-align:center;">MySQL query returned 0 rows.</td></tr>`;
      return;
    }

    const cols = Object.keys(res.rows[0]);
    thead.innerHTML = `<tr>${cols.map((c) => `<th>${escapeHTML(c)}</th>`).join("")}</tr>`;
    tbody.innerHTML = res.rows
      .map(
        (r) =>
          `<tr>${cols.map((c) => `<td class="mono">${escapeHTML(r[c])}</td>`).join("")}</tr>`
      )
      .join("");
  } catch (err) {
    showToast("SQL Report Error", err.message, "error");
  }
}

// ---------- Export Live SQL Dump ----------
function exportLiveSQL() {
  const esc = (s) => String(s).replace(/'/g, "''");
  const lines = [
    "-- LibraDB Live MySQL Data Export",
    `-- Generated: ${new Date().toISOString()}`,
    "USE libradb;",
    "",
    "-- BOOKS"
  ];

  state.books.forEach((b) => {
    lines.push(
      `INSERT INTO BOOKS VALUES (${b.book_id}, '${esc(b.isbn)}', '${esc(b.title)}', '${esc(b.author)}', '${esc(b.category)}', ${b.total_copies}, ${b.available_copies});`
    );
  });

  lines.push("", "-- MEMBERS");
  state.members.forEach((m) => {
    lines.push(
      `INSERT INTO MEMBERS VALUES (${m.member_id}, '${esc(m.reg_code)}', '${esc(m.full_name)}', '${esc(m.email)}', '${esc(m.role)}', '${esc(m.department)}', '${m.joined_date}');`
    );
  });

  lines.push("", "-- TRANSACTIONS");
  state.transactions.forEach((t) => {
    const ret = t.return_date ? `'${t.return_date}'` : "NULL";
    lines.push(
      `INSERT INTO TRANSACTIONS VALUES (${t.tx_id}, ${t.book_id}, ${t.member_id}, '${t.issue_date}', '${t.due_date}', ${ret}, ${Number(t.fine_amount || 0).toFixed(2)});`
    );
  });

  const blob = new Blob([lines.join("\n")], { type: "text/sql" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "libradb_live_dump.sql";
  a.click();
  URL.revokeObjectURL(url);
  showToast("SQL Exported", "Downloaded libradb_live_dump.sql");
}

// ---------- Wire Up Events ----------
document.addEventListener("DOMContentLoaded", async () => {
  const savedTheme = localStorage.getItem("libradb_theme");
  if (savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    document.getElementById("theme-icon").textContent = "☀️";
  }

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.querySelectorAll("[data-jump]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.jump));
  });
  document.getElementById("btn-menu-toggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
  document.getElementById("btn-theme-toggle").addEventListener("click", toggleTheme);

  document.querySelectorAll("[data-chart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentChartType = btn.dataset.chart;
      document.querySelectorAll("[data-chart]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderChart();
    });
  });

  document.getElementById("books-search").addEventListener("input", renderBooksTable);
  document.getElementById("books-category-filter").addEventListener("change", renderBooksTable);
  document.getElementById("books-stock-filter").addEventListener("change", renderBooksTable);
  document.getElementById("members-search").addEventListener("input", renderMembersTable);
  document.getElementById("members-role-filter").addEventListener("change", renderMembersTable);
  document.getElementById("tx-search").addEventListener("input", renderTransactionsTable);

  document.querySelectorAll("#tx-filter-tabs .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTxFilter = btn.dataset.txFilter;
      document.querySelectorAll("#tx-filter-tabs .seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTransactionsTable();
    });
  });

  document.getElementById("btn-add-book").addEventListener("click", () => openBookModal());
  document.getElementById("btn-add-member").addEventListener("click", () => openMemberModal());
  document.getElementById("btn-quick-issue").addEventListener("click", openIssueModal);
  document.getElementById("btn-issue-book-tab").addEventListener("click", openIssueModal);
  document.getElementById("btn-export-sql").addEventListener("click", exportLiveSQL);
  document.getElementById("btn-clear-log").addEventListener("click", () => {
    state.logs = [];
    renderSQLLog();
  });
  document.getElementById("btn-reset-db").addEventListener("click", async () => {
    if (!confirm("Reset live MySQL tables back to the default college seed dataset?")) return;
    try {
      const res = await apiRequest("/reset", { method: "POST" });
      logSQL(res.sql);
      await refreshFromMySQL();
      showToast("MySQL Reset", "Default seed data restored in libradb.");
    } catch (err) {
      showToast("Reset Failed", err.message, "error");
    }
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.classList.remove("open");
    });
  });

  document.getElementById("form-book").addEventListener("submit", handleBookSubmit);
  document.getElementById("form-member").addEventListener("submit", handleMemberSubmit);
  document.getElementById("form-issue").addEventListener("submit", handleIssueSubmit);

  logSQL("-- Connected frontend to Node.js + MySQL REST API (http://localhost:3000/api)");
  await refreshFromMySQL();
  await initPresetQueries();
});