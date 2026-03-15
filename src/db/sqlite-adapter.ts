/**
 * SQLite adapter that mimics the Supabase JS client's chainable query API.
 * Controllers can use getDb().from('table').select(...).eq(...) exactly like Supabase.
 */
import Database from 'better-sqlite3';
import * as crypto from 'crypto';

// Maps table name → FK column name used in other tables
const TABLE_TO_FK: Record<string, string> = {
  companies: 'company_id',
  stores: 'store_id',
  users: 'user_id',
  products: 'product_id',
  categories: 'category_id',
  ingredients: 'ingredient_id',
  subscriptions: 'subscription_id',
  sales: 'sale_id',
  staff: 'staff_id',
};

function getFKColumn(table: string): string {
  if (TABLE_TO_FK[table]) return TABLE_TO_FK[table];
  // Heuristic: remove trailing 's', append '_id'
  const singular = table.endsWith('ies')
    ? table.slice(0, -3) + 'y'
    : table.endsWith('s')
    ? table.slice(0, -1)
    : table;
  return `${singular}_id`;
}

interface JoinDef {
  table: string;
  type: 'inner' | 'left';
  alias: string;
  cols: string;
}

interface Condition {
  type: string;
  col: string;
  val: any;
}

type Op = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

class SQLiteQueryBuilder {
  private _db: Database.Database;
  private _table: string;
  private _op: Op = 'select';
  private _selectCols: string = '*';
  private _conditions: Condition[] = [];
  private _orderCol?: string;
  private _orderAsc: boolean = true;
  private _limitNum?: number;
  private _offsetNum?: number;
  private _isSingle: boolean = false;
  private _insertData?: any;
  private _updateData?: any;
  private _upsertData?: any;
  private _countMode?: 'exact';
  private _isHead: boolean = false;
  private _joins: JoinDef[] = [];
  private _postOpReturnCols?: string;
  private _postOpSingle: boolean = false;

  constructor(db: Database.Database, table: string) {
    this._db = db;
    this._table = table;
  }

  // ── Chainable methods ──────────────────────────────────────────────────────

  select(cols: string = '*', options?: { count?: 'exact'; head?: boolean }): this {
    // Called after insert/update/upsert/delete → means "return the data"
    if (this._op !== 'select') {
      this._postOpReturnCols = cols;
      return this;
    }
    this._op = 'select';
    if (options?.count) this._countMode = options.count;
    if (options?.head) this._isHead = options.head;
    this._parseSelectCols(cols);
    return this;
  }

  insert(data: any): this {
    this._op = 'insert';
    this._insertData = data;
    return this;
  }

  update(data: any): this {
    this._op = 'update';
    this._updateData = data;
    return this;
  }

  delete(): this {
    this._op = 'delete';
    return this;
  }

  upsert(data: any, _opts?: any): this {
    this._op = 'upsert';
    this._upsertData = data;
    return this;
  }

  eq(col: string, val: any): this    { this._conditions.push({ type: 'eq',   col, val }); return this; }
  neq(col: string, val: any): this   { this._conditions.push({ type: 'neq',  col, val }); return this; }
  in(col: string, val: any[]): this  { this._conditions.push({ type: 'in',   col, val }); return this; }
  ilike(col: string, val: string): this { this._conditions.push({ type: 'ilike', col, val }); return this; }
  like(col: string, val: string): this  { this._conditions.push({ type: 'like',  col, val }); return this; }
  gte(col: string, val: any): this   { this._conditions.push({ type: 'gte',  col, val }); return this; }
  lte(col: string, val: any): this   { this._conditions.push({ type: 'lte',  col, val }); return this; }
  gt(col: string, val: any): this    { this._conditions.push({ type: 'gt',   col, val }); return this; }
  lt(col: string, val: any): this    { this._conditions.push({ type: 'lt',   col, val }); return this; }
  is(col: string, val: any): this    { this._conditions.push({ type: 'is',   col, val }); return this; }
  not(col: string, _op: string, val: any): this { this._conditions.push({ type: 'neq', col, val }); return this; }

