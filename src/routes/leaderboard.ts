import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

router.use(authenticate)

// GET /api/leaderboard/global — Global XP leaderboard
router.get('/global', async (req: AuthRequest, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      avatar: true,
      xp: true,
      level: true,
      totalStreaks: true
    },
    orderBy: { xp: 'desc' },
    take: 50
  })

  const ranked = users.map((u, i) => ({ ...u, rank: i + 1 }))
  const userRank = ranked.find((u) => u.id === req.userId)

  res.json({ leaderboard: ranked, yourRank: userRank })
})

// GET /api/leaderboard/friends — Friends-only leaderboard
router.get('/friends', async (req: AuthRequest, res) => {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { userId: req.userId, status: 'ACCEPTED' },
        { friendId: req.userId, status: 'ACCEPTED' }
      ]
    }
  })

  const friendIds = friendships.map((f) =>
    f.userId === req.userId ? f.friendId : f.userId
  )
  friendIds.push(req.userId!)

  const users = await prisma.user.findMany({
    where: { id: { in: friendIds } },
    select: {
      id: true,
      name: true,
      avatar: true,
      xp: true,
      level: true
    },
    orderBy: { xp: 'desc' }
  })

  const ranked = users.map((u, i) => ({ ...u, rank: i + 1 }));
  res.json(ranked)
})

// GET /api/leaderboard/challenge/:id — Challenge-specific leaderboard
router.get('/challenge/:id', async (req: AuthRequest, res) => {
  const participants = await prisma.challengeParticipant.findMany({
    where: { challengeId: req.params.id },
    include: {
      user: { select: { id: true, name: true, avatar: true, level: true } },
    },
    orderBy: { streak: 'desc' }
  })

  const ranked = participants.map((p, i) => ({
    rank: i + 1,
    userId: p.user.id,
    name: p.user.name,
    avatar: p.user.avatar,
    level: p.user.level,
    streak: p.streak,
    longestStreak: p.longestStreak,
    totalXP: p.totalXP,
    status: p.status
  }))

  res.json(ranked)
})

// GET /api/leaderboard/streaks — Best streaks leaderboard
router.get('/streaks', async (req: AuthRequest, res) => {
  const participants = await prisma.challengeParticipant.findMany({
    where: { longestStreak: { gt: 0 } },
    include: {
      user: { select: { id: true, name: true, avatar: true } },
      challenge: { select: { title: true, emoji: true } },
    },
    orderBy: { longestStreak: 'desc' },
    take: 50
  })

  const ranked = participants.map((p, i) => ({
    rank: i + 1,
    name: p.user.name,
    avatar: p.user.avatar,
    challenge: `${p.challenge.emoji} ${p.challenge.title}`,
    longestStreak: p.longestStreak,
    currentStreak: p.streak
  }))

  res.json(ranked)
})

export default router