/* ==========================================================================
   LibraDB — Node.js + Express + MySQL Backend Server
   Connects the LibraDB frontend directly to your local MySQL database.
   ========================================================================== */

require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const FINE_PER_DAY = 5;

app.use(cors());
app.use(express.json());
// Serve index.html, styles.css, and app.js directly from this folder
app.use(express.static(path.join(__dirname)));

// MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "libradb",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,     // Return DATE columns as 'YYYY-MM-DD' strings
  decimalNumbers: true   // Return DECIMAL columns as JS numbers
});

// Helper: Check if a MySQL trigger already exists in the active schema
async function hasTrigger(conn, triggerName) {
  const [rows] = await conn.query(
    `SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`,
    [triggerName]
  );
  return rows.length > 0;
}

// Helper: Format SQL string cleanly for the DBMS Workbench live log
function formatLogSQL(sql, params = []) {
  let idx = 0;
  return sql.replace(/\?/g, () => {
    const val = params[idx++];
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "number") return String(val);
    return `'${String(val).replace(/'/g, "''")}'`;
  });
}

// ---------- Health Check ----------
app.get("/api/health", async (_req, res) => {
  try {
    const [[row]] = await pool.query("SELECT DATABASE() AS db, VERSION() AS version");
    res.json({ ok: true, db: row.db, version: row.version });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Full Live State (Books, Members, Transactions) ----------
app.get("/api/state", async (_req, res) => {
  try {
    const [books] = await pool.query("SELECT * FROM BOOKS ORDER BY book_id ASC");
    const [members] = await pool.query("SELECT * FROM MEMBERS ORDER BY member_id ASC");
    const [transactions] = await pool.query(
      "SELECT * FROM TRANSACTIONS ORDER BY tx_id DESC"
    );
    res.json({ books, members, transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- BOOKS CRUD ----------
app.post("/api/books", async (req, res) => {
  const { isbn, title, author, category, total_copies } = req.body;
  const total = Number(total_copies);
  const sql =
    "INSERT INTO BOOKS (isbn, title, author, category, total_copies, available_copies) VALUES (?, ?, ?, ?, ?, ?)";
  const params = [isbn, title, author, category, total, total];

  try {
    const [result] = await pool.query(sql, params);
    res.status(201).json({
      book_id: result.insertId,
      sql: formatLogSQL(sql, params) + ";"
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        title: "UNIQUE Constraint Violation",
        error: `ISBN '${isbn}' already exists in BOOKS.`,
        sql: `-- ERROR 1062 (23000): Duplicate entry for UNIQUE(isbn)\n${formatLogSQL(sql, params)};`
      });
    }
    res.status(400).json({
      title: "MySQL Error",
      error: err.sqlMessage || err.message,
      sql: `-- ERROR: ${err.sqlMessage || err.message}`
    });
  }
});

app.put("/api/books/:id", async (req, res) => {
  const bookId = Number(req.params.id);
  const { isbn, title, author, category, total_copies } = req.body;
  const newTotal = Number(total_copies);

  try {
    const [[existing]] = await pool.query(
      "SELECT total_copies, available_copies FROM BOOKS WHERE book_id = ?",
      [bookId]
    );
    if (!existing) return res.status(404).json({ error: "Book not found." });

    const loaned = existing.total_copies - existing.available_copies;
    if (newTotal < loaned) {
      return res.status(400).json({
        title: "CHECK Constraint Violation",
        error: `Cannot reduce total_copies to ${newTotal}: ${loaned} copy/copies currently loaned out.`,
        sql: `-- CHECK FAILED: total_copies (${newTotal}) < active_loans (${loaned}) FOR book_id=${bookId}`
      });
    }

    const newAvailable = newTotal - loaned;
    const sql =
      "UPDATE BOOKS SET isbn = ?, title = ?, author = ?, category = ?, total_copies = ?, available_copies = ? WHERE book_id = ?";
    const params = [isbn, title, author, category, newTotal, newAvailable, bookId];
    await pool.query(sql, params);
    res.json({ ok: true, sql: formatLogSQL(sql, params) + ";" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        title: "UNIQUE Constraint Violation",
        error: `ISBN '${isbn}' already belongs to another book.`,
        sql: `-- ERROR 1062: UNIQUE(isbn) violation for '${isbn}'`
      });
    }
    res.status(400).json({ error: err.sqlMessage || err.message });
  }
});

app.delete("/api/books/:id", async (req, res) => {
  const bookId = Number(req.params.id);
  const sql = "DELETE FROM BOOKS WHERE book_id = ?";
  try {
    await pool.query(sql, [bookId]);
    res.json({ ok: true, sql: formatLogSQL(sql, [bookId]) + ";" });
  } catch (err) {
    if (err.errno === 1451 || err.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({
        title: "Foreign Key Constraint Blocked",
        error: `MySQL blocked DELETE on book_id=${bookId} due to FOREIGN KEY (fk_tx_book) ON DELETE RESTRICT.`,
        sql: `${formatLogSQL(sql, [bookId])}; -- BLOCKED BY MySQL ERROR 1451 (ON DELETE RESTRICT)`
      });
    }
    res.status(400).json({ error: err.sqlMessage || err.message });
  }
});

// ---------- MEMBERS CRUD ----------
app.post("/api/members", async (req, res) => {
  const { reg_code, full_name, email, role, department } = req.body;
  const sql =
    "INSERT INTO MEMBERS (reg_code, full_name, email, role, department, joined_date) VALUES (?, ?, ?, ?, ?, CURRENT_DATE)";
  const params = [reg_code.toUpperCase(), full_name, email.toLowerCase(), role, department];

  try {
    const [result] = await pool.query(sql, params);
    res.status(201).json({
      member_id: result.insertId,
      sql: formatLogSQL(sql, params) + ";"
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        title: "UNIQUE Constraint Violation",
        error: "A member with that Roll/Employee Code or Email already exists.",
        sql: `-- ERROR 1062: UNIQUE constraint violation\n${formatLogSQL(sql, params)};`
      });
    }
    res.status(400).json({ error: err.sqlMessage || err.message });
  }
});

app.put("/api/members/:id", async (req, res) => {
  const memberId = Number(req.params.id);
  const { reg_code, full_name, email, role, department } = req.body;
  const sql =
    "UPDATE MEMBERS SET reg_code = ?, full_name = ?, email = ?, role = ?, department = ? WHERE member_id = ?";
  const params = [
    reg_code.toUpperCase(),
    full_name,
    email.toLowerCase(),
    role,
    department,
    memberId
  ];

  try {
    await pool.query(sql, params);
    res.json({ ok: true, sql: formatLogSQL(sql, params) + ";" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        title: "UNIQUE Constraint Violation",
        error: "Duplicate Roll/Employee Code or Email.",
        sql: `-- ERROR 1062: UNIQUE constraint violation on MEMBERS`
      });
    }
    res.status(400).json({ error: err.sqlMessage || err.message });
  }
});

app.delete("/api/members/:id", async (req, res) => {
  const memberId = Number(req.params.id);
  const sql = "DELETE FROM MEMBERS WHERE member_id = ?";
  try {
    await pool.query(sql, [memberId]);
    res.json({ ok: true, sql: formatLogSQL(sql, [memberId]) + ";" });
  } catch (err) {
    if (err.errno === 1451 || err.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({
        title: "Foreign Key Constraint Blocked",
        error: `MySQL blocked DELETE on member_id=${memberId} due to FOREIGN KEY (fk_tx_member) ON DELETE RESTRICT.`,
        sql: `${formatLogSQL(sql, [memberId])}; -- BLOCKED BY MySQL ERROR 1451 (ON DELETE RESTRICT)`
      });
    }
    res.status(400).json({ error: err.sqlMessage || err.message });
  }
});

// ---------- CIRCULATION: ISSUE & RETURN ----------
app.post("/api/transactions/issue", async (req, res) => {
  const bookId = Number(req.body.book_id);
  const memberId = Number(req.body.member_id);
  const { issue_date, due_date } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[book]] = await conn.query(
      "SELECT book_id, title, available_copies FROM BOOKS WHERE book_id = ? FOR UPDATE",
      [bookId]
    );
    if (!book || book.available_copies <= 0) {
      await conn.rollback();
      return res.status(400).json({
        title: "Out of Stock",
        error: "No available copies left for this book.",
        sql: `-- CHECK FAILED: book_id=${bookId} has 0 available_copies`
      });
    }

    const [[member]] = await conn.query(
      "SELECT member_id, full_name, role FROM MEMBERS WHERE member_id = ?",
      [memberId]
    );
    if (!member) {
      await conn.rollback();
      return res.status(404).json({ error: "Member not found." });
    }

    const [[quota]] = await conn.query(
      "SELECT COUNT(*) AS active_count FROM TRANSACTIONS WHERE member_id = ? AND return_date IS NULL",
      [memberId]
    );
    const limit = member.role === "Faculty" ? 5 : 3;
    if (quota.active_count >= limit) {
      await conn.rollback();
      return res.status(400).json({
        title: "Borrow Quota Reached",
        error: `${member.full_name} (${member.role}) already holds ${quota.active_count}/${limit} active books.`,
        sql: `-- QUOTA BLOCKED: member_id=${memberId} active_loans=${quota.active_count} >= limit=${limit}`
      });
    }

    const insertSql =
      "INSERT INTO TRANSACTIONS (book_id, member_id, issue_date, due_date) VALUES (?, ?, ?, ?)";
    const insertParams = [bookId, memberId, issue_date, due_date];
    const [result] = await conn.query(insertSql, insertParams);

    const triggerExists = await hasTrigger(conn, "trg_after_issue_book");
    let stockNote = "-- Trigger trg_after_issue_book automatically decremented BOOKS.available_copies";
    if (!triggerExists) {
      await conn.query(
        "UPDATE BOOKS SET available_copies = available_copies - 1 WHERE book_id = ?",
        [bookId]
      );
      stockNote = `UPDATE BOOKS SET available_copies = available_copies - 1 WHERE book_id = ${bookId};`;
    }

    await conn.commit();
    res.status(201).json({
      tx_id: result.insertId,
      message: `"${book.title}" issued to ${member.full_name}.`,
      sql: `BEGIN;\n${formatLogSQL(insertSql, insertParams)};\n${stockNote}\nCOMMIT;`
    });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({
      title: "Transaction Failed",
      error: err.sqlMessage || err.message,
      sql: `-- ROLLBACK: ${err.sqlMessage || err.message}`
    });
  } finally {
    conn.release();
  }
});

app.post("/api/transactions/:id/return", async (req, res) => {
  const txId = Number(req.params.id);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[tx]] = await conn.query(
      `SELECT t.*, b.title AS book_title
       FROM TRANSACTIONS t
       INNER JOIN BOOKS b ON t.book_id = b.book_id
       WHERE t.tx_id = ? FOR UPDATE`,
      [txId]
    );
    if (!tx) {
      await conn.rollback();
      return res.status(404).json({ error: "Transaction not found." });
    }
    if (tx.return_date) {
      await conn.rollback();
      return res.status(400).json({ error: "Book already returned." });
    }

    const updateSql = `UPDATE TRANSACTIONS
       SET return_date = CURRENT_DATE,
           fine_amount = GREATEST(DATEDIFF(CURRENT_DATE, due_date), 0) * ?
       WHERE tx_id = ? AND return_date IS NULL`;
    await conn.query(updateSql, [FINE_PER_DAY, txId]);

    const triggerExists = await hasTrigger(conn, "trg_after_return_book");
    let stockNote = "-- Trigger trg_after_return_book automatically incremented BOOKS.available_copies";
    if (!triggerExists) {
      await conn.query(
        "UPDATE BOOKS SET available_copies = available_copies + 1 WHERE book_id = ?",
        [tx.book_id]
      );
      stockNote = `UPDATE BOOKS SET available_copies = available_copies + 1 WHERE book_id = ${tx.book_id};`;
    }

    const [[updated]] = await conn.query(
      "SELECT return_date, fine_amount FROM TRANSACTIONS WHERE tx_id = ?",
      [txId]
    );

    await conn.commit();
    res.json({
      ok: true,
      book_title: tx.book_title,
      return_date: updated.return_date,
      fine_amount: updated.fine_amount,
      sql: `BEGIN;\nUPDATE TRANSACTIONS SET return_date='${updated.return_date}', fine_amount=${updated.fine_amount} WHERE tx_id=${txId};\n${stockNote}\nCOMMIT;`
    });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.sqlMessage || err.message });
  } finally {
    conn.release();
  }
});

