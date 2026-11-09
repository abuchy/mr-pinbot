export type ImportProgress = 'queued' | 'processing' | 'completed' | 'attention';

export async function processImportQueue<T extends { id: string }>(
  items: T[],
  processItem: (item: T) => Promise<boolean>,
  update: (id: string, status: ImportProgress) => void,
) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      update(item.id, 'processing');
      let complete = false;
      try {
        complete = await processItem(item);
      } catch {
        // The item was saved before enrichment and can be retried independently.
      }
      update(item.id, complete ? 'completed' : 'attention');
    }
  }
  await Promise.all(Array.from({ length: Math.min(items.length, 2) }, worker));
}
