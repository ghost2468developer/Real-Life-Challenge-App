import { PrismaClient } from '@prisma/client'
import { awardXP, XP_REWARDS } from './xp'

const prisma = new PrismaClient()

export const BADGE_DEFINITIONS = [
  {
    name: 'First Step',
    description: 'Complete your first daily log',
    icon: '👣',
    criteria: { type: 'logs', count: 1 },
    xpReward: 25
  },
  {
    name: 'Week Warrior',
    description: 'Maintain a 7-day streak',
    icon: '⚔️',
    criteria: { type: 'streak', count: 7 },
    xpReward: 100
  },
  {
    name: 'Monthly Master',
    description: 'Maintain a 30-day streak',
    icon: '🏆',
    criteria: { type: 'streak', count: 30 },
    xpReward: 500
  },
  {
    name: 'Century Club',
    description: 'Maintain a 100-day streak',
    icon: '💯',
    criteria: { type: 'streak', count: 100 },
    xpReward: 2000
  },
  {
    name: 'Challenge Creator',
    description: 'Create your first challenge',
    icon: '🎨',
    criteria: { type: 'challenges_created', count: 1 },
    xpReward: 50
  },
  {
    name: 'Social Butterfly',
    description: 'Add 5 friends',
    icon: '🦋',
    criteria: { type: 'friends', count: 5 },
    xpReward: 75
  },
  {
    name: 'Multi-Tasker',
    description: 'Join 3 challenges simultaneously',
    icon: '🎪',
    criteria: { type: 'active_challenges', count: 3 },
    xpReward: 100
  },
  {
    name: 'XP Hoarder',
    description: 'Earn 5,000 total XP',
    icon: '💎',
    criteria: { type: 'total_xp', count: 5000 },
    xpReward: 200
  },
  {
    name: 'Early Bird',
    description: 'Log 10 days before 8 AM',
    icon: '🐦',
    criteria: { type: 'early_logs', count: 10 },
    xpReward: 75
  },
  {
    name: 'Iron Will',
    description: 'Never break a streak in a 30-day challenge',
    icon: '🛡️',
    criteria: { type: 'perfect_challenge', count: 1 },
    xpReward: 1000
  }
]

export async function seedBadges() {
  for (const badge of BADGE_DEFINITIONS) {
    await prisma.badge.upsert({
      where: { name: badge.name },
      update: {},
      create: {
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        criteria: JSON.stringify(badge.criteria),
        xpReward: badge.xpReward
      }
    })
  }
}

export async function checkAndAwardBadges(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      badges: { include: { badge: true } },
      participations: {
        include: { dailyLogs: true },
      },
      sentRequests: { where: { status: 'ACCEPTED' } },
      createdChallenges: true
    }
  })

  if (!user) return []

  const earnedBadgeIds = new Set(user.badges.map((ub) => ub.badgeId))
  const newBadges: string[] = []

  const totalLogs = user.participations.reduce(
    (sum, p) => sum + p.dailyLogs.filter((l) => l.completed).length,
    0
  )
  const maxStreak = Math.max(...user.participations.map((p) => p.longestStreak), 0)
  const friendCount = user.sentRequests.length
  const activeChallenges = user.participations.filter(
    (p) => p.status === 'ACTIVE'
  ).length
  const challengesCreated = user.createdChallenges.length

  const checks: Record<string, number> = {
    logs: totalLogs,
    streak: maxStreak,
    friends: friendCount,
    active_challenges: activeChallenges,
    challenges_created: challengesCreated,
    total_xp: user.xp
  }

  const allBadges = await prisma.badge.findMany()

  for (const badge of allBadges) {
    if (earnedBadgeIds.has(badge.id)) continue

    const criteria = JSON.parse(badge.criteria) as { type: string; count: number }
    const currentValue = checks[criteria.type] ?? 0

    if (currentValue >= criteria.count) {
      await prisma.userBadge.create({
        data: { userId, badgeId: badge.id }
      })

      await prisma.notification.create({
        data: {
          userId,
          type: 'BADGE_EARNED',
          title: `${badge.icon} New Badge!`,
          message: `You earned "${badge.name}": ${badge.description}`
        }
      })

      await awardXP(userId, badge.xpReward, `badge: ${badge.name}`)
      newBadges.push(badge.name)
    }
  }

  return newBadges
}