  order(col: string, opts?: { ascending?: boolean }): this {
    this._orderCol = col;
    this._orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number): this     { this._limitNum = n; return this; }
  offset(n: number): this    { this._offsetNum = n; return this; }
  range(from: number, to: number): this {
    this._offsetNum = from;
    this._limitNum = to - from + 1;
    return this;
  }

  single(): this {
    if (this._op === 'insert' || this._op === 'update' || this._op === 'upsert') {
      this._postOpSingle = true;
    } else {
      this._isSingle = true;
      this._limitNum = 1;
    }
    return this;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Split "*, companies!inner(*), stores(*)" respecting nested parens */
  private _parseSelectCols(cols: string): void {
    // Normalize whitespace so multi-line template literals work
    cols = cols.replace(/\s+/g, ' ').trim();

    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of cols) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());

    const mainCols: string[] = [];
    for (const part of parts) {
      // Matches: table!inner(cols) or table!fk_hint(cols)
      const innerHint = part.match(/^(\w+)!(\w+)\((.+)\)$/);
      // Matches: table(cols)
      const left  = part.match(/^(\w+)\((.+)\)$/);
      if (innerHint) {
        const joinType = innerHint[2] === 'inner' ? 'inner' : 'left';
        this._joins.push({ table: innerHint[1], type: joinType, alias: innerHint[1], cols: innerHint[3] });
      } else if (left && !/^(count|sum|avg|min|max)\(/.test(part)) {
        this._joins.push({ table: left[1], type: 'left', alias: left[1], cols: left[2] });
      } else {
        mainCols.push(part);
      }
    }
    this._selectCols = mainCols.join(', ') || '*';
  }

  private _coerce(val: any): any {
    if (val === null || val === undefined) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val;
  }

  private _buildWhere(): { sql: string; params: any[] } {
    if (!this._conditions.length) return { sql: '', params: [] };
    const clauses: string[] = [];
    const params: any[] = [];

    for (const c of this._conditions) {
      switch (c.type) {
        case 'eq':
          c.val === null
            ? clauses.push(`"${c.col}" IS NULL`)
            : (clauses.push(`"${c.col}" = ?`), params.push(this._coerce(c.val)));
          break;
        case 'neq':
          c.val === null
            ? clauses.push(`"${c.col}" IS NOT NULL`)
            : (clauses.push(`"${c.col}" != ?`), params.push(this._coerce(c.val)));
          break;
        case 'in':
          if (!c.val?.length) { clauses.push('1=0'); break; }
          clauses.push(`"${c.col}" IN (${c.val.map(() => '?').join(',')})`);
          params.push(...c.val.map((v: any) => this._coerce(v)));
          break;
        case 'ilike':
        case 'like':
          clauses.push(`"${c.col}" LIKE ? COLLATE NOCASE`);
          params.push(this._coerce(c.val));
          break;
        case 'gte': clauses.push(`"${c.col}" >= ?`); params.push(this._coerce(c.val)); break;
        case 'lte': clauses.push(`"${c.col}" <= ?`); params.push(this._coerce(c.val)); break;
        case 'gt':  clauses.push(`"${c.col}" > ?`);  params.push(this._coerce(c.val)); break;
        case 'lt':  clauses.push(`"${c.col}" < ?`);  params.push(this._coerce(c.val)); break;
        case 'is':
          c.val === null
            ? clauses.push(`"${c.col}" IS NULL`)
            : (clauses.push(`"${c.col}" IS ?`), params.push(this._coerce(c.val)));
          break;
      }
    }
    return { sql: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', params };
  }

  private _serialize(val: any): any {
    if (val === null || val === undefined) return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'object') return JSON.stringify(val);
    return val;
  }

