/** Optional document fields for the separately verified artwork of a competition edition. */
export function editionArtworkFields(imageUrl) {
  return imageUrl ? { editionArtwork: { imageUrl, role: "edition_emblem" } } : {};
}
