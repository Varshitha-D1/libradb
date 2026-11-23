-- ============================================================================
-- LibraDB — University Library Management System (3NF Relational Database)
-- Compatible with MySQL 8.0+ (for PostgreSQL, replace AUTO_INCREMENT & DATEDIFF)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS libradb;
USE libradb;

-- Clean reset order (child table first due to Foreign Key constraints)
DROP VIEW IF EXISTS v_overdue_loans;
DROP VIEW IF EXISTS v_category_summary;
DROP TRIGGER IF EXISTS trg_after_issue_book;
DROP TRIGGER IF EXISTS trg_after_return_book;
DROP TABLE IF EXISTS TRANSACTIONS;
DROP TABLE IF EXISTS MEMBERS;
DROP TABLE IF EXISTS BOOKS;

-- ============================================================================
-- 1. DDL: TABLES IN THIRD NORMAL FORM (3NF)
-- ============================================================================

CREATE TABLE BOOKS (
    book_id          INT PRIMARY KEY AUTO_INCREMENT,
    isbn             VARCHAR(20)  NOT NULL UNIQUE,
    title            VARCHAR(150) NOT NULL,
    author           VARCHAR(100) NOT NULL,
    category         VARCHAR(50)  NOT NULL,
    total_copies     INT          NOT NULL,
    available_copies INT          NOT NULL,
    CONSTRAINT chk_total_copies     CHECK (total_copies >= 1),
    CONSTRAINT chk_available_copies CHECK (available_copies >= 0 AND available_copies <= total_copies)
);

CREATE TABLE MEMBERS (
    member_id   INT PRIMARY KEY AUTO_INCREMENT,
    reg_code    VARCHAR(20)  NOT NULL UNIQUE,
    full_name   VARCHAR(100) NOT NULL,
    email       VARCHAR(120) NOT NULL UNIQUE,
    role        VARCHAR(20)  NOT NULL,
    department  VARCHAR(60)  NOT NULL,
    joined_date DATE         NOT NULL DEFAULT (CURRENT_DATE),
    CONSTRAINT chk_member_role CHECK (role IN ('Student', 'Faculty'))
);

CREATE TABLE TRANSACTIONS (
    tx_id       INT PRIMARY KEY AUTO_INCREMENT,
    book_id     INT           NOT NULL,
    member_id   INT           NOT NULL,
    issue_date  DATE          NOT NULL,
    due_date    DATE          NOT NULL,
    return_date DATE          NULL,
    fine_amount DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    CONSTRAINT fk_tx_book   FOREIGN KEY (book_id)   REFERENCES BOOKS(book_id)     ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tx_member FOREIGN KEY (member_id) REFERENCES MEMBERS(member_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_dates    CHECK (due_date >= issue_date),
    CONSTRAINT chk_fine     CHECK (fine_amount >= 0)
);

-- Indexes for faster JOIN and search performance
CREATE INDEX idx_books_category   ON BOOKS(category);
CREATE INDEX idx_tx_book_id       ON TRANSACTIONS(book_id);
CREATE INDEX idx_tx_member_id     ON TRANSACTIONS(member_id);
CREATE INDEX idx_tx_return_date   ON TRANSACTIONS(return_date);

-- ============================================================================
-- 2. DML: SEED DATA (10 Books, 6 Members, 7 Circulation Records)
-- ============================================================================

INSERT INTO BOOKS (book_id, isbn, title, author, category, total_copies, available_copies) VALUES
(101, '978-0078022159', 'Database System Concepts',                 'Abraham Silberschatz', 'Computer Science', 4, 2),
(102, '978-0138147570', 'Signals and Systems',                      'Alan V. Oppenheim',    'Electronics',      3, 2),
(103, '978-0262046305', 'Introduction to Algorithms',               'Thomas H. Cormen',     'Computer Science', 2, 0),
(104, '978-0073380643', 'Microelectronic Circuits',                 'Adel S. Sedra',        'Electronics',      5, 4),
(105, '978-0133594140', 'Computer Networking: A Top-Down Approach', 'James Kurose',         'Computer Science', 3, 3),
(106, '978-8126554232', 'Higher Engineering Mathematics',           'B. S. Grewal',         'Mathematics',      6, 6),
(107, '978-0134093413', 'Operating System Concepts',                'Greg Gagne',           'Computer Science', 4, 4),
(108, '978-1107014176', 'Introduction to Electrodynamics',          'David J. Griffiths',   'Physics',          3, 3),
(109, '978-8173711466', 'Wings of Fire',                            'A. P. J. Abdul Kalam', 'Literature',       4, 4),
(110, '978-0132126953', 'Engineering Economics',                    'William G. Sullivan',  'Management',       2, 2);

INSERT INTO MEMBERS (member_id, reg_code, full_name, email, role, department, joined_date) VALUES
(201, 'ECE23B014',  'Aarav Sharma',          'aarav.sharma@college.edu.in', 'Student', 'ECE',         '2024-08-10'),
(202, 'CSE23B042',  'Diya Nair',             'diya.nair@college.edu.in',    'Student', 'CSE',         '2024-08-12'),
(203, 'ECE22B088',  'Rohan Kulkarni',        'rohan.k@college.edu.in',      'Student', 'ECE',         '2023-08-15'),
(204, 'FAC-CSE-09', 'Dr. Meera Iyer',        'meera.iyer@college.edu.in',   'Faculty', 'CSE',         '2021-07-01'),
(205, 'FAC-ECE-04', 'Prof. Vikram Deshmukh', 'vikram.d@college.edu.in',     'Faculty', 'ECE',         '2020-01-15'),
(206, 'MAT24B019',  'Ananya Chatterjee',     'ananya.c@college.edu.in',     'Student', 'Mathematics', '2025-08-05');

INSERT INTO TRANSACTIONS (tx_id, book_id, member_id, issue_date, due_date, return_date, fine_amount) VALUES
(5001, 103, 201, DATE_SUB(CURRENT_DATE, INTERVAL 22 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 8 DAY),  NULL, 0.00),
(5002, 101, 202, DATE_SUB(CURRENT_DATE, INTERVAL 19 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 5 DAY),  NULL, 0.00),
(5003, 103, 204, DATE_SUB(CURRENT_DATE, INTERVAL 5 DAY),  DATE_ADD(CURRENT_DATE, INTERVAL 9 DAY),  NULL, 0.00),
(5004, 102, 203, DATE_SUB(CURRENT_DATE, INTERVAL 3 DAY),  DATE_ADD(CURRENT_DATE, INTERVAL 11 DAY), NULL, 0.00),
(5005, 104, 205, DATE_SUB(CURRENT_DATE, INTERVAL 2 DAY),  DATE_ADD(CURRENT_DATE, INTERVAL 12 DAY), NULL, 0.00),
(5006, 101, 204, DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY),  DATE_ADD(CURRENT_DATE, INTERVAL 13 DAY), NULL, 0.00),
(5007, 105, 202, DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 16 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 14 DAY), 10.00);