// ---------- DBMS WORKBENCH: LIVE MYSQL PRESET REPORTS ----------
const PRESET_REPORTS = [
  {
    label: "1. Overdue Loans (INNER JOIN)",
    sql: `SELECT t.tx_id, b.title, m.full_name, t.due_date,
       CONCAT('₹', DATEDIFF(CURRENT_DATE, t.due_date) * 5) AS pending_fine_inr
FROM TRANSACTIONS t
INNER JOIN BOOKS b ON t.book_id = b.book_id
INNER JOIN MEMBERS m ON t.member_id = m.member_id
WHERE t.return_date IS NULL AND t.due_date < CURRENT_DATE
ORDER BY DATEDIFF(CURRENT_DATE, t.due_date) DESC;`
  },
  {
    label: "2. Category Inventory (GROUP BY)",
    sql: `SELECT category, COUNT(*) AS titles,
       SUM(total_copies) AS total_copies,
       SUM(available_copies) AS available_copies
FROM BOOKS
GROUP BY category
ORDER BY total_copies DESC;`
  },
  {
    label: "3. Unborrowed Books (LEFT JOIN)",
    sql: `SELECT b.book_id, b.title, b.category, b.available_copies
FROM BOOKS b
LEFT JOIN TRANSACTIONS t ON b.book_id = t.book_id
WHERE t.tx_id IS NULL;`
  },
  {
    label: "4. Top Borrowers (COUNT + JOIN)",
    sql: `SELECT m.reg_code, m.full_name, m.role, COUNT(t.tx_id) AS total_loans
FROM MEMBERS m
LEFT JOIN TRANSACTIONS t ON m.member_id = t.member_id
GROUP BY m.member_id, m.reg_code, m.full_name, m.role
ORDER BY total_loans DESC;`
  },
  {
    label: "5. Out-of-Stock Titles",
    sql: `SELECT book_id, isbn, title, total_copies
FROM BOOKS
WHERE available_copies = 0;`
  },
  {
    label: "6. Member Quota Utilization (CASE)",
    sql: `SELECT m.full_name, m.role,
       COUNT(t.tx_id) AS active_loans,
       CASE WHEN m.role = 'Faculty' THEN 5 ELSE 3 END AS max_quota
FROM MEMBERS m
LEFT JOIN TRANSACTIONS t
       ON m.member_id = t.member_id AND t.return_date IS NULL
GROUP BY m.member_id, m.full_name, m.role;`
  }
];

