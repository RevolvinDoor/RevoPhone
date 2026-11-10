export class MemoryStore {
  rows = new Map();
  async list(kind) { return structuredClone([...this.rows.values()].filter(row => !kind || row.kind === kind)); }
  async get(id) { return structuredClone(this.rows.get(id) || null); }
  async put(rows) { for (const row of rows) this.rows.set(row.id, structuredClone(row)); return structuredClone(rows); }
  async ensure(doc) { if (!this.rows.has(doc.id)) this.rows.set(doc.id, structuredClone(doc)); return this.get(doc.id); }
  async change(id, fn) {
    const row = structuredClone(this.rows.get(id));
    if (!row) throw Error('这条内容已经不在了');
    fn(row); this.rows.set(id, row); return structuredClone(row);
  }
  async remove(id) { this.rows.delete(id); return true; }
  async removeMany(ids) { ids.forEach(id => this.rows.delete(id)); return true; }
}
