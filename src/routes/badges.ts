import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

router.use(authenticate)

// GET /api/badges — All badges with user's earned status
router.get('/', async (req: AuthRequest, res) => {
  const allBadges = await prisma.badge.findMany({ orderBy: { xpReward: 'asc' } });
  const userBadges = await prisma.userBadge.findMany({
    where: { userId: req.userId },
    select: { badgeId: true, earnedAt: true }
  })

  const earnedSet = new Map(userBadges.map((ub) => [ub.badgeId, ub.earnedAt]))

  const badges = allBadges.map((b) => ({
    ...b,
    earned: earnedSet.has(b.id),
    earnedAt: earnedSet.get(b.id) ?? null
  }))

  res.json(badges)
})

export default router