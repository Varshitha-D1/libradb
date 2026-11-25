# LibraDB – University Library Management System

A full-stack **University Library Management System** developed as a DBMS project using **HTML, CSS, JavaScript, Node.js (Express), and MySQL**. The system follows a **Third Normal Form (3NF) relational database design** to ensure data consistency, reduce redundancy, and maintain efficient data management.

## ✨ Features

- **Dashboard & Analytics:** Displays live KPIs, including total books, active loans, registered members, and overdue fines (₹). Includes interactive Chart.js category charts with Bar and Doughnut visualizations.
- **Books & Members Management:** Supports searching, filtering, adding, editing, and deleting records with live MySQL database integration. Implements role-based borrowing limits:
  - Students: Maximum 3 active books.
  - Faculty: Maximum 5 active books.
- **Book Circulation & Fine Management:** Provides book issue and return functionality with automatic stock updates and overdue fine calculation at a default rate of **₹5 per day**.
- **DBMS Workbench:** Features an interactive SVG-based ER diagram, six SQL analytical reports, a real-time SQL query activity log, and SQL data export functionality.

## 🛠️ Technology Stack

| Component | Technologies |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript, Chart.js |
| Backend | Node.js, Express.js |
| Database | MySQL 8.0+ |
| Dependencies | mysql2, cors, dotenv |
| Database Design | 3NF, Primary Keys, Foreign Keys, Constraints, Triggers, and Views |

## 🗄️ Database Schema (3NF)

The database is organized into three primary relational tables:

- **`BOOKS`** – Stores book inventory details with unique ISBN constraints and stock validation.
- **`MEMBERS`** – Maintains student and faculty information with unique registration codes and email addresses.
- **`TRANSACTIONS`** – Records book issue and return activities, connecting books and members through foreign keys with `ON DELETE RESTRICT`.

### Database Components

- **Triggers:**
  - `trg_after_issue_book` – Automatically updates available book copies when a book is issued.
  - `trg_after_return_book` – Updates available book copies when a book is returned.
- **Views:**
  - `v_overdue_loans` – Provides information about overdue book transactions.
  - `v_category_summary` – Provides category-wise book inventory summaries.

## ⚙️ Installation & Setup

Follow these steps to configure and run LibraDB locally.

### Prerequisites

Make sure the following software is installed:

- Node.js and npm
- MySQL Server 8.0 or later
- MySQL Workbench (recommended)
- A modern web browser

### Step 1: Set Up the Database

Open MySQL Workbench, connect to your MySQL server, and execute the `libradb_schema.sql` file.

Alternatively, use the MySQL command line:

```bash
mysql -u root -p < libradb_schema.sql
```

This creates the `libradb` database along with its tables, sample records, triggers, and views.

### Step 2: Configure Environment Variables

Create a `.env` file in the project root directory and add your MySQL configuration:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=libradb
PORT=3000
```

Replace `your_mysql_password` with your actual MySQL password.

### Step 3: Install Dependencies

Open a terminal in the project directory and execute:

```bash
npm install
```

### Step 4: Start the Application

Run the following command:

```bash
npm start
```

**Windows PowerShell users:** If script execution is restricted, use:

```bash
npm.cmd install
npm.cmd start
```

### Step 5: Access the Application

Once the server starts successfully, open your browser and navigate to:

**http://localhost:3000**

The LibraDB application is now ready to use.

---

## 📌 Project Highlights

- Normalized relational database design using **3NF**.
- Real-time MySQL database integration.
- Automated book stock management using triggers.
- Role-based borrowing limits.
- SQL-based analytical reports.
- Interactive dashboard and database visualization.

---

**Project:** LibraDB – University Library Management System  
**Database:** MySQL 8.0+  
**Backend:** Node.js & Express.js  
**Frontend:** HTML, CSS & JavaScript