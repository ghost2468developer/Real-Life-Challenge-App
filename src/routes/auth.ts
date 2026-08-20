import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

const registerSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(6)
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
})

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = registerSchema.parse(req.body)
    const passwordHash = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: { name, email, passwordHash }
    })

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
      expiresIn: '30d'
    })

    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, xp: user.xp, level: user.level }
    })
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Email already registered' })
    }
    res.status(400).json({ error: err.message })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
      expiresIn: '30d'
    })

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, xp: user.xp, level: user.level }
    })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      xp: true,
      level: true,
      totalStreaks: true,
      createdAt: true,
      badges: { include: { badge: true } },
      participations: {
        include: {
          challenge: true,
          dailyLogs: { orderBy: { date: 'desc' }, take: 7 }
        }
      }
    }
  })

  res.json(user)
})

export default router