-- ============================================================================
-- 3. TRIGGERS (Automatic Stock Maintenance on Issue & Return)
-- ============================================================================

DELIMITER //

CREATE TRIGGER trg_after_issue_book
AFTER INSERT ON TRANSACTIONS
FOR EACH ROW
BEGIN
    IF NEW.return_date IS NULL THEN
        UPDATE BOOKS
        SET available_copies = available_copies - 1
        WHERE book_id = NEW.book_id;
    END IF;
END //

CREATE TRIGGER trg_after_return_book
AFTER UPDATE ON TRANSACTIONS
FOR EACH ROW
BEGIN
    IF OLD.return_date IS NULL AND NEW.return_date IS NOT NULL THEN
        UPDATE BOOKS
        SET available_copies = available_copies + 1
        WHERE book_id = NEW.book_id;
    END IF;
END //

DELIMITER ;

-- ============================================================================
-- 4. VIEWS FOR REPORTING
-- ============================================================================

CREATE VIEW v_overdue_loans AS
SELECT
    t.tx_id,
    b.title AS book_title,
    m.reg_code,
    m.full_name,
    t.due_date,
    DATEDIFF(CURRENT_DATE, t.due_date) AS overdue_days,
    (DATEDIFF(CURRENT_DATE, t.due_date) * 5.00) AS pending_fine_inr
FROM TRANSACTIONS t
INNER JOIN BOOKS b   ON t.book_id = b.book_id
INNER JOIN MEMBERS m ON t.member_id = m.member_id
WHERE t.return_date IS NULL
  AND t.due_date < CURRENT_DATE;

CREATE VIEW v_category_summary AS
SELECT
    category,
    COUNT(*) AS distinct_titles,
    SUM(total_copies) AS total_copies,
    SUM(available_copies) AS available_copies
FROM BOOKS
GROUP BY category;

-- ============================================================================
-- 5. SAMPLE VIVA / ANALYTICAL QUERIES
-- ============================================================================

-- Q1: View all currently overdue loans and pending fines (₹5/day)
SELECT * FROM v_overdue_loans ORDER BY pending_fine_inr DESC;

-- Q2: Category-wise inventory distribution
SELECT * FROM v_category_summary ORDER BY total_copies DESC;

-- Q3: Books that have never been borrowed (LEFT JOIN)
SELECT b.book_id, b.title, b.category, b.available_copies
FROM BOOKS b
LEFT JOIN TRANSACTIONS t ON b.book_id = t.book_id
WHERE t.tx_id IS NULL;

-- Q4: Top borrowers across all time
SELECT m.reg_code, m.full_name, m.role, COUNT(t.tx_id) AS total_loans
FROM MEMBERS m
LEFT JOIN TRANSACTIONS t ON m.member_id = t.member_id
GROUP BY m.member_id, m.reg_code, m.full_name, m.role
ORDER BY total_loans DESC;

-- Q5: Currently out-of-stock books
SELECT book_id, isbn, title, total_copies
FROM BOOKS
WHERE available_copies = 0;

-- Q6: Member borrow quota utilization using CASE
SELECT
    m.full_name,
    m.role,
    COUNT(t.tx_id) AS active_loans,
    CASE WHEN m.role = 'Faculty' THEN 5 ELSE 3 END AS max_quota
FROM MEMBERS m
LEFT JOIN TRANSACTIONS t
       ON m.member_id = t.member_id AND t.return_date IS NULL
GROUP BY m.member_id, m.full_name, m.role;