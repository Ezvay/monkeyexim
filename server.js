const express    = require('express')
const app        = express()
const http       = require('http').createServer(app)
const io         = require('socket.io')(http)
const { MongoClient } = require('mongodb')

/* ── KONFIGURACJA ── */
const PASSWORD  = process.env.PASSWORD  || 'zmien_haslo'
const MONGO_URI = process.env.MONGO_URI || ''
const PORT      = process.env.PORT      || 3000

app.use(express.static('public'))
app.get('/', (req, res) => res.redirect('/characters.html'))

/* ── DANE ── */
let characters = {}
let charsList  = {}
let charOrder  = []
let tasks      = {}
let resetHour   = 6
let resetMinute = 0

/* ── MONGODB ── */
let col = null

async function connectDB() {
  if (!MONGO_URI) {
    console.log('⚠️  BRAK MONGO_URI — dane nie będą zapisywane po restarcie!')
    console.log('   Ustaw zmienną MONGO_URI w Environment Variables na Render.com')
    return
  }
  try {
    console.log('Łączenie z MongoDB...')
    const client = await MongoClient.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    })
    const db = client.db('characters_tracker')
    col = db.collection('state')
    const doc = await col.findOne({ _id: 'main' })
    if (doc) {
      characters  = doc.characters  || {}
      charsList   = doc.charsList   || {}
      charOrder   = doc.charOrder   || []
      tasks       = doc.tasks       || {}
      resetHour   = doc.resetHour   ?? 6
      resetMinute = doc.resetMinute ?? 0
      console.log('✅ Dane wczytane z MongoDB')
    } else {
      console.log('✅ Połączono z MongoDB (brak danych — start od zera)')
    }
  } catch(e) {
    console.error('❌ Błąd MongoDB:', e.message)
    console.error('   Sprawdź czy MONGO_URI jest poprawne i IP 0.0.0.0/0 jest dodane w Network Access')
  }
}

let saveTimer = null
async function saveNow() {
  if (!col) {
    console.log('⚠️  Zapis pominięty — brak połączenia z MongoDB')
    return
  }
  try {
    await col.replaceOne(
      { _id: 'main' },
      { _id: 'main', characters, charsList, charOrder, tasks, resetHour, resetMinute },
      { upsert: true }
    )
    console.log('💾 Zapisano do MongoDB')
  } catch(e) {
    console.error('❌ Błąd zapisu:', e.message)
  }
}
function saveData() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}

