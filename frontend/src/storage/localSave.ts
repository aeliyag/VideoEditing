/** Storage key for a user's media blob in IndexedDB. */
export function mediaRecordKey(userId: string, assetId: string): string {
  return `${userId}:${assetId}`
}

/** Reuse an existing blob unless this asset was explicitly marked dirty. */
export function shouldWriteMediaAsset(
  alreadyStored: boolean,
  assetId: string,
  forceWriteIds?: ReadonlySet<string>,
): boolean {
  if (forceWriteIds?.has(assetId)) {
    return true
  }
  return !alreadyStored
}
