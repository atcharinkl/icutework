// db.js — PostgreSQL version (Neon)
require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ── ตาราง employees ─────────────────────────────────────────
async function findByLineId(lineUserId) {
  const res = await pool.query(
    `SELECT e.*, s.start_time, s.end_time, s.late_minutes
     FROM employees e
     JOIN shift_schedules s ON e.shift_id = s.id
     WHERE e.line_user_id = $1`,
    [lineUserId]
  )
  return res.rows[0] || null
}

async function getAllEmployees() {
  const res = await pool.query(
    `SELECT e.*, d.name AS dept_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     ORDER BY e.name`
  )
  return res.rows
}

// ── ตาราง check_ins ──────────────────────────────────────────
async function getTodayCheckIn(employeeId) {
  const res = await pool.query(
    `SELECT * FROM check_ins
     WHERE employee_id = $1 AND DATE(checkin_time) = CURRENT_DATE`,
    [employeeId]
  )
  return res.rows[0] || null
}

async function createCheckIn({ employee_id, checkin_time, checkin_type, lat, lng }) {
  const res = await pool.query(
    `INSERT INTO check_ins (employee_id, checkin_time, checkin_type, lat, lng)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [employee_id, checkin_time, checkin_type, lat || null, lng || null]
  )
  return res.rows[0].id
}

async function updateCheckOut(employeeId, checkoutTime) {
  await pool.query(
    `UPDATE check_ins SET checkout_time = $1
     WHERE employee_id = $2 AND DATE(checkin_time) = CURRENT_DATE`,
    [checkoutTime, employeeId]
  )
}

async function getTodaySummary() {
  const res = await pool.query(
    `SELECT e.name, e.employee_code, d.name AS dept,
            c.checkin_time, c.checkout_time, c.checkin_type, c.lat, c.lng
     FROM employees e
     LEFT JOIN check_ins c ON e.id = c.employee_id AND DATE(c.checkin_time) = CURRENT_DATE
     LEFT JOIN departments d ON e.department_id = d.id
     ORDER BY c.checkin_time ASC NULLS LAST`
  )
  return res.rows
}

async function getDepartment(departmentId) {
  const res = await pool.query('SELECT * FROM departments WHERE id = $1', [departmentId])
  return res.rows[0] || null
}

// ── สร้างตาราง (รันครั้งแรกเท่านั้น) ───────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      manager_line_id VARCHAR(100)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shift_schedules (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      start_time TIME NOT NULL DEFAULT '08:30:00',
      end_time   TIME NOT NULL DEFAULT '17:30:00',
      late_minutes INT NOT NULL DEFAULT 15
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      line_user_id VARCHAR(100) UNIQUE,
      name VARCHAR(100) NOT NULL,
      employee_code VARCHAR(20),
      department_id INT REFERENCES departments(id),
      shift_id INT REFERENCES shift_schedules(id) DEFAULT 1,
      status VARCHAR(10) DEFAULT 'active'
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS check_ins (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id),
      checkin_time  TIMESTAMP NOT NULL,
      checkout_time TIMESTAMP,
      checkin_type  VARCHAR(10) DEFAULT 'on_time',
      lat DECIMAL(10,7),
      lng DECIMAL(10,7),
      note TEXT
    )
  `)

  // ข้อมูลตัวอย่าง — แยกเป็นทีละ query เพื่อความเข้ากันได้กับ PostgreSQL
  const { rows } = await pool.query('SELECT id FROM shift_schedules LIMIT 1')
  if (rows.length === 0) {
    await pool.query(`INSERT INTO shift_schedules (name, start_time, end_time, late_minutes) VALUES ('กะปกติ','08:30:00','17:30:00',15)`)
    await pool.query(`INSERT INTO departments (name) VALUES ('IT')`)
    await pool.query(`INSERT INTO departments (name) VALUES ('HR')`)
    await pool.query(`INSERT INTO departments (name) VALUES ('การตลาด')`)
  }
  console.log('✅ Database พร้อมใช้งาน')
}

module.exports = { findByLineId, getAllEmployees, getTodayCheckIn, createCheckIn, updateCheckOut, getTodaySummary, getDepartment, initDB, pool }
