import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'
import { checkAndAwardBadges } from '../utils/badges'

const prisma = new PrismaClient()
const router = Router()

router.use(authenticate)

// GET /api/friends — List friends
router.get('/', async (req: AuthRequest, res) => {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { userId: req.userId, status: 'ACCEPTED' },
        { friendId: req.userId, status: 'ACCEPTED' }
      ]
    },
    include: {
      user: { select: { id: true, name: true, avatar: true, xp: true, level: true } },
      friend: { select: { id: true, name: true, avatar: true, xp: true, level: true } }
    }
  })

  const friends = friendships.map((f) =>
    f.userId === req.userId ? f.friend : f.user
  )

  res.json(friends)
})

// GET /api/friends/requests — Pending requests
router.get('/requests', async (req: AuthRequest, res) => {
  const requests = await prisma.friendship.findMany({
    where: { friendId: req.userId, status: 'PENDING' },
    include: {
      user: { select: { id: true, name: true, avatar: true, level: true } }
    }
  })
  res.json(requests)
})

// POST /api/friends/request/:userId — Send friend request
router.post('/request/:userId', async (req: AuthRequest, res) => {
  try {
    if (req.params.userId === req.userId) {
      return res.status(400).json({ error: 'Cannot friend yourself' })
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: req.userId, friendId: req.params.userId },
          { userId: req.params.userId, friendId: req.userId }
        ]
      }
    })

    if (existing) return res.status(409).json({ error: 'Request already exists' })

    const friendship = await prisma.friendship.create({
      data: { userId: req.userId!, friendId: req.params.userId }
    })

    const sender = await prisma.user.findUnique({ where: { id: req.userId } })
    await prisma.notification.create({
      data: {
        userId: req.params.userId,
        type: 'FRIEND_REQUEST',
        title: '👋 Friend Request',
        message: `${sender?.name} wants to be your friend!`
      }
    })

    res.status(201).json(friendship)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/friends/accept/:friendshipId
router.put('/accept/:friendshipId', async (req: AuthRequest, res) => {
  const friendship = await prisma.friendship.update({
    where: { id: req.params.friendshipId, friendId: req.userId },
    data: { status: 'ACCEPTED' }
  })

  await checkAndAwardBadges(req.userId!)
  await checkAndAwardBadges(friendship.userId)
  res.json(friendship)
})

// PUT /api/friends/decline/:friendshipId
router.put('/decline/:friendshipId', async (req: AuthRequest, res) => {
  await prisma.friendship.delete({
    where: { id: req.params.friendshipId, friendId: req.userId }
  })
  res.json({ success: true })
})

// GET /api/friends/search?q= — Search users
router.get('/search', async (req: AuthRequest, res) => {
  const q = (req.query.q as string) || ''
  if (q.length < 2) return res.json([])

  const users = await prisma.user.findMany({
    where: {
      AND: [
        { id: { not: req.userId } },
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } }
          ]
        }
      ]
    },
    select: { id: true, name: true, avatar: true, level: true, xp: true },
    take: 10
  })

  res.json(users)
})

export default router