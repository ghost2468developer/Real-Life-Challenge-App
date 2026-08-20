// backend/src/utils/streak.ts
import { PrismaClient } from '@prisma/client'
import {
  startOfDay,
  subDays,
  isSameDay,
  differenceInDays,
  parseISO
} from 'date-fns'

const prisma = new PrismaClient()

/**
 * Core streak logic:
 * - If today's log exists → streak stays
 * - If yesterday was logged → streak continues
 * - If gap > 1 day → streak breaks
 */
export async function evaluateStreak(participantId: string): Promise<{
  streak: number
  broken: boolean
  longestStreak: number
}> {
  const participant = await prisma.challengeParticipant.findUnique({
    where: { id: participantId },
    include: { dailyLogs: { orderBy: { date: 'desc' } } }
  })

  if (!participant) throw new Error('Participant not found')

  const today = startOfDay(new Date())
  const yesterday = startOfDay(subDays(new Date(), 1))

  const logs = participant.dailyLogs
    .filter((l) => l.completed)
    .map((l) => startOfDay(l.date))

  if (logs.length === 0) {
    return { streak: 0, broken: false, longestStreak: participant.longestStreak }
  }

  const latestLog = logs[0]
  const hasToday = isSameDay(latestLog, today)
  const hasYesterday = logs.some((l) => isSameDay(l, yesterday))

  let streak = participant.streak
  let broken = false

  if (!hasToday && !hasYesterday) {
    // Streak is broken
    broken = true
    streak = 0
  }

  // Recalculate streak from logs
  if (!broken) {
    let calcStreak = 0
    let checkDate = hasToday ? today : yesterday

    for (const log of logs) {
      if (isSameDay(log, checkDate)) {
        calcStreak++;
        checkDate = subDays(checkDate, 1)
      } else if (log < checkDate) {
        break
      }
    }
    streak = calcStreak
  }

  const longestStreak = Math.max(streak, participant.longestStreak)

  await prisma.challengeParticipant.update({
    where: { id: participantId },
    data: {
      streak,
      longestStreak,
      status: broken ? 'BROKEN' : participant.status,
      lastLogDate: hasToday ? today : participant.lastLogDate
    }
  })

  // Notify if streak broke
  if (broken && participant.streak > 0) {
    await prisma.notification.create({
      data: {
        userId: participant.userId,
        type: 'STREAK_BROKEN',
        title: '💔 Streak Broken!',
        message: `You lost your ${participant.streak}-day streak. Start fresh!`
      }
    })
  }

  // Milestone notifications
  if (streak > 0 && streak % 7 === 0 && streak !== participant.streak) {
    await prisma.notification.create({
      data: {
        userId: participant.userId,
        type: 'STREAK_MILESTONE',
        title: '🔥 Streak Milestone!',
        message: `Amazing! You've hit a ${streak}-day streak!`
      }
    })
  }

  return { streak, broken, longestStreak }
}

/**
 * Check all active participants for broken streaks (run as cron)
 */
export async function checkAllStreaks() {
  const activeParticipants = await prisma.challengeParticipant.findMany({
    where: { status: 'ACTIVE', streak: { gt: 0 } }
  })

  const results: { userId: string; name: string; streak: number }[] = []

  for (const p of activeParticipants) {
    const { broken, streak } = await evaluateStreak(p.id)
    if (broken) {
      const user = await prisma.user.findUnique({ where: { id: p.userId } })
      if (user) {
        results.push({ userId: user.id, name: user.name, streak: p.streak })

        // Notify friends about broken streak
        const friends = await prisma.friendship.findMany({
          where: {
            OR: [
              { userId: user.id, status: 'ACCEPTED' },
              { friendId: user.id, status: 'ACCEPTED' }
            ]
          }
        })

        for (const f of friends) {
          const friendId = f.userId === user.id ? f.friendId : f.userId;
          await prisma.notification.create({
            data: {
              userId: friendId,
              type: 'STREAK_BROKEN',
              title: '😬 Friend Lost Streak',
              message: `${user.name} broke their ${p.streak}-day streak!`
            }
          })
        }
      }
    }
  }

  return results
}