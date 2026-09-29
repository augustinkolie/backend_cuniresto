import type { User } from '@prisma/client'

/** Représentation publique d'un utilisateur : jamais de hachage ni de secret. */
export function presentUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    birthDate: u.birthDate ? u.birthDate.toISOString().slice(0, 10) : null,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    coverUrl: u.coverUrl,
    role: u.role,
    referralCode: u.referralCode,
    orangeMoneyNumber: u.orangeMoneyNumber,
    hasPassword: !!u.passwordHash,
    isGoogleLinked: !!u.googleId,
    createdAt: u.createdAt,
  }
}

export type UserView = ReturnType<typeof presentUser>

/** Fiche réduite pour la messagerie et les listes. */
export const publicUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  role: true,
} as const
