const express    = require('express')
const app        = express()
const http       = require('http').createServer(app)
const io         = require('socket.io')(http)
const { MongoClient } = require('mongodb')

/* ── KONFIGURACJA — zmień te wartości ── */
const PASSWORD  = process.env.PASSWORD  || 'zmien_haslo'   // hasło do strony
const MONGO_URI = process.env.MONGO_URI || ''               // URI z MongoDB Atlas
const PORT      = process.env.PORT      || 3000

app.use(express.static('public'))

/* ── DANE ── */
let characters = {}   // { charName: { horseLevel, medals, spiritStones, ... } }
let charsList  = {}   // { charName: { icon, ... } }
let charOrder  = []   // kolejność postaci
let tasks      = {}   // { charName: { taskName: { done, custom } } }

let resetHour   = 6
let resetMinute = 0

/* ── MONGODB ── */
let db, col

async function connectDB() {
  if (!MONGO_URI) {
    console.log('Brak MONGO_URI — dane tylko w pamięci (nie przeżyją restartu)')
    startServer()
    return
  }
  try {
    const client = await MongoClient.connect(MONGO_URI)
    db  = client.db('characters_tracker')
    col = db.collection('state')
    const doc = await col.findOne({ _id: 'main' })
    if (doc) {
      characters = doc.characters || {}
      charsList  = doc.charsList  || {}
      charOrder  = doc.charOrder  || []
      tasks      = doc.tasks      || {}
      resetHour   = doc.resetHour   ?? 6
      resetMinute = doc.resetMinute ?? 0
      console.log('Dane wczytane z MongoDB')
    }
    startServer()
  } catch(e) {
    console.error('Błąd MongoDB:', e.message)
    process.exit(1)
  }
}

