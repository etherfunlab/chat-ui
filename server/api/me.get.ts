import { getSessionWallet } from '#server/utils/session'
import { getPool } from '#server/utils/db'

export default defineEventHandler(async (event) => {
  const wallet = await getSessionWallet(event)
  if (!wallet) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { rows } = await getPool().query('SELECT balance_micro FROM accounts WHERE wallet = $1', [wallet])
  const balance = (rows[0] as { balance_micro: string } | undefined)?.balance_micro ?? '0'
  return { wallet, balanceMicro: balance }
})
