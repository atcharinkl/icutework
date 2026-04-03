// db.js — จัดการ Database
require('dotenv').config()
const mysql = require('mysql2/promise')

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
})

// ── ตาราง employees ─────────────────────────────────────────
async function findByLineId(lineUserId) {
  const [rows] = await pool.query(
    'SELECT e.*, s.start_time, s.end_time, s.late_minutes FROM employees e JOIN shift_schedules s ON e.shift_id = s.id WHERE e.line_user_id = ?',
    [lineUserId]
  )
  return rows[0] || null
}

async function getAllEmployees() {
  const [rows] = await pool.query(
    `SELECT e.*, d.name AS dept_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     ORDER BY e.name`
  )
  return rows
}

// ── ตาราง check_ins ──────────────────────────────────────────
async function getTodayCheckIn(employeeId) {
  const today = new Date().toISOString().slice(0, 10)
  const [rows] = await pool.query(
    'SELECT * FROM check_ins WHERE employee_id = ? AND DATE(checkin_time) = ?',
    [employeeId, today]
  )
  return rows[0] || null
}

async function createCheckIn({ employee_id, checkin_time, checkin_type, lat, lng }) {
  const [result] = await pool.query(
    'INSERT INTO check_ins (employee_id, checkin_time, checkin_type, lat, lng) VALUES (?, ?, ?, ?, ?)',
    [employee_id, checkin_time, checkin_type, lat || null, lng || null]
  )
  return result.insertId
}

async function updateCheckOut(employeeId, checkoutTime) {
  const today = new Date().toISOString().slice(0, 10)
  await pool.query(
    'UPDATE check_ins SET checkout_time = ? WHERE employee_id = ? AND DATE(checkin_time) = ?',
    [checkoutTime, employeeId, today]
  )
}

async function getTodaySummary() {
  const today = new Date().toISOString().slice(0, 10)
  const [rows] = await pool.query(
    `SELECT
       e.name, e.employee_code, d.name AS dept,
       c.checkin_time, c.checkout_time, c.checkin_type, c.lat, c.lng
     FROM employees e
     LEFT JOIN check_ins c ON e.id = c.employee_id AND DATE(c.checkin_time) = ?
     LEFT JOIN departments d ON e.department_id = d.id
     ORDER BY c.checkin_time ASC`,
    [today]
  )
  return rows
}

async function getDepartment(departmentId) {
  const [rows] = await pool.query('SELECT * FROM departments WHERE id = ?', [departmentId])
  return rows[0] || null
}

// ── สร้างตาราง (รันครั้งแรกเท่านั้น) ───────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      manager_line_id VARCHAR(100)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shift_schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      start_time TIME NOT NULL DEFAULT '08:30:00',
      end_time   TIME NOT NULL DEFAULT '17:30:00',
      late_minutes INT NOT NULL DEFAULT 15
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id INT AUTO_INCREMENT PRIMARY KEY,
      line_user_id VARCHAR(100) UNIQUE,
      name VARCHAR(100) NOT NULL,
      employee_code VARCHAR(20),
      department_id INT,
      shift_id INT DEFAULT 1,
      status ENUM('active','inactive') DEFAULT 'active',
      FOREIGN KEY (department_id) REFERENCES departments(id),
      FOREIGN KEY (shift_id)      REFERENCES shift_schedules(id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS check_ins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL,
      checkin_time  DATETIME NOT NULL,
      checkout_time DATETIME,
      checkin_type  ENUM('on_time','late','early') DEFAULT 'on_time',
      lat DECIMAL(10,7),
      lng DECIMAL(10,7),
      note TEXT,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )
  `)

  // ข้อมูลตัวอย่าง
  const [shifts] = await pool.query('SELECT id FROM shift_schedules LIMIT 1')
  if (shifts.length === 0) {
    await pool.query(`INSERT INTO shift_schedules (name, start_time, end_time, late_minutes) VALUES ('กะปกติ','08:30:00','17:30:00',15)`)
    await pool.query(`INSERT INTO departments (name) VALUES ('IT'),('HR'),('การตลาด')`)
  }
  console.log('✅ Database พร้อมใช้งาน')
}

module.exports = { findByLineId, getAllEmployees, getTodayCheckIn, createCheckIn, updateCheckOut, getTodaySummary, getDepartment, initDB, pool }
