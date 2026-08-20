import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'
import { evaluateStreak } from '../utils/streak'
import { awardXP, XP_REWARDS } from '../utils/xp'
import { checkAndAwardBadges } from '../utils/badges'
import { startOfDay } from 'date-fns'

const prisma = new PrismaClient()
const router = Router()

router.use(authenticate)

const createSchema = z.object({
  title: z.string().min(2).max(100),
  description: z.string().optional(),
  category: z.enum([
    'FITNESS', 'PRODUCTIVITY', 'LEARNING', 'FINANCE',
    'HEALTH', 'MINDFULNESS', 'CREATIVE', 'CUSTOM'
  ]),
  target: z.number().positive(),
  unit: z.string().min(1),
  duration: z.number().int().min(1).max(365),
  isPublic: z.boolean().default(true),
  emoji: z.string().default('🎯')
})

// POST /api/challenges — Create a challenge
router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = createSchema.parse(req.body)

    const challenge = await prisma.challenge.create({
      data: { ...data, creatorId: req.userId! }
    })

    // Auto-join creator
    await prisma.challengeParticipant.create({
      data: {
        challengeId: challenge.id,
        userId: req.userId!
      }
    })

    await awardXP(req.userId!, XP_REWARDS.CREATE_CHALLENGE, 'creating a challenge');
    await checkAndAwardBadges(req.userId!)

    res.status(201).json(challenge)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/challenges — List public challenges + user's challenges
router.get('/', async (req: AuthRequest, res) => {
  const challenges = await prisma.challenge.findMany({
    where: {
      OR: [
        { isPublic: true },
        { creatorId: req.userId },
        { participants: { some: { userId: req.userId } } }
      ]
    },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      _count: { select: { participants: true } },
      participants: {
        where: { userId: req.userId },
        select: { id: true, streak: true, status: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  res.json(challenges)
})

// GET /api/challenges/:id — Challenge detail
router.get('/:id', async (req: AuthRequest, res) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: req.params.id },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      participants: {
        include: {
          user: { select: { id: true, name: true, avatar: true, level: true } },
          dailyLogs: { orderBy: { date: 'desc' }, take: 30 }
        },
        orderBy: { streak: 'desc' }
      }
    }
  })

  if (!challenge) return res.status(404).json({ error: 'Challenge not found' })
  res.json(challenge)
})

// POST /api/challenges/:id/join — Join a challenge
router.post('/:id/join', async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.challengeParticipant.findUnique({
      where: {
        challengeId_userId: {
          challengeId: req.params.id,
          userId: req.userId!
        }
      }
    })

    if (existing) return res.status(409).json({ error: 'Already joined' });

    const participant = await prisma.challengeParticipant.create({
      data: { challengeId: req.params.id, userId: req.userId! }
    })

    // Notify creator
    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id }
    })
    if (challenge && challenge.creatorId !== req.userId) {
      const user = await prisma.user.findUnique({ where: { id: req.userId } })
      await prisma.notification.create({
        data: {
          userId: challenge.creatorId,
          type: 'FRIEND_JOINED',
          title: '🎉 New Participant!',
          message: `${user?.name} joined "${challenge.title}"!`
        }
      })
    }

    await checkAndAwardBadges(req.userId!)
    res.status(201).json(participant)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/challenges/:id/log — Log today's progress
router.post('/:id/log', async (req: AuthRequest, res) => {
  try {
    const { value, notes } = req.body

    const participant = await prisma.challengeParticipant.findUnique({
      where: {
        challengeId_userId: {
          challengeId: req.params.id,
          userId: req.userId!
        }
      }
    })

    if (!participant) return res.status(404).json({ error: 'Not a participant' })
    if (participant.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Challenge not active' })
    }

    const today = startOfDay(new Date())

    const log = await prisma.dailyLog.upsert({
      where: {
        participantId_date: {
          participantId: participant.id,
          date: today,
        },
      },
      update: { completed: true, value, notes },
      create: {
        participantId: participant.id,
        date: today,
        completed: true,
        value,
        notes
      }
    })

    // Evaluate streak
    const streakResult = await evaluateStreak(participant.id)

    // Award XP
    await awardXP(req.userId!, XP_REWARDS.DAILY_LOG, 'daily log')

    if (streakResult.streak === 7) {
      await awardXP(req.userId!, XP_REWARDS.STREAK_7, '7-day streak')
    }
    if (streakResult.streak === 30) {
      await awardXP(req.userId!, XP_REWARDS.STREAK_30, '30-day streak')
    }

    await checkAndAwardBadges(req.userId!)

    res.json({
      log,
      streak: streakResult.streak,
      broken: streakResult.broken,
      longestStreak: streakResult.longestStreak
    })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/challenges/:id/progress — Get progress data for charts
router.get('/:id/progress', async (req: AuthRequest, res) => {
  const participant = await prisma.challengeParticipant.findUnique({
    where: {
      challengeId_userId: {
        challengeId: req.params.id,
        userId: req.userId!
      },
    },
    include: {
      dailyLogs: { orderBy: { date: 'asc' } },
      challenge: true
    }
  })

  if (!participant) return res.status(404).json({ error: 'Not found' })

  // Build 30-day progress array
  const days = Array.from({ length: participant.challenge.duration }, (_, i) => {
    const date = new Date(participant.joinedAt)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]
    const log = participant.dailyLogs.find(
      (l) => l.date.toISOString().split('T')[0] === dateStr
    )
    return {
      date: dateStr,
      completed: log?.completed ?? false,
      value: log?.value ?? 0
    }
  })

  res.json({
    streak: participant.streak,
    longestStreak: participant.longestStreak,
    totalDays: participant.challenge.duration,
    completedDays: participant.dailyLogs.filter((l) => l.completed).length,
    days
  })
})

export default router