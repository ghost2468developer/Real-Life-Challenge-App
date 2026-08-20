import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

router.use(authenticate)

// GET /api/notifications
router.get('/', async (req: AuthRequest, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: 50
  })

  const unreadCount = await prisma.notification.count({
    where: { userId: req.userId, read: false }
  })

  res.json({ notifications, unreadCount })
})

// PUT /api/notifications/read-all
router.put('/read-all', async (req: AuthRequest, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.userId, read: false },
    data: { read: true }
  })
  res.json({ success: true })
})

export default router