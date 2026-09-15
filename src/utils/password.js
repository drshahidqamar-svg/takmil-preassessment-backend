import bcrypt from 'bcryptjs'

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10)
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash)
}

// Used by bulk teacher upload when no password is supplied in the sheet.
// Not cryptographically paranoid -- it just needs to be unguessable and
// easy for an admin to read aloud or type once while handing it to a
// teacher, since there's no email/SMS delivery mechanism in this system.
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
export function generateTempPassword(length = 10) {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)]
  }
  return out
}
