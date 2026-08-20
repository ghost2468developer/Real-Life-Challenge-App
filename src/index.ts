import express from 'express'
import cors from 'cors'
import { checkAllStreaks } from './utils/streak'
import { seedBadges } from './utils/badges'

import authRoutes from './routes/auth'
import challengeRoutes from './routes/challenges'
import friendRoutes from './routes/friends'
import leaderboardRoutes from './routes/leaderboard'
import badgeRoutes from './routes/badges'
import notificationRoutes from './routes/notifications'

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/challenges', challengeRoutes)
app.use('/api/friends', friendRoutes)
app.use('/api/leaderboard', leaderboardRoutes)
app.use('/api/badges', badgeRoutes)
app.use('/api/notifications', notificationRoutes)

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok' }))

// Cron: Check streaks every hour (use node-cron in production)
setInterval(async () => {
  console.log('🕐 Running streak check...')
  const broken = await checkAllStreaks()
  if (broken.length > 0) {
    console.log(`❌ ${broken.length} streaks broken`)
  }
}, 60 * 60 * 1000)

app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await seedBadges()
  console.log('🏅 Badges seeded')
})