app.get("/api/reports", (_req, res) => {
  res.json(PRESET_REPORTS.map((r, id) => ({ id, label: r.label })));
});

app.get("/api/reports/:id", async (req, res) => {
  const report = PRESET_REPORTS[Number(req.params.id)];
  if (!report) return res.status(404).json({ error: "Report not found." });
  try {
    const [rows] = await pool.query(report.sql);
    res.json({ label: report.label, sql: report.sql, rows });
  } catch (err) {
    res.status(500).json({ error: err.sqlMessage || err.message, sql: report.sql });
  }
});

// ---------- RESET SEED DATA IN MYSQL ----------
app.post("/api/reset", async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM TRANSACTIONS");
    await conn.query("DELETE FROM MEMBERS");
    await conn.query("DELETE FROM BOOKS");

    const triggerExists = await hasTrigger(conn, "trg_after_issue_book");

    // If trg_after_issue_book is active, insert full available_copies and let the trigger decrement on active loans
    await conn.query(`
      INSERT INTO BOOKS (book_id, isbn, title, author, category, total_copies, available_copies) VALUES
      (101, '978-0078022159', 'Database System Concepts',                 'Abraham Silberschatz', 'Computer Science', 4, ${triggerExists ? 4 : 2}),
      (102, '978-0138147570', 'Signals and Systems',                      'Alan V. Oppenheim',    'Electronics',      3, ${triggerExists ? 3 : 2}),
      (103, '978-0262046305', 'Introduction to Algorithms',               'Thomas H. Cormen',     'Computer Science', 2, ${triggerExists ? 2 : 0}),
      (104, '978-0073380643', 'Microelectronic Circuits',                 'Adel S. Sedra',        'Electronics',      5, ${triggerExists ? 5 : 4}),
      (105, '978-0133594140', 'Computer Networking: A Top-Down Approach', 'James Kurose',         'Computer Science', 3, 3),
      (106, '978-8126554232', 'Higher Engineering Mathematics',           'B. S. Grewal',         'Mathematics',      6, 6),
      (107, '978-0134093413', 'Operating System Concepts',                'Greg Gagne',           'Computer Science', 4, 4),
      (108, '978-1107014176', 'Introduction to Electrodynamics',          'David J. Griffiths',   'Physics',          3, 3),
      (109, '978-8173711466', 'Wings of Fire',                            'A. P. J. Abdul Kalam', 'Literature',       4, 4),
      (110, '978-0132126953', 'Engineering Economics',                    'William G. Sullivan',  'Management',       2, 2);
    `);

    await conn.query(`
      INSERT INTO MEMBERS (member_id, reg_code, full_name, email, role, department, joined_date) VALUES
      (201, 'ECE23B014',  'Aarav Sharma',          'aarav.sharma@college.edu.in', 'Student', 'ECE',         '2024-08-10'),
      (202, 'CSE23B042',  'Diya Nair',             'diya.nair@college.edu.in',    'Student', 'CSE',         '2024-08-12'),
      (203, 'ECE22B088',  'Rohan Kulkarni',        'rohan.k@college.edu.in',      'Student', 'ECE',         '2023-08-15'),
      (204, 'FAC-CSE-09', 'Dr. Meera Iyer',        'meera.iyer@college.edu.in',   'Faculty', 'CSE',         '2021-07-01'),
      (205, 'FAC-ECE-04', 'Prof. Vikram Deshmukh', 'vikram.d@college.edu.in',     'Faculty', 'ECE',         '2020-01-15'),
      (206, 'MAT24B019',  'Ananya Chatterjee',     'ananya.c@college.edu.in',     'Student', 'Mathematics', '2025-08-05');
    `);

    await conn.query(`
      INSERT INTO TRANSACTIONS (tx_id, book_id, member_id, issue_date, due_date, return_date, fine_amount) VALUES
      (5001, 103, 201, DATE_SUB(CURRENT_DATE, INTERVAL 22 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 8 DAY),  NULL, 0.00),
      (5002, 101, 202, DATE_SUB(CURRENT_DATE, INTERVAL 19 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 5 DAY),  NULL, 0.00),
      (5003, 103, 204, DATE_SUB(CURRENT_DATE, INTERVAL 5 DAY),  DATE_ADD(CURRENT_DATE, INTERVAL 9 DAY),  NULL, 0.00),
      (5004, 102, 203, DATE_SUB(CURRENT_DATE, INTERVAL 3 DAY),  DATE_ADD(CURRENT_DATE, INTERVAL 11 DAY), NULL, 0.00),
      (5005, 104, 205, DATE_SUB(CURRENT_DATE, INTERVAL 2 DAY),  DATE_ADD(CURRENT_DATE, INTERVAL 12 DAY), NULL, 0.00),
      (5006, 101, 204, DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY),  DATE_ADD(CURRENT_DATE, INTERVAL 13 DAY), NULL, 0.00),
      (5007, 105, 202, DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 16 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 14 DAY), 10.00);
    `);

    await conn.commit();
    res.json({
      ok: true,
      sql: "-- Reset MySQL tables (TRANSACTIONS, MEMBERS, BOOKS) to default seed data"
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.sqlMessage || err.message });
  } finally {
    conn.release();
  }
});

// Start Server
app.listen(PORT, async () => {
  console.log(`\nLibraDB Server running at http://localhost:${PORT}`);
  try {
    const [[row]] = await pool.query("SELECT DATABASE() AS db");
    console.log(`Connected to MySQL database: ${row.db}`);
  } catch (err) {
    console.error("MySQL connection failed:", err.message);
    console.error("Check your DB_PASSWORD in .env and ensure MySQL service is running.");
  }
});