  private _applyJoins(row: any): any | null {
    if (!this._joins.length) return row;
    const result = { ...row };
    for (const join of this._joins) {
      const fkCol = getFKColumn(join.table);
      const fkVal = row[fkCol];
      if (fkVal == null) {
        if (join.type === 'inner') return null; // inner join fails → exclude row
        result[join.alias] = null;
        continue;
      }
      try {
        // Strip nested relation syntax (table!hint(...) or table(...)) from joinCols
        // as SQLite cannot handle Supabase join expressions inside SELECT
        const rawCols = join.cols === '*' ? '*' : join.cols;
        const simpleCols = rawCols === '*' ? '*' : rawCols
          .split(',')
          .map(c => c.trim())
          .filter(c => !c.includes('('))
          .join(', ') || '*';
        const joinCols = simpleCols;
        const stmt = this._db.prepare(`SELECT ${joinCols} FROM "${join.table}" WHERE id = ?`);
        const joinRow = stmt.get(fkVal) as any;
        if (join.type === 'inner' && !joinRow) return null;
        result[join.alias] = joinRow || null;
      } catch {
        result[join.alias] = null;
      }
    }
    return result;
  }

  // ── Execute ────────────────────────────────────────────────────────────────

  private _execute(): { data: any; error: any; count?: number | null } {
    try {
      switch (this._op) {
        case 'select': return this._doSelect();
        case 'insert': return this._doInsert();
        case 'update': return this._doUpdate();
        case 'delete': return this._doDelete();
        case 'upsert': return this._doUpsert();
        default:       return { data: null, error: new Error('Unknown op') };
      }
    } catch (err: any) {
      console.error(`❌ SQLite [${this._table}]:`, err.message);
      return { data: null, error: { message: err.message, code: 'SQLITE_ERROR' } };
    }
  }

  private _doSelect(): { data: any; error: any; count?: number | null } {
    const { sql: where, params } = this._buildWhere();

    // Head count only
    if (this._isHead && this._countMode) {
      const row = this._db.prepare(`SELECT COUNT(*) as cnt FROM "${this._table}"${where}`).get(...params as any) as any;
      return { data: null, error: null, count: Number(row?.cnt ?? 0) };
    }

    let sql = `SELECT ${this._selectCols} FROM "${this._table}"${where}`;
    if (this._orderCol) sql += ` ORDER BY "${this._orderCol}" ${this._orderAsc ? 'ASC' : 'DESC'}`;
    if (this._limitNum  !== undefined) sql += ` LIMIT ${this._limitNum}`;
    if (this._offsetNum !== undefined) sql += ` OFFSET ${this._offsetNum}`;

    if (this._isSingle) {
      const row = this._db.prepare(sql).get(...params as any);
      if (!row) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
      const result = this._applyJoins(row as any);
      if (result === null) return { data: null, error: { message: 'Related row not found (inner join)', code: 'PGRST116' } };
      return { data: result, error: null };
    }

    const rows = this._db.prepare(sql).all(...params as any) as any[];
    const results = rows.map(r => this._applyJoins(r)).filter(r => r !== null);

    if (this._countMode) {
      const countRow = this._db.prepare(`SELECT COUNT(*) as cnt FROM "${this._table}"${where}`).get(...params as any) as any;
      return { data: results, error: null, count: Number(countRow?.cnt ?? 0) };
    }
    return { data: results, error: null };
  }

