// server.js — ระบบเช็คอินผ่าน LINE (โค้ดเต็ม)
require('dotenv').config()
const express = require('express')
const { Client, middleware } = require('@line/bot-sdk')
const db = require('./db')

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
}
const client = new Client(lineConfig)
const app = express()

// ── Webhook endpoint ──────────────────────────────────────────
app.post('/webhook', middleware(lineConfig), async (req, res) => {
  res.sendStatus(200) // ตอบ 200 ก่อนเสมอ
  for (const event of req.body.events) {
    try {
      if (event.type === 'message') {
        if (event.message.type === 'text')     await handleText(event)
        if (event.message.type === 'location') await handleLocation(event)
      }
    } catch (err) {
      console.error('Event error:', err)
    }
  }
})

// ── จัดการข้อความ ────────────────────────────────────────────
async function handleText(event) {
  const userId = event.source.userId
  const text   = event.message.text.trim()
  const emp    = await db.findByLineId(userId)

  // พนักงานยังไม่ได้ลงทะเบียน
  if (!emp) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `ยังไม่พบข้อมูลของคุณในระบบครับ\nกรุณาแจ้ง HR พร้อม LINE User ID ของคุณ:\n${userId}`
    })
  }

  const cmd = text.toLowerCase()
  if (cmd === 'เช็คอิน' || cmd === 'checkin')   return checkIn(event.replyToken, emp)
  if (cmd === 'เช็คเอาท์' || cmd === 'checkout') return checkOut(event.replyToken, emp)
  if (cmd === 'สถานะ' || cmd === 'status')        return sendStatus(event.replyToken, emp)
  if (cmd === 'ช่วยเหลือ' || cmd === 'help')      return sendHelp(event.replyToken, emp)

  // ไม่รู้จำคำสั่ง → แสดงเมนู
  return sendHelp(event.replyToken, emp)
}

// ── กรณีส่ง Location (GPS) ───────────────────────────────────
async function handleLocation(event) {
  const userId = event.source.userId
  const emp    = await db.findByLineId(userId)
  if (!emp) return

  const { latitude: lat, longitude: lng } = event.message

  // ตรวจสอบรัศมี 500 เมตรจากออฟฟิศ
  const OFFICE_LAT = 18.7883  // ← เปลี่ยนเป็นพิกัดออฟฟิศจริง
  const OFFICE_LNG = 98.9853
  const dist = getDistance(lat, lng, OFFICE_LAT, OFFICE_LNG)

  if (dist > 500) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `⚠️ คุณอยู่ห่างจากออฟฟิศ ${Math.round(dist)} เมตร\nกรุณาเช็คอินในพื้นที่ทำงานครับ`
    })
  }

  return checkIn(event.replyToken, emp, lat, lng)
}

// ── ฟังก์ชัน เช็คอิน ─────────────────────────────────────────
async function checkIn(replyToken, emp, lat, lng) {
  const existing = await db.getTodayCheckIn(emp.id)
  if (existing) {
    const t = formatTime(existing.checkin_time)
    return client.replyMessage(replyToken, {
      type: 'text',
      text: `คุณเช็คอินวันนี้แล้วครับ ตั้งแต่เวลา ${t} น.`
    })
  }

  const now   = new Date()
  const shift = parseTime(emp.start_time) // เวลาเริ่มกะ
  const late  = (now - shift) / 60000     // นาทีที่สาย
  const type  = late > emp.late_minutes ? 'late' : 'on_time'

  await db.createCheckIn({ employee_id: emp.id, checkin_time: now, checkin_type: type, lat, lng })

  const timeStr = formatTime(now)
  let msg
  if (type === 'on_time') {
    msg = `✅ เช็คอินสำเร็จครับ!\n👤 ${emp.name}\n🕐 ${timeStr} น.\n📍 ${lat ? 'ยืนยัน GPS แล้ว' : 'สำนักงาน'}\n\nขอให้ทำงานโชคดีครับ 💪`
  } else {
    const lateMin = Math.round(late)
    msg = `⚠️ เช็คอินสำเร็จ\n👤 ${emp.name}\n🕐 ${timeStr} น.\n⏰ มาสาย ${lateMin} นาที\n\nกรุณาแจ้งเหตุผลกับ HR ด้วยนะครับ`

    // แจ้ง HR / หัวหน้าแผนก
    const dept = await db.getDepartment(emp.department_id)
    if (dept?.manager_line_id) {
      await client.pushMessage(dept.manager_line_id, {
        type: 'text',
        text: `📋 แจ้งเตือน\n${emp.name} มาสาย ${lateMin} นาที\nเวลาเช็คอิน: ${timeStr} น.`
      })
    }
  }

  return client.replyMessage(replyToken, { type: 'text', text: msg })
}

