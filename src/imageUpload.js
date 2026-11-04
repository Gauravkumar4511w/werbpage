// Phone screenshots are often 3-8 MB and the server takes up to 2 MB, so they are scaled down
// and re-encoded as JPEG before upload. Screenshots stay readable at this size.
const MAX_SIDE = 1600
const MAX_BYTES = 1.8 * 1024 * 1024

export async function imageFileToDataUrl(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose an image file (PNG, JPG or WebP).')
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This image could not be opened. Try another screenshot.')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  // JPEG has no transparency; a white background keeps transparent PNGs readable.
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  for (const quality of [0.85, 0.7, 0.5]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length * 0.75 < MAX_BYTES) return dataUrl
  }
  throw new Error('This screenshot is too large. Crop it and try again.')
}
