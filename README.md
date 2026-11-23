# LibraDB — University Library Management System

A full-stack DBMS web app for university library management built with **HTML, CSS, JavaScript, Node.js (Express), and MySQL** using a **3NF relational schema**.

## Features
- **Dashboard & Charts:** Live KPIs (books, active loans, members, overdue fines in `₹`) and interactive Chart.js category charts (Bar/Doughnut).
- **Books & Members CRUD:** Search, filter, add, edit, and delete records with live MySQL persistence and role-based borrow limits (Students: 3, Faculty: 5).
- **Circulation & Fines:** Transactional issue/return workflow with automatic stock updates and configurable overdue fines (default `₹5/day`).
- **DBMS Workbench:** Interactive SVG ER diagram, 6 live SQL analytical reports (`INNER JOIN`, `LEFT JOIN`, `GROUP BY`, `CASE`), real-time SQL query log, and `.sql` backup export.

## Tech Stack
- **Frontend:** HTML5, CSS3 (Light/Dark theme), Vanilla JavaScript, Chart.js
- **Backend:** Node.js, Express.js, `mysql2`, `cors`, `dotenv`
- **Database:** MySQL 8.0+ (3NF tables, Foreign Keys, Triggers, Views)

## Database Schema (3NF)
- **`BOOKS`** — Book inventory with `UNIQUE(isbn)` and stock `CHECK` constraints.
- **`MEMBERS`** — Student and faculty records with `UNIQUE(reg_code)` and `UNIQUE(email)`.
- **`TRANSACTIONS`** — Circulation records linked via `FOREIGN KEY ... ON DELETE RESTRICT`, supported by stock triggers (`trg_after_issue_book`, `trg_after_return_book`) and reporting views (`v_overdue_loans`, `v_category_summary`).

## Quick Setup
1. **Load the database** in MySQL:
   ```sql
   mysql -u root -p
   SOURCE libradb_schema.sql;
   ```
2. **Configure `.env`:** Copy `.env.example` to `.env` and enter your local MySQL `DB_PASSWORD`.
3. **Install & start the server:**
   ```bash
   npm install
   npm start
   ```
   *(On Windows PowerShell, use `npm.cmd install` and `npm.cmd start` if scripts are blocked.)*
4. **Open the app** at `http://localhost:3000`.