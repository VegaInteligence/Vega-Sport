// pg-pool's own pool (pg 8.23.1, the API's lock) on a stand-in for pg's Client, without a base (GH140,
// FAILURE_MODES_OPTIMISATIONS.md). The stand-in does for the pool what pg's Client does:
// - a connection opens on a later turn of the event loop, or is refused with `base.refuse`;
// - its statements run one at a time, in the order sent, each answered by `answer(sql, values)`: rows (nothing is no
//   rows), an Error the base sends back (the connection stays usable), `lose(error)` (the connection dies under the
//   statement), or a promise of one of these (a statement held until the test lets it go);
// - a connection that dies takes no more queries, fails every one sent or queued on it with that error on the next
//   tick, and emits "error" at once, as pg's `_handleErrorEvent` does: an "error" nobody hears throws;
// - a statement sent on a dead connection fails on the next tick without reaching the base (`base.unsent`).
import { EventEmitter } from "node:events";
import pg from "pg";

class Lost {
  constructor(error) {
    this.error = error;
  }
}
/** The outcome of a statement whose connection dies under it. */
export const lose = (error) => new Lost(error);

/** A promise the test resolves: `held.open()`. */
export function gate() {
  let open;
  const held = new Promise((resolve) => (open = resolve));
  return Object.assign(held, { open });
}

/** Turns of the event loop until `condition()` holds. */
export async function until(condition, turns = 1000) {
  for (let i = 0; !condition(); i++) {
    if (i >= turns) throw new Error("the condition never held");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** `{ Pool, base }`: the class to give createReader (`Pool`), and what the stand-in saw: the connections opened
 * (`clients`, numbered from 1, each with its `ended` count), the connections asked for (`attempts`), the statements
 * each received (`sent`, `[number, sql]`) and those refused before reaching it (`unsent`). */
export function standIn(answer) {
  const base = { clients: [], attempts: 0, sent: [], unsent: [], refuse: null };
  class Client extends EventEmitter {
    _queryable = true;
    _ending = false;
    ended = 0;
    #queue = [];
    #active = null;
    connect(callback) {
      base.attempts++;
      setImmediate(() => {
        if (base.refuse) return callback(base.refuse);
        base.clients.push(this);
        this.number = base.clients.length;
        callback();
      });
    }
    query(text, values, callback) {
      if (typeof values === "function") [values, callback] = [undefined, values];
      let result;
      if (!callback) result = new Promise((resolve, reject) => (callback = (error, rows) => (error ? reject(error) : resolve(rows))));
      if (!this._queryable || this._ending) {
        base.unsent.push([this.number, text]);
        process.nextTick(callback, new Error("Client has encountered a connection error and is not queryable"));
      } else {
        this.#queue.push({ text, values, callback });
        this.#next();
      }
      return result;
    }
    #next() {
      if (this.#active || !this.#queue.length) return;
      const query = (this.#active = this.#queue.shift());
      base.sent.push([this.number, query.text]);
      Promise.resolve(answer(query.text, query.values)).then((outcome) =>
        setImmediate(() => {
          if (this.#active !== query) return;
          if (outcome instanceof Lost) return this.lose(outcome.error);
          this.#active = null;
          if (outcome instanceof Error) query.callback(outcome);
          else query.callback(null, { rows: outcome ?? [] });
          this.#next();
        }),
      );
    }
    /** The connection dies, under a statement or idle in the pool. */
    lose(error) {
      this._queryable = false;
      const failed = [this.#active, ...this.#queue].filter(Boolean);
      this.#active = null;
      this.#queue = [];
      for (const query of failed) process.nextTick(query.callback, error);
      this.emit("error", error);
    }
    end(callback) {
      this._ending = true;
      this.ended++;
      setImmediate(() => callback?.());
    }
  }
  class Pool extends pg.Pool {
    constructor(options) {
      super({ ...options, Client });
    }
  }
  return { Pool, base };
}
