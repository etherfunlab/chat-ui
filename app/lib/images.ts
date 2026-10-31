/** Long edge after downscaling; large enough for vision models to read text. */
export const IMAGE_MAX_EDGE = 1568
export const IMAGE_QUALITY = 0.85

export function fitWithin(width: number, height: number, maxEdge: number): { width: number, height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Decodes an image file and re-encodes it as a JPEG data URL within IMAGE_MAX_EDGE. */
export async function downscaleImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
}
