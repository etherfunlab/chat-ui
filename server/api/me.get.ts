import { getSessionWallet } from '#server/utils/session'
import { getServerConfig } from '#server/utils/config'
import { getPool } from '#server/utils/db'

export default defineEventHandler(async (event) => {
  const wallet = await getSessionWallet(event)
  if (!wallet) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { rows } = await getPool().query(
    'SELECT (balance_micro - held_micro)::text AS available FROM accounts WHERE wallet = $1',
    [wallet],
  )
  const available = (rows[0] as { available: string } | undefined)?.available ?? '0'
  return { wallet, billing: getServerConfig().billing, availableMicro: available }
})
