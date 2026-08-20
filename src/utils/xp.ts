import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// XP rewards
export const XP_REWARDS = {
  DAILY_LOG: 25,
  STREAK_7: 100,
  STREAK_30: 500,
  STREAK_100: 2000,
  CHALLENGE_COMPLETE: 1000,
  BADGE_EARNED: 50,
  FRIEND_JOIN: 15,
  CREATE_CHALLENGE: 50
} as const

// Level formula: level = floor(sqrt(xp / 100)) + 1
export function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1
}

export function xpForNextLevel(currentLevel: number): number {
  return Math.pow(currentLevel, 2) * 100
}

export function xpProgressInLevel(xp: number): { current: number; needed: number; percent: number } {
  const level = calculateLevel(xp)
  const currentLevelXP = Math.pow(level - 1, 2) * 100
  const nextLevelXP = Math.pow(level, 2) * 100
  const current = xp - currentLevelXP
  const needed = nextLevelXP - currentLevelXP
  return { current, needed, percent: Math.round((current / needed) * 100) }
}

export async function awardXP(userId: string, amount: number, reason: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return

  const newXP = user.xp + amount
  const oldLevel = user.level
  const newLevel = calculateLevel(newXP)

  await prisma.user.update({
    where: { id: userId },
    data: { xp: newXP, level: newLevel }
  })

  if (newLevel > oldLevel) {
    await prisma.notification.create({
      data: {
        userId,
        type: 'LEVEL_UP',
        title: '🎉 Level Up!',
        message: `You reached Level ${newLevel}! (+${amount} XP for ${reason})`
      }
    })
  }

  return { newXP, newLevel, leveledUp: newLevel > oldLevel }
}