  private _doInsert(): { data: any; error: any } {
    const items = Array.isArray(this._insertData) ? this._insertData : [this._insertData];
    const results: any[] = [];

    for (const item of items) {
      const row = { ...item };
      if (!row.id) row.id = crypto.randomUUID();
      if (!row.created_at) row.created_at = new Date().toISOString();
      if ('updated_at' in row || Object.keys(row).some(k => k === 'updated_at')) {
        row.updated_at = new Date().toISOString();
      }

      const cols = Object.keys(row);
      const sql = `INSERT INTO "${this._table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      this._db.prepare(sql).run(...cols.map(c => this._serialize(row[c])) as any);

      const inserted = this._db.prepare(`SELECT * FROM "${this._table}" WHERE id = ?`).get(row.id) as any;
      results.push(inserted);
    }

    const isSingle = this._isSingle || this._postOpSingle || !Array.isArray(this._insertData);
    return { data: isSingle ? (results[0] || null) : results, error: null };
  }

  private _doUpdate(): { data: any; error: any } {
    const data = { ...this._updateData };
    // Auto-update timestamp if column exists (we try, schema may not have it)
    data.updated_at = new Date().toISOString();

    const cols = Object.keys(data);
    const { sql: where, params: whereParams } = this._buildWhere();
    const sql = `UPDATE "${this._table}" SET ${cols.map(c => `"${c}" = ?`).join(', ')}${where}`;
    this._db.prepare(sql).run(...[...cols.map(c => this._serialize(data[c])), ...whereParams] as any);

    // If .select() was chained → return the updated rows
    if (this._postOpReturnCols !== undefined || this._postOpSingle) {
      const { sql: retWhere, params: retParams } = this._buildWhere();
      const retSQL = `SELECT * FROM "${this._table}"${retWhere}${this._postOpSingle ? ' LIMIT 1' : ''}`;
      if (this._postOpSingle) {
        return { data: this._db.prepare(retSQL).get(...retParams as any) || null, error: null };
      }
      return { data: this._db.prepare(retSQL).all(...retParams as any), error: null };
    }
    return { data: null, error: null };
  }

  private _doDelete(): { data: any; error: any } {
    const { sql: where, params } = this._buildWhere();
    this._db.prepare(`DELETE FROM "${this._table}"${where}`).run(...params as any);
    return { data: null, error: null };
  }

  private _doUpsert(): { data: any; error: any } {
    const items = Array.isArray(this._upsertData) ? this._upsertData : [this._upsertData];
    const lastId: string[] = [];

    for (const item of items) {
      const row = { ...item };
      if (!row.id) row.id = crypto.randomUUID();
      if (!row.created_at) row.created_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      lastId.push(row.id);

      const cols = Object.keys(row);
      const updateSet = cols.filter(c => c !== 'id').map(c => `"${c}" = excluded."${c}"`).join(', ');
      const sql = `INSERT INTO "${this._table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
      this._db.prepare(sql).run(...cols.map(c => this._serialize(row[c])) as any);
    }

    const result = this._db.prepare(`SELECT * FROM "${this._table}" WHERE id = ?`).get(lastId[lastId.length - 1]) as any;
    const isSingle = this._isSingle || this._postOpSingle || !Array.isArray(this._upsertData);
    return { data: isSingle ? result : [result], error: null };
  }

  // ── Thenable (makes await work) ────────────────────────────────────────────
  then<T, E>(
    onfulfilled?: ((v: any) => T | PromiseLike<T>) | null,
    onrejected?: ((r: any) => E | PromiseLike<E>) | null
  ): Promise<T | E> {
    return Promise.resolve(this._execute()).then(onfulfilled as any, onrejected as any);
  }

  catch<E>(onrejected?: ((r: any) => E | PromiseLike<E>) | null): Promise<any> {
    return Promise.resolve(this._execute()).catch(onrejected as any);
  }

  finally(cb?: (() => void) | null): Promise<any> {
    return Promise.resolve(this._execute()).finally(cb as any);
  }
}

// ── Public adapter class ─────────────────────────────────────────────────────

export class SQLiteAdapter {
  private _db: Database.Database;

  constructor(dbPath: string) {
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
  }

  from(table: string): SQLiteQueryBuilder {
    return new SQLiteQueryBuilder(this._db, table);
  }

  /** Access raw Database for schema init or transactions */
  getDb(): Database.Database {
    return this._db;
  }
}