/* ── RESET DZIENNY ── */
function scheduleReset() {
  const now = new Date()
  const next = new Date()
  next.setHours(resetHour, resetMinute, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  setTimeout(() => { doReset(); scheduleReset() }, next - now)
}

function doReset() {
  for (const char in characters) {
    if (characters[char].medals) {
      characters[char].medals.forEach(m => { m.doneToday = false })
    }
  }
  for (const char in tasks) {
    for (const task in tasks[char]) {
      if (!tasks[char][task].custom) tasks[char][task].done = false
    }
  }
  saveData()
  io.emit('tasksUpdate', tasks)
  io.emit('charactersUpdate', characters)
  io.emit('resetTime', { hour: resetHour, minute: resetMinute })
  console.log('🔄 Reset dzienny wykonany')
}

/* ── SOCKET.IO ── */
io.on('connection', socket => {
  console.log('👤 Nowe połączenie')

  socket.emit('charsListUpdate',  charsList)
  socket.emit('charOrderUpdate',  charOrder)
  socket.emit('charactersUpdate', characters)
  socket.emit('tasksUpdate',      tasks)
  socket.emit('resetTime', { hour: resetHour, minute: resetMinute })

  socket.on('checkPassword', (pass, cb) => { if (cb) cb(pass === PASSWORD) })

  socket.on('addChar', (data) => {
    const name = (typeof data === 'object') ? data.name : data
    const icon = (typeof data === 'object') ? (data.icon || '') : ''
    if (!name) return
    if (!charsList[name]) charsList[name] = { icon }
    else charsList[name].icon = icon
    if (!charOrder.includes(name)) charOrder.push(name)
    io.emit('charsListUpdate', charsList)
    io.emit('charOrderUpdate',  charOrder)
    saveData()
  })

  socket.on('removeChar', (data) => {
    const name = (typeof data === 'object') ? data.name : data
    if (!name) return
    delete charsList[name]
    delete characters[name]
    delete tasks[name]
    charOrder = charOrder.filter(c => c !== name)
    io.emit('charsListUpdate',  charsList)
    io.emit('charOrderUpdate',  charOrder)
    io.emit('charactersUpdate', characters)
    io.emit('tasksUpdate',      tasks)
    saveData()
  })

  socket.on('reorderChars', (order) => {
    charOrder = order
    io.emit('charOrderUpdate', charOrder)
    saveData()
  })

  socket.on('updateBio', (data) => {
    const { char, ...rest } = data
    if (!char) return
    if (!characters[char]) characters[char] = {}
    if (rest.remove) delete characters[char]
    else Object.assign(characters[char], rest)
    io.emit('charactersUpdate', characters)
    saveData()
  })

  socket.on('addTask', (data) => {
    if (!tasks[data.char]) tasks[data.char] = {}
    tasks[data.char][data.task] = { done: false, custom: true }
    io.emit('tasksUpdate', tasks); saveData()
  })
  socket.on('toggleTask', (data) => {
    if (!tasks[data.char]) tasks[data.char] = {}
    if (!tasks[data.char][data.task]) tasks[data.char][data.task] = {}
    tasks[data.char][data.task].done = data.value
    io.emit('tasksUpdate', tasks); saveData()
  })
  socket.on('removeTask', (data) => {
    if (tasks[data.char]) delete tasks[data.char][data.task]
    io.emit('tasksUpdate', tasks); saveData()
  })

  socket.on('setHorseLevel', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    characters[data.char].horseLevel = data.level
    io.emit('charactersUpdate', characters); saveData()
  })

  socket.on('addMedal', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    if (!characters[data.char].medals) characters[data.char].medals = []
    characters[data.char].medals.push({ level: data.level, ts: Date.now(), doneToday: false })
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('removeMedal', (char) => {
    if (characters[char]?.medals?.length) characters[char].medals.pop()
    io.emit('charactersUpdate', characters); saveData()
  })

  socket.on('spiritStone', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    if (!characters[data.char].spiritStones) characters[data.char].spiritStones = {}
    if (!characters[data.char].spiritStones[data.stoneId]) characters[data.char].spiritStones[data.stoneId] = {}
    characters[data.char].spiritStones[data.stoneId].hours = data.hours
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('addStone', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    if (!characters[data.char].spiritStones) characters[data.char].spiritStones = {}
    characters[data.char].spiritStones[data.stoneId] = { name: data.name, skillLevel: data.skillLevel, hours: 0 }
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('removeStone', (data) => {
    if (characters[data.char]?.spiritStones) delete characters[data.char].spiritStones[data.stoneId]
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('renameStone', (data) => {
    if (characters[data.char]?.spiritStones?.[data.stoneId])
      characters[data.char].spiritStones[data.stoneId].name = data.name
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('setStoneSkillLevel', (data) => {
    if (characters[data.char]?.spiritStones?.[data.stoneId])
      characters[data.char].spiritStones[data.stoneId].level = data.level
    io.emit('charactersUpdate', characters); saveData()
  })

  socket.on('setResetTime', (data) => {
    resetHour   = data.hour   ?? resetHour
    resetMinute = data.minute ?? resetMinute
    scheduleReset(); saveData()
  })
})

/* ── START ── */
connectDB().then(() => {
  scheduleReset()
  http.listen(PORT, () => console.log(`✅ Serwer działa na porcie ${PORT}`))
})
