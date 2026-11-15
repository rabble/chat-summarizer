export function buildDigestDelivery(
  recipientJid: string,
  markdown: string,
  configuredGroupJid?: string,
): { recipientJid: string; message: { text: string } } {
  const configuredGroup = /^\d+(?:-\d+)?@g\.us$/.test(recipientJid) &&
    recipientJid === configuredGroupJid;
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(recipientJid) && !configuredGroup) {
    throw new Error('Digest delivery requires one direct WhatsApp recipient');
  }
  if (markdown.trim().length === 0) {
    throw new Error('Cannot deliver an empty digest');
  }
  return { recipientJid, message: { text: markdown } };
}

export function buildDigestDeliveries(
  recipientJid: string,
  markdown: string,
  maxCharacters = 2_500,
  configuredGroupJid?: string,
): Array<{ recipientJid: string; message: { text: string } }> {
  buildDigestDelivery(recipientJid, markdown, configuredGroupJid);
  if (maxCharacters < 80) {
    throw new Error('Digest delivery chunk size is too small');
  }
  const contentBudget = maxCharacters - 32;
  const chunks: string[] = [];
  let remaining = markdown.trim();
  while (remaining.length > contentBudget) {
    const paragraphBoundary = remaining.lastIndexOf('\n\n', contentBudget);
    const lineBoundary = remaining.lastIndexOf('\n', contentBudget);
    const spaceBoundary = remaining.lastIndexOf(' ', contentBudget);
    const preferred = Math.max(paragraphBoundary, lineBoundary, spaceBoundary);
    const cut = preferred >= contentBudget / 2 ? preferred : contentBudget;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);
  if (chunks.length === 1) return [buildDigestDelivery(recipientJid, chunks[0]!, configuredGroupJid)];

  return chunks.map((chunk, index) =>
    buildDigestDelivery(
      recipientJid,
      `Community Brief ${index + 1}/${chunks.length}\n\n${chunk}`,
      configuredGroupJid,
    ),
  );
}