// ── ฟังก์ชัน เช็คเอาท์ ──────────────────────────────────────
async function checkOut(replyToken, emp) {
  const record = await db.getTodayCheckIn(emp.id)
  if (!record) {
    return client.replyMessage(replyToken, {
      type: 'text',
      text: 'ยังไม่ได้เช็คอินวันนี้เลยครับ กรุณาเช็คอินก่อนนะครับ'
    })
  }
  if (record.checkout_time) {
    return client.replyMessage(replyToken, {
      type: 'text', text: `เช็คเอาท์ไปแล้วตั้งแต่ ${formatTime(record.checkout_time)} น. ครับ`
    })
  }

  const now = new Date()
  await db.updateCheckOut(emp.id, now)

  const inTime  = new Date(record.checkin_time)
  const hours   = ((now - inTime) / 3600000).toFixed(1)

  return client.replyMessage(replyToken, {
    type: 'text',
    text: `🏠 เลิกงานแล้วครับ!\n👤 ${emp.name}\n🕐 ${formatTime(now)} น.\n⏱ ทำงาน ${hours} ชั่วโมง\n\nพักผ่อนให้เพียงพอด้วยนะครับ 😊`
  })
}

// ── ฟังก์ชัน ดูสถานะ ────────────────────────────────────────
async function sendStatus(replyToken, emp) {
  const record = await db.getTodayCheckIn(emp.id)
  if (!record) {
    return client.replyMessage(replyToken, {
      type: 'text', text: `สวัสดีครับ ${emp.name}\nวันนี้ยังไม่ได้เช็คอินครับ`
    })
  }
  const inTime  = formatTime(record.checkin_time)
  const outTime = record.checkout_time ? formatTime(record.checkout_time) : 'ยังไม่ได้เช็คเอาท์'
  const status  = record.checkin_type === 'late' ? '⚠️ มาสาย' : '✅ มาตรงเวลา'

  return client.replyMessage(replyToken, {
    type: 'text',
    text: `📊 สถานะวันนี้ของคุณ\n👤 ${emp.name}\n\nเช็คอิน: ${inTime} น.\nเช็คเอาท์: ${outTime}\nสถานะ: ${status}`
  })
}

// ── ฟังก์ชัน ช่วยเหลือ ──────────────────────────────────────
async function sendHelp(replyToken, emp) {
  return client.replyMessage(replyToken, {
    type: 'text',
    text: `สวัสดีครับ ${emp.name} 👋\n\nคำสั่งที่ใช้ได้:\n\n📌 เช็คอิน — บันทึกเวลาเข้างาน\n📌 เช็คเอาท์ — บันทึกเวลาออกงาน\n📌 สถานะ — ดูสถานะวันนี้\n\nหรือส่ง 📍 Location เพื่อยืนยัน GPS ด้วยครับ`
  })
}

// ── Admin API endpoints ──────────────────────────────────────
app.use('/admin', express.json())

// ดูสรุปวันนี้ (ใช้กับ Dashboard)
app.get('/admin/today', async (req, res) => {
  const data = await db.getTodaySummary()
  res.json(data)
})

// เพิ่มพนักงาน
app.post('/admin/employees', async (req, res) => {
  const { name, employee_code, line_user_id, department_id, shift_id } = req.body
  const [result] = await db.pool.query(
    'INSERT INTO employees (name, employee_code, line_user_id, department_id, shift_id) VALUES (?,?,?,?,?)',
    [name, employee_code, line_user_id, department_id, shift_id || 1]
  )
  res.json({ id: result.insertId, message: 'เพิ่มพนักงานสำเร็จ' })
})

// ── Helper functions ─────────────────────────────────────────
function formatTime(d) {
  return new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// ── Start server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  await db.initDB()
  console.log(`🚀 Server รันบน port ${PORT}`)
})