let saveTimer = null
async function saveNow() {
  if (!col) return
  try {
    await col.replaceOne(
      { _id: 'main' },
      { _id: 'main', characters, charsList, charOrder, tasks, resetHour, resetMinute },
      { upsert: true }
    )
  } catch(e) {
    console.error('Błąd zapisu:', e.message)
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
  const ms = next - now
  setTimeout(() => {
    doReset()
    scheduleReset()
  }, ms)
}

function doReset() {
  // Resetuj tagi dziienne (medale, zadania)
  for (const char in characters) {
    if (characters[char].medals) {
      characters[char].medals.forEach(m => { m.doneToday = false })
    }
  }
  for (const char in tasks) {
    for (const task in tasks[char]) {
      if (!tasks[char][task].custom) {
        tasks[char][task].done = false
      }
    }
  }
  saveData()
  const now = new Date()
  io.emit('tasksUpdate', tasks)
  io.emit('charactersUpdate', characters)
  io.emit('resetTime', { hour: now.getHours(), minute: now.getMinutes() })
  console.log('Reset dzienny wykonany')
}

/* ── SOCKET.IO ── */
function startServer() {
  scheduleReset()

  io.on('connection', socket => {
    // Wyślij dane przy połączeniu
    socket.emit('charsListUpdate', charsList)
    socket.emit('charOrderUpdate', charOrder)
    socket.emit('charactersUpdate', characters)
    socket.emit('tasksUpdate', tasks)
    socket.emit('resetTime', { hour: resetHour, minute: resetMinute })

    // Hasło
    socket.on('checkPassword', (pass, cb) => { if(cb) cb(pass === PASSWORD) })

    // Zarządzanie postaciami
    socket.on('addChar', (name) => {
      if (!charsList[name]) charsList[name] = {}
      if (!charOrder.includes(name)) charOrder.push(name)
      io.emit('charsListUpdate', charsList)
      io.emit('charOrderUpdate', charOrder)
      saveData()
    })
    socket.on('removeChar', (name) => {
      delete charsList[name]
      delete characters[name]
      delete tasks[name]
      charOrder = charOrder.filter(c => c !== name)
      io.emit('charsListUpdate', charsList)
      io.emit('charOrderUpdate', charOrder)
      io.emit('charactersUpdate', characters)
      io.emit('tasksUpdate', tasks)
      saveData()
    })
    socket.on('reorderChars', (order) => {
      charOrder = order
      io.emit('charOrderUpdate', charOrder)
      saveData()
    })
    socket.on('updateBio', (data) => {
      const { char, ...rest } = data
      if (!charsList[char]) charsList[char] = {}
      if (rest.remove) {
        delete characters[char]
      } else {
        if (!characters[char]) characters[char] = {}
        Object.assign(characters[char], rest)
      }
      io.emit('charactersUpdate', characters)
      io.emit('charsListUpdate', charsList)
      saveData()
    })

    // Zadania
    socket.on('addTask', (data) => {
      if (!tasks[data.char]) tasks[data.char] = {}
      tasks[data.char][data.task] = { done: false, custom: true }
      io.emit('tasksUpdate', tasks)
      saveData()
    })
    socket.on('toggleTask', (data) => {
      if (!tasks[data.char]) tasks[data.char] = {}
      if (!tasks[data.char][data.task]) tasks[data.char][data.task] = {}
      tasks[data.char][data.task].done = data.value
      io.emit('tasksUpdate', tasks)
      saveData()
    })
    socket.on('removeTask', (data) => {
      if (tasks[data.char]) delete tasks[data.char][data.task]
      io.emit('tasksUpdate', tasks)
      saveData()
    })

    // Koń
    socket.on('setHorseLevel', (data) => {
      if (!characters[data.char]) characters[data.char] = {}
      characters[data.char].horseLevel = data.level
      io.emit('charactersUpdate', characters)
      saveData()
    })

    // Medale
    socket.on('addMedal', (data) => {
      if (!characters[data.char]) characters[data.char] = {}
      if (!characters[data.char].medals) characters[data.char].medals = []
      characters[data.char].medals.push({ level: data.level, ts: Date.now(), doneToday: false })
      io.emit('charactersUpdate', characters)
      saveData()
    })
    socket.on('removeMedal', (char) => {
      if (characters[char]?.medals?.length) characters[char].medals.pop()
      io.emit('charactersUpdate', characters)
      saveData()
    })

    // Kryształy ducha
    socket.on('spiritStone', (data) => {
      if (!characters[data.char]) characters[data.char] = {}
      if (!characters[data.char].spiritStones) characters[data.char].spiritStones = {}
      if (!characters[data.char].spiritStones[data.stoneId]) characters[data.char].spiritStones[data.stoneId] = {}
      characters[data.char].spiritStones[data.stoneId].hours = data.hours
      io.emit('charactersUpdate', characters)
      saveData()
    })
    socket.on('addStone', (data) => {
      if (!characters[data.char]) characters[data.char] = {}
      if (!characters[data.char].spiritStones) characters[data.char].spiritStones = {}
      characters[data.char].spiritStones[data.stoneId] = { name: data.name, skillLevel: data.skillLevel, hours: 0 }
      io.emit('charactersUpdate', characters)
      saveData()
    })
    socket.on('removeStone', (data) => {
      if (characters[data.char]?.spiritStones) delete characters[data.char].spiritStones[data.stoneId]
      io.emit('charactersUpdate', characters)
      saveData()
    })
    socket.on('renameStone', (data) => {
      if (characters[data.char]?.spiritStones?.[data.stoneId])
        characters[data.char].spiritStones[data.stoneId].name = data.name
      io.emit('charactersUpdate', characters)
      saveData()
    })
    socket.on('setStoneSkillLevel', (data) => {
      if (characters[data.char]?.spiritStones?.[data.stoneId])
        characters[data.char].spiritStones[data.stoneId].level = data.level
      io.emit('charactersUpdate', characters)
      saveData()
    })

    // Godzina resetu
    socket.on('setResetTime', (data) => {
      resetHour   = data.hour   ?? resetHour
      resetMinute = data.minute ?? resetMinute
      scheduleReset()
      saveData()
    })
  })

  http.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`))
}

connectDB()
